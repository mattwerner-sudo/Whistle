import { db } from "../db";
import { linkedinConnections, staffMembers, schoolDirectories, signals, type LinkedinConnection, type StaffMember } from "@shared/schema";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { nameSimilarity } from "../staffExtractor";

function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return null;
  return m[1].toLowerCase().replace(/\/$/, "");
}

function tokenizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z\s]/g, "").trim();
}

interface MatchResult {
  staffId: number;
  schoolId: string;
  schoolName: string;
  staffName: string;
  staffTitle: string | null;
  confidence: number;
}

// Cached "all schools" snapshot for the fuzzy matcher.
// Reused across an entire ingestion batch so we don't re-query ~1200 schools
// per connection. Refreshed every 60s.
let schoolsCache: { rows: { schoolId: string; schoolName: string | null }[]; expiresAt: number } | null = null;
async function getSchoolsForMatcher() {
  const now = Date.now();
  if (schoolsCache && schoolsCache.expiresAt > now) return schoolsCache.rows;
  const rows = await db
    .select({ schoolId: schoolDirectories.schoolId, schoolName: schoolDirectories.schoolName })
    .from(schoolDirectories);
  schoolsCache = { rows, expiresAt: now + 60_000 };
  return rows;
}

/**
 * Match a single connection to a staff member.
 * Strategy 1 (high confidence): linkedinUrl public-identifier exact match.
 * Strategy 2 (medium): full-name match + headline contains school name.
 */
async function matchConnection(
  conn: {
    fullName?: string | null;
    publicIdentifier?: string | null;
    profileUrl?: string | null;
    headline?: string | null;
  },
  allSchools: { schoolId: string; schoolName: string | null }[],
): Promise<MatchResult | null> {
  const slug = conn.publicIdentifier?.toLowerCase() || normalizeLinkedinUrl(conn.profileUrl);

  // Strategy 1 — exact LinkedIn slug match (true equality on the /in/<slug> segment)
  if (slug) {
    const candidates = await db
      .select({
        id: staffMembers.id,
        schoolId: staffMembers.schoolId,
        name: staffMembers.name,
        title: staffMembers.title,
        linkedinUrl: staffMembers.linkedinUrl,
        schoolName: schoolDirectories.schoolName,
      })
      .from(staffMembers)
      .innerJoin(schoolDirectories, eq(staffMembers.schoolId, schoolDirectories.schoolId))
      .where(sql`${staffMembers.linkedinUrl} ~* ${'/in/' + slug + '/?($|[?#])'}`)
      .limit(5);
    // Belt-and-suspenders: re-verify the slug equality in JS to defeat any regex edge cases.
    const exact = candidates.find(c => normalizeLinkedinUrl(c.linkedinUrl) === slug);
    if (exact) {
      return {
        staffId: exact.id,
        schoolId: exact.schoolId,
        schoolName: exact.schoolName,
        staffName: exact.name,
        staffTitle: exact.title,
        confidence: 100,
      };
    }
  }

  // Strategy 2 — name + headline-contains-school (uses pre-loaded school list)
  if (conn.fullName && conn.headline) {
    const headlineLower = conn.headline.toLowerCase();
    const matchedSchools = allSchools.filter(s => {
      if (!s.schoolName || s.schoolName.length < 3) return false;
      return headlineLower.includes(s.schoolName.toLowerCase());
    });
    if (matchedSchools.length === 0) return null;

    const schoolIds = matchedSchools.map(s => s.schoolId);
    const candidates = await db
      .select({
        id: staffMembers.id,
        schoolId: staffMembers.schoolId,
        name: staffMembers.name,
        title: staffMembers.title,
        schoolName: schoolDirectories.schoolName,
      })
      .from(staffMembers)
      .innerJoin(schoolDirectories, eq(staffMembers.schoolId, schoolDirectories.schoolId))
      .where(and(
        inArray(staffMembers.schoolId, schoolIds),
        // Fuzzy fallback only considers staff WITHOUT a known LinkedIn URL —
        // staff with one would have been caught by Strategy 1 already, and
        // restricting here avoids name-collision false positives.
        sql`(${staffMembers.linkedinUrl} IS NULL OR ${staffMembers.linkedinUrl} = '')`,
      ));

    let best: { row: typeof candidates[number]; score: number } | null = null;
    for (const cand of candidates) {
      const score = nameSimilarity(tokenizeName(conn.fullName), tokenizeName(cand.name));
      if (score >= 0.9 && (!best || score > best.score)) {
        best = { row: cand, score };
      }
    }
    if (best) {
      return {
        staffId: best.row.id,
        schoolId: best.row.schoolId,
        schoolName: best.row.schoolName,
        staffName: best.row.name,
        staffTitle: best.row.title,
        confidence: Math.round(best.score * 90), // cap at 90 for fuzzy
      };
    }
  }

  return null;
}

export interface MatchRunResult {
  matchedCount: number;
  signalsCreated: number;
}

/**
 * Match a list of connections (just-upserted rows) for a given user.
 * Only emits signals for transitions null -> matched (idempotent).
 */
export async function matchConnectionsForUser(userId: number, connectionIds: number[]): Promise<MatchRunResult> {
  if (connectionIds.length === 0) return { matchedCount: 0, signalsCreated: 0 };

  const rows = await db
    .select()
    .from(linkedinConnections)
    .where(and(eq(linkedinConnections.userId, userId), inArray(linkedinConnections.id, connectionIds)));

  let matchedCount = 0;
  let signalsCreated = 0;

  // Load schools ONCE for the whole batch (cached for 60s across batches).
  const allSchools = await getSchoolsForMatcher();

  for (const conn of rows) {
    const wasUnmatched = !conn.matchedStaffId;
    const result = await matchConnection({
      fullName: conn.fullName,
      publicIdentifier: conn.publicIdentifier,
      profileUrl: conn.profileUrl,
      headline: conn.headline,
    }, allSchools);
    if (!result) continue;

    // Skip if already matched to the same staff member
    if (conn.matchedStaffId === result.staffId) continue;

    await db
      .update(linkedinConnections)
      .set({
        matchedStaffId: result.staffId,
        matchedSchoolId: result.schoolId,
        matchConfidence: result.confidence,
        matchedAt: new Date(),
      })
      .where(eq(linkedinConnections.id, conn.id));
    matchedCount++;

    // Emit a `network_connection` signal only on first match (null -> set)
    if (wasUnmatched) {
      await db.insert(signals).values({
        schoolId: result.schoolId,
        staffId: result.staffId,
        type: 'network_connection',
        description: `${conn.fullName || 'A LinkedIn connection'} (${conn.headline || 'in your network'}) is on staff at ${result.schoolName} as ${result.staffTitle || 'staff'}`,
        metadata: {
          newSchool: result.schoolId,
          newSchoolName: result.schoolName,
          staffName: result.staffName,
          staffTitle: result.staffTitle || undefined,
          connectionName: conn.fullName || undefined,
          connectionHeadline: conn.headline || undefined,
          connectionProfileUrl: conn.profileUrl || undefined,
          matchConfidence: result.confidence,
          userId,
        },
      });
      signalsCreated++;
    }
  }

  return { matchedCount, signalsCreated };
}

/**
 * Run a full re-match across all of a user's connections.
 * Useful after staff data has been refreshed.
 */
export async function rematchAllForUser(userId: number): Promise<MatchRunResult> {
  const rows = await db
    .select({ id: linkedinConnections.id })
    .from(linkedinConnections)
    .where(eq(linkedinConnections.userId, userId));
  return matchConnectionsForUser(userId, rows.map(r => r.id));
}

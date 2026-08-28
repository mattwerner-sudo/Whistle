import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import { db } from "../db";
import {
  linkedinConnections,
  schoolDirectories,
  staffMembers,
  apiKeys,
  linkedinSyncBatchSchema,
} from "@shared/schema";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";
import { validateApiKey, generateApiKey, type AuthenticatedRequest } from "../middleware/api-auth";
import { matchConnectionsForUser, rematchAllForUser } from "../lib/linkedin-matcher";
import { buildExtensionZip, extensionZipETag } from "../lib/extension-zip";

const router = Router();

const EXTENSION_DIR = path.resolve(process.cwd(), "whistle-connect-extension");

interface UserRequest extends Request {
  userId: number;
}

function requireUser(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized", message: "Sign in required" });
  }
  (req as UserRequest).userId = userId;
  next();
}

// ============================================================================
// EXTENSION DOWNLOAD - Public; just serves the packaged extension
// ============================================================================

function getBaseUrl(req: Request): string {
  // Honour proxy headers (Replit terminates TLS upstream).
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:5000";
  return `${proto.split(",")[0].trim()}://${host}`;
}

router.get("/extension.zip", (req: Request, res: Response) => {
  try {
    const baseUrl = getBaseUrl(req);
    const buf = buildExtensionZip(EXTENSION_DIR, baseUrl);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="whistle-connect.zip"');
    res.setHeader("ETag", extensionZipETag(EXTENSION_DIR, baseUrl));
    res.send(buf);
  } catch (e: any) {
    console.error("Extension zip build error:", e);
    res.status(500).json({ error: "Failed to package extension", message: e.message });
  }
});

router.get("/extension.json", (_req: Request, res: Response) => {
  res.json({
    name: "Whistle Connect",
    version: "1.0.0",
    downloadUrl: "/api/linkedin/extension.zip",
    instructions: [
      "Download the zip and unzip the folder.",
      "In Chrome, open chrome://extensions/.",
      "Toggle 'Developer mode' on (top right).",
      "Click 'Load unpacked' and select the unzipped folder.",
      "Open the Whistle Connect extension popup, paste your API key, and click 'Sync Connections'.",
    ],
  });
});

// ============================================================================
// EXTENSION INGESTION - validateApiKey + apiKey.userId required
// ============================================================================

// Ingestion: also accessible at /api/v1/linkedin/connections (Whistle-spec path).
router.post("/connections", validateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.apiKeyUserId;
    if (!userId) {
      return res.status(403).json({
        error: "Forbidden",
        message: "API key is not bound to a user account. Whistle Connect requires a per-user API key.",
      });
    }

    const parsed = linkedinSyncBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const inserted: number[] = [];
    for (const conn of parsed.data.connections) {
      const connectedAt = conn.connectedAt ? new Date(conn.connectedAt) : null;
      const [row] = await db
        .insert(linkedinConnections)
        .values({
          userId,
          entityUrn: conn.entityUrn,
          fullName: conn.fullName ?? null,
          firstName: conn.firstName ?? null,
          lastName: conn.lastName ?? null,
          headline: conn.headline ?? null,
          profileUrl: conn.profileUrl ?? null,
          publicIdentifier: conn.publicIdentifier ?? null,
          connectedAt: connectedAt && !isNaN(connectedAt.getTime()) ? connectedAt : null,
        })
        .onConflictDoUpdate({
          target: [linkedinConnections.userId, linkedinConnections.entityUrn],
          set: {
            fullName: conn.fullName ?? null,
            firstName: conn.firstName ?? null,
            lastName: conn.lastName ?? null,
            headline: conn.headline ?? null,
            profileUrl: conn.profileUrl ?? null,
            publicIdentifier: conn.publicIdentifier ?? null,
            connectedAt: connectedAt && !isNaN(connectedAt.getTime()) ? connectedAt : null,
            syncedAt: new Date(),
          },
        })
        .returning({ id: linkedinConnections.id });
      if (row) inserted.push(row.id);
    }

    // Run matcher inline (small batches; OK to await)
    const matchResult = await matchConnectionsForUser(userId, inserted);

    // Server-side count of *current* connections for this user (stable, not cumulative)
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(linkedinConnections)
      .where(eq(linkedinConnections.userId, userId));

    res.json({
      success: true,
      received: parsed.data.connections.length,
      upserted: inserted.length,
      newMatches: matchResult.matchedCount,
      newSignals: matchResult.signalsCreated,
      totalConnections: Number(total || 0),
    });
  } catch (e: any) {
    console.error("LinkedIn ingestion error:", e);
    res.status(500).json({ error: "Ingestion failed", message: e.message });
  }
});

// ============================================================================
// READ ENDPOINTS - session-auth (browser)
// ============================================================================

router.get("/sync-status", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  const [stats] = await db
    .select({
      total: sql<number>`count(*)`.as("total"),
      matched: sql<number>`count(*) filter (where matched_staff_id is not null)`.as("matched"),
      lastSync: sql<Date | null>`max(synced_at)`.as("last_sync"),
    })
    .from(linkedinConnections)
    .where(eq(linkedinConnections.userId, userId));
  res.json({
    totalConnections: Number(stats?.total || 0),
    matchedConnections: Number(stats?.matched || 0),
    lastSyncAt: stats?.lastSync ?? null,
  });
});

router.get("/connections", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
  const matchedOnly = req.query.matched === "true";

  const where = matchedOnly
    ? and(eq(linkedinConnections.userId, userId), isNotNull(linkedinConnections.matchedStaffId))
    : eq(linkedinConnections.userId, userId);

  const rows = await db
    .select({
      id: linkedinConnections.id,
      fullName: linkedinConnections.fullName,
      headline: linkedinConnections.headline,
      profileUrl: linkedinConnections.profileUrl,
      connectedAt: linkedinConnections.connectedAt,
      matchedStaffId: linkedinConnections.matchedStaffId,
      matchedSchoolId: linkedinConnections.matchedSchoolId,
      matchConfidence: linkedinConnections.matchConfidence,
      schoolName: schoolDirectories.schoolName,
      schoolLogo: schoolDirectories.logoUrl,
      staffName: staffMembers.name,
      staffTitle: staffMembers.title,
    })
    .from(linkedinConnections)
    .leftJoin(staffMembers, eq(linkedinConnections.matchedStaffId, staffMembers.id))
    .leftJoin(schoolDirectories, eq(linkedinConnections.matchedSchoolId, schoolDirectories.schoolId))
    .where(where)
    .orderBy(desc(linkedinConnections.syncedAt))
    .limit(limit);

  res.json({ connections: rows });
});

// "You know N people at this school"
router.get("/school/:schoolId", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  const schoolId = req.params.schoolId;
  const rows = await db
    .select({
      id: linkedinConnections.id,
      fullName: linkedinConnections.fullName,
      headline: linkedinConnections.headline,
      profileUrl: linkedinConnections.profileUrl,
      matchedStaffId: linkedinConnections.matchedStaffId,
      matchConfidence: linkedinConnections.matchConfidence,
      staffName: staffMembers.name,
      staffTitle: staffMembers.title,
      staffEmail: staffMembers.email,
    })
    .from(linkedinConnections)
    .leftJoin(staffMembers, eq(linkedinConnections.matchedStaffId, staffMembers.id))
    .where(and(eq(linkedinConnections.userId, userId), eq(linkedinConnections.matchedSchoolId, schoolId)));
  res.json({ schoolId, count: rows.length, connections: rows });
});

// Staff IDs the caller knows (used for "In your network" badges in lists).
// Returns both the bare ID list (back-compat) and a map of id -> connected date
// so the UI can render a "connected since" tooltip without an extra request.
router.get("/network-staff-ids", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  const rows = await db
    .select({
      staffId: linkedinConnections.matchedStaffId,
      connectedAt: linkedinConnections.connectedAt,
      fullName: linkedinConnections.fullName,
    })
    .from(linkedinConnections)
    .where(and(eq(linkedinConnections.userId, userId), isNotNull(linkedinConnections.matchedStaffId)));

  const staffIds: number[] = [];
  const connectedAt: Record<number, string | null> = {};
  const connectionName: Record<number, string | null> = {};
  for (const r of rows) {
    if (r.staffId == null) continue;
    if (!(r.staffId in connectedAt)) {
      staffIds.push(r.staffId);
      connectedAt[r.staffId] = r.connectedAt ? r.connectedAt.toISOString() : null;
      connectionName[r.staffId] = r.fullName;
    }
  }
  res.json({ staffIds, connectedAt, connectionName });
});

// Manual re-match (after fresh staff data lands)
router.post("/rematch", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  const result = await rematchAllForUser(userId);
  res.json({ success: true, ...result });
});

// "Resync all" — clears the per-user sync watermark so the *next* extension run
// pulls every connection regardless of delta. The actual fetch happens in the
// extension; this endpoint just signals the server-side state to expect a full
// re-ingest and surfaces a flag the extension polls.
router.post("/resync", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  // Force a full resync by zeroing syncedAt on every existing row (matcher
  // re-runs on every ingestion, and the extension reads `forceFullSync`).
  await db
    .update(linkedinConnections)
    .set({ syncedAt: new Date(0) })
    .where(eq(linkedinConnections.userId, userId));
  res.json({
    success: true,
    forceFullSync: true,
    message: "Next sync from the extension will re-fetch all connections (delta off for one run).",
  });
});

// Polled by the extension to discover whether a full resync was requested
// from the web UI since the last sync. READ-ONLY — does NOT consume the flag,
// so a failed extension run still picks it up next time. The extension calls
// POST /resync-ack ONLY after a successful ingest to clear the marker.
router.get("/resync-status", validateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.apiKeyUserId;
  if (!userId) return res.status(403).json({ forceFullSync: false });
  const [row] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(linkedinConnections)
    .where(and(eq(linkedinConnections.userId, userId), eq(linkedinConnections.syncedAt, new Date(0))));
  res.json({ forceFullSync: Number(row?.pending || 0) > 0 });
});

// Acknowledge a successful full-resync. Bumps any remaining epoch syncedAt
// rows to "now" so subsequent runs revert to delta mode.
router.post("/resync-ack", validateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.apiKeyUserId;
  if (!userId) return res.status(403).json({ success: false });
  const cleared = await db
    .update(linkedinConnections)
    .set({ syncedAt: new Date() })
    .where(and(eq(linkedinConnections.userId, userId), eq(linkedinConnections.syncedAt, new Date(0))))
    .returning({ id: linkedinConnections.id });
  res.json({ success: true, clearedCount: cleared.length });
});

// Issue a per-user Whistle Connect API key (scoped to LinkedIn ingestion)
router.post("/api-key", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  try {
    const { key, prefix, hashedKey } = generateApiKey();
    await db.insert(apiKeys).values({
      keyPrefix: prefix,
      hashedKey,
      label: "Whistle Connect",
      scopes: ["linkedin:write"],
      userId,
    });
    res.json({
      key,
      prefix,
      warning: "Save this key now. It will not be shown again.",
    });
  } catch (e: any) {
    console.error("Whistle Connect key creation error:", e);
    res.status(500).json({ error: "Failed to create key", message: e.message });
  }
});

router.get("/api-keys", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  const rows = await db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.keyPrefix,
      label: apiKeys.label,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.label, "Whistle Connect")));
  res.json({ keys: rows });
});

router.delete("/api-key/:id", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  const id = parseInt(req.params.id);
  await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  res.json({ success: true });
});

router.delete("/connections", requireUser, async (req: Request, res: Response) => {
  const userId = (req as UserRequest).userId;
  await db.delete(linkedinConnections).where(eq(linkedinConnections.userId, userId));
  res.json({ success: true });
});

export default router;

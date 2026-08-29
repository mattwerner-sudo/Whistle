import { db } from "../db";
import { careerHistory, staffMembers, signals, schoolDirectories } from "@shared/schema";
import { eq, and, inArray, desc, sql, gte } from "drizzle-orm";
import { dispatchSignalAlerts } from "./alert-subscriptions";
import { GoogleGenAI, Type } from "@google/genai";

let genAI: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!genAI) genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return genAI;
}

// Score a signal's sales relevance asynchronously (fire-and-forget from callers).
async function enrichSignalWithAI(signalId: number, signalType: string, description: string, schoolId: string | null): Promise<void> {
  const ai = getGenAI();
  if (!ai) return;

  const prompt = `A B2B vendor selling technology and services into college athletic departments sees this signal:

Signal type: ${signalType}
Description: ${description}

Score the sales relevance of this signal from 0 to 100, where:
- 0 = not relevant (e.g. minor admin change, unrelated)
- 50 = moderately relevant (worth noting)
- 100 = extremely relevant (new AD, major tech decision, large hiring wave)

Return the score and a one-sentence reason.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: prompt,
      config: {
        // Structured output: the model is constrained to this shape, so a
        // malformed reply can't silently masquerade as "no result".
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            reason: { type: Type.STRING },
          },
          required: ["score", "reason"],
        },
      },
    });
    const parsed = JSON.parse(response.text ?? "");
    const score = Number(parsed.score);
    if (isNaN(score)) return;

    // Update signal metadata with relevance score
    const [current] = await db.select({ metadata: signals.metadata }).from(signals).where(eq(signals.id, signalId)).limit(1);
    const meta = (current?.metadata as Record<string, any>) ?? {};
    await db.update(signals).set({ metadata: { ...meta, relevanceScore: score, relevanceReason: parsed.reason } }).where(eq(signals.id, signalId));

    // Update school priorityScore if high-relevance signals are clustering
    if (schoolId && score >= 75) {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentHighRelevance = await db
        .select({ id: signals.id })
        .from(signals)
        .where(
          and(
            eq(signals.schoolId, schoolId),
            gte(signals.detectedAt, cutoff),
            sql`(${signals.metadata}->>'relevanceScore')::numeric >= 75`,
          ),
        )
        .limit(5);

      if (recentHighRelevance.length >= 3) {
        const [school] = await db.select({ priorityScore: schoolDirectories.priorityScore }).from(schoolDirectories).where(eq(schoolDirectories.schoolId, schoolId)).limit(1);
        const current = Number(school?.priorityScore ?? 0);
        await db.update(schoolDirectories).set({ priorityScore: Math.min(100, current + 10) }).where(eq(schoolDirectories.schoolId, schoolId));
      }
    }
  } catch {
    // Non-critical — enrichment failure doesn't break signal creation
  }
}

export interface WarmPath {
  staffId: number;
  staffName: string;
  staffTitle: string | null;
  staffEmail: string;
  previousSchoolId: string;
  previousSchoolName: string;
  previousTitle: string | null;
  yearsAtPreviousSchool: string;
  technologiesUsed: string[];
  signal: string;
}

export async function findWarmPaths(targetSchoolId: string, customerSchoolIds: string[]): Promise<WarmPath[]> {
  if (!customerSchoolIds.length) return [];
  
  const targetStaff = await db.select().from(staffMembers).where(eq(staffMembers.schoolId, targetSchoolId));
  const targetStaffIds = targetStaff.map(s => s.id);
  
  if (!targetStaffIds.length) return [];

  const warmLeads = await db.select()
    .from(careerHistory)
    .where(and(
      inArray(careerHistory.staffId, targetStaffIds),
      inArray(careerHistory.schoolId, customerSchoolIds)
    ));

  const schoolNames = await db.select({ schoolId: schoolDirectories.schoolId, schoolName: schoolDirectories.schoolName })
    .from(schoolDirectories)
    .where(inArray(schoolDirectories.schoolId, customerSchoolIds));
  
  const schoolNameMap = new Map(schoolNames.map(s => [s.schoolId, s.schoolName]));
  const staffMap = new Map(targetStaff.map(s => [s.id, s]));

  return warmLeads.map(lead => {
    const staff = staffMap.get(lead.staffId);
    const yearRange = lead.startYear && lead.endYear 
      ? `${lead.startYear}-${lead.endYear}` 
      : lead.startYear 
        ? `${lead.startYear}-present` 
        : 'unknown';
    
    return {
      staffId: lead.staffId,
      staffName: staff?.name || 'Unknown',
      staffTitle: staff?.title || null,
      staffEmail: staff?.email || '',
      previousSchoolId: lead.schoolId,
      previousSchoolName: schoolNameMap.get(lead.schoolId) || lead.schoolId,
      previousTitle: lead.title,
      yearsAtPreviousSchool: yearRange,
      technologiesUsed: (lead.technologiesUsed as string[]) || [],
      signal: "Former User"
    };
  });
}

export async function generateWarmPathSignals(targetSchoolId: string, customerSchoolIds: string[]): Promise<number> {
  const warmPaths = await findWarmPaths(targetSchoolId, customerSchoolIds);
  
  if (!warmPaths.length) return 0;

  const targetSchool = await db.select()
    .from(schoolDirectories)
    .where(eq(schoolDirectories.schoolId, targetSchoolId))
    .limit(1);
  
  const schoolName = targetSchool[0]?.schoolName || targetSchoolId;

  for (const path of warmPaths) {
    await db.insert(signals).values({
      schoolId: targetSchoolId,
      staffId: path.staffId,
      type: 'warm_path',
      description: `${path.staffName} at ${schoolName} previously worked at ${path.previousSchoolName} (${path.yearsAtPreviousSchool})`,
      metadata: {
        oldSchool: path.previousSchoolId,
        oldSchoolName: path.previousSchoolName,
        newSchool: targetSchoolId,
        newSchoolName: schoolName,
        staffName: path.staffName,
        staffTitle: path.staffTitle || undefined,
      }
    });
  }

  return warmPaths.length;
}

export async function detectTechChanges(
  schoolId: string, 
  oldTechStack: string[], 
  newTechStack: string[]
): Promise<{ dropped: string[]; added: string[] }> {
  const oldSet = new Set(oldTechStack.map(t => t.toLowerCase()));
  const newSet = new Set(newTechStack.map(t => t.toLowerCase()));
  
  const dropped = oldTechStack.filter(t => !newSet.has(t.toLowerCase()));
  const added = newTechStack.filter(t => !oldSet.has(t.toLowerCase()));

  const school = await db.select()
    .from(schoolDirectories)
    .where(eq(schoolDirectories.schoolId, schoolId))
    .limit(1);
  
  const schoolName = school[0]?.schoolName || schoolId;

  if (dropped.length > 0) {
    await db.insert(signals).values({
      schoolId,
      type: 'tech_drop',
      description: `${schoolName} dropped: ${dropped.join(', ')}`,
      metadata: {
        techDropped: dropped,
        newSchool: schoolId,
        newSchoolName: schoolName,
      }
    });
  }

  if (added.length > 0) {
    await db.insert(signals).values({
      schoolId,
      type: 'tech_add',
      description: `${schoolName} added: ${added.join(', ')}`,
      metadata: {
        techAdded: added,
        newSchool: schoolId,
        newSchoolName: schoolName,
      }
    });
  }

  return { dropped, added };
}

export async function createNewHireSignal(
  staffId: number,
  staffName: string,
  staffTitle: string | null,
  schoolId: string,
  schoolName: string,
  previousSchoolId?: string,
  previousSchoolName?: string
): Promise<void> {
  const description = previousSchoolName 
    ? `New hire: ${staffName} (${staffTitle || 'Unknown Role'}) at ${schoolName} - came from ${previousSchoolName}`
    : `New hire: ${staffName} (${staffTitle || 'Unknown Role'}) at ${schoolName}`;

  const [newHireRow] = await db.insert(signals).values({
    schoolId,
    staffId,
    type: 'new_hire',
    description,
    metadata: {
      staffName,
      staffTitle: staffTitle || undefined,
      newSchool: schoolId,
      newSchoolName: schoolName,
      oldSchool: previousSchoolId,
      oldSchoolName: previousSchoolName,
    }
  }).returning({ id: signals.id });
  dispatchSignalAlerts({ type: 'new_hire', description, schoolId, staffId, metadata: { staffName, staffTitle } }).catch(() => {});
  if (newHireRow) enrichSignalWithAI(newHireRow.id, 'new_hire', description, schoolId).catch(() => {});
}

export async function createDepartureSignal(
  staffId: number,
  staffName: string,
  staffTitle: string | null,
  schoolId: string,
  schoolName: string
): Promise<void> {
  const departureDescription = `Departure: ${staffName} (${staffTitle || 'Unknown Role'}) left ${schoolName}`;
  const [departureRow] = await db.insert(signals).values({
    schoolId,
    staffId,
    type: 'departure',
    description: departureDescription,
    metadata: {
      staffName,
      staffTitle: staffTitle || undefined,
      oldSchool: schoolId,
      oldSchoolName: schoolName,
    }
  }).returning({ id: signals.id });
  dispatchSignalAlerts({ type: 'departure', description: departureDescription, schoolId, staffId, metadata: { staffName, staffTitle } }).catch(() => {});
  if (departureRow) enrichSignalWithAI(departureRow.id, 'departure', departureDescription, schoolId).catch(() => {});
}

export async function createTitleChangeSignal(
  staffId: number,
  staffName: string,
  schoolId: string,
  schoolName: string,
  oldTitle: string,
  newTitle: string,
): Promise<void> {
  const description = `Title change: ${staffName} at ${schoolName} — ${oldTitle} → ${newTitle}`;
  const [titleRow] = await db.insert(signals).values({
    schoolId,
    staffId,
    type: 'title_change',
    description,
    metadata: { staffName, oldTitle, newTitle, schoolName },
  }).returning({ id: signals.id });
  dispatchSignalAlerts({ type: 'title_change', description, schoolId, staffId, metadata: { staffName, oldTitle, newTitle } }).catch(() => {});
  if (titleRow) enrichSignalWithAI(titleRow.id, 'title_change', description, schoolId).catch(() => {});
}

export async function getRecentSignals(limit: number = 50, callerUserId?: number) {
  // network_connection signals are per-user (their metadata.userId tags the owner).
  // Filter at the DB level so the LIMIT applies to rows the caller is actually allowed to see.
  // SQL: type != 'network_connection' OR metadata->>'userId' = $callerUserId
  const visibility = callerUserId !== undefined
    ? sql`(${signals.type} <> 'network_connection' OR (${signals.metadata}->>'userId')::int = ${callerUserId})`
    : sql`${signals.type} <> 'network_connection'`;

  return await db.select()
    .from(signals)
    .where(visibility)
    .orderBy(desc(signals.detectedAt))
    .limit(limit);
}

/**
 * Mark a signal as actioned. Authorization rules:
 *  - For `network_connection` signals: the caller MUST be the owner
 *    (metadata.userId === callerUserId). Throws on mismatch.
 *  - For other signal types: any authenticated caller may action them
 *    (workspace-shared signals like new_hire/departure/tech_change).
 * Returns false if the signal does not exist or the caller is not allowed.
 */
export async function markSignalActioned(signalId: number, callerUserId: number): Promise<boolean> {
  const [row] = await db.select().from(signals).where(eq(signals.id, signalId)).limit(1);
  if (!row) return false;
  if (row.type === 'network_connection') {
    const ownerId = row.metadata?.userId;
    if (ownerId !== callerUserId) return false;
  }
  await db.update(signals)
    .set({ isActioned: true })
    .where(eq(signals.id, signalId));
  return true;
}

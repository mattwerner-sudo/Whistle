import { db } from "../db";
import { careerHistory, staffMembers, signals, schoolDirectories } from "@shared/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

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

  await db.insert(signals).values({
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
  });
}

export async function createDepartureSignal(
  staffId: number,
  staffName: string,
  staffTitle: string | null,
  schoolId: string,
  schoolName: string
): Promise<void> {
  await db.insert(signals).values({
    schoolId,
    staffId,
    type: 'departure',
    description: `Departure: ${staffName} (${staffTitle || 'Unknown Role'}) left ${schoolName}`,
    metadata: {
      staffName,
      staffTitle: staffTitle || undefined,
      oldSchool: schoolId,
      oldSchoolName: schoolName,
    }
  });
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

import { 
  schoolDirectories, 
  staffMembers,
  usageEvents,
  extractionJobs, 
  staffChangeLogs,
  savedLists,
  savedListItems,
  schoolAliases,
  type SchoolDirectory, 
  type InsertSchoolDirectory,
  type StaffMember,
  type InsertStaffMember,
  type UsageEvent,
  type InsertUsageEvent,
  type ExtractionJob,
  type InsertExtractionJob,
  type StaffChangeLog,
  type InsertStaffChangeLog,
  type SavedList,
  type InsertSavedList,
  type SavedListItem,
  type InsertSavedListItem,
  type SchoolAlias,
  type InsertSchoolAlias,
  type ChangeType
} from "@shared/schema";
import { db } from "./db";
import { eq, ilike, or, and, sql, desc, asc, gte, lte, lt, isNull, isNotNull } from "drizzle-orm";
import { createHash } from "crypto";
import { nameSimilarity as nameSimilarityFn } from "./staffExtractor";

export interface IStorage {
  getSchoolDirectory(schoolId: string): Promise<SchoolDirectory | undefined>;
  getSchoolDirectories(options?: {
    status?: string;
    division?: string;
    conference?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ directories: SchoolDirectory[]; total: number }>;
  upsertSchoolDirectory(directory: InsertSchoolDirectory): Promise<SchoolDirectory>;
  updateSchoolDirectoryStatus(schoolId: string, status: string, error?: string, failureReason?: string): Promise<void>;
  bulkUpsertSchoolDirectories(directories: InsertSchoolDirectory[]): Promise<void>;
  
  getStaffMember(id: number): Promise<StaffMember | undefined>;
  getStaffMembers(options?: {
    schoolId?: string;
    search?: string;
    division?: string;
    conference?: string;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ members: (StaffMember & { schoolName?: string; schoolLogo?: string })[]; total: number }>;
  getStaffMembersBySchool(schoolId: string): Promise<StaffMember[]>;
  upsertStaffMember(member: InsertStaffMember): Promise<StaffMember>;
  bulkUpsertStaffMembers(members: InsertStaffMember[]): Promise<void>;
  deleteStaffMembersBySchool(schoolId: string): Promise<void>;
  reportStaffInaccurate(id: number): Promise<StaffMember | undefined>;
  reverifyStaffEmails(limit?: number, opts?: { force?: boolean; staleAfterMs?: number }): Promise<{ checked: number; changed: number }>;
  
  getStats(): Promise<{
    totalSchools: number;
    extractedSchools: number;
    totalStaff: number;
    avgConfidence: number;
  }>;
  
  logEvent(event: InsertUsageEvent): Promise<UsageEvent>;
  getUsageEvents(options?: {
    eventType?: string;
    schoolId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ events: UsageEvent[]; total: number }>;
  getUsageStats(options?: { startDate?: Date; endDate?: Date }): Promise<{
    totalEvents: number;
    uniqueSessions: number;
    eventsByType: Record<string, number>;
    topSchools: Array<{ schoolId: string; schoolName: string; count: number }>;
    recentActivity: UsageEvent[];
  }>;

  createExtractionJob(job: InsertExtractionJob): Promise<ExtractionJob>;
  getExtractionJob(id: number): Promise<ExtractionJob | undefined>;
  updateExtractionJob(id: number, updates: Partial<ExtractionJob>): Promise<void>;
  getRecentJobs(limit?: number): Promise<ExtractionJob[]>;
  
  logStaffChange(change: InsertStaffChangeLog): Promise<StaffChangeLog>;
  getStaffChanges(options?: {
    schoolId?: string;
    changeType?: ChangeType;
    limit?: number;
  }): Promise<StaffChangeLog[]>;
  
  // Saved Lists
  getSavedLists(userId?: number): Promise<(SavedList & { itemCount: number })[]>;
  createSavedList(list: InsertSavedList): Promise<SavedList>;
  getSavedListWithItems(listId: number, userId?: number): Promise<(SavedList & { items: (SavedListItem & { staff: StaffMember })[] }) | undefined>;
  addToSavedList(item: InsertSavedListItem): Promise<SavedListItem>;
  removeFromSavedList(listId: number, staffId: number): Promise<void>;
  deleteSavedList(listId: number): Promise<void>;
  
  // School Aliases
  getAllSchoolAliases(): Promise<SchoolAlias[]>;
  createSchoolAlias(alias: InsertSchoolAlias): Promise<SchoolAlias>;
  deleteSchoolAlias(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getSchoolDirectory(schoolId: string): Promise<SchoolDirectory | undefined> {
    const [directory] = await db
      .select()
      .from(schoolDirectories)
      .where(eq(schoolDirectories.schoolId, schoolId));
    return directory || undefined;
  }

  async getSchoolDirectories(options?: {
    status?: string;
    division?: string;
    conference?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ directories: SchoolDirectory[]; total: number }> {
    const conditions = [];
    
    if (options?.status) {
      conditions.push(eq(schoolDirectories.status, options.status));
    }
    if (options?.division) {
      conditions.push(eq(schoolDirectories.division, options.division));
    }
    if (options?.conference) {
      conditions.push(eq(schoolDirectories.conference, options.conference));
    }
    if (options?.search) {
      conditions.push(
        or(
          eq(schoolDirectories.schoolId, options.search),
          ilike(schoolDirectories.schoolName, `%${options.search}%`),
          ilike(schoolDirectories.schoolFullName, `%${options.search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [directories, countResult] = await Promise.all([
      db
        .select()
        .from(schoolDirectories)
        .where(whereClause)
        .orderBy(asc(schoolDirectories.schoolName))
        .limit(options?.limit || 50)
        .offset(options?.offset || 0),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schoolDirectories)
        .where(whereClause),
    ]);

    return {
      directories,
      total: Number(countResult[0]?.count || 0),
    };
  }

  async upsertSchoolDirectory(directory: InsertSchoolDirectory): Promise<SchoolDirectory> {
    const insertValues = {
      schoolId: directory.schoolId,
      schoolName: directory.schoolName,
      schoolFullName: directory.schoolFullName,
      logoUrl: directory.logoUrl,
      ncaaUrl: directory.ncaaUrl,
      directoryUrl: directory.directoryUrl,
      division: directory.division,
      conference: directory.conference,
      status: directory.status,
      contactsCount: directory.contactsCount,
      avgConfidence: directory.avgConfidence,
      fiscalYearEnd: directory.fiscalYearEnd,
      techStack: directory.techStack as string[] | null,
      buyingWindowStatus: directory.buyingWindowStatus,
      failureReason: directory.failureReason,
      extractionAttempts: directory.extractionAttempts ?? 0,
      lastSuccessfulMethod: directory.lastSuccessfulMethod,
      updatedAt: new Date(),
    };
    const [result] = await db
      .insert(schoolDirectories)
      .values(insertValues)
      .onConflictDoUpdate({
        target: schoolDirectories.schoolId,
        set: {
          schoolName: directory.schoolName,
          schoolFullName: directory.schoolFullName,
          logoUrl: directory.logoUrl,
          ncaaUrl: directory.ncaaUrl,
          directoryUrl: directory.directoryUrl,
          division: directory.division,
          conference: directory.conference,
          status: directory.status,
          contactsCount: directory.contactsCount,
          avgConfidence: directory.avgConfidence,
          fiscalYearEnd: directory.fiscalYearEnd,
          techStack: directory.techStack as string[] | null,
          buyingWindowStatus: directory.buyingWindowStatus,
          failureReason: directory.failureReason,
          extractionAttempts: directory.extractionAttempts ?? 0,
          lastSuccessfulMethod: directory.lastSuccessfulMethod,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async updateSchoolDirectoryStatus(schoolId: string, status: string, error?: string, failureReason?: string): Promise<void> {
    const isTerminalFailure = status === 'failed' || status === 'needs_review';
    const isSuccess = status === 'success';
    
    await db
      .update(schoolDirectories)
      .set({
        status,
        extractionError: error || null,
        lastAttemptedAt: new Date(),
        updatedAt: new Date(),
        ...(isTerminalFailure ? {
          failureReason: failureReason || null,
          extractionAttempts: sql`COALESCE(${schoolDirectories.extractionAttempts}, 0) + 1`,
        } : {}),
        ...(isSuccess ? { 
          lastExtractedAt: new Date(),
          failureReason: null,
          extractionAttempts: 0,
        } : {}),
        ...(!isTerminalFailure && !isSuccess ? {
          failureReason: null,
        } : {}),
      })
      .where(eq(schoolDirectories.schoolId, schoolId));
  }

  async bulkUpsertSchoolDirectories(directories: InsertSchoolDirectory[]): Promise<void> {
    if (directories.length === 0) return;
    
    const batchSize = 100;
    for (let i = 0; i < directories.length; i += batchSize) {
      const batch = directories.slice(i, i + batchSize);
      const values = batch.map(d => ({
        schoolId: d.schoolId,
        schoolName: d.schoolName,
        schoolFullName: d.schoolFullName,
        logoUrl: d.logoUrl,
        ncaaUrl: d.ncaaUrl,
        directoryUrl: d.directoryUrl,
        division: d.division,
        conference: d.conference,
        status: d.status,
        fiscalYearEnd: d.fiscalYearEnd,
        techStack: d.techStack as string[] | null,
        buyingWindowStatus: d.buyingWindowStatus,
        updatedAt: new Date(),
      }));
      await db
        .insert(schoolDirectories)
        .values(values)
        .onConflictDoUpdate({
          target: schoolDirectories.schoolId,
          set: {
            schoolName: sql`excluded.school_name`,
            schoolFullName: sql`excluded.school_full_name`,
            logoUrl: sql`excluded.logo_url`,
            ncaaUrl: sql`excluded.ncaa_url`,
            division: sql`COALESCE(school_directories.division, excluded.division)`,
            conference: sql`COALESCE(school_directories.conference, excluded.conference)`,
            updatedAt: new Date(),
          },
        });
    }
  }

  async getStaffMember(id: number): Promise<StaffMember | undefined> {
    const [member] = await db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.id, id));
    return member || undefined;
  }

  async getStaffMembers(options?: {
    schoolId?: string;
    search?: string;
    division?: string;
    conference?: string;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ members: (StaffMember & { schoolName?: string; schoolLogo?: string })[]; total: number }> {
    const conditions = [];
    
    if (options?.schoolId) {
      conditions.push(eq(staffMembers.schoolId, options.schoolId));
    }
    
    if (options?.search) {
      const cleanSearch = options.search.replace(/[^\w\s]/g, '').trim().split(/\s+/).join(' & ');
      if (cleanSearch) {
        conditions.push(
          sql`to_tsvector('english', ${staffMembers.name} || ' ' || coalesce(${staffMembers.title}, '') || ' ' || coalesce(${staffMembers.department}, '')) @@ to_tsquery('english', ${cleanSearch + ':*'})`
        );
      }
    }
    
    if (options?.division) {
      conditions.push(eq(schoolDirectories.division, options.division));
    }
    if (options?.conference) {
      conditions.push(eq(schoolDirectories.conference, options.conference));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [members, countResult] = await Promise.all([
      db
        .select({
          id: staffMembers.id,
          schoolId: staffMembers.schoolId,
          name: staffMembers.name,
          title: staffMembers.title,
          email: staffMembers.email,
          phone: staffMembers.phone,
          department: staffMembers.department,
          office: staffMembers.office,
          linkedinUrl: staffMembers.linkedinUrl,
          bioUrl: staffMembers.bioUrl,
          imageUrl: staffMembers.imageUrl,
          confidence: staffMembers.confidence,
          emailVerificationStatus: staffMembers.emailVerificationStatus,
          emailVerifiedAt: staffMembers.emailVerifiedAt,
          reportedInaccurateAt: staffMembers.reportedInaccurateAt,
          extractedAt: staffMembers.extractedAt,
          updatedAt: staffMembers.updatedAt,
          schoolName: schoolDirectories.schoolName,
          schoolLogo: schoolDirectories.logoUrl,
        })
        .from(staffMembers)
        .innerJoin(schoolDirectories, eq(staffMembers.schoolId, schoolDirectories.schoolId))
        .where(whereClause)
        .orderBy(desc(staffMembers.id))
        .limit(options?.limit || 50)
        .offset(options?.offset || 0),
      db
        .select({ count: sql<number>`count(*)` })
        .from(staffMembers)
        .innerJoin(schoolDirectories, eq(staffMembers.schoolId, schoolDirectories.schoolId))
        .where(whereClause),
    ]);

    return {
      members: members as (StaffMember & { schoolName?: string; schoolLogo?: string })[],
      total: Number(countResult[0]?.count || 0),
    };
  }

  async getStaffMembersBySchool(schoolId: string): Promise<StaffMember[]> {
    return db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.schoolId, schoolId))
      .orderBy(asc(staffMembers.name));
  }

  async upsertStaffMember(member: InsertStaffMember): Promise<StaffMember> {
    if (member.email) {
      const normalizedEmail = member.email.toLowerCase().trim();
      const existingByEmail = await db
        .select()
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.email, normalizedEmail),
            eq(staffMembers.schoolId, member.schoolId)
          )
        );
      member = { ...member, email: normalizedEmail };

      if (existingByEmail.length > 0) {
        const existing = existingByEmail[0];
        const pickBest = (incoming: string | null | undefined, current: string | null | undefined) => {
          if (incoming && incoming.length > 0) return incoming;
          return current;
        };
        const mergedDeptTags = (member.departmentTags ?? existing.departmentTags) as string[] | null | undefined;
        const merged = {
          updatedAt: new Date(),
          schoolId: member.schoolId,
          name: pickBest(member.name, existing.name) ?? existing.name,
          title: pickBest(member.title, existing.title),
          email: pickBest(member.email, existing.email) ?? existing.email,
          phone: pickBest(member.phone, existing.phone),
          department: pickBest(member.department, existing.department),
          office: pickBest(member.office, existing.office),
          linkedinUrl: pickBest(member.linkedinUrl, existing.linkedinUrl),
          bioUrl: pickBest(member.bioUrl, existing.bioUrl),
          imageUrl: pickBest(member.imageUrl, existing.imageUrl),
          confidence: member.confidence ?? existing.confidence,
          departmentTags: mergedDeptTags,
          buyerPersona: member.buyerPersona ?? existing.buyerPersona,
          functionalArea: member.functionalArea ?? existing.functionalArea,
          emailVerificationStatus: member.emailVerificationStatus ?? existing.emailVerificationStatus,
          emailVerifiedAt: member.emailVerifiedAt ?? existing.emailVerifiedAt,
          // Only an actual verification pass (emailVerifiedAt set) clears a prior
          // "reported wrong" flag — the default 'unverified' status must not.
          reportedInaccurateAt: member.emailVerifiedAt ? null : existing.reportedInaccurateAt,
        };

        const [updated] = await db
          .update(staffMembers)
          .set(merged)
          .where(eq(staffMembers.id, existing.id))
          .returning();
        return updated;
      }
    }

    if (member.name && member.name !== 'Unknown') {
      const schoolStaff = await db
        .select()
        .from(staffMembers)
        .where(eq(staffMembers.schoolId, member.schoolId));

      const fuzzyMatch = schoolStaff.find(s => {
        if (!s.name || s.name === 'Unknown') return false;
        return this.nameSimilarity(s.name, member.name!) >= 0.85;
      });

      if (fuzzyMatch) {
        const pickBest = (incoming: string | null | undefined, current: string | null | undefined) => {
          if (incoming && incoming.length > 0) return incoming;
          return current;
        };
        const deptTags = (member.departmentTags ?? fuzzyMatch.departmentTags) as string[] | null | undefined;
        const merged = {
          name: member.name ?? fuzzyMatch.name,
          schoolId: member.schoolId,
          updatedAt: new Date(),
          email: pickBest(member.email, fuzzyMatch.email) ?? fuzzyMatch.email,
          phone: pickBest(member.phone, fuzzyMatch.phone),
          title: (member.title && member.title.length > 2) ? member.title : (fuzzyMatch.title ?? member.title),
          department: pickBest(member.department, fuzzyMatch.department),
          office: pickBest(member.office, fuzzyMatch.office),
          linkedinUrl: pickBest(member.linkedinUrl, fuzzyMatch.linkedinUrl),
          bioUrl: pickBest(member.bioUrl, fuzzyMatch.bioUrl),
          imageUrl: pickBest(member.imageUrl, fuzzyMatch.imageUrl),
          confidence: member.confidence ?? fuzzyMatch.confidence,
          departmentTags: deptTags,
          buyerPersona: member.buyerPersona ?? fuzzyMatch.buyerPersona,
          functionalArea: member.functionalArea ?? fuzzyMatch.functionalArea,
          emailVerificationStatus: member.emailVerificationStatus ?? fuzzyMatch.emailVerificationStatus,
          emailVerifiedAt: member.emailVerifiedAt ?? fuzzyMatch.emailVerifiedAt,
          reportedInaccurateAt: member.emailVerifiedAt ? null : fuzzyMatch.reportedInaccurateAt,
        };

        const [updated] = await db
          .update(staffMembers)
          .set(merged)
          .where(eq(staffMembers.id, fuzzyMatch.id))
          .returning();
        return updated;
      }
    }

    const insertData = {
      ...member,
      departmentTags: (member.departmentTags ?? null) as string[] | null,
    };
    const [created] = await db
      .insert(staffMembers)
      .values(insertData)
      .returning();
    return created;
  }

  private nameSimilarity(a: string, b: string): number {
    return nameSimilarityFn(a, b);
  }

  async bulkUpsertStaffMembers(members: InsertStaffMember[]): Promise<void> {
    if (members.length === 0) return;
    
    const batchSize = 50;
    for (let i = 0; i < members.length; i += batchSize) {
      const batch = members.slice(i, i + batchSize);
      for (const member of batch) {
        await this.upsertStaffMember(member);
      }
    }
  }

  async deleteStaffMembersBySchool(schoolId: string): Promise<void> {
    await db
      .delete(staffMembers)
      .where(eq(staffMembers.schoolId, schoolId));
  }

  // Contact-accuracy feedback: a user reported this record as wrong. Downgrade
  // confidence, clear the verification (so it re-verifies), and flag it.
  async reportStaffInaccurate(id: number): Promise<StaffMember | undefined> {
    const [existing] = await db.select().from(staffMembers).where(eq(staffMembers.id, id));
    if (!existing) return undefined;

    // Idempotent at the record level: once a contact is flagged, further reports
    // are no-ops until a re-verification pass clears the flag. This prevents
    // repeated reports from multiplicatively driving confidence toward zero.
    if (existing.reportedInaccurateAt) return existing;

    const current = existing.confidence;
    // Lower both the derived email score AND the immutable base so the penalty
    // survives a later verification recompute (a "wrong" contact stays low even
    // if its domain is still technically deliverable). A genuine re-extraction
    // rebuilds confidence from scratch and clears the flag.
    const current2 = current
      ? { ...current, emailBase: Math.round((current.emailBase ?? current.email) * 0.3) }
      : current;
    const downgraded = current2
      ? { ...current2, email: Math.round(current2.email * 0.3), overall: Math.max(0, Math.round(current2.overall * 0.5)) }
      : current2;

    const [updated] = await db
      .update(staffMembers)
      .set({
        confidence: downgraded,
        emailVerificationStatus: "unverified",
        emailVerifiedAt: null,
        reportedInaccurateAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(staffMembers.id, id))
      .returning();
    return updated;
  }

  // Evergreen maintenance: re-run free verification. By default this targets
  // records that were never verified, were flagged for re-verification
  // (emailVerifiedAt null), OR whose last check is older than `staleAfterMs`
  // (default 30 days). Pass `force: true` to re-verify every record with an
  // email regardless of when it was last checked. Confidence recomputation is
  // idempotent (see applyVerificationToConfidence), so repeated runs never drift.
  // Bounded by `limit`; per-record errors are swallowed so one bad lookup can't
  // abort the batch.
  async reverifyStaffEmails(
    limit: number = 100,
    opts: { force?: boolean; staleAfterMs?: number } = {},
  ): Promise<{ checked: number; changed: number }> {
    const { verifyEmail, applyVerificationToConfidence } = await import("./lib/email-verification");
    const staleAfterMs = opts.staleAfterMs ?? 30 * 24 * 60 * 60 * 1000;
    const staleCutoff = new Date(Date.now() - staleAfterMs);
    const eligibility = opts.force
      ? sql`${staffMembers.email} <> ''`
      : and(
          sql`${staffMembers.email} <> ''`,
          or(
            isNull(staffMembers.emailVerifiedAt),
            lt(staffMembers.emailVerifiedAt, staleCutoff),
            // Contacts flagged inaccurate get re-checked even if recently verified.
            isNotNull(staffMembers.reportedInaccurateAt),
          ),
        );
    const rows = await db
      .select()
      .from(staffMembers)
      .where(eligibility)
      .limit(limit);

    let checked = 0;
    let changed = 0;
    for (const row of rows) {
      try {
        const result = await verifyEmail(row.email);
        checked++;
        const newConfidence = applyVerificationToConfidence(row.confidence, result.status) ?? row.confidence;
        if (row.emailVerificationStatus !== result.status) changed++;
        await db
          .update(staffMembers)
          .set({
            emailVerificationStatus: result.status,
            emailVerifiedAt: result.checkedAt,
            confidence: newConfidence,
            // A completed verification pass re-opens the record for future
            // reports. The report's confidence penalty still persists via the
            // lowered emailBase, so clearing the flag doesn't restore the score.
            reportedInaccurateAt: null,
            updatedAt: new Date(),
          })
          .where(eq(staffMembers.id, row.id));
      } catch (err) {
        console.error(`[Reverify] Failed for staff ${row.id}:`, err);
      }
    }
    return { checked, changed };
  }

  async getStats(): Promise<{
    totalSchools: number;
    extractedSchools: number;
    totalStaff: number;
    avgConfidence: number;
  }> {
    const [schoolStats, staffStats] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`,
          extracted: sql<number>`count(*) filter (where status = 'success')`,
        })
        .from(schoolDirectories),
      db
        .select({
          total: sql<number>`count(*)`,
          avgConfidence: sql<number>`avg((confidence->>'overall')::int)`,
        })
        .from(staffMembers),
    ]);

    return {
      totalSchools: Number(schoolStats[0]?.total || 0),
      extractedSchools: Number(schoolStats[0]?.extracted || 0),
      totalStaff: Number(staffStats[0]?.total || 0),
      avgConfidence: Math.round(Number(staffStats[0]?.avgConfidence || 0)),
    };
  }

  async logEvent(event: InsertUsageEvent): Promise<UsageEvent> {
    const [created] = await db
      .insert(usageEvents)
      .values(event)
      .returning();
    return created;
  }

  async getUsageEvents(options?: {
    eventType?: string;
    schoolId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ events: UsageEvent[]; total: number }> {
    const conditions = [];
    
    if (options?.eventType) {
      conditions.push(eq(usageEvents.eventType, options.eventType));
    }
    if (options?.schoolId) {
      conditions.push(eq(usageEvents.schoolId, options.schoolId));
    }
    if (options?.startDate) {
      conditions.push(gte(usageEvents.createdAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(usageEvents.createdAt, options.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [events, countResult] = await Promise.all([
      db
        .select()
        .from(usageEvents)
        .where(whereClause)
        .orderBy(desc(usageEvents.createdAt))
        .limit(options?.limit || 100)
        .offset(options?.offset || 0),
      db
        .select({ count: sql<number>`count(*)` })
        .from(usageEvents)
        .where(whereClause),
    ]);

    return {
      events,
      total: Number(countResult[0]?.count || 0),
    };
  }

  async getUsageStats(options?: { startDate?: Date; endDate?: Date }): Promise<{
    totalEvents: number;
    uniqueSessions: number;
    eventsByType: Record<string, number>;
    topSchools: Array<{ schoolId: string; schoolName: string; count: number }>;
    recentActivity: UsageEvent[];
  }> {
    const conditions = [];
    if (options?.startDate) {
      conditions.push(gte(usageEvents.createdAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(usageEvents.createdAt, options.endDate));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totals, sessions, eventTypes, topSchools, recentEvents] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(usageEvents)
        .where(whereClause),
      db
        .select({ count: sql<number>`count(distinct session_id)` })
        .from(usageEvents)
        .where(whereClause),
      db
        .select({
          eventType: usageEvents.eventType,
          count: sql<number>`count(*)`,
        })
        .from(usageEvents)
        .where(whereClause)
        .groupBy(usageEvents.eventType),
      db
        .select({
          schoolId: usageEvents.schoolId,
          schoolName: usageEvents.schoolName,
          count: sql<number>`count(*)`,
        })
        .from(usageEvents)
        .where(and(whereClause, sql`school_id is not null`))
        .groupBy(usageEvents.schoolId, usageEvents.schoolName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      db
        .select()
        .from(usageEvents)
        .where(whereClause)
        .orderBy(desc(usageEvents.createdAt))
        .limit(20),
    ]);

    const eventsByType: Record<string, number> = {};
    for (const row of eventTypes) {
      eventsByType[row.eventType] = Number(row.count);
    }

    return {
      totalEvents: Number(totals[0]?.count || 0),
      uniqueSessions: Number(sessions[0]?.count || 0),
      eventsByType,
      topSchools: topSchools.map(s => ({
        schoolId: s.schoolId || '',
        schoolName: s.schoolName || '',
        count: Number(s.count),
      })),
      recentActivity: recentEvents,
    };
  }

  async createExtractionJob(job: InsertExtractionJob): Promise<ExtractionJob> {
    const jobData = {
      type: job.type,
      targetId: job.targetId ?? null,
      status: job.status ?? 'pending',
      totalSchools: job.totalSchools ?? 0,
      processedSchools: job.processedSchools ?? 0,
      contactsFound: job.contactsFound ?? 0,
      logs: (job.logs ?? []) as string[],
    };
    const [created] = await db.insert(extractionJobs).values(jobData).returning();
    return created;
  }

  async getExtractionJob(id: number): Promise<ExtractionJob | undefined> {
    const [job] = await db.select().from(extractionJobs).where(eq(extractionJobs.id, id));
    return job || undefined;
  }

  async updateExtractionJob(id: number, updates: Partial<ExtractionJob>): Promise<void> {
    await db.update(extractionJobs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(extractionJobs.id, id));
  }

  async getRecentJobs(limit = 10): Promise<ExtractionJob[]> {
    return db.select()
      .from(extractionJobs)
      .orderBy(desc(extractionJobs.createdAt))
      .limit(limit);
  }
  
  async logStaffChange(change: InsertStaffChangeLog): Promise<StaffChangeLog> {
    const [created] = await db
      .insert(staffChangeLogs)
      .values(change)
      .returning();
    return created;
  }
  
  async getStaffChanges(options?: {
    schoolId?: string;
    changeType?: ChangeType;
    limit?: number;
  }): Promise<StaffChangeLog[]> {
    const conditions = [];
    
    if (options?.schoolId) {
      conditions.push(eq(staffChangeLogs.schoolId, options.schoolId));
    }
    if (options?.changeType) {
      conditions.push(eq(staffChangeLogs.changeType, options.changeType));
    }
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    return db
      .select()
      .from(staffChangeLogs)
      .where(whereClause)
      .orderBy(desc(staffChangeLogs.detectedAt))
      .limit(options?.limit || 100);
  }
  
  // Saved Lists Implementation
  async getSavedLists(userId?: number): Promise<(SavedList & { itemCount: number })[]> {
    const lists = userId !== undefined
      ? await db.select().from(savedLists).where(eq(savedLists.userId, userId)).orderBy(desc(savedLists.createdAt))
      : await db.select().from(savedLists).orderBy(desc(savedLists.createdAt));
    
    // Get item counts for each list
    const results = await Promise.all(
      lists.map(async (list) => {
        const [countResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(savedListItems)
          .where(eq(savedListItems.listId, list.id));
        return { ...list, itemCount: Number(countResult?.count || 0) };
      })
    );
    
    return results;
  }
  
  async createSavedList(list: InsertSavedList): Promise<SavedList> {
    const [created] = await db.insert(savedLists).values(list).returning();
    return created;
  }
  
  async getSavedListWithItems(listId: number, userId?: number): Promise<(SavedList & { items: (SavedListItem & { staff: StaffMember })[] }) | undefined> {
    const [list] = await db.select().from(savedLists).where(
      userId !== undefined
        ? and(eq(savedLists.id, listId), eq(savedLists.userId, userId))
        : eq(savedLists.id, listId)
    );
    if (!list) return undefined;
    
    const items = await db
      .select()
      .from(savedListItems)
      .innerJoin(staffMembers, eq(savedListItems.staffId, staffMembers.id))
      .where(eq(savedListItems.listId, listId))
      .orderBy(desc(savedListItems.addedAt));
    
    return {
      ...list,
      items: items.map(row => ({
        ...row.saved_list_items,
        staff: row.staff_members
      }))
    };
  }
  
  async addToSavedList(item: InsertSavedListItem): Promise<SavedListItem> {
    // Check if already exists
    const [existing] = await db
      .select()
      .from(savedListItems)
      .where(and(
        eq(savedListItems.listId, item.listId),
        eq(savedListItems.staffId, item.staffId)
      ));
    
    if (existing) {
      return existing;
    }
    
    const [created] = await db.insert(savedListItems).values(item).returning();
    return created;
  }
  
  async removeFromSavedList(listId: number, staffId: number): Promise<void> {
    await db.delete(savedListItems).where(
      and(
        eq(savedListItems.listId, listId),
        eq(savedListItems.staffId, staffId)
      )
    );
  }
  
  async deleteSavedList(listId: number): Promise<void> {
    // Delete all items first
    await db.delete(savedListItems).where(eq(savedListItems.listId, listId));
    // Delete the list
    await db.delete(savedLists).where(eq(savedLists.id, listId));
  }

  async getAllSchoolAliases(): Promise<SchoolAlias[]> {
    return db.select().from(schoolAliases).orderBy(asc(schoolAliases.alias));
  }

  async createSchoolAlias(alias: InsertSchoolAlias): Promise<SchoolAlias> {
    const [created] = await db.insert(schoolAliases).values(alias).returning();
    return created;
  }

  async deleteSchoolAlias(id: number): Promise<void> {
    await db.delete(schoolAliases).where(eq(schoolAliases.id, id));
  }
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip + 'ncaa-staff-salt').digest('hex').substring(0, 16);
}

export const storage = new DatabaseStorage();

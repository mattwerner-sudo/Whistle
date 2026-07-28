import pLimit from 'p-limit';
import { storage } from "../storage";
import { extractStaffFromUrl, convertToStaffMembers, discoverDirectoryUrl, parseHtmlForContacts } from "../staffExtractor";
import type { StaffMember, InsertStaffMember, SchoolExtractionMeta } from "@shared/schema";
import { broadcastJobUpdate } from "./websocket";
import { detectTechStack } from "./tech-stack-detector";
import { getBuyingWindowStatus } from "./ai-extractor";
import { detectTechChanges, createNewHireSignal, createDepartureSignal } from "./graph-engine";
import { 
  isParserDisabled, 
  recordParserSuccess, 
  recordParserFailure,
  recordBioEnrichment,
  waitWithJitter
} from "./scraper-health";
import { enrichMissingEmailsFromBio } from "./scraper-worker";

export type FailureReason = 'url_not_found' | 'timeout' | 'blocked' | 'no_contacts' | 'parse_error';

const ALTERNATIVE_URL_SUFFIXES = [
  '/staff-directory',
  '/about/staff',
  '/athletics-staff',
];

function categorizeFailureReason(error: string | null, contactsFound: number, httpStatus?: number | null): FailureReason {
  if (httpStatus && httpStatus >= 400) {
    if (httpStatus === 404) return 'url_not_found';
    if (httpStatus === 403 || httpStatus === 401 || httpStatus === 451) return 'blocked';
    if (httpStatus === 408 || httpStatus === 504 || httpStatus === 522 || httpStatus === 524) return 'timeout';
  }

  if (error) {
    const msg = error.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('navigation timeout')) return 'timeout';
    if (msg.includes('403') || msg.includes('forbidden') || msg.includes('blocked') || msg.includes('captcha') || msg.includes('cloudflare') || msg.includes('access denied')) return 'blocked';
    if (msg.includes('enotfound') || msg.includes('dns') || msg.includes('getaddrinfo') || msg.includes('no directory')) return 'url_not_found';
    if (msg.includes('404')) return 'url_not_found';
    if (msg.includes('parse') || msg.includes('cheerio') || msg.includes('invalid html')) return 'parse_error';
    if (msg.includes('no contacts') || msg.includes('0 contacts')) return 'no_contacts';
  }

  if (contactsFound === 0) return 'no_contacts';
  return 'parse_error';
}

function buildAlternativeUrls(baseUrl: string): string[] {
  try {
    const parsed = new URL(baseUrl);
    const domain = `${parsed.protocol}//${parsed.host}`;
    const alternatives: string[] = [];
    for (const suffix of ALTERNATIVE_URL_SUFFIXES) {
      const altUrl = `${domain}${suffix}`;
      if (altUrl !== baseUrl) {
        alternatives.push(altUrl);
      }
    }
    return alternatives;
  } catch {
    return [];
  }
}

const NEEDS_REVIEW_THRESHOLD = 3;

interface StaffChange {
  type: 'new_hire' | 'departure' | 'title_change';
  name: string;
  email: string;
  staffId?: number;
  oldValue?: string;
  newValue?: string;
}

interface SchoolLock {
  schoolId: string;
  jobId: number | null;
  startedAt: Date;
  sessionId?: string;
}

const schoolLocks = new Map<string, SchoolLock>();
const NCAA_INIT_LOCK = { locked: false, startedAt: null as Date | null };

export function isSchoolLocked(schoolId: string): boolean {
  return schoolLocks.has(schoolId);
}

export function getSchoolLock(schoolId: string): SchoolLock | null {
  return schoolLocks.get(schoolId) || null;
}

export function acquireSchoolLock(schoolId: string, jobId: number | null = null, sessionId?: string): boolean {
  if (schoolLocks.has(schoolId)) {
    return false;
  }
  schoolLocks.set(schoolId, { schoolId, jobId, startedAt: new Date(), sessionId });
  console.log(`[Lock] Acquired lock for ${schoolId} (job: ${jobId}, session: ${sessionId || 'none'})`);
  return true;
}

export function releaseSchoolLock(schoolId: string): void {
  if (schoolLocks.has(schoolId)) {
    console.log(`[Lock] Released lock for ${schoolId}`);
    schoolLocks.delete(schoolId);
  }
}

export function getActiveSchoolLocks(): SchoolLock[] {
  return Array.from(schoolLocks.values());
}

export function acquireNcaaInitLock(): boolean {
  if (NCAA_INIT_LOCK.locked) {
    return false;
  }
  NCAA_INIT_LOCK.locked = true;
  NCAA_INIT_LOCK.startedAt = new Date();
  console.log('[Lock] Acquired NCAA init lock');
  return true;
}

export function releaseNcaaInitLock(): void {
  NCAA_INIT_LOCK.locked = false;
  NCAA_INIT_LOCK.startedAt = null;
  console.log('[Lock] Released NCAA init lock');
}

export function isNcaaInitLocked(): boolean {
  return NCAA_INIT_LOCK.locked;
}

async function detectStaffChanges(
  schoolId: string, 
  newMembers: InsertStaffMember[]
): Promise<StaffChange[]> {
  const { fuzzyMatchName } = await import('./scraper-health');
  const changes: StaffChange[] = [];
  const existingMembers = await storage.getStaffMembersBySchool(schoolId);
  
  const existingByEmail = new Map<string, StaffMember>();
  const existingByName = new Map<string, StaffMember>();
  for (const member of existingMembers) {
    existingByEmail.set(member.email.toLowerCase(), member);
    existingByName.set(member.name.toLowerCase().trim(), member);
  }
  
  const newByEmail = new Map<string, InsertStaffMember>();
  const newByName = new Map<string, InsertStaffMember>();
  for (const member of newMembers) {
    newByEmail.set(member.email.toLowerCase(), member);
    newByName.set(member.name.toLowerCase().trim(), member);
  }
  
  const matchedExistingEmails = new Set<string>();
  
  Array.from(newByEmail.entries()).forEach(([email, newMember]) => {
    let existing = existingByEmail.get(email);
    
    if (!existing) {
      const existingList = Array.from(existingByEmail.values());
      for (const candidate of existingList) {
        if (fuzzyMatchName(newMember.name, candidate.name, 0.85)) {
          existing = candidate;
          matchedExistingEmails.add(candidate.email.toLowerCase());
          break;
        }
      }
    } else {
      matchedExistingEmails.add(email);
    }
    
    if (!existing) {
      changes.push({
        type: 'new_hire',
        name: newMember.name,
        email: newMember.email,
        newValue: newMember.title || undefined,
      });
    } else if (newMember.title && existing.title && newMember.title !== existing.title) {
      changes.push({
        type: 'title_change',
        name: newMember.name,
        email: newMember.email,
        staffId: existing.id,
        oldValue: existing.title,
        newValue: newMember.title,
      });
    }
  });
  
  Array.from(existingByEmail.entries()).forEach(([email, existing]) => {
    if (!newByEmail.has(email) && !matchedExistingEmails.has(email)) {
      let foundByName = false;
      for (const newMember of Array.from(newByEmail.values())) {
        if (fuzzyMatchName(existing.name, newMember.name, 0.85)) {
          foundByName = true;
          break;
        }
      }
      
      if (!foundByName) {
        changes.push({
          type: 'departure',
          name: existing.name,
          email: existing.email,
          staffId: existing.id,
          oldValue: existing.title || undefined,
        });
      }
    }
  });
  
  return changes;
}

async function logChangesToDatabase(schoolId: string, changes: StaffChange[]): Promise<void> {
  for (const change of changes) {
    await storage.logStaffChange({
      schoolId,
      staffId: change.staffId || null,
      name: change.name,
      changeType: change.type,
      oldValue: change.oldValue || null,
      newValue: change.newValue || null,
    });
  }
}

const limit = pLimit(3);

const activeJobs = new Set<number>();

export function queueJob(jobId: number): void {
  if (activeJobs.has(jobId)) {
    console.log(`[JobQueue] Job #${jobId} already queued`);
    return;
  }
  
  activeJobs.add(jobId);
  
  const jobPromise = limit(async () => {
    console.log(`[JobQueue] Starting execution for Job #${jobId}`);
    try {
      await processExtractionJob(jobId);
    } catch (err) {
      console.error(`[JobQueue] Unhandled error in Job #${jobId}`, err);
    }
  });
  
  jobPromise.finally(() => {
    activeJobs.delete(jobId);
  });
}

async function processExtractionJob(jobId: number): Promise<void> {
  const job = await storage.getExtractionJob(jobId);
  if (!job || job.status === 'completed') {
    console.log(`[JobQueue] Job #${jobId} not found or already completed`);
    return;
  }

  await storage.updateExtractionJob(jobId, { status: "processing" });
  
  broadcastJobUpdate({
    type: 'job_progress',
    jobId,
    data: { status: 'processing', message: 'Job started' }
  });

  let targetSchools: string[] = [];
  
  if (job.type === 'conference' && job.targetId) {
    const allSchools = await storage.getSchoolDirectories({ conference: job.targetId, limit: 1000 });
    targetSchools = allSchools.directories.map(s => s.schoolId);
  } else if (job.type === 'single' && job.targetId) {
    targetSchools = [job.targetId];
  } else if (job.type === 'bulk') {
    // Check if targetId contains JSON school IDs (for stale refresh)
    if (job.targetId && job.targetId.startsWith('[')) {
      try {
        const parsedIds = JSON.parse(job.targetId);
        if (Array.isArray(parsedIds) && parsedIds.length > 0 && parsedIds.every((id: unknown) => typeof id === 'string')) {
          targetSchools = parsedIds;
        } else {
          console.error(`[JobQueue] Invalid JSON school IDs in targetId for job #${jobId}`);
          await storage.updateExtractionJob(jobId, { 
            status: "failed", 
            logs: ["Invalid JSON school IDs in targetId - must be non-empty array of strings"] 
          });
          return;
        }
      } catch (parseErr) {
        console.error(`[JobQueue] Failed to parse targetId JSON for job #${jobId}:`, parseErr);
        await storage.updateExtractionJob(jobId, { 
          status: "failed", 
          logs: ["Failed to parse JSON school IDs in targetId"] 
        });
        return;
      }
    } else {
      const pending = await storage.getSchoolDirectories({ status: 'pending', limit: 20 });
      targetSchools = pending.directories.map(d => d.schoolId);
    }
  }

  if (targetSchools.length === 0) {
    await storage.updateExtractionJob(jobId, { 
      status: "completed", 
      logs: ["No schools to process"] 
    });
    return;
  }

  await storage.updateExtractionJob(jobId, { totalSchools: targetSchools.length });

  let processed = 0;
  let contactsFound = 0;
  const logs: string[] = [`Processing ${targetSchools.length} schools...`];
  const extractionMetadata: Record<string, SchoolExtractionMeta> = {};

  for (const schoolId of targetSchools) {
    let hasLock = false;
    let url: string | null = null;
    try {
      if (!acquireSchoolLock(schoolId, jobId)) {
        const existingLock = getSchoolLock(schoolId);
        logs.push(`[${schoolId}] Already being processed by job #${existingLock?.jobId || 'unknown'}`);
        processed++;
        continue;
      }
      hasLock = true;

      let directory = await storage.getSchoolDirectory(schoolId);
      if (!directory) {
        logs.push(`[${schoolId}] School not found in database`);
        processed++;
        continue;
      }

      await storage.updateSchoolDirectoryStatus(schoolId, "processing");

      const { getKnownDirectoryUrl, resolveDirectoryUrl } = await import("./known-directory-urls");
      const knownOverride = getKnownDirectoryUrl(schoolId);
      
      if (knownOverride) {
        url = knownOverride.directoryUrl;
        logs.push(`[${directory.schoolName}] Using known override URL: ${url}`);
        if (url !== directory.directoryUrl) {
          await storage.upsertSchoolDirectory({ ...directory, directoryUrl: url });
        }
      } else if (directory.directoryUrl) {
        url = directory.directoryUrl;
      } else {
        const conferenceUrl = resolveDirectoryUrl(schoolId, directory.schoolName);
        if (conferenceUrl) {
          url = conferenceUrl;
          logs.push(`[${directory.schoolName}] Using conference URL: ${url}`);
          await storage.upsertSchoolDirectory({ ...directory, directoryUrl: url });
        } else {
          logs.push(`[${directory.schoolName}] Discovering URL...`);
          url = await discoverDirectoryUrl(directory.ncaaUrl, directory.schoolName, schoolId);
          if (url) {
            await storage.upsertSchoolDirectory({ ...directory, directoryUrl: url });
            const { addKnownDirectoryUrl } = await import("./known-directory-urls");
            addKnownDirectoryUrl(schoolId, url);
            logs.push(`[${directory.schoolName}] Discovered and saved URL: ${url}`);
          }
        }
      }

      if (!url) {
        logs.push(`[${directory.schoolName}] No directory URL found`);
        await storage.updateSchoolDirectoryStatus(schoolId, "no_directory");
        processed++;
        if (processed % 2 === 0 || processed === targetSchools.length) {
          await storage.updateExtractionJob(jobId, { 
            processedSchools: processed, 
            contactsFound, 
            logs: logs.slice(-30) 
          });
        }
        continue;
      }

      const parserName = url.includes('sidearm') ? 'sidearm' : 
                         url.includes('presto') ? 'presto' : 'generic';
      
      if (isParserDisabled(parserName)) {
        logs.push(`[${directory.schoolName}] Parser ${parserName} disabled (circuit breaker open)`);
        processed++;
        continue;
      }

      logs.push(`[${directory.schoolName}] Extracting from ${url}`);
      const startTime = Date.now();
      let result = await extractStaffFromUrl(url);
      let extractionTime = Date.now() - startTime;
      let usedUrl = url;

      if (result.extractionMeta) {
        const meta = result.extractionMeta;
        logs.push(`[${directory.schoolName}] Method: ${result.method || 'unknown'}, reason: ${meta.fetchReason}, time: ${meta.timeTakenMs}ms${meta.waitStrategy ? `, wait: ${meta.waitStrategy} (${meta.contentWaitMs}ms)` : ''}${meta.scrollSteps ? `, scrolls: ${meta.scrollSteps}` : ''}`);
        extractionMetadata[schoolId] = {
          method: result.method || 'unknown',
          fetchReason: meta.fetchReason,
          waitStrategy: meta.waitStrategy,
          contentWaitMs: meta.contentWaitMs,
          scrollSteps: meta.scrollSteps,
          timeTakenMs: meta.timeTakenMs,
          contactsFound: result.contacts.length,
          parserUsed: result.diagnostics?.containersDetected ? parserName : 'none',
        };
      }

      const htmlWasFetched = result.html && result.html.length > 200;
      if (result.contacts.length === 0 && url && htmlWasFetched) {
        const altUrls = buildAlternativeUrls(url);
        if (altUrls.length > 0) {
          logs.push(`[${directory.schoolName}] Primary URL returned HTML but 0 contacts, trying ${altUrls.length} alternative URLs...`);
          for (const altUrl of altUrls) {
            try {
              const altStartTime = Date.now();
              const altResult = await extractStaffFromUrl(altUrl);
              const altTime = Date.now() - altStartTime;
              if (altResult.contacts.length > 0) {
                result = altResult;
                extractionTime = altTime;
                usedUrl = altUrl;
                logs.push(`[${directory.schoolName}] Alternative URL success: ${altUrl} (${altResult.contacts.length} contacts)`);
                await storage.upsertSchoolDirectory({ ...directory, directoryUrl: altUrl });
                break;
              }
            } catch {
              continue;
            }
          }
          if (result.contacts.length === 0) {
            logs.push(`[${directory.schoolName}] All alternative URLs also yielded 0 contacts`);
          }
        }
      }
      
      if (result.contacts.length > 0) {
        // Recover missing emails from per-staffer bio pages, reusing the
        // shared bio-page cache so repeated scrapes of the same directory
        // don't keep paying the full fetch cost.
        try {
          const enrichBase = result.resolvedUrl || usedUrl;
          const bioStats = await enrichMissingEmailsFromBio(result.contacts, enrichBase);
          if (bioStats.fetched > 0 || bioStats.cacheHits > 0 || bioStats.recovered > 0) {
            const meta = extractionMetadata[schoolId] || {
              method: result.method || 'unknown',
              fetchReason: result.extractionMeta?.fetchReason || 'unknown',
              timeTakenMs: extractionTime,
              contactsFound: result.contacts.length,
              parserUsed: parserName,
            };
            meta.bioEmailsRecovered = bioStats.recovered;
            meta.bioPagesFetched = bioStats.fetched;
            meta.bioCacheHits = bioStats.cacheHits;
            extractionMetadata[schoolId] = meta;
            recordBioEnrichment(parserName, bioStats.recovered, bioStats.fetched, bioStats.cacheHits);
            const lookups = bioStats.fetched + bioStats.cacheHits;
            const hitRate = lookups > 0 ? Math.round((bioStats.cacheHits / lookups) * 100) : 0;
            logs.push(`[${directory.schoolName}] Bio enrichment: recovered ${bioStats.recovered} emails (cache hits ${bioStats.cacheHits}/${lookups}, ${hitRate}% hit rate, fetched ${bioStats.fetched})`);
          }
        } catch (bioErr) {
          console.error(`[JobQueue] Bio enrichment failed for ${directory.schoolName}:`, bioErr);
        }

        recordParserSuccess(parserName, result.contacts.length, extractionTime);
        const members = await convertToStaffMembers(result.contacts, schoolId);
        
        const changes = await detectStaffChanges(schoolId, members);
        if (changes.length > 0) {
          await logChangesToDatabase(schoolId, changes);
          const hires = changes.filter(c => c.type === 'new_hire').length;
          const departures = changes.filter(c => c.type === 'departure').length;
          const titleChanges = changes.filter(c => c.type === 'title_change').length;
          logs.push(`[${directory.schoolName}] Turnover: +${hires} hires, -${departures} departures, ${titleChanges} title changes`);
          
          for (const change of changes) {
            try {
              if (change.type === 'new_hire') {
                await createNewHireSignal(
                  change.staffId || 0,
                  change.name,
                  change.newValue || null,
                  schoolId,
                  directory.schoolName
                );
              } else if (change.type === 'departure') {
                await createDepartureSignal(
                  change.staffId || 0,
                  change.name,
                  change.oldValue || null,
                  schoolId,
                  directory.schoolName
                );
              }
            } catch (signalErr) {
              console.error(`[JobQueue] Failed to create signal for ${change.name}:`, signalErr);
            }
          }
        }
        
        await storage.bulkUpsertStaffMembers(members);
        
        let techStack: string[] | undefined;
        if (result.html) {
          const techResult = detectTechStack(result.html);
          if (techResult.techStack.length > 0) {
            techStack = techResult.techStack;
            logs.push(`[${directory.schoolName}] Tech detected: ${techStack.join(', ')}`);
            
            const oldTechStack = (directory.techStack as string[]) || [];
            if (oldTechStack.length > 0) {
              try {
                const techChanges = await detectTechChanges(schoolId, oldTechStack, techStack);
                if (techChanges.dropped.length > 0 || techChanges.added.length > 0) {
                  logs.push(`[${directory.schoolName}] Tech changes: +${techChanges.added.length} added, -${techChanges.dropped.length} dropped`);
                }
              } catch (techErr) {
                console.error(`[JobQueue] Failed to create tech change signal:`, techErr);
              }
            }
          }
        }
        
        const buyingWindowStatus = getBuyingWindowStatus();
        
        await storage.upsertSchoolDirectory({
          ...directory,
          directoryUrl: usedUrl,
          resolvedUrl: result.resolvedUrl || directory.resolvedUrl,
          status: "success",
          contactsCount: result.contacts.length,
          avgConfidence: result.diagnostics.averageConfidence,
          lastExtractedAt: new Date(),
          lastAttemptedAt: new Date(),
          techStack: techStack || directory.techStack,
          buyingWindowStatus,
          failureReason: null,
          extractionAttempts: 0,
          lastSuccessfulMethod: result.method || null,
        });
        
        if (result.resolvedUrl) {
          logs.push(`[${directory.schoolName}] URL redirect: ${usedUrl} -> ${result.resolvedUrl}`);
        }
        
        contactsFound += result.contacts.length;
        logs.push(`[${directory.schoolName}] Extracted ${result.contacts.length} contacts`);
      } else {
        const failReason = categorizeFailureReason("No contacts found", 0, result.httpStatus);
        recordParserFailure(parserName, 'noContacts');
        const currentAttempts = (directory.extractionAttempts || 0) + 1;
        const failStatus = currentAttempts >= NEEDS_REVIEW_THRESHOLD ? "needs_review" : "failed";
        await storage.updateSchoolDirectoryStatus(schoolId, failStatus, "No contacts found", failReason);
        logs.push(`[${directory.schoolName}] No contacts found (${failReason}, attempt ${currentAttempts}${failStatus === 'needs_review' ? ' - NEEDS REVIEW' : ''})`);
      }
    } catch (e: any) {
      const failReason = categorizeFailureReason(e.message || '', 0);
      const errorType = e.message?.includes('timeout') ? 'timeout' :
                       e.message?.includes('403') || e.message?.includes('forbidden') ? 'forbidden' :
                       e.message?.includes('parse') ? 'parsing' : 'other';
      if (url) {
        const errParserName = url.includes('sidearm') ? 'sidearm' : 
                              url.includes('presto') ? 'presto' : 'generic';
        recordParserFailure(errParserName, errorType);
      }
      console.error(`[JobQueue] Error processing ${schoolId}:`, e);
      logs.push(`[${schoolId}] Error (${failReason}): ${e.message}`);
      try {
        const directory = await storage.getSchoolDirectory(schoolId);
        const currentAttempts = (directory?.extractionAttempts || 0) + 1;
        const failStatus = currentAttempts >= NEEDS_REVIEW_THRESHOLD ? "needs_review" : "failed";
        await storage.updateSchoolDirectoryStatus(schoolId, failStatus, e.message, failReason);
        if (failStatus === 'needs_review') {
          logs.push(`[${schoolId}] Flagged as NEEDS REVIEW after ${currentAttempts} failed attempts`);
        }
      } catch (updateErr) {
        console.error(`[JobQueue] Failed to update status for ${schoolId}:`, updateErr);
      }
    } finally {
      if (hasLock) {
        releaseSchoolLock(schoolId);
      }
    }

    processed++;
    if (processed % 2 === 0 || processed === targetSchools.length) {
      await storage.updateExtractionJob(jobId, { 
        processedSchools: processed, 
        contactsFound, 
        logs: logs.slice(-30) 
      });
      
      broadcastJobUpdate({
        type: 'job_progress',
        jobId,
        schoolId,
        data: {
          status: 'processing',
          processedSchools: processed,
          totalSchools: targetSchools.length,
          contactsFound,
          lastSchool: schoolId,
          progress: Math.round((processed / targetSchools.length) * 100)
        }
      });
    }
    
    await waitWithJitter(1000, 3000);
  }

  logs.push(`Job completed: ${processed} schools, ${contactsFound} contacts`);
  await storage.updateExtractionJob(jobId, { 
    status: "completed", 
    processedSchools: processed,
    contactsFound,
    logs,
    extractionMetadata: Object.keys(extractionMetadata).length > 0 ? extractionMetadata : undefined,
  });
  
  broadcastJobUpdate({
    type: 'job_completed',
    jobId,
    data: {
      status: 'completed',
      processedSchools: processed,
      totalSchools: targetSchools.length,
      contactsFound,
      progress: 100
    }
  });
  
  console.log(`[JobQueue] Job #${jobId} completed: ${processed} schools, ${contactsFound} contacts`);
}

export function getQueueStatus(): { activeCount: number; activeJobIds: number[] } {
  return {
    activeCount: activeJobs.size,
    activeJobIds: Array.from(activeJobs),
  };
}

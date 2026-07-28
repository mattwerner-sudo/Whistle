import { storage } from "../storage";
import { SchoolDirectory } from "@shared/schema";

export interface DataFreshnessConfig {
  power5MaxDays: number;
  midTierMaxDays: number;
  defaultMaxDays: number;
}

const defaultConfig: DataFreshnessConfig = {
  power5MaxDays: 7,
  midTierMaxDays: 14,
  defaultMaxDays: 30,
};

const POWER_5_CONFERENCES = [
  "ACC",
  "Big Ten",
  "Big 12",
  "Pac-12",
  "SEC",
];

const MID_TIER_CONFERENCES = [
  "American Athletic",
  "Mountain West",
  "Sun Belt",
  "Mid-American",
  "Conference USA",
];

export function getConferenceTier(conference: string | null | undefined): "power5" | "midTier" | "other" {
  if (!conference) return "other";
  
  const normalizedConference = conference.toLowerCase();
  
  for (const p5 of POWER_5_CONFERENCES) {
    if (normalizedConference.includes(p5.toLowerCase())) {
      return "power5";
    }
  }
  
  for (const mt of MID_TIER_CONFERENCES) {
    if (normalizedConference.includes(mt.toLowerCase())) {
      return "midTier";
    }
  }
  
  return "other";
}

export function getMaxStaleDays(conference: string | null | undefined, config: DataFreshnessConfig = defaultConfig): number {
  const tier = getConferenceTier(conference);
  
  switch (tier) {
    case "power5":
      return config.power5MaxDays;
    case "midTier":
      return config.midTierMaxDays;
    default:
      return config.defaultMaxDays;
  }
}

export function isStale(school: SchoolDirectory, config: DataFreshnessConfig = defaultConfig): boolean {
  if (!school.lastExtractedAt) {
    return school.status === "success";
  }
  
  const maxDays = getMaxStaleDays(school.conference, config);
  const now = new Date();
  const lastExtracted = new Date(school.lastExtractedAt);
  const daysSinceExtraction = Math.floor((now.getTime() - lastExtracted.getTime()) / (1000 * 60 * 60 * 24));
  
  return daysSinceExtraction > maxDays;
}

export function getDaysSinceExtraction(school: SchoolDirectory): number | null {
  if (!school.lastExtractedAt) return null;
  
  const now = new Date();
  const lastExtracted = new Date(school.lastExtractedAt);
  return Math.floor((now.getTime() - lastExtracted.getTime()) / (1000 * 60 * 60 * 24));
}

export interface ConfidenceValue {
  value: number;
  confidence: number;
}

export interface FailedSchoolInfo {
  schoolId: string;
  schoolName: string;
  conference: string | null;
  tier: "power5" | "midTier" | "other";
  failureReason: string | null;
  extractionAttempts: number;
  extractionError: string | null;
  lastAttemptedAt: Date | null;
  needsReview: boolean;
}

export interface FailureReasonBreakdown {
  url_not_found: number;
  timeout: number;
  blocked: number;
  no_contacts: number;
  parse_error: number;
  unknown: number;
}

export interface DataHealthMetrics {
  totalSchools: number;
  extractedSchools: number;
  pendingSchools: number;
  staleSchools: number;
  freshSchools: number;
  neverExtracted: number;
  failedSchools: number;
  needsReviewSchools: number;
  failureReasonBreakdown: FailureReasonBreakdown;
  freshnessPercentage: ConfidenceValue;
  averageDaysSinceExtraction: ConfidenceValue | null;
  totalContacts: number;
  averageConfidence: ConfidenceValue | null;
  averagePriorityScore: ConfidenceValue | null;
  byConferenceTier: {
    power5: TierMetrics;
    midTier: TierMetrics;
    other: TierMetrics;
  };
  byConference: ConferenceMetrics[];
  staleSchoolsList: StaleSchoolInfo[];
  failedSchoolsList: FailedSchoolInfo[];
}

export interface TierMetrics {
  total: number;
  extracted: number;
  stale: number;
  fresh: number;
  maxDays: number;
  averagePriorityScore: ConfidenceValue | null;
}

export interface ConferenceMetrics {
  conference: string;
  tier: "power5" | "midTier" | "other";
  total: number;
  extracted: number;
  stale: number;
  fresh: number;
  contacts: number;
}

export interface StaleSchoolInfo {
  schoolId: string;
  schoolName: string;
  conference: string | null;
  tier: "power5" | "midTier" | "other";
  lastExtractedAt: Date | null;
  daysSinceExtraction: number | null;
  maxAllowedDays: number;
  contactsCount: number;
  priorityScore: number;
}

export async function getDataHealthMetrics(config: DataFreshnessConfig = defaultConfig): Promise<DataHealthMetrics> {
  const { directories: schools } = await storage.getSchoolDirectories({ limit: 10000 });
  const { computePriorityScore } = await import("./priority-score");
  
  const tierMetrics: DataHealthMetrics["byConferenceTier"] = {
    power5: { total: 0, extracted: 0, stale: 0, fresh: 0, maxDays: config.power5MaxDays, averagePriorityScore: null },
    midTier: { total: 0, extracted: 0, stale: 0, fresh: 0, maxDays: config.midTierMaxDays, averagePriorityScore: null },
    other: { total: 0, extracted: 0, stale: 0, fresh: 0, maxDays: config.defaultMaxDays, averagePriorityScore: null },
  };
  
  const tierPriorityScores: { [key: string]: { total: number; count: number; confidence: number } } = {
    power5: { total: 0, count: 0, confidence: 0 },
    midTier: { total: 0, count: 0, confidence: 0 },
    other: { total: 0, count: 0, confidence: 0 },
  };
  
  const conferenceMap = new Map<string, ConferenceMetrics>();
  const staleSchoolsList: StaleSchoolInfo[] = [];
  const failedSchoolsList: FailedSchoolInfo[] = [];
  const failureReasonBreakdown: FailureReasonBreakdown = {
    url_not_found: 0, timeout: 0, blocked: 0, no_contacts: 0, parse_error: 0, unknown: 0,
  };
  
  let totalContacts = 0;
  let totalConfidence = 0;
  let confidenceCount = 0;
  let totalDays = 0;
  let daysCount = 0;
  let extractedSchools = 0;
  let pendingSchools = 0;
  let staleSchools = 0;
  let freshSchools = 0;
  let neverExtracted = 0;
  let failedSchools = 0;
  let needsReviewSchools = 0;
  let totalPriorityScore = 0;
  let priorityScoreCount = 0;
  let priorityScoreConfidence = 0;
  
  for (const school of schools) {
    const tier = getConferenceTier(school.conference);
    const isExtracted = school.status === "success";
    const isSchoolStale = isStale(school, config);
    const daysSince = getDaysSinceExtraction(school);
    const maxDays = getMaxStaleDays(school.conference, config);
    const priorityData = computePriorityScore(school);
    
    tierMetrics[tier].total++;
    tierPriorityScores[tier].total += priorityData.totalScore;
    tierPriorityScores[tier].confidence += priorityData.confidence;
    tierPriorityScores[tier].count++;
    
    totalPriorityScore += priorityData.totalScore;
    priorityScoreConfidence += priorityData.confidence;
    priorityScoreCount++;
    
    if (isExtracted) {
      extractedSchools++;
      tierMetrics[tier].extracted++;
      
      if (school.lastExtractedAt) {
        if (isSchoolStale) {
          staleSchools++;
          tierMetrics[tier].stale++;
          
          staleSchoolsList.push({
            schoolId: school.schoolId,
            schoolName: school.schoolName,
            conference: school.conference,
            tier,
            lastExtractedAt: school.lastExtractedAt,
            daysSinceExtraction: daysSince,
            maxAllowedDays: maxDays,
            contactsCount: school.contactsCount || 0,
            priorityScore: priorityData.totalScore,
          });
        } else {
          freshSchools++;
          tierMetrics[tier].fresh++;
        }
        
        if (daysSince !== null) {
          totalDays += daysSince;
          daysCount++;
        }
      } else {
        neverExtracted++;
      }
    } else if (school.status === "failed" || school.status === "needs_review") {
      failedSchools++;
      if (school.status === "needs_review") {
        needsReviewSchools++;
      }
      const reason = (school.failureReason || 'unknown') as keyof FailureReasonBreakdown;
      if (reason in failureReasonBreakdown) {
        failureReasonBreakdown[reason]++;
      } else {
        failureReasonBreakdown.unknown++;
      }
      failedSchoolsList.push({
        schoolId: school.schoolId,
        schoolName: school.schoolName,
        conference: school.conference,
        tier,
        failureReason: school.failureReason,
        extractionAttempts: school.extractionAttempts || 0,
        extractionError: school.extractionError,
        lastAttemptedAt: school.lastAttemptedAt,
        needsReview: school.status === "needs_review",
      });
    } else {
      pendingSchools++;
      neverExtracted++;
    }
    
    totalContacts += school.contactsCount || 0;
    if (school.avgConfidence && school.avgConfidence > 0) {
      totalConfidence += school.avgConfidence;
      confidenceCount++;
    }
    
    const confName = school.conference || "Unknown";
    if (!conferenceMap.has(confName)) {
      conferenceMap.set(confName, {
        conference: confName,
        tier,
        total: 0,
        extracted: 0,
        stale: 0,
        fresh: 0,
        contacts: 0,
      });
    }
    
    const confMetrics = conferenceMap.get(confName)!;
    confMetrics.total++;
    confMetrics.contacts += school.contactsCount || 0;
    
    if (isExtracted) {
      confMetrics.extracted++;
      if (isSchoolStale) {
        confMetrics.stale++;
      } else {
        confMetrics.fresh++;
      }
    }
  }
  
  for (const tier of ["power5", "midTier", "other"] as const) {
    if (tierPriorityScores[tier].count > 0) {
      tierMetrics[tier].averagePriorityScore = {
        value: Math.round(tierPriorityScores[tier].total / tierPriorityScores[tier].count),
        confidence: Math.round((tierPriorityScores[tier].confidence / tierPriorityScores[tier].count) * 100) / 100,
      };
    }
  }
  
  staleSchoolsList.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    const tierOrder = { power5: 0, midTier: 1, other: 2 };
    if (tierOrder[a.tier] !== tierOrder[b.tier]) {
      return tierOrder[a.tier] - tierOrder[b.tier];
    }
    return (b.daysSinceExtraction || 0) - (a.daysSinceExtraction || 0);
  });
  
  const byConference = Array.from(conferenceMap.values()).sort((a, b) => {
    const tierOrder = { power5: 0, midTier: 1, other: 2 };
    if (tierOrder[a.tier] !== tierOrder[b.tier]) {
      return tierOrder[a.tier] - tierOrder[b.tier];
    }
    return b.total - a.total;
  });
  
  const freshnessConfidence = extractedSchools > 0 ? Math.min(1, extractedSchools / schools.length) : 0;
  const daysConfidence = daysCount > 0 ? Math.min(1, daysCount / schools.length) : 0;
  
  failedSchoolsList.sort((a, b) => {
    if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1;
    return (b.extractionAttempts || 0) - (a.extractionAttempts || 0);
  });

  return {
    totalSchools: schools.length,
    extractedSchools,
    pendingSchools,
    staleSchools,
    freshSchools,
    neverExtracted,
    failedSchools,
    needsReviewSchools,
    failureReasonBreakdown,
    freshnessPercentage: {
      value: extractedSchools > 0 ? Math.round((freshSchools / extractedSchools) * 100) : 0,
      confidence: Math.round(freshnessConfidence * 100) / 100,
    },
    averageDaysSinceExtraction: daysCount > 0 ? {
      value: Math.round(totalDays / daysCount),
      confidence: Math.round(daysConfidence * 100) / 100,
    } : null,
    totalContacts,
    averageConfidence: confidenceCount > 0 ? {
      value: Math.round(totalConfidence / confidenceCount),
      confidence: Math.round((confidenceCount / schools.length) * 100) / 100,
    } : null,
    averagePriorityScore: priorityScoreCount > 0 ? {
      value: Math.round(totalPriorityScore / priorityScoreCount),
      confidence: Math.round((priorityScoreConfidence / priorityScoreCount) * 100) / 100,
    } : null,
    byConferenceTier: tierMetrics,
    byConference,
    staleSchoolsList: staleSchoolsList.slice(0, 100),
    failedSchoolsList: failedSchoolsList.slice(0, 100),
  };
}

export async function getStaleSchoolIds(
  config: DataFreshnessConfig = defaultConfig,
  tier?: "power5" | "midTier" | "other",
  limit: number = 50
): Promise<string[]> {
  const { directories: schools } = await storage.getSchoolDirectories({ limit: 10000 });
  
  const staleSchools = schools
    .filter((school: SchoolDirectory) => {
      if (school.status !== "success") return false;
      if (!isStale(school, config)) return false;
      if (tier && getConferenceTier(school.conference) !== tier) return false;
      return true;
    })
    .sort((a: SchoolDirectory, b: SchoolDirectory) => {
      const tierOrder = { power5: 0, midTier: 1, other: 2 };
      const aTier = getConferenceTier(a.conference);
      const bTier = getConferenceTier(b.conference);
      if (tierOrder[aTier] !== tierOrder[bTier]) {
        return tierOrder[aTier] - tierOrder[bTier];
      }
      const aDays = getDaysSinceExtraction(a) || 0;
      const bDays = getDaysSinceExtraction(b) || 0;
      return bDays - aDays;
    })
    .slice(0, limit);
  
  return staleSchools.map((s: SchoolDirectory) => s.schoolId);
}

export async function getFailedSchoolIds(
  failureReason?: string,
  limit: number = 50,
  conference?: string,
  includeNeedsReview: boolean = false
): Promise<string[]> {
  const { directories: schools } = await storage.getSchoolDirectories({ limit: 10000 });
  
  const failedSchools = schools
    .filter((school: SchoolDirectory) => {
      if (includeNeedsReview) {
        if (school.status !== "failed" && school.status !== "needs_review") return false;
      } else {
        if (school.status !== "failed") return false;
      }
      if (failureReason && school.failureReason !== failureReason) return false;
      if (conference && school.conference !== conference) return false;
      return true;
    })
    .sort((a: SchoolDirectory, b: SchoolDirectory) => {
      const tierOrder = { power5: 0, midTier: 1, other: 2 };
      const aTier = getConferenceTier(a.conference);
      const bTier = getConferenceTier(b.conference);
      if (tierOrder[aTier] !== tierOrder[bTier]) {
        return tierOrder[aTier] - tierOrder[bTier];
      }
      return (a.extractionAttempts || 0) - (b.extractionAttempts || 0);
    })
    .slice(0, limit);
  
  return failedSchools.map((s: SchoolDirectory) => s.schoolId);
}

/**
 * Scraper Health Monitor - Circuit Breaker, Rate Limiting & Metrics
 * 
 * Provides production-grade reliability features:
 * - Circuit breaker pattern for parser failure recovery
 * - User-agent rotation for anti-detection
 * - Request fingerprinting with realistic delays
 * - Health metrics tracking for observability
 */

import fuzzysort from 'fuzzysort';

export interface ParserMetrics {
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  avgExtractionTime: number;
  totalContacts: number;
  disabledUntil: Date | null;
  bioEmailsRecovered: number;
  bioPagesFetched: number;
  bioCacheHits: number;
  bioEnrichedRuns: number;
}

export interface BioCacheStats {
  totalRecovered: number;
  totalFetched: number;
  totalCacheHits: number;
  totalLookups: number;
  hitRate: number;
  enrichedRuns: number;
}

export interface HealthSnapshot {
  parsers: Record<string, ParserMetrics>;
  overall: {
    totalExtractions: number;
    successRate: number;
    avgContactsPerExtraction: number;
    avgExtractionTime: number;
  };
  bioCache: BioCacheStats;
  errors: {
    timeout: number;
    forbidden: number;
    parsing: number;
    noContacts: number;
    other: number;
  };
}

const parserMetrics: Record<string, ParserMetrics> = {};
const errorCounts = {
  timeout: 0,
  forbidden: 0,
  parsing: 0,
  noContacts: 0,
  other: 0,
};

// The "generic" bucket covers hundreds of genuinely different real-world
// sites, not one parser's health. Empirically, real per-site success for
// generic is ~70-75% once resource contention is controlled for — at that
// rate, hitting 3 failures in a row somewhere in a 30-school batch is common
// by ordinary variance alone (schools are processed in a fixed order, and a
// run of harder sites can cluster), not evidence the parser itself broke.
// A too-low threshold was observed tripping mid-batch repeatedly, each time
// idling every *other*, otherwise-fine site in the bucket for 30 minutes.
const CIRCUIT_BREAKER_THRESHOLD = 8;
const CIRCUIT_BREAKER_RESET_MS = 30 * 60 * 1000;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

function getParserMetrics(parserName: string): ParserMetrics {
  if (!parserMetrics[parserName]) {
    parserMetrics[parserName] = {
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastSuccess: null,
      lastFailure: null,
      avgExtractionTime: 0,
      totalContacts: 0,
      disabledUntil: null,
      bioEmailsRecovered: 0,
      bioPagesFetched: 0,
      bioCacheHits: 0,
      bioEnrichedRuns: 0,
    };
  }
  return parserMetrics[parserName];
}

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getRandomDelay(minMs: number = 2000, maxMs: number = 5000): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export async function waitWithJitter(minMs: number = 2000, maxMs: number = 5000): Promise<void> {
  const delay = getRandomDelay(minMs, maxMs);
  await new Promise(resolve => setTimeout(resolve, delay));
}

export function isParserDisabled(parserName: string): boolean {
  const metrics = getParserMetrics(parserName);
  if (!metrics.disabledUntil) return false;
  
  if (new Date() >= metrics.disabledUntil) {
    metrics.disabledUntil = null;
    metrics.consecutiveFailures = 0;
    console.log(`[CircuitBreaker] Parser ${parserName} re-enabled after cooldown`);
    return false;
  }
  
  return true;
}

export function recordParserSuccess(
  parserName: string, 
  contactsExtracted: number, 
  extractionTimeMs: number
): void {
  const metrics = getParserMetrics(parserName);
  metrics.successCount++;
  metrics.consecutiveFailures = 0;
  metrics.lastSuccess = new Date();
  metrics.totalContacts += contactsExtracted;
  
  const totalExtractions = metrics.successCount + metrics.failureCount;
  metrics.avgExtractionTime = 
    (metrics.avgExtractionTime * (totalExtractions - 1) + extractionTimeMs) / totalExtractions;
}

export function recordParserFailure(parserName: string, errorType: keyof typeof errorCounts): void {
  const metrics = getParserMetrics(parserName);
  metrics.failureCount++;
  metrics.consecutiveFailures++;
  metrics.lastFailure = new Date();
  
  errorCounts[errorType]++;
  
  if (metrics.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    metrics.disabledUntil = new Date(Date.now() + CIRCUIT_BREAKER_RESET_MS);
    console.log(`[CircuitBreaker] Parser ${parserName} disabled until ${metrics.disabledUntil.toISOString()}`);
  }
}

export function recordBioEnrichment(
  parserName: string,
  recovered: number,
  fetched: number,
  cacheHits: number,
): void {
  if (recovered === 0 && fetched === 0 && cacheHits === 0) return;
  const metrics = getParserMetrics(parserName);
  metrics.bioEmailsRecovered += recovered;
  metrics.bioPagesFetched += fetched;
  metrics.bioCacheHits += cacheHits;
  metrics.bioEnrichedRuns += 1;
}

export function getHealthSnapshot(): HealthSnapshot {
  const parsers = { ...parserMetrics };
  
  let totalSuccess = 0;
  let totalFail = 0;
  let totalContacts = 0;
  let totalTime = 0;
  let parserCount = 0;
  let bioRecovered = 0;
  let bioFetched = 0;
  let bioCacheHits = 0;
  let bioEnrichedRuns = 0;
  
  for (const metrics of Object.values(parsers)) {
    totalSuccess += metrics.successCount;
    totalFail += metrics.failureCount;
    totalContacts += metrics.totalContacts;
    totalTime += metrics.avgExtractionTime * (metrics.successCount + metrics.failureCount);
    parserCount++;
    bioRecovered += metrics.bioEmailsRecovered;
    bioFetched += metrics.bioPagesFetched;
    bioCacheHits += metrics.bioCacheHits;
    bioEnrichedRuns += metrics.bioEnrichedRuns;
  }
  
  const totalExtractions = totalSuccess + totalFail;
  const bioLookups = bioFetched + bioCacheHits;
  
  return {
    parsers,
    overall: {
      totalExtractions,
      successRate: totalExtractions > 0 ? (totalSuccess / totalExtractions) * 100 : 0,
      avgContactsPerExtraction: totalSuccess > 0 ? totalContacts / totalSuccess : 0,
      avgExtractionTime: totalExtractions > 0 ? totalTime / totalExtractions : 0,
    },
    bioCache: {
      totalRecovered: bioRecovered,
      totalFetched: bioFetched,
      totalCacheHits: bioCacheHits,
      totalLookups: bioLookups,
      hitRate: bioLookups > 0 ? (bioCacheHits / bioLookups) * 100 : 0,
      enrichedRuns: bioEnrichedRuns,
    },
    errors: { ...errorCounts },
  };
}

export function resetHealthMetrics(): void {
  for (const key of Object.keys(parserMetrics)) {
    delete parserMetrics[key];
  }
  errorCounts.timeout = 0;
  errorCounts.forbidden = 0;
  errorCounts.parsing = 0;
  errorCounts.noContacts = 0;
  errorCounts.other = 0;
}

export function fuzzyMatchName(name1: string, name2: string, threshold: number = 0.85): boolean {
  if (!name1 || !name2) return false;
  
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();
  
  if (n1 === n2) return true;
  
  const result = fuzzysort.single(n1, n2);
  if (!result) return false;
  
  const score = (result.score + 1000) / 1000;
  return score >= threshold;
}

export function findFuzzyMatch<T extends { name: string }>(
  target: string,
  candidates: T[],
  threshold: number = 0.85
): T | null {
  if (!target || candidates.length === 0) return null;
  
  const results = fuzzysort.go(target.toLowerCase(), candidates, {
    key: 'name',
    threshold: (threshold * 1000) - 1000,
    limit: 1,
  });
  
  return results.length > 0 ? results[0].obj : null;
}

export function validateEmail(email: string): { valid: boolean; score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 0;
  
  if (!email || !email.includes('@')) {
    return { valid: false, score: 0, issues: ['Invalid email format'] };
  }
  
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    issues.push('Email format not standard');
    score = 40;
  } else {
    score = 70;
  }
  
  const domain = email.split('@')[1].toLowerCase();
  const eduDomains = ['.edu', '.ac.uk', '.edu.au', '.edu.ca'];
  const isEduDomain = eduDomains.some(ext => domain.endsWith(ext));
  
  if (isEduDomain) {
    score = 100;
  } else if (domain.includes('university') || domain.includes('college') || domain.includes('athletics')) {
    score = 90;
  } else {
    issues.push('Non-educational domain');
    score = Math.max(score, 60);
  }
  
  return { valid: score >= 40, score, issues };
}

export function validatePhone(phone: string): { valid: boolean; score: number; format: string } {
  if (!phone) return { valid: false, score: 0, format: 'none' };
  
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) {
    return { valid: true, score: 90, format: 'US-10' };
  }
  
  if (digits.length === 11 && digits.startsWith('1')) {
    return { valid: true, score: 90, format: 'US-11' };
  }
  
  if (digits.length === 7) {
    return { valid: true, score: 60, format: 'local-7' };
  }
  
  if (digits.length >= 10 && digits.length <= 15) {
    return { valid: true, score: 70, format: 'international' };
  }
  
  return { valid: false, score: 0, format: 'invalid' };
}

const NCAA_TITLE_KEYWORDS = [
  'athletic director', 'ad', 'coach', 'director', 'coordinator', 'manager',
  'assistant', 'associate', 'senior', 'head', 'trainer', 'physician',
  'compliance', 'academic', 'marketing', 'communications', 'media',
  'operations', 'facilities', 'equipment', 'recruiting', 'development',
  'ticketing', 'events', 'video', 'strength', 'conditioning', 'nutrition',
  'sports medicine', 'athletic training', 'sports information', 'intern',
];

export function validateTitle(title: string): { valid: boolean; score: number; category: string } {
  if (!title || title.length < 3) {
    return { valid: false, score: 0, category: 'none' };
  }
  
  const normalized = title.toLowerCase();
  
  const matchedKeywords = NCAA_TITLE_KEYWORDS.filter(kw => normalized.includes(kw));
  
  if (matchedKeywords.length >= 2) {
    return { valid: true, score: 100, category: 'athletic-specific' };
  }
  
  if (matchedKeywords.length === 1) {
    return { valid: true, score: 85, category: 'athletic-related' };
  }
  
  if (title.length > 5 && title.length < 100 && !title.includes('@') && !/^\d/.test(title)) {
    return { valid: true, score: 60, category: 'general' };
  }
  
  return { valid: false, score: 30, category: 'unknown' };
}

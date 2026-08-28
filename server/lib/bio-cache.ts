/**
 * Bio Page Cache
 *
 * Caches the result of per-staffer bio-page fetches keyed by resolved bio
 * URL. The directory scrape calls `enrichMissingEmailsFromBio` (in
 * scraper-worker) which fetches each staffer's bio page through a CORS
 * proxy. Without a cache every re-scrape pays for the same hundreds of
 * fetches, and the per-scrape cap (`SCRAPER_BIO_ENRICH_MAX_PAGES`) has to
 * stay artificially low.
 *
 * The cache stores both positive ("we found this email") and negative
 * ("we fetched it and there was no email / fetch failed") entries, with
 * separate TTLs. It is persisted to disk so the savings survive process
 * restarts. Schema mirrors the SPA host cache: { version, updatedAt,
 * entries: { url: { email, fetchedAt, hit } } }.
 */

import * as fs from 'fs';
import * as path from 'path';

const CACHE_PATH = process.env.SCRAPER_BIO_CACHE_PATH
  || path.join(process.cwd(), '.data', 'bio-cache.json');

const DEFAULT_POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const MAX_ENTRIES = parseInt(process.env.SCRAPER_BIO_CACHE_MAX_ENTRIES || '20000', 10);

const POSITIVE_TTL_MS = parseInt(
  process.env.SCRAPER_BIO_CACHE_TTL_MS || String(DEFAULT_POSITIVE_TTL_MS),
  10,
);
const NEGATIVE_TTL_MS = parseInt(
  process.env.SCRAPER_BIO_CACHE_NEGATIVE_TTL_MS || String(DEFAULT_NEGATIVE_TTL_MS),
  10,
);

interface CacheEntry {
  email: string | null;
  fetchedAt: number;
  hits: number;
}

interface CacheFile {
  version: 1;
  updatedAt: string;
  entries: Record<string, CacheEntry>;
}

let mem: Map<string, CacheEntry> | null = null;
let raw: CacheFile | null = null;
let dirty = false;
let persistTimer: NodeJS.Timeout | null = null;

function loadSync(): void {
  if (mem) return;
  mem = new Map();
  raw = { version: 1, updatedAt: new Date().toISOString(), entries: {} };
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const text = fs.readFileSync(CACHE_PATH, 'utf8');
      const parsed = JSON.parse(text) as CacheFile;
      if (parsed && parsed.entries && typeof parsed.entries === 'object') {
        raw = parsed;
        for (const [url, entry] of Object.entries(parsed.entries)) {
          if (entry && typeof entry.fetchedAt === 'number') {
            mem.set(url, {
              email: entry.email ?? null,
              fetchedAt: entry.fetchedAt,
              hits: entry.hits || 0,
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[BioCache] Failed to load ${CACHE_PATH}: ${err.message}`);
  }
}

function schedulePersist(): void {
  dirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (dirty) persistNow();
  }, 2000);
  // Don't keep the event loop alive for the cache flush.
  if (typeof persistTimer.unref === 'function') persistTimer.unref();
}

function persistNow(): void {
  if (!raw || !mem) return;
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    raw.updatedAt = new Date().toISOString();
    raw.entries = {};
    mem.forEach((entry, url) => {
      raw!.entries[url] = entry;
    });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(raw));
    dirty = false;
  } catch (err: any) {
    console.warn(`[BioCache] Failed to persist ${CACHE_PATH}: ${err.message}`);
  }
}

function isExpired(entry: CacheEntry, now: number): boolean {
  const ttl = entry.email ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  return now - entry.fetchedAt > ttl;
}

export interface BioCacheLookup {
  hit: boolean;
  email: string | null;
}

/**
 * Look up a resolved bio URL in the cache. Returns { hit: false } when no
 * usable entry exists (missing or expired), forcing the caller to fetch.
 * Returns { hit: true, email } when a fresh positive entry exists, and
 * { hit: true, email: null } when a fresh negative entry exists (we fetched
 * recently and got nothing).
 */
export function getCachedBio(url: string): BioCacheLookup {
  loadSync();
  const entry = mem!.get(url);
  if (!entry) return { hit: false, email: null };
  if (isExpired(entry, Date.now())) {
    mem!.delete(url);
    schedulePersist();
    return { hit: false, email: null };
  }
  entry.hits = (entry.hits || 0) + 1;
  schedulePersist();
  return { hit: true, email: entry.email };
}

export function setCachedBio(url: string, email: string | null): void {
  loadSync();
  mem!.set(url, { email, fetchedAt: Date.now(), hits: 0 });
  if (mem!.size > MAX_ENTRIES) evictOldest();
  schedulePersist();
}

function evictOldest(): void {
  if (!mem) return;
  const target = Math.floor(MAX_ENTRIES * 0.9);
  const all: Array<[string, CacheEntry]> = [];
  mem.forEach((entry, url) => { all.push([url, entry]); });
  const sorted = all.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  while (sorted.length > target) {
    const [url] = sorted.shift()!;
    mem.delete(url);
  }
}

export interface BioCacheStats {
  size: number;
  positive: number;
  negative: number;
}

export function getBioCacheStats(): BioCacheStats {
  loadSync();
  let positive = 0;
  let negative = 0;
  mem!.forEach((entry) => {
    if (entry.email) positive++;
    else negative++;
  });
  return { size: mem!.size, positive, negative };
}

/** Force-flush any pending writes (used at shutdown / after big batches). */
export function flushBioCache(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
}

export function clearBioCacheForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  mem = new Map();
  raw = { version: 1, updatedAt: new Date().toISOString(), entries: {} };
  dirty = false;
}

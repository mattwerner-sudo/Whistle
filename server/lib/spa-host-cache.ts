/**
 * SPA Host Cache
 *
 * Tracks hostnames whose staff directories we've discovered are rendered
 * client-side (Vue/React/etc shells). When a host is in this cache,
 * `needsJavaScriptRendering` returns true and the scraper skips the CORS
 * proxy fast-path, going straight to Playwright.
 *
 * The cache is persisted to disk so the learning survives process restarts.
 * It complements (and is loaded after) the hard-coded JS_RENDERED_DOMAINS
 * list in scraper-config.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

const CACHE_PATH = process.env.SCRAPER_SPA_HOST_CACHE_PATH
  || path.join(process.cwd(), '.data', 'spa-hosts.json');

interface CacheFile {
  version: 1;
  updatedAt: string;
  hosts: Record<string, { learnedAt: string; reason: string; hits: number }>;
}

let cache: Set<string> | null = null;
let raw: CacheFile | null = null;

function loadSync(): void {
  if (cache) return;
  cache = new Set();
  raw = { version: 1, updatedAt: new Date().toISOString(), hosts: {} };
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const text = fs.readFileSync(CACHE_PATH, 'utf8');
      const parsed = JSON.parse(text) as CacheFile;
      if (parsed && parsed.hosts && typeof parsed.hosts === 'object') {
        raw = parsed;
        for (const host of Object.keys(parsed.hosts)) cache.add(host.toLowerCase());
      }
    }
  } catch (err: any) {
    console.warn(`[SpaHostCache] Failed to load ${CACHE_PATH}: ${err.message}`);
  }
}

function persist(): void {
  if (!raw) return;
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    raw.updatedAt = new Date().toISOString();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(raw, null, 2));
  } catch (err: any) {
    console.warn(`[SpaHostCache] Failed to persist ${CACHE_PATH}: ${err.message}`);
  }
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLearnedSpaHost(url: string): boolean {
  loadSync();
  const host = hostFromUrl(url);
  if (!host) return false;
  if (cache!.has(host)) return true;
  // Match parent domain too (e.g. learned "foo.example.com" also covers
  // "www.foo.example.com" if we record the leaf, and "example.com" covers
  // any subdomain).
  for (const learned of Array.from(cache!)) {
    if (host === learned || host.endsWith('.' + learned)) return true;
  }
  return false;
}

export function rememberSpaHost(url: string, reason: string): boolean {
  loadSync();
  const host = hostFromUrl(url);
  if (!host) return false;
  if (cache!.has(host)) {
    if (raw && raw.hosts[host]) raw.hosts[host].hits = (raw.hosts[host].hits || 0) + 1;
    persist();
    return false;
  }
  cache!.add(host);
  raw!.hosts[host] = {
    learnedAt: new Date().toISOString(),
    reason,
    hits: 1,
  };
  persist();
  console.log(`[SpaHostCache] Learned new SPA host: ${host} (${reason})`);
  return true;
}

export function listLearnedSpaHosts(): string[] {
  loadSync();
  return Array.from(cache!).sort();
}

export function clearSpaHostCacheForTests(): void {
  cache = new Set();
  raw = { version: 1, updatedAt: new Date().toISOString(), hosts: {} };
}

const SPA_SHELL_MARKERS: Array<{ name: string; re: RegExp }> = [
  { name: 'vue-app-shell', re: /<div[^>]+id=["']app["'][^>]*>\s*<\/div>/i },
  { name: 'vue-data-v', re: /\sdata-v-[a-f0-9]{6,}=/i },
  { name: 'vue-runtime', re: /window\.__INITIAL_STATE__|v-app|data-vue-meta|vue\.runtime/i },
  { name: 'react-next', re: /__NEXT_DATA__|data-reactroot|data-react-helmet/i },
  { name: 'react-root', re: /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i },
  { name: 'sidearm-spa', re: /s-person-card|s-stamp__|sidearm-vue/i },
  { name: 'angular', re: /ng-version=|<app-root[\s>]/i },
];

const HAS_EMAIL_RE = /<a[^>]+href=["']mailto:|data-cfemail=|\/cdn-cgi\/l\/email-protection/i;
const HAS_STAFF_ROW_RE = /staff-directory-table-member|sidearm-staff-member|s-person-card|<tr[^>]*has-email|class=["'][^"']*(staff|coach|directory|personnel|person)-card/i;

/**
 * Heuristic: does this HTML look like a client-side-rendered staff page
 * shell that we should not be wasting CORS-proxy fetches on?
 *
 * Returns the marker name that matched (so we can log a reason), or null
 * if the page doesn't look SPA-shaped. We only flag pages that ALSO have
 * no contact rows / no email links — a server-rendered Sidearm page will
 * include `data-v-*` attributes too but will already have mailto: links.
 */
export function detectClientRenderedShell(html: string): string | null {
  if (!html || html.length < 50) return null;
  // Look at the first ~80KB; SPA shells are tiny and contact-bearing pages
  // surface mailto/staff markers near the top of the DOM.
  const head = html.length > 80000 ? html.slice(0, 80000) : html;

  if (HAS_EMAIL_RE.test(head)) return null;
  if (HAS_STAFF_ROW_RE.test(head)) return null;

  for (const marker of SPA_SHELL_MARKERS) {
    if (marker.re.test(head)) return marker.name;
  }
  return null;
}

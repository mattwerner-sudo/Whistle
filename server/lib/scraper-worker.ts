import { getBrowserSession, type BrowserSession } from './browser-pool';
import { SCRAPER_CONFIG, getRandomUserAgent, needsJavaScriptRendering } from './scraper-config';
import { ParserFactory, extractEmailFromBioHtml, type ParseResult } from './parser-factory';
import { healthMonitor } from './health-monitor';
import { recordBioEnrichment } from './scraper-health';
import { detectClientRenderedShell, rememberSpaHost } from './spa-host-cache';
import { getCachedBio, setCachedBio, flushBioCache } from './bio-cache';
import { isValidContactEmail } from '../staffExtractor';

export interface ScrapeResult {
  success: boolean;
  html?: string;
  parseResult?: ParseResult;
  error?: string;
  metadata: ExtractionMetadata;
}

export interface ExtractionMetadata {
  url: string;
  resolvedUrl: string | null;
  httpStatus: number | null;
  timeTakenMs: number;
  parserUsed: string;
  retryCount: number;
  method: 'cors-proxy' | 'playwright' | 'playwright-direct';
  userAgent: string;
  fetchReason?: string;
  waitStrategy?: string;
  scrollSteps?: number;
  contentWaitMs?: number;
  bioEmailsRecovered?: number;
  bioPagesFetched?: number;
  bioCacheHits?: number;
}

const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

const STAFF_CONTENT_SELECTORS = [
  'a[href^="mailto:"]',
  'a[data-cfemail]',
  '.sidearm-staff-member',
  '[class*="s-person-card"]',
  '[class*="s-person"]',
  '[class*="staff-card"]',
  '[class*="staff-member"]',
  '[class*="person-card"]',
  '[class*="roster-card"]',
  '[class*="directory-item"]',
  'table.staff-directory',
  '[class*="sidearm-staff"]',
];

/**
 * Score a candidate proxy payload by how much real "staff page" signal it
 * carries. Cloudflare's email-protection variant occasionally rewrites
 * mailto: links into data-cfemail tokens *and* trims the surrounding markup,
 * which means the first proxy in the chain can return a smaller, partial
 * payload while another proxy returns the full mailto-bearing page. We use
 * this scorer to prefer the richer response instead of unconditionally
 * taking the first ok-looking one. Mailto links are weighted slightly higher
 * than cfemail because mailto-mode pages also tend to come with the full
 * staff card markup (see Liberty regression in audits/multi-conf-diff.json).
 */
export function scoreProxyHtml(html: string): number {
  if (!html || html.length < 500) return -1;
  const mailto = (html.match(/href=["']mailto:/gi) || []).length;
  const cfemail = (html.match(/data-cfemail=/gi) || []).length;
  // 2x mailto + 1x cfemail keeps cfemail-only responses viable while still
  // preferring an equivalent mailto-bearing one when both are available.
  return mailto * 2 + cfemail + Math.min(html.length / 100_000, 25);
}

async function fetchWithProxy(url: string, userAgent: string): Promise<{ html: string; status: number } | null> {
  let best: { html: string; status: number; score: number } | null = null;
  for (const proxyFn of CORS_PROXIES) {
    try {
      const proxyUrl = proxyFn(url);
      const response = await fetch(proxyUrl, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(SCRAPER_CONFIG.timeoutMs),
      });
      if (!response.ok) continue;
      const html = await response.text();
      if (html.length <= 500) continue;
      const score = scoreProxyHtml(html);
      if (!best || score > best.score) {
        best = { html, status: response.status, score };
      }
      // Strong signal — a proxy returned mailto-bearing HTML. No need to
      // burn the rest of the chain; mailto-mode is the rich variant.
      if ((html.match(/href=["']mailto:/gi) || []).length >= 5) break;
    } catch {
      continue;
    }
  }
  if (!best) return null;
  return { html: best.html, status: best.status };
}

const SPA_CARD_SELECTOR = '.s-person-card, [class*="s-person-card"]';
const EMAIL_ANCHOR_SELECTOR = 'a[href^="mailto:"], a[data-cfemail], a[href*="/cdn-cgi/l/email-protection"]';

async function waitForStaffContent(
  session: BrowserSession,
  url: string,
  jsRequired: boolean,
): Promise<{ waitStrategy: string; waitMs: number }> {
  const startWait = Date.now();

  if (jsRequired) {
    try {
      await session.page.waitForSelector(SPA_CARD_SELECTOR, { timeout: 15000 });
      try {
        await session.page.waitForSelector(EMAIL_ANCHOR_SELECTOR, { timeout: 7000 });
        return { waitStrategy: 'spa-card+email', waitMs: Date.now() - startWait };
      } catch {
        return { waitStrategy: 'spa-card', waitMs: Date.now() - startWait };
      }
    } catch {}
  }

  const selectorList = STAFF_CONTENT_SELECTORS.join(', ');
  try {
    await session.page.waitForSelector(selectorList, { timeout: 15000 });
    const waitMs = Date.now() - startWait;
    return { waitStrategy: 'content-selector', waitMs };
  } catch {}

  try {
    await session.page.waitForLoadState('networkidle', { timeout: 8000 });
    const waitMs = Date.now() - startWait;
    return { waitStrategy: 'network-idle', waitMs };
  } catch {}

  await session.page.waitForTimeout(3000);
  const waitMs = Date.now() - startWait;
  return { waitStrategy: 'fixed-fallback', waitMs };
}

async function autoScroll(session: BrowserSession): Promise<number> {
  let scrollSteps = 0;
  try {
    const viewportHeight = await session.page.evaluate(() => window.innerHeight);
    const scrollHeight = await session.page.evaluate(() => document.body.scrollHeight);

    const maxScrolls = Math.min(Math.ceil(scrollHeight / viewportHeight), 8);

    for (let i = 0; i < maxScrolls; i++) {
      await session.page.evaluate((step) => {
        window.scrollBy(0, window.innerHeight * 0.8);
      }, i);
      scrollSteps++;
      await session.page.waitForTimeout(400);
    }

    await session.page.evaluate(() => window.scrollTo(0, 0));
    await session.page.waitForTimeout(500);
  } catch {}
  return scrollSteps;
}

async function fetchWithPlaywright(
  url: string,
  userAgent: string,
  jsRequired: boolean,
): Promise<{
  html: string;
  status: number;
  resolvedUrl: string | null;
  waitStrategy: string;
  contentWaitMs: number;
  scrollSteps: number;
} | null> {
  let session: BrowserSession | null = null;

  try {
    session = await getBrowserSession();

    await session.context.setExtraHTTPHeaders({
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    const response = await session.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: SCRAPER_CONFIG.timeoutMs,
    });

    const status = response?.status() || 0;
    const resolvedUrl = session.page.url();

    const { waitStrategy, waitMs } = await waitForStaffContent(session, url, jsRequired);

    const scrollSteps = await autoScroll(session);

    const html = await session.page.content();
    return {
      html,
      status,
      resolvedUrl: resolvedUrl !== url ? resolvedUrl : null,
      waitStrategy,
      contentWaitMs: waitMs,
      scrollSteps,
    };
  } catch (error: any) {
    console.error(`[ScraperWorker] Playwright fetch error for ${url}:`, error.message);
    return null;
  } finally {
    if (session) {
      await session.close();
    }
  }
}

const BIO_ENRICH_CONCURRENCY = parseInt(process.env.SCRAPER_BIO_ENRICH_CONCURRENCY || '5', 10);
const BIO_ENRICH_MAX_PAGES = parseInt(process.env.SCRAPER_BIO_ENRICH_MAX_PAGES || '40', 10);
const BIO_ENRICH_TIMEOUT_MS = parseInt(process.env.SCRAPER_BIO_ENRICH_TIMEOUT_MS || '8000', 10);

function resolveBioUrl(bioUrl: string, baseUrl: string): string | null {
  if (!bioUrl) return null;
  try {
    return new URL(bioUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchBioPage(url: string, userAgent: string): Promise<string | null> {
  for (const proxyFn of CORS_PROXIES) {
    try {
      const response = await fetch(proxyFn(url), {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(BIO_ENRICH_TIMEOUT_MS),
      });
      if (response.ok) {
        const html = await response.text();
        if (html && html.length > 200) return html;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Follow the per-staffer bio link for any contact that came back without an
 * email. Many Sidearm directories only render name/title/phone in the row
 * and hide the email on the linked /staff-directory/<slug> page. Bounded
 * by concurrency + max-pages so we never blow up the main scrape budget.
 */
interface BioRecoverable {
  email?: string | null;
  confidence?: {
    name: number;
    title: number;
    email: number;
    phone: number;
    overall: number;
  };
}

function applyRecoveredEmail<T extends BioRecoverable>(contact: T, email: string): void {
  contact.email = email;
  if (contact.confidence) {
    contact.confidence.email = 95;
    contact.confidence.overall = Math.round(
      (contact.confidence.name * 0.35) +
      (contact.confidence.title * 0.30) +
      (contact.confidence.email * 0.25) +
      (contact.confidence.phone * 0.10)
    );
  }
}

export interface BioEnrichable extends BioRecoverable {
  bioUrl?: string | null;
}

export async function enrichMissingEmailsFromBio<T extends BioEnrichable>(
  contactsOrResult: { contacts: T[] } | T[],
  baseUrl: string,
  userAgent: string = getRandomUserAgent(),
): Promise<{ recovered: number; fetched: number; cacheHits: number }> {
  const contacts = Array.isArray(contactsOrResult) ? contactsOrResult : contactsOrResult.contacts;
  const candidates = contacts.filter((c: T) => !c.email && !!c.bioUrl);
  if (candidates.length === 0) return { recovered: 0, fetched: 0, cacheHits: 0 };

  // First pass: serve everything we can from the cache. This pulls
  // already-resolved emails (and known-empty pages) out of the queue
  // before we spend the per-scrape fetch budget on them, so the cap
  // really only limits *new* network work.
  let recovered = 0;
  let cacheHits = 0;
  // Group by resolved URL so multiple contacts that point to the same
  // bio page share one fetch (and one cache slot).
  const fetchGroups = new Map<string, T[]>();

  for (const contact of candidates) {
    const resolved = resolveBioUrl(contact.bioUrl!, baseUrl);
    if (!resolved) continue;
    const cached = getCachedBio(resolved);
    if (cached.hit) {
      cacheHits++;
      if (cached.email && isValidContactEmail(cached.email)) {
        applyRecoveredEmail(contact, cached.email);
        recovered++;
      }
      continue;
    }
    const group = fetchGroups.get(resolved);
    if (group) group.push(contact);
    else fetchGroups.set(resolved, [contact]);
  }

  const toFetch: Array<{ contacts: T[]; resolved: string }> = [];
  fetchGroups.forEach((contacts, resolved) => {
    toFetch.push({ contacts, resolved });
  });

  if (toFetch.length === 0) {
    return { recovered, fetched: 0, cacheHits };
  }

  const limited = toFetch.slice(0, BIO_ENRICH_MAX_PAGES);
  let fetched = 0;
  let idx = 0;

  async function worker() {
    while (idx < limited.length) {
      const my = idx++;
      const { contacts, resolved } = limited[my];
      try {
        const html = await fetchBioPage(resolved, userAgent);
        fetched++;
        if (!html) {
          setCachedBio(resolved, null);
          continue;
        }
        const email = extractEmailFromBioHtml(html);
        if (email && isValidContactEmail(email)) {
          for (const contact of contacts) {
            applyRecoveredEmail(contact, email);
            recovered++;
          }
          setCachedBio(resolved, email);
        } else {
          setCachedBio(resolved, null);
        }
      } catch {
        continue;
      }
    }
  }

  const workerCount = Math.min(BIO_ENRICH_CONCURRENCY, limited.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  // Best-effort flush so subsequent scrapes (even ones spawned right after
  // this one finishes) see the freshly-cached entries on disk.
  flushBioCache();
  return { recovered, fetched, cacheHits };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateBackoff(attempt: number): number {
  const { baseDelayMs, maxDelayMs, backoffMultiplier } = SCRAPER_CONFIG.retry;
  const delay = baseDelayMs * Math.pow(backoffMultiplier, attempt);
  return Math.min(delay, maxDelayMs);
}

export interface ScrapeOptions {
  /**
   * Hard upper bound (ms) on the entire scrape, including all retries,
   * Playwright fetches, and bio-page enrichment. When exceeded, the worker
   * resolves with a synthetic failure result instead of blocking the caller.
   * Defaults to no extra cap (existing per-step Playwright/fetch timeouts apply).
   */
  timeoutMs?: number;
}

export class ScraperWorker {
  private url: string;
  private schoolId?: string;

  constructor(url: string, schoolId?: string) {
    this.url = url;
    this.schoolId = schoolId;
  }

  async scrape(): Promise<ScrapeResult> {
    const startTime = Date.now();
    const userAgent = getRandomUserAgent();
    let lastError = '';
    let retryCount = 0;
    let method: ExtractionMetadata['method'] = 'cors-proxy';
    let httpStatus: number | null = null;
    let resolvedUrl: string | null = null;
    let html = '';
    let parseResult: ParseResult | undefined;
    let fetchReason = '';
    let waitStrategy = '';
    let scrollSteps = 0;
    let contentWaitMs = 0;

    const jsRequired = needsJavaScriptRendering(this.url);

    if (jsRequired) {
      fetchReason = 'js-rendered-domain';
      method = 'playwright-direct';
      console.log(`[ScraperWorker] JS-rendered site detected, using Playwright directly: ${this.url}`);
    } else {
      fetchReason = 'standard-cors-first';
      console.log(`[ScraperWorker] Starting extraction for ${this.url}`);
    }

    for (let attempt = 0; attempt < SCRAPER_CONFIG.retry.maxAttempts; attempt++) {
      retryCount = attempt;

      try {
        if (!jsRequired) {
          const proxyResult = await fetchWithProxy(this.url, userAgent);

          if (proxyResult) {
            html = proxyResult.html;
            httpStatus = proxyResult.status;
            method = 'cors-proxy';

            const parser = new ParserFactory(html, this.url);
            parseResult = await parser.parse();

            if (parseResult.contacts.length >= 3) {
              fetchReason = 'cors-proxy-sufficient';
              console.log(`[ScraperWorker] CORS proxy success: ${parseResult.contacts.length} contacts from ${this.url}`);
              break;
            }

            // Auto-detect SPA shells: if the HTML clearly looks like a
            // client-rendered app shell (Vue/React/empty #app etc.) and the
            // proxy yielded almost nothing, remember the host so the next
            // visit goes straight to Playwright instead of wasting another
            // proxy fetch + escalation cycle.
            const shellMarker = detectClientRenderedShell(html);
            if (shellMarker && parseResult.contacts.length < 3) {
              const learned = rememberSpaHost(this.url, `auto:${shellMarker}`);
              if (learned) {
                console.log(`[ScraperWorker] Auto-detected SPA host for ${this.url} (marker=${shellMarker})`);
              }
            }

            console.log(`[ScraperWorker] CORS proxy low yield (${parseResult.contacts.length}), escalating to Playwright...`);
            fetchReason = 'cors-proxy-low-yield';
          } else {
            fetchReason = 'cors-proxy-failed';
          }
        }

        const playwrightResult = await fetchWithPlaywright(this.url, userAgent, jsRequired);

        if (playwrightResult) {
          resolvedUrl = playwrightResult.resolvedUrl;
          waitStrategy = playwrightResult.waitStrategy;
          contentWaitMs = playwrightResult.contentWaitMs;
          scrollSteps = playwrightResult.scrollSteps;

          const parser = new ParserFactory(playwrightResult.html, this.url);
          const playwrightParseResult = await parser.parse();

          const proxyWasBetter = parseResult && parseResult.contacts.length >= playwrightParseResult.contacts.length;

          if (proxyWasBetter) {
            console.log(`[ScraperWorker] Keeping CORS proxy result (${parseResult!.contacts.length} contacts) over Playwright (${playwrightParseResult.contacts.length})`);
          } else {
            html = playwrightResult.html;
            httpStatus = playwrightResult.status;
            method = jsRequired ? 'playwright-direct' : 'playwright';
            parseResult = playwrightParseResult;
          }

          if (resolvedUrl) {
            console.log(`[ScraperWorker] Redirect: ${this.url} -> ${resolvedUrl}`);
          }
          console.log(`[ScraperWorker] Playwright result: ${playwrightParseResult.contacts.length} contacts (wait: ${waitStrategy}, ${contentWaitMs}ms, scrolls: ${scrollSteps})`);

          if (parseResult && parseResult.contacts.length > 0) {
            break;
          }

          lastError = 'Extraction yielded 0 contacts';
          continue;
        }

        lastError = jsRequired ? 'Playwright failed' : 'Both CORS proxy and Playwright failed';

      } catch (error: any) {
        lastError = error.message;
        console.error(`[ScraperWorker] Attempt ${attempt + 1} failed for ${this.url}:`, lastError);
      }

      if (attempt < SCRAPER_CONFIG.retry.maxAttempts - 1) {
        const backoffMs = calculateBackoff(attempt);
        console.log(`[ScraperWorker] Retrying ${this.url} in ${backoffMs}ms...`);
        await sleep(backoffMs);
      }
    }

    let bioEmailsRecovered = 0;
    let bioPagesFetched = 0;
    let bioCacheHits = 0;
    if (parseResult && parseResult.contacts.length > 0) {
      const enrichBase = resolvedUrl || this.url;
      const enrichResult = await enrichMissingEmailsFromBio(parseResult, enrichBase, userAgent);
      bioEmailsRecovered = enrichResult.recovered;
      bioPagesFetched = enrichResult.fetched;
      bioCacheHits = enrichResult.cacheHits;
      if (bioPagesFetched > 0 || bioCacheHits > 0) {
        console.log(`[ScraperWorker] Bio enrichment: recovered ${bioEmailsRecovered} emails (fetched ${bioPagesFetched}, cache hits ${bioCacheHits}) for ${this.url}`);
      }
    }

    const timeTakenMs = Date.now() - startTime;
    const success = !!parseResult && parseResult.contacts.length > 0;

    const metadata: ExtractionMetadata = {
      url: this.url,
      resolvedUrl,
      httpStatus,
      timeTakenMs,
      parserUsed: parseResult?.diagnostics.parserUsed || 'none',
      retryCount,
      method,
      userAgent,
      fetchReason,
      waitStrategy: waitStrategy || undefined,
      scrollSteps: scrollSteps > 0 ? scrollSteps : undefined,
      contentWaitMs: contentWaitMs > 0 ? contentWaitMs : undefined,
      bioEmailsRecovered: bioEmailsRecovered > 0 ? bioEmailsRecovered : undefined,
      bioPagesFetched: bioPagesFetched > 0 ? bioPagesFetched : undefined,
      bioCacheHits: bioCacheHits > 0 ? bioCacheHits : undefined,
    };

    if (bioPagesFetched > 0 || bioCacheHits > 0 || bioEmailsRecovered > 0) {
      recordBioEnrichment(metadata.parserUsed, bioEmailsRecovered, bioPagesFetched, bioCacheHits);
    }

    healthMonitor.recordExtraction({
      schoolId: this.schoolId,
      success,
      contactsFound: parseResult?.contacts.length || 0,
      aiEnhanced: parseResult?.diagnostics.aiEnhancedCount || 0,
      timeTakenMs,
      parserUsed: metadata.parserUsed,
      method: method === 'playwright-direct' ? 'playwright' : method,
    });

    if (success) {
      console.log(`[ScraperWorker] Complete: ${parseResult!.contacts.length} contacts in ${timeTakenMs}ms [${method}/${fetchReason}] ${this.url}`);
    } else {
      console.log(`[ScraperWorker] Failed after ${retryCount + 1} attempts [${method}/${fetchReason}]: ${lastError} ${this.url}`);
    }

    return {
      success,
      html,
      parseResult,
      error: success ? undefined : lastError,
      metadata,
    };
  }
}

export async function scrapeUrl(
  url: string,
  schoolId?: string,
  options?: ScrapeOptions,
): Promise<ScrapeResult> {
  const worker = new ScraperWorker(url, schoolId);
  const scrapePromise = worker.scrape();
  const timeoutMs = options?.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) return scrapePromise;

  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<ScrapeResult>(resolve => {
    timer = setTimeout(() => {
      console.warn(`[ScraperWorker] Hard timeout after ${timeoutMs}ms: ${url}`);
      resolve({
        success: false,
        error: `Scrape timed out after ${timeoutMs}ms`,
        metadata: {
          url,
          resolvedUrl: null,
          httpStatus: null,
          timeTakenMs: Date.now() - start,
          parserUsed: 'none',
          retryCount: 0,
          method: 'playwright',
          userAgent: '',
          fetchReason: 'site-timeout',
        },
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([scrapePromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

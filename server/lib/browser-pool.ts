import { chromium, Browser, Page, BrowserContext } from "playwright";
import { SCRAPER_CONFIG } from "./scraper-config";

let globalBrowser: Browser | null = null;
let lastUsed = Date.now();
let activeSessionCount = 0;
let launchPromise: Promise<Browser> | null = null;
const IDLE_TIMEOUT = 1000 * 60 * 5;
let checkInterval: NodeJS.Timeout | null = null;

export interface BrowserSession {
  page: Page;
  context: BrowserContext;
  close: () => Promise<void>;
}

async function launchBrowser(): Promise<Browser> {
  if (globalBrowser) {
    console.log("[BrowserPool] Browser disconnected, cleaning up...");
    try { await globalBrowser.close(); } catch {}
    globalBrowser = null;
  }

  console.log("[BrowserPool] Launching new Global Browser...");
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--no-first-run',
      '--single-process',
    ]
  });

  browser.on('disconnected', () => {
    console.warn("[BrowserPool] Browser disconnected unexpectedly");
    globalBrowser = null;
    launchPromise = null;
  });

  globalBrowser = browser;

  if (!checkInterval) {
    checkInterval = setInterval(checkIdle, 60000);
  }

  return browser;
}

async function ensureBrowser(): Promise<Browser> {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }

  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = launchBrowser().finally(() => {
    launchPromise = null;
  });

  return launchPromise;
}

export async function getBrowserSession(): Promise<BrowserSession> {
  const maxSessions = SCRAPER_CONFIG.browser.maxSessions;
  if (activeSessionCount >= maxSessions) {
    console.warn(`[BrowserPool] Max sessions (${maxSessions}) reached, waiting...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (activeSessionCount >= maxSessions) {
      throw new Error("Browser pool exhausted: too many concurrent sessions");
    }
  }

  const browser = await ensureBrowser();
  lastUsed = Date.now();
  activeSessionCount++;

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let closed = false;

  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      bypassCSP: true,
      javaScriptEnabled: true,
    });

    page = await context.newPage();

    page.setDefaultTimeout(SCRAPER_CONFIG.browser.pageTimeoutMs);
    page.setDefaultNavigationTimeout(SCRAPER_CONFIG.browser.pageTimeoutMs);

    await page.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}', route => route.abort());

  } catch (err) {
    activeSessionCount--;
    if (page) { try { await page.close(); } catch {} }
    if (context) { try { await context.close(); } catch {} }
    throw err;
  }

  const closeSession = async () => {
    if (closed) return;
    closed = true;
    activeSessionCount = Math.max(0, activeSessionCount - 1);
    try { await page!.close(); } catch {}
    try { await context!.close(); } catch {}
  };

  return { page, context, close: closeSession };
}

export async function getBrowserPage(): Promise<Page> {
  const session = await getBrowserSession();
  return session.page;
}

async function checkIdle() {
  if (globalBrowser && activeSessionCount === 0 && Date.now() - lastUsed > IDLE_TIMEOUT) {
    console.log("[BrowserPool] Browser idle. Closing to save RAM.");
    await closeBrowser();
  }
}

export async function closeBrowser(): Promise<void> {
  if (globalBrowser) {
    try {
      await globalBrowser.close();
    } catch (e) {
      console.warn("[BrowserPool] Error closing browser:", e);
    }
    globalBrowser = null;
  }
  activeSessionCount = 0;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

export function isBrowserActive(): boolean {
  return globalBrowser !== null && globalBrowser.isConnected();
}

export function getBrowserPoolStats(): { active: boolean; sessions: number; maxSessions: number; lastUsed: number } {
  return {
    active: isBrowserActive(),
    sessions: activeSessionCount,
    maxSessions: SCRAPER_CONFIG.browser.maxSessions,
    lastUsed,
  };
}

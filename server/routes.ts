import type { Express } from "express";
import crypto from "crypto";
import { createServer, type Server } from "http";
import dns from "dns";
import { chromium } from "playwright";
import * as cheerio from "cheerio";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./lib/swagger";
import { apiLimiter, strictLimiter } from "./middleware/rate-limit";
import { initWebSocket, broadcastJobUpdate, getConnectedClientCount } from "./lib/websocket";
import { sendSlackAlert } from "./lib/notifications";
import { validateApiKey, generateApiKey, type AuthenticatedRequest } from "./middleware/api-auth";
import { requireAdmin } from "./middleware/auth";
import { dispatchStaffNewHire, dispatchExtractionCompleted, generateWebhookSecret } from "./lib/webhooks";
import { apiKeys, webhookSubscriptions, webhookDeliveryLogs, usageEvents, staffMembers, signals, schoolDirectories, type SchoolDirectory, type StaffMember } from "@shared/schema";
import authRoutes from "./routes/auth";
import linkedinRoutes from "./routes/linkedin";
import billingRoutes from "./routes/billing";
import orgRoutes from "./routes/org";
import alertRoutes from "./routes/alerts";
import { maskStaffList, applyMaskToStaff, getRevealedStaffIds } from "./lib/contact-masking";
import { revealContact } from "./lib/reveal-service";
import { requireUser, attachUser, requirePlan, type UserRequest } from "./middleware/require-user";
import { db } from "./db";
import { eq, sql, and, desc } from "drizzle-orm";
import {
  fetchUrlRequestSchema,
  parseHtmlRequestSchema,
  aiAnalysisRequestSchema,
  aiCleanDataRequestSchema,
  aiEmailRequestSchema,
  aiMeetingPrepRequestSchema,
  createJobSchema,
  type NCAASchool,
  type ExtractionJob,
} from "@shared/schema";
import {
  analyzeTeamStructure,
  cleanContactData,
  generateEmailDraft,
  generateMeetingPrep,
} from "./gemini";
import { storage } from "./storage";
import { ncaaConferences } from "@shared/ncaa-conferences";
import { 
  queueJob, 
  getQueueStatus, 
  isSchoolLocked, 
  getSchoolLock, 
  acquireSchoolLock, 
  releaseSchoolLock,
  getActiveSchoolLocks,
  acquireNcaaInitLock,
  releaseNcaaInitLock,
  isNcaaInitLocked
} from "./lib/job-queue";

// In-memory cache for rendered pages
interface CacheEntry {
  html: string;
  timestamp: number;
}

// NCAA Schools cache with diagnostics
interface NCAASchoolsCache {
  schools: NCAASchool[];
  lastUpdated: string;
  diagnostics: {
    parseErrors: number;
    pageFailures: number;
    noLogoCount: number;
    isComplete: boolean;
  };
}

let ncaaSchoolsCache: NCAASchoolsCache | null = null;
const NCAA_CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours (schools list rarely changes)
let ncaaLastFetch = 0;

const renderCache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Parse NCAA schools from HTML page using Cheerio DOM parser
function parseNCAASchoolsPageWithCheerio(html: string): { schools: NCAASchool[]; parseErrors: number; skippedRows: string[] } {
  const $ = cheerio.load(html);
  const schools: NCAASchool[] = [];
  let parseErrors = 0;
  const skippedRows: string[] = [];
  
  // Find all table rows in the schools table
  $('table tbody tr').each((_, row) => {
    try {
      const $row = $(row);
      const cells = $row.find('td');
      
      if (cells.length < 3) return; // Skip invalid rows (header rows, etc.)
      
      // First cell: logo - check src, data-src, and data-lazy-src for lazy-loading support
      const $logoImg = $(cells[0]).find('img');
      let logoUrl = $logoImg.attr('src') || $logoImg.attr('data-src') || $logoImg.attr('data-lazy-src');
      
      // Handle relative URLs and protocol-relative URLs
      if (logoUrl) {
        if (logoUrl.startsWith('//')) {
          logoUrl = 'https:' + logoUrl;
        } else if (logoUrl.startsWith('/')) {
          logoUrl = 'https://www.ncaa.com' + logoUrl;
        }
      }
      
      // Second cell: school link with short name
      // First try to get from <a> tag, fall back to cell text content
      const $nameLink = $(cells[1]).find('a');
      const href = $nameLink.attr('href');
      let shortName = $nameLink.text().trim();
      
      // Fallback: if no <a> tag or empty name, use cell text directly
      if (!shortName) {
        shortName = $(cells[1]).text().trim();
      }
      
      // Third cell: plain text full name (use .text() to handle any nested elements)
      const fullName = $(cells[2]).text().trim();
      
      // Extract slug from href="/schools/slug" or try to derive from name
      let schoolSlug: string | null = null;
      if (href) {
        const slugMatch = href.match(/\/schools\/([^/]+)/);
        schoolSlug = slugMatch ? slugMatch[1] : null;
      }
      // Fallback: derive slug from name if href not available
      if (!schoolSlug && shortName) {
        schoolSlug = shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      
      // Validate required fields - only slug and name are required, logo is optional
      if (!schoolSlug) {
        parseErrors++;
        skippedRows.push(`Missing slug: ${$row.html()?.slice(0, 100)}`);
        return;
      }
      if (!shortName) {
        parseErrors++;
        skippedRows.push(`Missing name for row: ${$row.html()?.slice(0, 100)}`);
        return;
      }
      
      schools.push({
        id: schoolSlug,
        name: shortName,
        fullName: fullName || shortName,
        logoUrl: logoUrl || undefined, // Logo is optional
        schoolUrl: `https://www.ncaa.com/schools/${schoolSlug}`,
      });
    } catch (err) {
      parseErrors++;
      skippedRows.push(`Exception: ${err}`);
    }
  });
  
  return { schools, parseErrors, skippedRows };
}

// Fetch all NCAA schools from the index (all pages)
async function fetchAllNCAASchools(): Promise<NCAASchoolsCache> {
  // Check cache
  if (ncaaSchoolsCache && Date.now() - ncaaLastFetch < NCAA_CACHE_TTL) {
    console.log('Using cached NCAA schools data');
    return ncaaSchoolsCache;
  }
  
  console.log('Fetching NCAA schools from ncaa.com...');
  const allSchools: NCAASchool[] = [];
  const seenIds = new Set<string>();
  const totalPages = 24; // NCAA index has 24 pages (0-23, page 24 is 404)
  let totalParseErrors = 0;
  let pageFailures = 0;
  
  for (let page = 0; page <= totalPages; page++) {
    const pageUrl = page === 0 
      ? 'https://www.ncaa.com/schools-index'
      : `https://www.ncaa.com/schools-index/${page}`;
    
    try {
      console.log(`Fetching page ${page + 1}/${totalPages + 1}: ${pageUrl}`);
      const response = await fetch(pageUrl);
      if (!response.ok) {
        // Page 24 commonly returns 404 (NCAA has ~24 pages, 0-23)
        if (page < 24) {
          pageFailures++;
        }
        console.warn(`Page ${page} returned status ${response.status}`);
        continue;
      }
      
      const html = await response.text();
      const { schools, parseErrors, skippedRows } = parseNCAASchoolsPageWithCheerio(html);
      totalParseErrors += parseErrors;
      
      // Log any skipped rows for debugging
      if (skippedRows.length > 0) {
        console.warn(`Page ${page}: ${skippedRows.length} rows skipped:`, skippedRows.slice(0, 3));
      }
      
      // Add unique schools
      for (const school of schools) {
        if (!seenIds.has(school.id)) {
          seenIds.add(school.id);
          allSchools.push(school);
        }
      }
      
      // Small delay between requests to be respectful
      if (page < totalPages) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      // Count failed page fetches (but not expected 404 on page 24)
      if (page < 24) {
        pageFailures++;
      }
      console.error(`Failed to fetch page ${page}:`, err);
    }
  }
  
  // Validate expected count (NCAA has ~1168 schools as of Nov 2025)
  const EXPECTED_MIN_COUNT = 1100;
  const isComplete = allSchools.length >= EXPECTED_MIN_COUNT && pageFailures === 0;
  
  if (!isComplete) {
    console.error(`COVERAGE WARNING: Fetched ${allSchools.length} schools (expected ${EXPECTED_MIN_COUNT}+), page failures: ${pageFailures}`);
  }
  
  // Validate: warn if fullName matches name for too many schools
  const noFullNameCount = allSchools.filter(s => s.fullName === s.name).length;
  if (noFullNameCount > allSchools.length * 0.1) {
    console.warn(`Warning: ${noFullNameCount} schools have fullName = name (may indicate parsing issue)`);
  }
  
  // Count schools without logos
  const noLogoCount = allSchools.filter(s => !s.logoUrl).length;
  
  console.log(`Fetched ${allSchools.length} schools from NCAA (${totalParseErrors} parse errors, ${pageFailures} page failures, ${noLogoCount} without logos)`);
  
  const result: NCAASchoolsCache = {
    schools: allSchools,
    lastUpdated: new Date().toISOString(),
    diagnostics: {
      parseErrors: totalParseErrors,
      pageFailures,
      noLogoCount,
      isComplete,
    },
  };
  
  // Only cache complete data - incomplete data should be re-fetched on next request
  if (isComplete) {
    ncaaSchoolsCache = result;
    ncaaLastFetch = Date.now();
    console.log('NCAA schools cached (complete data)');
  } else {
    // Invalidate any existing cache to force re-fetch on next request
    ncaaSchoolsCache = null;
    ncaaLastFetch = 0;
    console.warn('NCAA schools NOT cached (incomplete data - will re-fetch on next request)');
  }
  
  return result;
}

function getCachedHtml(url: string): string | null {
  const cached = renderCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Cache HIT for ${url} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
    return cached.html;
  }
  if (cached) {
    console.log(`Cache EXPIRED for ${url}`);
    renderCache.delete(url);
  }
  return null;
}

function setCachedHtml(url: string, html: string): void {
  renderCache.set(url, { html, timestamp: Date.now() });
  console.log(`Cached page for ${url} (size: ${html.length} bytes)`);
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

async function validateNoSSRF(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "0.0.0.0") {
    throw new Error("URL targets a disallowed host");
  }

  // Check literal IP in URL
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error("URL targets a private or reserved address");
    }
  }

  // DNS resolve and re-check the resolved IP (prevents DNS rebinding)
  try {
    const { address } = await dns.promises.lookup(hostname);
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(address)) {
        throw new Error("URL resolves to a private or reserved address");
      }
    }
  } catch (err: any) {
    if (err.message.startsWith("URL")) throw err;
    throw new Error("Could not resolve hostname");
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // ============================================================================
  // API DOCUMENTATION (Swagger UI)
  // ============================================================================
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Athletics Directory API Docs',
  }));

  // Serve OpenAPI spec as JSON for Clay/Postman import
  app.get("/api/docs.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });

  // Authentication routes
  app.use("/api/auth", authRoutes);
  app.use("/api/billing", billingRoutes);
  app.use("/api/org", orgRoutes);
  app.use("/api/alerts", alertRoutes);

  // Whistle Connect (LinkedIn network) routes.
  // Apply rate limiting to all v1 API endpoints (must be registered BEFORE
  // the /api/v1/* routers so extension ingestion is covered by the v1 limiter).
  app.use("/api/v1", apiLimiter);

  // Mount at both /api/linkedin (browser) and /api/v1/linkedin (extension ingestion)
  app.use("/api/linkedin", linkedinRoutes);
  app.use("/api/v1/linkedin", linkedinRoutes);

  // Fetch URL endpoint - proxy to bypass CORS
  app.post("/api/fetch-url", requireAdmin, async (req, res) => {
    try {
      const { url } = fetchUrlRequestSchema.parse(req.body);

      await validateNoSSRF(url);

      // Try multiple CORS proxy strategies
      const strategies = [
        {
          name: 'AllOrigins',
          url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
          handler: async (response: Response) => {
            const data = await response.json();
            return data.contents;
          }
        },
        {
          name: 'CodeTabs',
          url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
          handler: async (response: Response) => response.text()
        }
      ];

      let html: string | null = null;

      for (const strategy of strategies) {
        try {
          console.log(`Attempting fetch via ${strategy.name}...`);
          const response = await fetch(strategy.url);
          if (response.ok) {
            html = await strategy.handler(response);
            if (html && html.length > 100) {
              console.log(`Successfully fetched via ${strategy.name}`);
              break;
            }
          }
        } catch (err) {
          console.warn(`${strategy.name} failed:`, err);
        }
      }

      if (!html) {
        return res.status(400).json({
          error: "Could not fetch URL. Please try pasting HTML instead."
        });
      }

      res.json({ html });
    } catch (error: any) {
      console.error("Fetch URL error:", error);
      res.status(400).json({
        error: error.message || "Failed to fetch URL"
      });
    }
  });

  // Fetch URL with JavaScript rendering (Playwright)
  app.post("/api/fetch-url-rendered", requireAdmin, async (req, res) => {
    try {
      const { url } = fetchUrlRequestSchema.parse(req.body);

      await validateNoSSRF(url);

      // Check cache first
      const cachedHtml = getCachedHtml(url);
      if (cachedHtml) {
        return res.json({ html: cachedHtml, cached: true });
      }

      console.log(`Fetching JavaScript-rendered page: ${url}`);
      const startTime = Date.now();
      
      let browser;
      try {
        // Use Playwright's bundled Chromium (installed via 'npx playwright install chromium')
        browser = await chromium.launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        
        // Navigate and wait for network to be idle
        await page.goto(url, { 
          waitUntil: 'networkidle',
          timeout: 60000 
        });
        
        // Smart wait: Race between multiple conditions
        // This adapts to page speed instead of fixed delays
        await Promise.race([
          // Wait for contact content to appear
          page.waitForSelector('a[href^="mailto:"]', { timeout: 15000 }),
          // Or wait for common directory container patterns
          page.waitForSelector('[class*="person-card"], [class*="staff"], tr, li', { timeout: 15000 }),
          // Fallback: wait for page to be stable
          page.waitForLoadState('domcontentloaded'),
        ]).catch(() => {
          // If all fail, continue anyway - page might use different structure
          console.warn("Content selectors timed out, using current page state");
        });
        
        // Get fully rendered HTML
        const html = await page.content();
        
        await browser.close();
        
        const renderTime = Date.now() - startTime;
        console.log(`Successfully rendered page in ${renderTime}ms, HTML length: ${html.length}`);
        
        // Cache the result
        setCachedHtml(url, html);
        
        res.json({ html, cached: false, renderTime });
        
      } catch (playwrightError: any) {
        if (browser) {
          await browser.close();
        }
        
        // Check if browser is not installed
        if (playwrightError.message?.includes('browserType.launch') || 
            playwrightError.message?.includes('Executable doesn\'t exist')) {
          console.error("Chromium not installed. Run: npx playwright install chromium");
          return res.status(500).json({
            error: "Browser not installed. Please contact support or use the static URL fetcher.",
            details: "Chromium browser needs to be installed on the server."
          });
        }
        
        throw playwrightError;
      }
      
    } catch (error: any) {
      console.error("Fetch rendered URL error:", error);
      res.status(400).json({
        error: error.message || "Failed to fetch rendered URL"
      });
    }
  });

  // AI Analysis endpoint
  app.post("/api/ai/analyze", async (req, res) => {
    try {
      const { contacts } = aiAnalysisRequestSchema.parse(req.body);

      if (contacts.length === 0) {
        return res.status(400).json({ error: "No contacts to analyze" });
      }

      const content = await analyzeTeamStructure(contacts);

      res.json({
        content,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("AI Analysis error:", error);
      res.status(500).json({
        error: error.message || "Failed to generate analysis"
      });
    }
  });

  // AI Clean Data endpoint
  app.post("/api/ai/clean-data", async (req, res) => {
    try {
      const { contacts } = aiCleanDataRequestSchema.parse(req.body);

      if (contacts.length === 0) {
        return res.status(400).json({ error: "No contacts to clean" });
      }

      const cleanedContacts = await cleanContactData(contacts);

      res.json({ contacts: cleanedContacts });
    } catch (error: any) {
      console.error("AI Clean Data error:", error);
      res.status(500).json({
        error: error.message || "Failed to clean data"
      });
    }
  });

  // AI Email Generation endpoint
  app.post("/api/ai/generate-email", async (req, res) => {
    try {
      const { recipient, context } = aiEmailRequestSchema.parse(req.body);

      const draft = await generateEmailDraft(recipient, context);

      res.json({
        subject: draft.subject,
        body: draft.body,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        context,
      });
    } catch (error: any) {
      console.error("AI Email Generation error:", error);
      res.status(500).json({
        error: error.message || "Failed to generate email"
      });
    }
  });

  // AI Meeting Prep endpoint
  app.post("/api/ai/meeting-prep", async (req, res) => {
    try {
      const { recipient, topic } = aiMeetingPrepRequestSchema.parse(req.body);

      const content = await generateMeetingPrep(recipient, topic);

      res.json({
        content,
        recipientName: recipient.name,
        topic,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("AI Meeting Prep error:", error);
      res.status(500).json({
        error: error.message || "Failed to generate meeting prep"
      });
    }
  });

  // ============================================================================
  // STAFF DIRECTORY ENDPOINTS (ZoomInfo-style)
  // ============================================================================
  
  // Import storage and extractor at runtime to avoid circular dependency issues
  const { storage, hashIp } = await import("./storage");
  const { extractStaffFromUrl, discoverDirectoryUrl, convertToStaffMembers, parseHtmlForContacts } = await import("./staffExtractor");
  
  // Helper to generate session ID from request
  function getSessionId(req: any): string {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return hashIp(ip + userAgent);
  }
  
  const INTERNAL_DEFAULT_CREDITS = 10000;
  let internalCreditsUsed = 0;

  async function initInternalCredits() {
    try {
      const exportEvents = await db.select({ 
        total: sql<number>`coalesce(sum((details->>'count')::int), 0)` 
      }).from(usageEvents).where(eq(usageEvents.eventType, 'export'));
      internalCreditsUsed = exportEvents[0]?.total || 0;
      console.log(`[Credits] Initialized: ${internalCreditsUsed} credits used, ${INTERNAL_DEFAULT_CREDITS - internalCreditsUsed} remaining`);
    } catch (err) {
      console.error("[Credits] Failed to initialize credit counter:", err);
    }
  }

  initInternalCredits();

  function getInternalCreditsRemaining(): number {
    return Math.max(0, INTERNAL_DEFAULT_CREDITS - internalCreditsUsed);
  }

  // Helper to log usage events
  async function logUsageEvent(req: any, eventType: string, schoolId?: string, schoolName?: string, details?: Record<string, any>) {
    try {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      await storage.logEvent({
        eventType,
        schoolId: schoolId || null,
        schoolName: schoolName || null,
        sessionId: getSessionId(req),
        ipHash: hashIp(ip),
        userAgent: req.headers['user-agent'] || null,
        details: details || null,
      });
      
      // Track credit usage for exports
      if (eventType === 'export') {
        const count = details?.count || 0;
        const format = details?.format || 'csv';
        internalCreditsUsed += count;
        console.log(`[Credits] Export: ${count} contacts (${format}). Total used: ${internalCreditsUsed}/${INTERNAL_DEFAULT_CREDITS}, remaining: ${getInternalCreditsRemaining()}`);
        await sendSlackAlert(`User (Session: ${getSessionId(req).slice(0, 8)}) just exported **${count} contacts** in ${format} format. Credits remaining: ${getInternalCreditsRemaining()}`, 'success');
      }
    } catch (err) {
      console.error("Failed to log usage event:", err);
    }
  }
  
  // Initialize school directories from NCAA schools data (with mutex for multi-user support)
  app.post("/api/staff/init-schools", async (req, res) => {
    try {
      // Check if initialization is already in progress
      if (isNcaaInitLocked()) {
        return res.status(409).json({ 
          error: "Initialization already in progress",
          message: "Another user is currently initializing schools. Please wait.",
          locked: true
        });
      }
      
      // Acquire the init lock
      if (!acquireNcaaInitLock()) {
        return res.status(409).json({ 
          error: "Initialization already in progress",
          locked: true
        });
      }
      
      try {
        const ncaaCache = await fetchAllNCAASchools();
        if (!ncaaCache.diagnostics.isComplete) {
          releaseNcaaInitLock();
          return res.status(503).json({ error: "NCAA schools data is incomplete" });
        }
        
        const directories = ncaaCache.schools.map(school => ({
          schoolId: school.id,
          schoolName: school.name,
          schoolFullName: school.fullName,
          logoUrl: school.logoUrl || null,
          ncaaUrl: school.schoolUrl,
          directoryUrl: null,
          division: school.division || null,
          conference: school.conference || null,
          status: "pending" as const,
        }));
        
        await storage.bulkUpsertSchoolDirectories(directories);
        
        // Log init event
        await logUsageEvent(req, 'init', undefined, undefined, { count: directories.length });
        
        releaseNcaaInitLock();
        
        res.json({
          message: `Initialized ${directories.length} school directories`,
          count: directories.length,
        });
      } catch (initError: any) {
        releaseNcaaInitLock();
        throw initError;
      }
    } catch (error: any) {
      console.error("Init schools error:", error);
      res.status(500).json({ error: error.message || "Failed to initialize schools" });
    }
  });
  
  // Seed database with Power 4 + Pac-12 conferences (admin only)
  app.post("/api/admin/seed", requireAdmin, async (req, res) => {
    try {
      const { seedSchools } = await import("@shared/ncaa-seed-data");

      console.log("Seeding database with school directory...");

      // Seed is add-only: upserting existing rows used to force status back
      // to "pending", which knocked every extracted school out of the public
      // directory and all status-filtered queries (live incident 2026-08-31).
      const existing = await db.select({ schoolId: schoolDirectories.schoolId }).from(schoolDirectories);
      const existingIds = new Set(existing.map((e) => e.schoolId));

      let count = 0;
      let skipped = 0;
      for (const school of seedSchools) {
        if (existingIds.has(school.schoolId)) { skipped++; continue; }
        await storage.upsertSchoolDirectory({
          ...school,
          status: "pending",
          logoUrl: null
        });
        count++;
      }
      console.log(`Seed: ${count} new, ${skipped} existing skipped`);
      
      // Log seed event
      await logUsageEvent(req, 'init', undefined, undefined, { type: 'seed', count });
      
      res.json({ success: true, message: `Seeded ${count} schools`, schools: count });
    } catch (error: any) {
      console.error("Seeding failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get school directories with filtering
  app.get("/api/staff/schools", async (req, res) => {
    try {
      const { status, division, conference, search, limit, offset } = req.query;
      
      const result = await storage.getSchoolDirectories({
        status: status as string | undefined,
        division: division as string | undefined,
        conference: conference as string | undefined,
        search: search as string | undefined,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("Get schools error:", error);
      res.status(500).json({ error: error.message || "Failed to get schools" });
    }
  });
  
  // Get all staff members with filtering (ZoomInfo-style search) - emails/phones masked unless revealed
  app.get("/api/staff/members", attachUser, async (req: UserRequest, res) => {
    try {
      const { schoolId, search, division, conference, limit, offset, export: exportFormat } = req.query;
      
      const result = await storage.getStaffMembers({
        schoolId: schoolId as string | undefined,
        search: search as string | undefined,
        division: division as string | undefined,
        conference: conference as string | undefined,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      });

      const maskedMembers = await maskStaffList(req.user?.id, result.members as any);
      
      // Log search/export events
      if (search || exportFormat) {
        await logUsageEvent(req, exportFormat ? 'export' : 'search', 
          schoolId as string | undefined, 
          undefined,
          { 
            query: search as string | undefined, 
            format: exportFormat as string | undefined,
            count: result.members.length,
            filters: { division: division as string, conference: conference as string, schoolId: schoolId as string }
          }
        );
      }
      
      res.json({ ...result, members: maskedMembers });
    } catch (error: any) {
      console.error("Get staff members error:", error);
      res.status(500).json({ error: error.message || "Failed to get staff members" });
    }
  });
  
  // Get staff members for a specific school - emails/phones masked unless revealed
  app.get("/api/staff/schools/:schoolId/members", attachUser, async (req: UserRequest, res) => {
    try {
      const { schoolId } = req.params;
      const members = await storage.getStaffMembersBySchool(schoolId);
      const directory = await storage.getSchoolDirectory(schoolId);
      const maskedMembers = await maskStaffList(req.user?.id, members as any);
      
      res.json({
        school: directory,
        members: maskedMembers,
        count: maskedMembers.length,
      });
    } catch (error: any) {
      console.error("Get school staff error:", error);
      res.status(500).json({ error: error.message || "Failed to get school staff" });
    }
  });

  // Reveal a staff member's contact info — charges per pricing tier
  app.post("/api/staff/:id/reveal", requireUser, async (req: UserRequest, res) => {
    try {
      const staffId = parseInt(req.params.id, 10);
      if (!staffId || Number.isNaN(staffId)) {
        return res.status(400).json({ error: "Invalid staff id" });
      }
      const outcome = await revealContact({
        userId: req.user!.id,
        staffId,
        sessionId: req.sessionID,
      });
      if (outcome.status === "error") {
        const httpStatus =
          outcome.code === "out_of_quota" ? 402 :
          outcome.code === "payment_failed" ? 402 :
          outcome.code === "staff_not_found" ? 404 : 400;
        return res.status(httpStatus).json(outcome);
      }
      res.json(outcome);
    } catch (error: any) {
      console.error("Reveal contact error:", error);
      res.status(500).json({ error: error.message || "Failed to reveal contact" });
    }
  });
  
  // Get overall stats
  app.get("/api/staff/stats", requireUser, async (_req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error: any) {
      console.error("Get stats error:", error);
      res.status(500).json({ error: error.message || "Failed to get stats" });
    }
  });

  // Contact-accuracy feedback loop: a signed-in user reports a staff record as
  // inaccurate. Downgrades confidence and flags it for re-verification.
  app.post("/api/staff/:id/report", requireUser, async (req: UserRequest, res) => {
    try {
      const staffId = parseInt(req.params.id, 10);
      if (!staffId || Number.isNaN(staffId)) {
        return res.status(400).json({ error: "Invalid staff id" });
      }
      const updated = await storage.reportStaffInaccurate(staffId);
      if (!updated) {
        return res.status(404).json({ error: "Staff member not found" });
      }
      await storage.logEvent({
        eventType: "contact_reported_inaccurate",
        details: { staffId, userId: req.user!.id },
      });
      res.json({ success: true, staff: updated });
    } catch (error: any) {
      console.error("Report inaccurate contact error:", error);
      res.status(500).json({ error: error.message || "Failed to report contact" });
    }
  });

  // Extract staff from a specific school (async job-based for multi-user support)
  app.post("/api/staff/extract/:schoolId", async (req, res) => {
    try {
      const { schoolId } = req.params;
      const { directoryUrl, async: asyncMode = true } = req.body || {};
      
      // Check if school is already being extracted
      if (isSchoolLocked(schoolId)) {
        const lock = getSchoolLock(schoolId);
        return res.status(409).json({
          success: false,
          message: "Extraction already in progress",
          locked: true,
          jobId: lock?.jobId,
          startedAt: lock?.startedAt,
          school: await storage.getSchoolDirectory(schoolId),
        });
      }
      
      // Get school directory
      let directory = await storage.getSchoolDirectory(schoolId);
      
      // If not in database, try to find it in NCAA cache
      if (!directory) {
        const ncaaCache = await fetchAllNCAASchools();
        const school = ncaaCache.schools.find(s => s.id === schoolId);
        if (!school) {
          return res.status(404).json({ error: "School not found" });
        }
        // Create directory entry
        directory = await storage.upsertSchoolDirectory({
          schoolId: school.id,
          schoolName: school.name,
          schoolFullName: school.fullName,
          logoUrl: school.logoUrl || null,
          ncaaUrl: school.schoolUrl,
          directoryUrl: directoryUrl || null,
          division: school.division || null,
          conference: school.conference || null,
          status: "pending",
        });
      }
      
      // For async mode: Create a job and return immediately
      if (asyncMode) {
        const job = await storage.createExtractionJob({
          type: 'single',
          targetId: schoolId,
          status: 'pending',
          totalSchools: 1,
          processedSchools: 0,
          contactsFound: 0,
          logs: [`Queued extraction for ${directory.schoolName}`],
        });
        
        await storage.updateSchoolDirectoryStatus(schoolId, "processing");
        queueJob(job.id);
        
        return res.json({
          success: true,
          message: "Extraction queued",
          async: true,
          jobId: job.id,
          school: await storage.getSchoolDirectory(schoolId),
          queueStatus: getQueueStatus(),
        });
      }
      
      // Synchronous mode (legacy support): Acquire lock and process immediately
      if (!acquireSchoolLock(schoolId, null)) {
        return res.status(409).json({
          success: false,
          message: "Extraction already in progress",
          locked: true,
        });
      }
      
      try {
        await storage.updateSchoolDirectoryStatus(schoolId, "processing");
        
        // Check for known override first - this takes priority over stored URLs
        const { getKnownDirectoryUrl } = await import("./lib/known-directory-urls");
        const knownOverride = getKnownDirectoryUrl(schoolId);
        
        let urlToExtract = directoryUrl; // User-provided URL takes highest priority
        
        if (!urlToExtract && knownOverride) {
          // Known override takes second priority
          console.log(`Using known override for ${directory.schoolName}: ${knownOverride.directoryUrl}`);
          urlToExtract = knownOverride.directoryUrl;
          // Update database with the known override
          if (urlToExtract !== directory.directoryUrl) {
            await storage.upsertSchoolDirectory({
              ...directory,
              directoryUrl: urlToExtract,
            });
          }
        }
        
        if (!urlToExtract) {
          // Fall back to stored URL
          urlToExtract = directory.directoryUrl;
        }
        
        // Try to discover directory URL if still not available
        if (!urlToExtract) {
          console.log(`Discovering directory URL for ${directory.schoolName}...`);
          urlToExtract = await discoverDirectoryUrl(directory.ncaaUrl, directory.schoolName, schoolId);
          if (urlToExtract) {
            await storage.upsertSchoolDirectory({
              ...directory,
              directoryUrl: urlToExtract,
            });
          }
        }
        
        if (!urlToExtract) {
          await storage.updateSchoolDirectoryStatus(schoolId, "no_directory", "Could not find staff directory page");
          releaseSchoolLock(schoolId);
          return res.json({
            success: false,
            message: "Could not find staff directory page",
            school: await storage.getSchoolDirectory(schoolId),
          });
        }
        
        // Extract staff
        console.log(`Extracting staff from ${urlToExtract}...`);
        let result = await extractStaffFromUrl(urlToExtract);
        
        // If no contacts found and URL was from database, try discovering a new URL
        if (result.contacts.length === 0 && !directoryUrl && directory.directoryUrl) {
          console.log(`No contacts at ${urlToExtract}, trying to discover new URL...`);
          const discoveredUrl = await discoverDirectoryUrl(directory.ncaaUrl, directory.schoolName, schoolId);
          if (discoveredUrl && discoveredUrl !== urlToExtract) {
            console.log(`Discovered new URL: ${discoveredUrl}`);
            urlToExtract = discoveredUrl;
            result = await extractStaffFromUrl(urlToExtract);
          }
        }
        
        if (result.contacts.length === 0) {
          await storage.updateSchoolDirectoryStatus(schoolId, "failed", "No contacts found on page");
          releaseSchoolLock(schoolId);
          return res.json({
            success: false,
            message: "No contacts found on page",
            diagnostics: result.diagnostics,
            school: await storage.getSchoolDirectory(schoolId),
          });
        }
        
        // Clear old staff and insert new
        await storage.deleteStaffMembersBySchool(schoolId);
        const staffMembers = convertToStaffMembers(result.contacts, schoolId);
        await storage.bulkUpsertStaffMembers(staffMembers);
        
        // Update directory status
        await storage.upsertSchoolDirectory({
          schoolId,
          schoolName: directory.schoolName,
          schoolFullName: directory.schoolFullName,
          logoUrl: directory.logoUrl,
          ncaaUrl: directory.ncaaUrl,
          directoryUrl: urlToExtract,
          division: directory.division,
          conference: directory.conference,
          status: "success",
          contactsCount: result.contacts.length,
          avgConfidence: result.diagnostics.averageConfidence,
          lastExtractedAt: new Date(),
          lastAttemptedAt: new Date(),
        });
        
        releaseSchoolLock(schoolId);
        
        // Log extraction event
        await logUsageEvent(req, 'extraction', schoolId, directory.schoolName, {
          success: true,
          count: result.contacts.length,
          duration: undefined,
        });
        
        res.json({
          success: true,
          message: `Extracted ${result.contacts.length} contacts`,
          contacts: result.contacts.length,
          diagnostics: result.diagnostics,
          school: await storage.getSchoolDirectory(schoolId),
        });
      } catch (innerError: any) {
        releaseSchoolLock(schoolId);
        throw innerError;
      }
    } catch (error: any) {
      console.error("Extract staff error:", error);
      const { schoolId } = req.params;
      await storage.updateSchoolDirectoryStatus(schoolId, "failed", error.message);
      
      // Log failed extraction
      await logUsageEvent(req, 'extraction', schoolId, undefined, {
        success: false,
        error: error.message,
      });
      
      res.status(500).json({ error: error.message || "Failed to extract staff" });
    }
  });
  
  // Bulk extract staff for multiple schools (queued processing)
  app.post("/api/staff/extract-bulk", async (req, res) => {
    try {
      const { schoolIds, limit = 10 } = req.body;
      
      let schoolsToProcess: string[] = schoolIds;
      
      // If no specific schools provided, get pending ones
      if (!schoolIds || schoolIds.length === 0) {
        const pending = await storage.getSchoolDirectories({ status: "pending", limit });
        schoolsToProcess = pending.directories.map(d => d.schoolId);
      }
      
      if (schoolsToProcess.length === 0) {
        return res.json({ message: "No schools to process", processed: 0 });
      }
      
      // Process schools sequentially with rate limiting
      const results: any[] = [];
      for (const schoolId of schoolsToProcess.slice(0, limit)) {
        try {
          console.log(`Processing ${schoolId}...`);
          
          // Simulate the extract endpoint logic
          let directory = await storage.getSchoolDirectory(schoolId);
          if (!directory) continue;
          
          await storage.updateSchoolDirectoryStatus(schoolId, "processing");
          
          // Check for known override first - this takes priority over stored URLs
          const { getKnownDirectoryUrl: getBulkKnownUrl } = await import("./lib/known-directory-urls");
          const bulkKnownOverride = getBulkKnownUrl(schoolId);
          
          let urlToExtract: string | null = null;
          
          if (bulkKnownOverride) {
            console.log(`Using known override for ${directory.schoolName}: ${bulkKnownOverride.directoryUrl}`);
            urlToExtract = bulkKnownOverride.directoryUrl;
            if (urlToExtract !== directory.directoryUrl) {
              await storage.upsertSchoolDirectory({ ...directory, directoryUrl: urlToExtract });
            }
          } else if (directory.directoryUrl) {
            urlToExtract = directory.directoryUrl;
          } else {
            urlToExtract = await discoverDirectoryUrl(directory.ncaaUrl, directory.schoolName, schoolId);
            if (urlToExtract) {
              await storage.upsertSchoolDirectory({
                ...directory,
                directoryUrl: urlToExtract,
              });
            }
          }
          
          if (!urlToExtract) {
            await storage.updateSchoolDirectoryStatus(schoolId, "no_directory");
            results.push({ schoolId, status: "no_directory" });
            continue;
          }
          
          const result = await extractStaffFromUrl(urlToExtract);
          
          if (result.contacts.length === 0) {
            await storage.updateSchoolDirectoryStatus(schoolId, "failed", "No contacts found");
            results.push({ schoolId, status: "failed", reason: "No contacts" });
            continue;
          }
          
          await storage.deleteStaffMembersBySchool(schoolId);
          const staffMembers = convertToStaffMembers(result.contacts, schoolId);
          await storage.bulkUpsertStaffMembers(staffMembers);
          
          await storage.upsertSchoolDirectory({
            schoolId,
            schoolName: directory.schoolName,
            schoolFullName: directory.schoolFullName,
            logoUrl: directory.logoUrl,
            ncaaUrl: directory.ncaaUrl,
            directoryUrl: urlToExtract,
            division: directory.division,
            conference: directory.conference,
            status: "success",
            contactsCount: result.contacts.length,
            avgConfidence: result.diagnostics.averageConfidence,
            lastExtractedAt: new Date(),
            lastAttemptedAt: new Date(),
          });
          
          results.push({ schoolId, status: "success", contacts: result.contacts.length });
          
          // Rate limit: wait 1 second between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err: any) {
          await storage.updateSchoolDirectoryStatus(schoolId, "failed", err.message);
          results.push({ schoolId, status: "error", error: err.message });
        }
      }
      
      res.json({
        message: `Processed ${results.length} schools`,
        results,
      });
    } catch (error: any) {
      console.error("Bulk extract error:", error);
      res.status(500).json({ error: error.message || "Failed to bulk extract" });
    }
  });
  
  // Parse HTML directly (for manual URL testing)
  app.post("/api/staff/parse-html", async (req, res) => {
    try {
      const { html } = req.body;
      if (!html) {
        return res.status(400).json({ error: "HTML content required" });
      }
      const result = parseHtmlForContacts(html);
      res.json(result);
    } catch (error: any) {
      console.error("Parse HTML error:", error);
      res.status(500).json({ error: error.message || "Failed to parse HTML" });
    }
  });
  
  // NCAA Schools Index endpoint
  app.get("/api/ncaa/schools", async (_req, res) => {
    try {
      const cache = await fetchAllNCAASchools();
      
      // Return 503 Service Unavailable if coverage is incomplete
      if (!cache.diagnostics.isComplete) {
        console.error("NCAA schools coverage incomplete:", cache.diagnostics);
        return res.status(503).json({
          error: "NCAA schools data is incomplete. Please try again later.",
          schools: cache.schools,
          totalCount: cache.schools.length,
          lastUpdated: cache.lastUpdated,
          diagnostics: cache.diagnostics,
        });
      }
      
      // Return data with diagnostics for complete coverage
      res.json({
        schools: cache.schools,
        totalCount: cache.schools.length,
        lastUpdated: cache.lastUpdated,
        diagnostics: cache.diagnostics,
      });
    } catch (error: any) {
      console.error("NCAA Schools fetch error:", error);
      res.status(500).json({
        error: error.message || "Failed to fetch NCAA schools"
      });
    }
  });

  // ============================================================================
  // USAGE REPORTING ENDPOINTS (Admin/Analytics)
  // ============================================================================
  
  // Get usage statistics dashboard
  app.get("/api/reports/stats", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      const stats = await storage.getUsageStats({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      
      res.json(stats);
    } catch (error: any) {
      console.error("Get usage stats error:", error);
      res.status(500).json({ error: error.message || "Failed to get usage stats" });
    }
  });
  
  // Get usage events with filtering
  app.get("/api/reports/events", async (req, res) => {
    try {
      const { eventType, schoolId, startDate, endDate, limit, offset } = req.query;
      
      const result = await storage.getUsageEvents({
        eventType: eventType as string | undefined,
        schoolId: schoolId as string | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0,
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("Get usage events error:", error);
      res.status(500).json({ error: error.message || "Failed to get usage events" });
    }
  });
  
  app.get("/api/credits", requireAdmin, async (_req, res) => {
    try {
      res.json({
        totalCredits: INTERNAL_DEFAULT_CREDITS,
        creditsUsed: internalCreditsUsed,
        creditsRemaining: getInternalCreditsRemaining(),
      });
    } catch (error: any) {
      console.error("Get credits error:", error);
      res.status(500).json({ error: error.message || "Failed to get credit balance" });
    }
  });

  // Get export-specific tracking (dedicated endpoint for export analytics)
  app.post("/api/reports/log-export", async (req, res) => {
    try {
      const { schoolId, schoolName, format, count } = req.body;
      const sanitizedCount = Math.max(0, Math.floor(Number(count) || 0));
      
      await logUsageEvent(req, 'export', schoolId, schoolName, {
        format: format || 'csv',
        count: sanitizedCount,
        success: true,
      });
      
      res.json({ 
        success: true,
        creditsUsed: sanitizedCount,
        creditsRemaining: getInternalCreditsRemaining(),
      });
    } catch (error: any) {
      console.error("Log export error:", error);
      res.status(500).json({ error: error.message || "Failed to log export" });
    }
  });
  
  // ============================================================================
  // EXTRACTION JOB QUEUE ENDPOINTS
  // ============================================================================
  
  // Get current extraction status (locks, queue, active jobs, websocket clients)
  app.get("/api/extraction/status", async (_req, res) => {
    try {
      const queueStatus = getQueueStatus();
      const activeLocks = getActiveSchoolLocks();
      const initLocked = isNcaaInitLocked();
      
      res.json({
        queue: queueStatus,
        activeLocks: activeLocks.map(lock => ({
          schoolId: lock.schoolId,
          jobId: lock.jobId,
          startedAt: lock.startedAt,
          duration: Date.now() - lock.startedAt.getTime(),
        })),
        initializationInProgress: initLocked,
        connectedClients: getConnectedClientCount(),
      });
    } catch (error: any) {
      console.error("Get extraction status error:", error);
      res.status(500).json({ error: error.message || "Failed to get extraction status" });
    }
  });
  
  // Create a new extraction job
  app.post("/api/jobs", requireAdmin, async (req, res) => {
    try {
      const parsed = createJobSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid job request", details: parsed.error.errors });
      }
      
      const { type, targetId, schoolIds } = parsed.data;
      
      let totalSchools = 0;
      let jobSchoolIds: string[] = [];
      
      if (type === 'single') {
        totalSchools = 1;
        jobSchoolIds = [targetId];
      } else if (type === 'conference') {
        // Query seeded schools from database, not NCAA scraper cache
        const result = await storage.getSchoolDirectories({ conference: targetId, limit: 500 });
        totalSchools = result.total;
        jobSchoolIds = result.directories.map(d => d.schoolId);
      } else if (type === 'bulk' && schoolIds) {
        totalSchools = schoolIds.length;
        jobSchoolIds = schoolIds;
      }
      
      if (totalSchools === 0) {
        return res.status(400).json({ error: "No schools to process" });
      }
      
      const job = await storage.createExtractionJob({
        type,
        targetId,
        status: 'pending',
        totalSchools,
        processedSchools: 0,
        contactsFound: 0,
        logs: [`Job created: Processing ${totalSchools} schools`],
      });
      
      queueJob(job.id);
      
      res.json({ 
        success: true, 
        job,
        message: `Job created: Processing ${totalSchools} schools`,
        queueStatus: getQueueStatus(),
      });
    } catch (error: any) {
      console.error("Create job error:", error);
      res.status(500).json({ error: error.message || "Failed to create job" });
    }
  });
  
  // Get recent jobs
  app.get("/api/jobs", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const jobs = await storage.getRecentJobs(limit);
      res.json({ jobs });
    } catch (error: any) {
      console.error("Get jobs error:", error);
      res.status(500).json({ error: error.message || "Failed to get jobs" });
    }
  });
  
  // Get job by ID
  app.get("/api/jobs/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid job ID" });
      }
      
      const job = await storage.getExtractionJob(id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      
      res.json({ job });
    } catch (error: any) {
      console.error("Get job error:", error);
      res.status(500).json({ error: error.message || "Failed to get job" });
    }
  });
  
  // Get queue status
  app.get("/api/jobs/queue/status", requireAdmin, async (_req, res) => {
    try {
      res.json(getQueueStatus());
    } catch (error: any) {
      console.error("Get queue status error:", error);
      res.status(500).json({ error: error.message || "Failed to get queue status" });
    }
  });

  // Health metrics endpoint - extraction statistics
  app.get("/api/health/metrics", requireAdmin, async (_req, res) => {
    try {
      const { healthMonitor } = await import("./lib/health-monitor");
      const stats = healthMonitor.getStats();
      res.json({ 
        status: "ok",
        metrics: stats,
        parserPerformance: healthMonitor.getParserPerformance(),
      });
    } catch (error: any) {
      console.error("Get health metrics error:", error);
      res.status(500).json({ error: error.message || "Failed to get health metrics" });
    }
  });

  // Scraper health endpoint - circuit breaker, parser metrics, and validation stats
  app.get("/api/scraper/health", requireAdmin, async (_req, res) => {
    try {
      const { getHealthSnapshot } = await import("./lib/scraper-health");
      const snapshot = getHealthSnapshot();
      res.json({
        status: "ok",
        ...snapshot,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Get scraper health error:", error);
      res.status(500).json({ error: error.message || "Failed to get scraper health" });
    }
  });

  // Data Health Metrics API - Database freshness monitoring
  app.get("/api/data-health", requireAdmin, async (_req, res) => {
    try {
      const { getDataHealthMetrics } = await import("./lib/data-health");
      const { getReverifyStatus } = await import("./lib/reverify-scheduler");
      const metrics = await getDataHealthMetrics();
      res.json({
        status: "ok",
        ...metrics,
        emailVerification: getReverifyStatus(),
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Get data health error:", error);
      res.status(500).json({ error: error.message || "Failed to get data health metrics" });
    }
  });

  // Refresh stale schools - queue stale schools for re-extraction
  app.post("/api/data-health/refresh-stale", requireAdmin, async (req, res) => {
    try {
      const { tier, limit = 50 } = req.body || {};
      
      // Validate tier parameter
      if (tier && !["power5", "midTier", "other"].includes(tier)) {
        return res.status(400).json({ error: "Invalid tier - must be 'power5', 'midTier', or 'other'" });
      }
      
      // Validate limit parameter
      const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
      
      const { getStaleSchoolIds } = await import("./lib/data-health");
      const staleSchoolIds = await getStaleSchoolIds(undefined, tier, safeLimit);
      
      if (staleSchoolIds.length === 0) {
        return res.json({
          success: true,
          message: "No stale schools found to refresh",
          schoolsQueued: 0,
        });
      }
      
      // Validate we have valid school IDs
      if (!staleSchoolIds.every(id => typeof id === 'string' && id.length > 0)) {
        return res.status(500).json({ error: "Invalid school IDs returned from stale detection" });
      }
      
      // Create a bulk extraction job for stale schools
      // Store school IDs as JSON in targetId for the job queue to parse
      const targetIdJson = JSON.stringify(staleSchoolIds);
      
      // Safety check - ensure targetId isn't too large for database storage
      if (targetIdJson.length > 50000) {
        return res.status(400).json({ 
          error: "Too many schools to refresh at once. Please use a smaller limit.",
          schoolsRequested: staleSchoolIds.length,
        });
      }
      
      const job = await storage.createExtractionJob({
        type: "bulk",
        targetId: targetIdJson,
        status: "pending",
        totalSchools: staleSchoolIds.length,
        processedSchools: 0,
        contactsFound: 0,
        logs: [`Queued ${staleSchoolIds.length} stale schools for re-extraction (${tier || "all"} tier)`],
      });
      
      // Start the job
      const { queueJob } = await import("./lib/job-queue");
      queueJob(job.id);
      
      res.json({
        success: true,
        message: `Queued ${staleSchoolIds.length} stale schools for re-extraction`,
        jobId: job.id,
        schoolsQueued: staleSchoolIds.length,
        tier: tier || "all",
      });
    } catch (error: any) {
      console.error("Refresh stale schools error:", error);
      res.status(500).json({ error: error.message || "Failed to queue stale schools for refresh" });
    }
  });

  app.post("/api/data-health/retry-failed", requireAdmin, async (req, res) => {
    try {
      const { failureReason, limit = 50, conference, includeNeedsReview = false } = req.body || {};
      
      const validReasons = ["url_not_found", "timeout", "blocked", "no_contacts", "parse_error"];
      if (failureReason && !validReasons.includes(failureReason)) {
        return res.status(400).json({ error: `Invalid failureReason - must be one of: ${validReasons.join(', ')}` });
      }
      
      const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
      
      const { getFailedSchoolIds } = await import("./lib/data-health");
      const failedSchoolIds = await getFailedSchoolIds(failureReason, safeLimit, conference, !!includeNeedsReview);
      
      if (failedSchoolIds.length === 0) {
        return res.json({
          success: true,
          message: "No failed schools found to retry",
          schoolsQueued: 0,
        });
      }
      
      const targetIdJson = JSON.stringify(failedSchoolIds);
      
      if (targetIdJson.length > 50000) {
        return res.status(400).json({ 
          error: "Too many schools to retry at once. Please use a smaller limit.",
          schoolsRequested: failedSchoolIds.length,
        });
      }
      
      const job = await storage.createExtractionJob({
        type: "bulk",
        targetId: targetIdJson,
        status: "pending",
        totalSchools: failedSchoolIds.length,
        processedSchools: 0,
        contactsFound: 0,
        logs: [`Queued ${failedSchoolIds.length} failed schools for retry (reason: ${failureReason || "all"})`],
      });
      
      const { queueJob } = await import("./lib/job-queue");
      queueJob(job.id);
      
      res.json({
        success: true,
        message: `Queued ${failedSchoolIds.length} failed schools for retry`,
        jobId: job.id,
        schoolsQueued: failedSchoolIds.length,
        failureReason: failureReason || "all",
      });
    } catch (error: any) {
      console.error("Retry failed schools error:", error);
      res.status(500).json({ error: error.message || "Failed to queue failed schools for retry" });
    }
  });

  // Admin endpoint to manually set a school's directory URL (admin only)
  app.post("/api/admin/directory-url", requireAdmin, async (req, res) => {
    try {
      const { schoolId, directoryUrl, athleticsBaseUrl, notes } = req.body;
      
      if (!schoolId || !directoryUrl) {
        return res.status(400).json({ error: "schoolId and directoryUrl are required" });
      }
      
      // Add to the known overrides (runtime)
      const { addKnownDirectoryUrl } = await import("./lib/known-directory-urls");
      addKnownDirectoryUrl(schoolId, directoryUrl, athleticsBaseUrl, notes);
      
      // Also update the database if the school exists
      const directory = await storage.getSchoolDirectory(schoolId);
      if (directory) {
        await storage.upsertSchoolDirectory({
          ...directory,
          directoryUrl,
        });
      }
      
      console.log(`[Admin] Set directory URL for ${schoolId}: ${directoryUrl}`);
      
      res.json({
        success: true,
        message: `Directory URL set for ${schoolId}`,
        schoolId,
        directoryUrl,
      });
    } catch (error: any) {
      console.error("Set directory URL error:", error);
      res.status(500).json({ error: error.message || "Failed to set directory URL" });
    }
  });

  // Admin endpoint to get known directory URL overrides (admin only)
  app.get("/api/admin/directory-urls", requireAdmin, async (req, res) => {
    try {
      const { KNOWN_DIRECTORY_URLS } = await import("./lib/known-directory-urls");
      res.json({
        overrides: KNOWN_DIRECTORY_URLS,
        count: Object.keys(KNOWN_DIRECTORY_URLS).length,
      });
    } catch (error: any) {
      console.error("Get directory URLs error:", error);
      res.status(500).json({ error: error.message || "Failed to get directory URLs" });
    }
  });

  app.post("/api/admin/cleanup-staff", requireAdmin, async (req, res) => {
    try {
      const { isValidContactEmail, isValidPersonName } = await import("./staffExtractor");
      const { dryRun = true, schoolId } = req.body;
      
      const allSchools = await storage.getSchoolDirectories({ limit: 10000 });
      const targetSchools = schoolId
        ? allSchools.directories.filter(s => s.schoolId === schoolId)
        : allSchools.directories.filter(s => s.status === 'success');
      
      const cleanupResults: {
        schoolId: string;
        schoolName: string;
        totalStaff: number;
        invalidEmails: number;
        invalidNames: number;
        lowQuality: number;
        removed: number;
      }[] = [];
      
      let totalRemoved = 0;
      let totalFlagged = 0;
      
      for (const school of targetSchools) {
        const members = await storage.getStaffMembersBySchool(school.schoolId);
        if (members.length === 0) continue;
        
        let invalidEmails = 0;
        let invalidNames = 0;
        let lowQuality = 0;
        const toRemove: number[] = [];
        
        for (const member of members) {
          const emailValid = isValidContactEmail(member.email);
          const nameValid = isValidPersonName(member.name);
          const hasTitle = !!member.title && member.title.length > 2;
          const hasPhone = !!member.phone && member.phone.length >= 7;
          
          if (!emailValid) invalidEmails++;
          if (!nameValid) invalidNames++;
          
          if (!nameValid) {
            lowQuality++;
            toRemove.push(member.id);
          } else if (!emailValid && !hasTitle && !hasPhone) {
            lowQuality++;
            toRemove.push(member.id);
          }
        }
        
        if (toRemove.length > 0) {
          if (!dryRun) {
            for (const id of toRemove) {
              await db.delete(staffMembers).where(eq(staffMembers.id, id));
            }
          }
          
          cleanupResults.push({
            schoolId: school.schoolId,
            schoolName: school.schoolName,
            totalStaff: members.length,
            invalidEmails,
            invalidNames,
            lowQuality,
            removed: toRemove.length,
          });
          
          totalRemoved += toRemove.length;
        }
        totalFlagged += invalidEmails;
      }
      
      res.json({
        success: true,
        dryRun,
        schoolsProcessed: targetSchools.length,
        totalRemoved: dryRun ? 0 : totalRemoved,
        wouldRemove: totalRemoved,
        totalFlagged: totalFlagged,
        perSchoolResults: cleanupResults,
      });
    } catch (error: any) {
      console.error("Staff cleanup error:", error);
      res.status(500).json({ error: error.message || "Failed to run staff cleanup" });
    }
  });

  app.post("/api/admin/staff/reverify", requireAdmin, async (req, res) => {
    try {
      const requested = Number(req.body?.limit);
      const limit = Number.isFinite(requested) ? Math.min(Math.max(1, Math.floor(requested)), 500) : 100;
      const force = req.body?.force === true;
      const result = await storage.reverifyStaffEmails(limit, { force });
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Reverify staff emails error:", error);
      res.status(500).json({ error: error.message || "Failed to reverify staff emails" });
    }
  });

  app.get("/api/admin/data-quality", requireAdmin, async (req, res) => {
    try {
      const { isValidContactEmail, isValidPersonName } = await import("./staffExtractor");
      const schoolId = req.query.schoolId as string | undefined;
      
      const targetSchools: SchoolDirectory[] = schoolId
        ? ([await storage.getSchoolDirectory(schoolId)].filter((s): s is SchoolDirectory => !!s))
        : (await storage.getSchoolDirectories({ status: 'success', limit: 10000 })).directories;
      
      const schoolScores: {
        schoolId: string;
        schoolName: string;
        totalStaff: number;
        validEmails: number;
        validNames: number;
        withTitles: number;
        withPhones: number;
        qualityScore: number;
      }[] = [];
      
      for (const school of targetSchools) {
        const members = await storage.getStaffMembersBySchool(school.schoolId);
        if (members.length === 0) continue;
        
        let validEmails = 0;
        let validNames = 0;
        let withTitles = 0;
        let withPhones = 0;
        
        for (const m of members) {
          if (isValidContactEmail(m.email)) validEmails++;
          if (isValidPersonName(m.name)) validNames++;
          if (m.title && m.title.length > 2) withTitles++;
          if (m.phone && m.phone.length >= 7) withPhones++;
        }
        
        const total = members.length;
        const qualityScore = Math.round(
          ((validEmails / total) * 30) +
          ((validNames / total) * 30) +
          ((withTitles / total) * 25) +
          ((withPhones / total) * 15)
        );
        
        schoolScores.push({
          schoolId: school.schoolId,
          schoolName: school.schoolName,
          totalStaff: total,
          validEmails,
          validNames,
          withTitles,
          withPhones,
          qualityScore,
        });
      }
      
      const avgScore = schoolScores.length > 0
        ? Math.round(schoolScores.reduce((sum, s) => sum + s.qualityScore, 0) / schoolScores.length)
        : 0;
      
      res.json({
        totalSchools: schoolScores.length,
        averageQualityScore: avgScore,
        schools: schoolScores.sort((a, b) => a.qualityScore - b.qualityScore),
      });
    } catch (error: any) {
      console.error("Data quality score error:", error);
      res.status(500).json({ error: error.message || "Failed to compute data quality scores" });
    }
  });

  // Legacy background job processor (kept for reference, now handled by job-queue.ts)
  async function _legacyProcessJobInBackground(jobId: number, schoolIds: string[]) {
    console.log(`Starting background job ${jobId} for ${schoolIds.length} schools`);
    
    try {
      await storage.updateExtractionJob(jobId, {
        status: 'processing',
        logs: [`Job started at ${new Date().toISOString()}`],
      });
      
      let processed = 0;
      let contactsFound = 0;
      const logs: string[] = [`Processing ${schoolIds.length} schools...`];
      
      for (const schoolId of schoolIds) {
        try {
          let directory = await storage.getSchoolDirectory(schoolId);
          
          // If not in database, try to find it in NCAA cache
          if (!directory) {
            const ncaaCache = await fetchAllNCAASchools();
            const school = ncaaCache.schools.find(s => s.id === schoolId);
            if (!school) {
              logs.push(`[${schoolId}] School not found in NCAA database`);
              processed++;
              continue;
            }
            directory = await storage.upsertSchoolDirectory({
              schoolId: school.id,
              schoolName: school.name,
              schoolFullName: school.fullName,
              logoUrl: school.logoUrl || null,
              ncaaUrl: school.schoolUrl,
              directoryUrl: null,
              division: school.division || null,
              conference: school.conference || null,
              status: "processing",
            });
          }
          
          await storage.updateSchoolDirectoryStatus(schoolId, "processing");
          
          // Check for known override first - this takes priority over stored URLs
          const { getKnownDirectoryUrl: getLegacyKnownUrl } = await import("./lib/known-directory-urls");
          const legacyKnownOverride = getLegacyKnownUrl(schoolId);
          
          let urlToExtract: string | null = null;
          
          if (legacyKnownOverride) {
            logs.push(`[${directory.schoolName}] Using known override URL`);
            urlToExtract = legacyKnownOverride.directoryUrl;
            if (urlToExtract !== directory.directoryUrl) {
              await storage.upsertSchoolDirectory({ ...directory, directoryUrl: urlToExtract });
            }
          } else if (directory.directoryUrl) {
            urlToExtract = directory.directoryUrl;
          } else {
            logs.push(`[${directory.schoolName}] Discovering staff directory...`);
            urlToExtract = await discoverDirectoryUrl(directory.ncaaUrl, directory.schoolName, schoolId);
            if (urlToExtract) {
              await storage.upsertSchoolDirectory({
                ...directory,
                directoryUrl: urlToExtract,
              });
            }
          }
          
          if (!urlToExtract) {
            await storage.updateSchoolDirectoryStatus(schoolId, "no_directory", "Could not find staff directory");
            logs.push(`[${directory.schoolName}] No staff directory found`);
            processed++;
            await storage.updateExtractionJob(jobId, { processedSchools: processed, logs });
            continue;
          }
          
          // Extract staff
          logs.push(`[${directory.schoolName}] Extracting from ${urlToExtract}`);
          const result = await extractStaffFromUrl(urlToExtract);
          
          if (result.contacts.length === 0) {
            await storage.updateSchoolDirectoryStatus(schoolId, "failed", "No contacts found");
            logs.push(`[${directory.schoolName}] No contacts found`);
          } else {
            // Save extracted staff
            await storage.deleteStaffMembersBySchool(schoolId);
            const staffMembers = convertToStaffMembers(result.contacts, schoolId);
            await storage.bulkUpsertStaffMembers(staffMembers);
            
            await storage.upsertSchoolDirectory({
              schoolId,
              schoolName: directory.schoolName,
              schoolFullName: directory.schoolFullName,
              logoUrl: directory.logoUrl,
              ncaaUrl: directory.ncaaUrl,
              directoryUrl: urlToExtract,
              division: directory.division,
              conference: directory.conference,
              status: "success",
              contactsCount: result.contacts.length,
              avgConfidence: result.diagnostics.averageConfidence,
              lastExtractedAt: new Date(),
              lastAttemptedAt: new Date(),
            });
            
            contactsFound += result.contacts.length;
            logs.push(`[${directory.schoolName}] Extracted ${result.contacts.length} contacts`);
          }
          
          processed++;
          await storage.updateExtractionJob(jobId, { 
            processedSchools: processed, 
            contactsFound,
            logs 
          });
          
          // Rate limit: wait 2 seconds between schools
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (err: any) {
          logs.push(`[${schoolId}] Error: ${err.message}`);
          await storage.updateSchoolDirectoryStatus(schoolId, "failed", err.message);
          processed++;
          await storage.updateExtractionJob(jobId, { processedSchools: processed, logs });
        }
      }
      
      // Mark job as completed
      logs.push(`Job completed: ${processed} schools processed, ${contactsFound} contacts found`);
      await storage.updateExtractionJob(jobId, {
        status: 'completed',
        processedSchools: processed,
        contactsFound,
        logs,
      });
      
      console.log(`Job ${jobId} completed: ${processed} schools, ${contactsFound} contacts`);
      
    } catch (error: any) {
      console.error(`Job ${jobId} failed:`, error);
      await storage.updateExtractionJob(jobId, {
        status: 'failed',
        logs: [`Job failed: ${error.message}`],
      });
    }
  }

  // ============================================================================
  // SAVED LISTS ENDPOINTS (Sales Rep Workflow)
  // ============================================================================
  
  const { z } = await import("zod");
  
  // Zod schemas for list endpoints
  const createListSchema = z.object({
    name: z.string().min(1, "List name is required").max(100),
    description: z.string().optional(),
  });
  
  const addToListSchema = z.object({
    staffId: z.number().int().positive("Staff ID must be a positive integer"),
    notes: z.string().optional(),
  });
  
  // Get all lists
  app.get("/api/lists", requireUser, async (req: UserRequest, res) => {
    try {
      const lists = await storage.getSavedLists();
      res.json(lists);
    } catch (error: any) {
      console.error("Get lists error:", error);
      res.status(500).json({ error: error.message || "Failed to get lists" });
    }
  });
  
  // Create new list
  app.post("/api/lists", attachUser, requirePlan("team"), async (req: UserRequest, res) => {
    try {
      const parsed = createListSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid request" });
      }
      const { name, description } = parsed.data;
      const list = await storage.createSavedList({ name, description, userId: 1 });
      res.json(list);
    } catch (error: any) {
      console.error("Create list error:", error);
      res.status(500).json({ error: error.message || "Failed to create list" });
    }
  });
  
  // Get single list with items
  app.get("/api/lists/:id", requireUser, async (req: UserRequest, res) => {
    try {
      const listId = parseInt(req.params.id);
      if (isNaN(listId) || listId <= 0) {
        return res.status(400).json({ error: "Invalid list ID" });
      }
      const list = await storage.getSavedListWithItems(listId);
      if (!list) {
        return res.status(404).json({ error: "List not found" });
      }
      res.json(list);
    } catch (error: any) {
      console.error("Get list error:", error);
      res.status(500).json({ error: error.message || "Failed to get list" });
    }
  });
  
  // Add contact to list
  app.post("/api/lists/:id/add", attachUser, requirePlan("team"), async (req: UserRequest, res) => {
    try {
      const listId = parseInt(req.params.id);
      if (isNaN(listId) || listId <= 0) {
        return res.status(400).json({ error: "Invalid list ID" });
      }
      
      const parsed = addToListSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid request" });
      }
      const { staffId, notes } = parsed.data;
      
      // Check if list exists
      const list = await storage.getSavedListWithItems(listId);
      if (!list) {
        return res.status(404).json({ error: "List not found" });
      }
      
      // Check if staff exists
      const staff = await storage.getStaffMember(staffId);
      if (!staff) {
        return res.status(404).json({ error: "Staff member not found" });
      }
      
      await storage.addToSavedList({ listId, staffId, notes });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Add to list error:", error);
      res.status(500).json({ error: error.message || "Failed to add to list" });
    }
  });
  
  // Remove contact from list
  app.delete("/api/lists/:id/remove/:staffId", requireUser, async (req: UserRequest, res) => {
    try {
      const listId = parseInt(req.params.id);
      const staffId = parseInt(req.params.staffId);
      if (isNaN(listId) || listId <= 0 || isNaN(staffId) || staffId <= 0) {
        return res.status(400).json({ error: "Invalid list ID or staff ID" });
      }
      await storage.removeFromSavedList(listId, staffId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Remove from list error:", error);
      res.status(500).json({ error: error.message || "Failed to remove from list" });
    }
  });
  
  // Delete list
  app.delete("/api/lists/:id", requireUser, async (req: UserRequest, res) => {
    try {
      const listId = parseInt(req.params.id);
      if (isNaN(listId) || listId <= 0) {
        return res.status(400).json({ error: "Invalid list ID" });
      }
      await storage.deleteSavedList(listId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete list error:", error);
      res.status(500).json({ error: error.message || "Failed to delete list" });
    }
  });

  // ============================================================================
  // ACCOUNT MATCHING ENDPOINTS (ABM List Matcher)
  // ============================================================================
  
  const { matchSchoolsBulk, matchSchoolsBatch, loadAliases, addAlias, getSchoolById } = await import("./lib/school-matcher");
  
  // Load aliases from database on startup
  try {
    const aliases = await storage.getAllSchoolAliases();
    loadAliases(aliases);
    console.log(`Loaded ${aliases.length} school aliases into matcher cache`);
  } catch (e) {
    console.log("No aliases table yet or empty, starting fresh");
  }
  
  app.post("/api/accounts/match-bulk", async (req, res) => {
    try {
      const { schoolNames } = req.body;
      
      if (!Array.isArray(schoolNames)) {
        return res.status(400).json({ error: "schoolNames must be an array of strings" });
      }
      
      if (schoolNames.length > 500) {
        return res.status(400).json({ error: "Maximum 500 school names per request" });
      }
      
      const results = matchSchoolsBulk(schoolNames);
      
      const matchedCount = results.filter(r => r.matched).length;
      const unmatchedCount = results.length - matchedCount;
      
      res.json({ 
        results,
        summary: {
          total: results.length,
          matched: matchedCount,
          unmatched: unmatchedCount,
          matchRate: results.length > 0 ? Math.round((matchedCount / results.length) * 100) : 0
        }
      });
    } catch (error: any) {
      console.error("Match bulk error:", error);
      res.status(500).json({ error: error.message || "Failed to match schools" });
    }
  });

  // Batch processing endpoint (50 items at a time with alternatives for ambiguous matches)
  app.post("/api/accounts/match-batch", async (req, res) => {
    try {
      const { schoolNames } = req.body;
      
      if (!Array.isArray(schoolNames)) {
        return res.status(400).json({ error: "schoolNames must be an array of strings" });
      }
      
      if (schoolNames.length > 50) {
        return res.status(400).json({ error: "Maximum 50 school names per batch request" });
      }
      
      const results = await matchSchoolsBatch(schoolNames);
      
      const matchedCount = results.filter(r => r.matched).length;
      const ambiguousCount = results.filter(r => r.isAmbiguous).length;
      const unmatchedCount = results.length - matchedCount;
      
      res.json({ 
        results,
        summary: {
          total: results.length,
          matched: matchedCount,
          ambiguous: ambiguousCount,
          unmatched: unmatchedCount,
          matchRate: results.length > 0 ? Math.round((matchedCount / results.length) * 100) : 0
        }
      });
    } catch (error: any) {
      console.error("Match batch error:", error);
      res.status(500).json({ error: error.message || "Failed to match schools" });
    }
  });

  // CRM Coverage Audit: given the schoolIds a user's uploaded account list
  // matched to (via match-batch), report how their CRM compares to the TAM —
  // matched coverage, stale matches, and the covered schools they're missing,
  // grouped by conference. The DataLane "coverage gap" play on existing data.
  app.post("/api/accounts/coverage-report", requireUser, async (req: UserRequest, res) => {
    try {
      const { matchedSchoolIds } = req.body as { matchedSchoolIds?: unknown };
      if (!Array.isArray(matchedSchoolIds) || !matchedSchoolIds.every((id) => typeof id === "string")) {
        return res.status(400).json({ error: "matchedSchoolIds must be an array of school id strings" });
      }
      const matchedSet = new Set(matchedSchoolIds);

      const covered = await db
        .select({
          schoolId: schoolDirectories.schoolId,
          schoolName: schoolDirectories.schoolFullName,
          conference: schoolDirectories.conference,
          contactsCount: schoolDirectories.contactsCount,
          lastExtractedAt: schoolDirectories.lastExtractedAt,
        })
        .from(schoolDirectories)
        .where(eq(schoolDirectories.status, "success"));

      const staleCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const matched = covered.filter((s) => matchedSet.has(s.schoolId));
      // getTime() via new Date(): the driver can hand timestamps back as strings,
      // and a string < Date comparison silently coerces both to strings.
      const staleMatched = matched.filter((s) => !s.lastExtractedAt || new Date(s.lastExtractedAt).getTime() < staleCutoff);
      const gap = covered.filter((s) => !matchedSet.has(s.schoolId));

      const gapByConference: Record<string, { schools: number; contacts: number }> = {};
      for (const s of gap) {
        const key = s.conference ?? "Other";
        gapByConference[key] = gapByConference[key] ?? { schools: 0, contacts: 0 };
        gapByConference[key].schools++;
        gapByConference[key].contacts += s.contactsCount ?? 0;
      }

      res.json({
        coveredSchools: covered.length,
        matched: matched.length,
        coveragePct: covered.length > 0 ? Math.round((matched.length / covered.length) * 100) : 0,
        staleMatched: staleMatched.length,
        gapSchools: gap.length,
        gapContacts: gap.reduce((a, s) => a + (s.contactsCount ?? 0), 0),
        gapByConference: Object.entries(gapByConference)
          .map(([conference, v]) => ({ conference, ...v }))
          .sort((a, b) => b.contacts - a.contacts),
        gapList: gap.map((s) => ({ schoolId: s.schoolId, schoolName: s.schoolName, conference: s.conference, contacts: s.contactsCount ?? 0 })),
      });
    } catch (error: any) {
      console.error("Coverage report error:", error);
      res.status(500).json({ error: error.message || "Failed to build coverage report" });
    }
  });

  // Save alias (learn from user correction)
  app.post("/api/accounts/alias", async (req, res) => {
    try {
      const { alias, schoolId } = req.body;
      
      if (!alias || typeof alias !== 'string') {
        return res.status(400).json({ error: "alias is required" });
      }
      
      if (!schoolId || typeof schoolId !== 'string') {
        return res.status(400).json({ error: "schoolId is required" });
      }
      
      // Verify school exists
      const school = getSchoolById(schoolId);
      if (!school) {
        return res.status(404).json({ error: "School not found" });
      }
      
      // Save to database
      const saved = await storage.createSchoolAlias({ alias: alias.trim(), schoolId });
      
      // Update in-memory cache
      addAlias(alias.trim(), schoolId);
      
      res.json({ 
        success: true, 
        alias: saved,
        school: { id: school.id, name: school.name, fullName: school.fullName }
      });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: "This alias already exists" });
      }
      console.error("Create alias error:", error);
      res.status(500).json({ error: error.message || "Failed to create alias" });
    }
  });

  // Get all aliases
  app.get("/api/accounts/aliases", async (_req, res) => {
    try {
      const aliases = await storage.getAllSchoolAliases();
      res.json({ aliases });
    } catch (error: any) {
      console.error("Get aliases error:", error);
      res.status(500).json({ error: error.message || "Failed to get aliases" });
    }
  });

  // Delete alias
  app.delete("/api/accounts/alias/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid alias ID" });
      }
      
      await storage.deleteSchoolAlias(id);
      
      // Reload aliases to update cache
      const aliases = await storage.getAllSchoolAliases();
      loadAliases(aliases);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete alias error:", error);
      res.status(500).json({ error: error.message || "Failed to delete alias" });
    }
  });

  // ============================================================================
  // BULK STAFF FETCH ENDPOINT (for Enrichment Module)
  // ============================================================================
  
  app.post("/api/staff/bulk-fetch", attachUser, async (req: UserRequest, res) => {
    try {
      const { schoolIds } = req.body;
      
      if (!schoolIds || !Array.isArray(schoolIds) || schoolIds.length === 0) {
        return res.json({ members: [], count: 0 });
      }

      // Use the storage layer to fetch via "IN" clause
      const { db } = await import("./db");
      const { staffMembers, schoolDirectories } = await import("@shared/schema");
      const { inArray, eq } = await import("drizzle-orm");
      
      const members = await db
        .select({
          id: staffMembers.id,
          name: staffMembers.name,
          title: staffMembers.title,
          email: staffMembers.email,
          phone: staffMembers.phone,
          department: staffMembers.department,
          schoolName: schoolDirectories.schoolName,
          schoolId: schoolDirectories.schoolId,
          conference: schoolDirectories.conference,
          division: schoolDirectories.division
        })
        .from(staffMembers)
        .innerJoin(schoolDirectories, eq(staffMembers.schoolId, schoolDirectories.schoolId))
        .where(inArray(staffMembers.schoolId, schoolIds))
        .limit(10000); // Safety limit

      const maskedMembers = await maskStaffList(req.user?.id, members as any);
      res.json({ members: maskedMembers, count: maskedMembers.length });
    } catch (error: any) {
      console.error("Bulk fetch error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch staff" });
    }
  });

  // ============================================================================
  // GROWTH & SALES INTELLIGENCE MODULE
  // ============================================================================

  // POST /api/growth/match-accounts - Bulk account matching for ABM
  app.post("/api/growth/match-accounts", attachUser, async (req: UserRequest, res) => {
    try {
      const { accountNames } = req.body;
      if (!accountNames || !Array.isArray(accountNames)) {
        return res.status(400).json({ error: "Invalid input: accountNames array required" });
      }

      const { db } = await import("./db");
      const { staffMembers, schoolDirectories } = await import("@shared/schema");
      const { inArray, eq } = await import("drizzle-orm");
      const fuzzysort = await import("fuzzysort");
      const { seedSchools } = await import("@shared/ncaa-seed-data");

      // Build search index from seed schools
      const searchIndex = seedSchools.map(s => ({
        id: s.schoolId,
        name: s.schoolName,
        full: s.schoolFullName,
        searchStr: `${s.schoolName} ${s.schoolFullName} ${s.schoolId}`
      }));

      const results: { input: string; match: string | null; id: string | null; score: number }[] = [];
      const matchedIds = new Set<string>();

      // Fuzzy match phase
      for (const name of accountNames) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;

        const matches = fuzzysort.default.go(trimmedName, searchIndex, { key: 'searchStr', limit: 1, threshold: -10000 });
        if (matches.length > 0 && matches[0]) {
          const match = matches[0];
          results.push({ 
            input: trimmedName, 
            match: match.obj.name, 
            id: match.obj.id,
            score: match.score
          });
          matchedIds.add(match.obj.id);
        } else {
          results.push({ input: trimmedName, match: null, id: null, score: 0 });
        }
      }

      // Enrichment phase - get contacts for matched schools
      let contacts: any[] = [];
      if (matchedIds.size > 0) {
        contacts = await db
          .select({
            id: staffMembers.id,
            name: staffMembers.name,
            title: staffMembers.title,
            email: staffMembers.email,
            phone: staffMembers.phone,
            department: staffMembers.department,
            schoolId: staffMembers.schoolId,
            schoolName: schoolDirectories.schoolName,
            conference: schoolDirectories.conference,
            division: schoolDirectories.division
          })
          .from(staffMembers)
          .innerJoin(schoolDirectories, eq(staffMembers.schoolId, schoolDirectories.schoolId))
          .where(inArray(staffMembers.schoolId, Array.from(matchedIds)))
          .limit(10000);
      }

      const maskedContacts = await maskStaffList(req.user?.id, contacts as any);
      res.json({
        summary: {
          inputCount: accountNames.length,
          matchedCount: matchedIds.size,
          contactsFound: maskedContacts.length
        },
        matches: results,
        contacts: maskedContacts
      });

    } catch (error: any) {
      console.error("Match accounts error:", error);
      res.status(500).json({ error: error.message || "Failed to match accounts" });
    }
  });

  // GET /api/growth/new-hires - Recent staff additions (last 7 days)
  app.get("/api/growth/new-hires", attachUser, async (req: UserRequest, res) => {
    try {
      const { db } = await import("./db");
      const { staffMembers, schoolDirectories } = await import("@shared/schema");
      const { desc, gt, eq } = await import("drizzle-orm");

      // Get staff extracted in the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const hires = await db
        .select({
          id: staffMembers.id,
          name: staffMembers.name,
          title: staffMembers.title,
          email: staffMembers.email,
          phone: staffMembers.phone,
          school: schoolDirectories.schoolName,
          schoolId: schoolDirectories.schoolId,
          conference: schoolDirectories.conference,
          detectedAt: staffMembers.extractedAt
        })
        .from(staffMembers)
        .innerJoin(schoolDirectories, eq(staffMembers.schoolId, schoolDirectories.schoolId))
        .where(gt(staffMembers.extractedAt, sevenDaysAgo))
        .orderBy(desc(staffMembers.extractedAt))
        .limit(100);

      const maskedHires = await maskStaffList(req.user?.id, hires as any);
      res.json(maskedHires);
    } catch (error: any) {
      console.error("New hires error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch new hires" });
    }
  });

  // ============================================================================
  // EXTERNAL API v1 - Headless API for GTM Tools (Clay, HubSpot, Zapier)
  // ============================================================================

  /**
   * @swagger
   * /enrich:
   *   post:
   *     summary: Enrich a company with athletic staff contacts
   *     description: |
   *       The Clay Connector endpoint. Provide a domain, school name, or school ID
   *       to get back the matched school with all extracted staff contacts.
   *       
   *       **Integration Examples:**
   *       - Clay: Use as an enrichment action in your table
   *       - Zapier: Trigger on new CRM records, enrich with staff data
   *     tags: [Enrichment]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/EnrichRequest'
   *           examples:
   *             byName:
   *               summary: Match by school name
   *               value: { "schoolName": "Alabama" }
   *             byDomain:
   *               summary: Match by website domain
   *               value: { "domain": "rolltide.com" }
   *             byId:
   *               summary: Direct lookup by ID
   *               value: { "schoolId": "alabama" }
   *     responses:
   *       200:
   *         description: Enrichment result with school and staff data
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/EnrichResponse'
   *       400:
   *         description: Bad request - missing parameters
   *       401:
   *         description: Unauthorized - invalid or missing API key
   *       429:
   *         description: Rate limit exceeded
   */
  app.post("/api/v1/enrich", validateApiKey, async (req: AuthenticatedRequest, res) => {
    try {
      const { domain, schoolName, schoolId } = req.body;

      if (!domain && !schoolName && !schoolId) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Provide at least one of: domain, schoolName, or schoolId",
        });
      }

      let matchedSchoolId: string | null = null;
      let matchedSchool: any = null;
      let matchScore: number = 1.0; // Default to perfect score for direct lookups
      let matchMethod: string = "exact";

      // Priority: schoolId > domain > schoolName
      if (schoolId) {
        matchedSchoolId = schoolId;
        matchedSchool = await storage.getSchoolDirectory(schoolId);
        matchMethod = "id_lookup";
      } else if (domain) {
        // Try to match by domain (extract from directoryUrl or ncaaUrl)
        const { directories: schools } = await storage.getSchoolDirectories();
        for (const school of schools) {
          const urlToCheck = school.directoryUrl || school.ncaaUrl || "";
          if (urlToCheck.toLowerCase().includes(domain.toLowerCase())) {
            matchedSchoolId = school.schoolId;
            matchedSchool = school;
            matchMethod = "domain_match";
            break;
          }
        }
      } else if (schoolName) {
        // Use fuzzy matching
        const { directories: schools } = await storage.getSchoolDirectories();
        const fuzzysort = await import("fuzzysort");
        const results = fuzzysort.default.go(schoolName, schools, {
          key: "schoolName",
          threshold: -10000,
          limit: 1,
        });
        if (results.length > 0 && results[0].score > -5000) {
          matchedSchool = results[0].obj;
          matchedSchoolId = matchedSchool.schoolId;
          // Convert fuzzysort score to 0-1 scale (scores are negative, closer to 0 is better)
          matchScore = Math.min(1, Math.max(0, 1 + results[0].score / 1000));
          matchMethod = "fuzzy_match";
        }
      }

      if (!matchedSchoolId || !matchedSchool) {
        return res.json({
          match_found: false,
          query: { domain, schoolName, schoolId },
          confidence: "none",
          match_score: 0,
          school: null,
          staff_count: 0,
          staff: [],
        });
      }

      // Calculate confidence level
      let confidence: "high" | "medium" | "low";
      if (matchMethod === "id_lookup" || matchMethod === "domain_match") {
        confidence = "high";
        matchScore = 1.0;
      } else if (matchScore >= 0.8) {
        confidence = "high";
      } else if (matchScore >= 0.5) {
        confidence = "medium";
      } else {
        confidence = "low";
      }

      // Fetch staff for the matched school
      const staff = await storage.getStaffMembersBySchool(matchedSchoolId);

      res.json({
        match_found: true,
        confidence,
        match_score: Math.round(matchScore * 100) / 100,
        match_method: matchMethod,
        school: {
          id: matchedSchool.schoolId,
          name: matchedSchool.schoolName,
          full_name: matchedSchool.schoolFullName,
          division: matchedSchool.division,
          conference: matchedSchool.conference,
          directory_url: matchedSchool.directoryUrl,
          logo_url: matchedSchool.logoUrl,
        },
        staff_count: staff.length,
        staff: staff.map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title,
          email: s.email,
          phone: s.phone,
          department: s.department,
          office: s.office,
          linkedin_url: s.linkedinUrl,
          twitter_handle: s.twitterHandle,
          extracted_at: s.extractedAt,
        })),
      });
    } catch (error: any) {
      console.error("Enrich API error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  /**
   * @swagger
   * /match:
   *   post:
   *     summary: Bulk match company names to schools
   *     description: |
   *       Match up to 500 company/account names to NCAA schools in a single request.
   *       Returns confidence scores for each match.
   *       
   *       **Use Cases:**
   *       - ABM list enrichment in Clay
   *       - HubSpot list imports
   *       - Marketing Ops data hygiene
   *     tags: [Enrichment]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/MatchRequest'
   *           example:
   *             accounts: ["Alabama", "Ohio State", "Michigan", "Unknown Corp"]
   *     responses:
   *       200:
   *         description: Match results with confidence scores
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 total_accounts:
   *                   type: integer
   *                 matched_count:
   *                   type: integer
   *                 match_rate:
   *                   type: string
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       input:
   *                         type: string
   *                       matched:
   *                         type: boolean
   *                       school_id:
   *                         type: string
   *                       school_name:
   *                         type: string
   *                       confidence:
   *                         type: integer
   *       400:
   *         description: Bad request - invalid accounts array
   *       401:
   *         description: Unauthorized - invalid or missing API key
   *       429:
   *         description: Rate limit exceeded
   */
  app.post("/api/v1/match", validateApiKey, async (req: AuthenticatedRequest, res) => {
    try {
      const { accounts } = req.body;

      if (!Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Provide an array of account names in 'accounts' field",
        });
      }

      if (accounts.length > 500) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Maximum 500 accounts per request",
        });
      }

      const fuzzysort = await import("fuzzysort");
      const { directories: schools } = await storage.getSchoolDirectories();
      const searchIndex = schools.map((s: SchoolDirectory) => ({
        id: s.schoolId,
        name: s.schoolName,
        fullName: s.schoolFullName,
      }));

      const matches: Array<{
        input: string;
        matched: boolean;
        school_id: string | null;
        school_name: string | null;
        confidence: number;
      }> = [];

      for (const accountName of accounts) {
        const results = fuzzysort.default.go(accountName, searchIndex, {
          key: "name",
          threshold: -10000,
          limit: 1,
        });

        if (results.length > 0 && results[0].score > -5000) {
          const match = results[0].obj as { id: string; name: string; fullName: string };
          const confidence = Math.min(100, Math.max(0, 100 + results[0].score / 50));
          matches.push({
            input: accountName,
            matched: true,
            school_id: match.id,
            school_name: match.name,
            confidence: Math.round(confidence),
          });
        } else {
          matches.push({
            input: accountName,
            matched: false,
            school_id: null,
            school_name: null,
            confidence: 0,
          });
        }
      }

      const matchedCount = matches.filter((m) => m.matched).length;

      res.json({
        summary: {
          total: accounts.length,
          matched: matchedCount,
          unmatched: accounts.length - matchedCount,
          match_rate: Math.round((matchedCount / accounts.length) * 100),
        },
        matches,
      });
    } catch (error: any) {
      console.error("Match API error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // GET /api/v1/schools - List all schools (for bulk enrichment)
  app.get("/api/v1/schools", validateApiKey, async (req: AuthenticatedRequest, res) => {
    try {
      const { division, conference, status, limit = "100", offset = "0" } = req.query;

      const { directories: schools } = await storage.getSchoolDirectories();

      let filtered: SchoolDirectory[] = schools;

      if (division && typeof division === "string") {
        filtered = filtered.filter((s: SchoolDirectory) => s.division === division);
      }

      if (conference && typeof conference === "string") {
        filtered = filtered.filter((s: SchoolDirectory) => s.conference === conference);
      }

      if (status && typeof status === "string") {
        filtered = filtered.filter((s: SchoolDirectory) => s.status === status);
      }

      const limitNum = Math.min(500, parseInt(limit as string) || 100);
      const offsetNum = parseInt(offset as string) || 0;

      const paginated = filtered.slice(offsetNum, offsetNum + limitNum);

      res.json({
        total: filtered.length,
        limit: limitNum,
        offset: offsetNum,
        schools: paginated.map((s: SchoolDirectory) => ({
          id: s.schoolId,
          name: s.schoolName,
          full_name: s.schoolFullName,
          division: s.division,
          conference: s.conference,
          status: s.status,
          contacts_count: s.contactsCount,
          last_extracted_at: s.lastExtractedAt,
          directory_url: s.directoryUrl,
          logo_url: s.logoUrl,
        })),
      });
    } catch (error: any) {
      console.error("Schools API error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // GET /api/v1/staff - Search staff across all schools
  app.get("/api/v1/staff", validateApiKey, async (req: AuthenticatedRequest, res) => {
    try {
      const { query, school_id, limit = "100", offset = "0" } = req.query;

      const limitNum = Math.min(500, parseInt(limit as string) || 100);
      const offsetNum = parseInt(offset as string) || 0;

      if (!query && !school_id) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Provide either 'query' for search or 'school_id' for filtering",
        });
      }

      const { members, total } = await storage.getStaffMembers({
        search: query as string | undefined,
        schoolId: school_id as string | undefined,
        limit: limitNum,
        offset: offsetNum,
      });

      res.json({
        total,
        limit: limitNum,
        offset: offsetNum,
        staff: members.map((s: StaffMember) => ({
          id: s.id,
          name: s.name,
          title: s.title,
          email: s.email,
          phone: s.phone,
          department: s.department,
          office: s.office,
          school_id: s.schoolId,
          linkedin_url: s.linkedinUrl,
          twitter_handle: s.twitterHandle,
          extracted_at: s.extractedAt,
        })),
      });
    } catch (error: any) {
      console.error("Staff API error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // GET /api/v1/schools/:id/staff - Staff list for a specific school (unmasked)
  app.get("/api/v1/schools/:id/staff", validateApiKey, async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.params.id;
      const { limit = "200", offset = "0" } = req.query;
      const limitNum = Math.min(500, parseInt(limit as string) || 200);
      const offsetNum = parseInt(offset as string) || 0;

      const { members, total } = await storage.getStaffMembers({ schoolId, limit: limitNum, offset: offsetNum });

      res.json({
        school_id: schoolId,
        total,
        limit: limitNum,
        offset: offsetNum,
        staff: members.map((s: StaffMember) => ({
          id: s.id,
          name: s.name,
          title: s.title,
          email: s.email,
          phone: s.phone,
          department: s.department,
          office: s.office,
          linkedin_url: s.linkedinUrl,
          twitter_handle: s.twitterHandle,
          last_scraped_at: (s as any).lastScrapedAt,
          extracted_at: s.extractedAt,
        })),
      });
    } catch (error: any) {
      console.error("v1/schools/:id/staff error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // POST /api/v1/schools/:id/refresh - Queue a scrape job for a school
  app.post("/api/v1/schools/:id/refresh", validateApiKey, async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.params.id;
      const schools = await db.select().from(schoolDirectories).where(eq(schoolDirectories.schoolId, schoolId)).limit(1);
      if (!schools.length) {
        return res.status(404).json({ error: "School not found", school_id: schoolId });
      }
      const school = schools[0];
      const job = await storage.createExtractionJob({
        type: "single",
        targetId: schoolId,
        status: "pending",
        totalSchools: 1,
        processedSchools: 0,
        contactsFound: 0,
        logs: [`API refresh queued for ${school.schoolName}`],
      });
      queueJob(job.id);
      res.json({
        message: "Refresh queued",
        school_id: schoolId,
        school_name: school.schoolName,
        job_id: job.id,
        queued_at: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("v1/schools/:id/refresh error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // GET /api/v1/signals - Intent signals feed
  app.get("/api/v1/signals", validateApiKey, async (req: AuthenticatedRequest, res) => {
    try {
      const { school_id, type, since, limit = "50", offset = "0" } = req.query;
      const limitNum = Math.min(500, parseInt(limit as string) || 50);
      const offsetNum = parseInt(offset as string) || 0;

      const conditions: any[] = [
        sql`${signals.type} <> 'network_connection'`,
      ];
      if (school_id) conditions.push(eq(signals.schoolId, school_id as string));
      if (type) conditions.push(eq(signals.type, type as string));
      if (since) conditions.push(sql`${signals.detectedAt} >= ${new Date(since as string)}`);

      const rows = await db
        .select()
        .from(signals)
        .where(and(...conditions))
        .orderBy(desc(signals.detectedAt))
        .limit(limitNum)
        .offset(offsetNum);

      res.json({
        total: rows.length,
        limit: limitNum,
        offset: offsetNum,
        signals: rows.map((s) => ({
          id: s.id,
          type: s.type,
          school_id: s.schoolId,
          staff_id: s.staffId,
          description: s.description,
          metadata: s.metadata,
          detected_at: s.detectedAt,
          is_actioned: s.isActioned,
        })),
      });
    } catch (error: any) {
      console.error("v1/signals error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // ============================================================================
  // API KEY MANAGEMENT (Protected - requires admin scope or ADMIN_SECRET for bootstrap)
  // ============================================================================

  // Middleware to check for admin access
  // Accepts either X-Admin-Secret header (constant-time comparison) or Bearer API key with admin scope
  async function requireAdminAccess(req: AuthenticatedRequest, res: any, next: any) {
    const adminSecret = process.env.ADMIN_SECRET;
    const providedSecret = req.headers["x-admin-secret"] as string;

    if (adminSecret && providedSecret) {
      try {
        const secretBuffer = Buffer.from(adminSecret);
        const providedBuffer = Buffer.from(providedSecret);
        if (secretBuffer.length === providedBuffer.length &&
            crypto.timingSafeEqual(secretBuffer, providedBuffer)) {
          return next();
        }
      } catch {
      }
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid X-Admin-Secret header.",
      });
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      await validateApiKey(req, res, () => {
        const scopes = req.apiKeyScopes || [];
        if (!scopes.includes("admin") && !scopes.includes("*")) {
          return res.status(403).json({
            error: "Forbidden",
            message: "Admin scope required for this operation",
          });
        }
        next();
      });
      return;
    }

    return res.status(401).json({
      error: "Unauthorized",
      message: "Admin access required. Use 'X-Admin-Secret' header or 'Authorization: Bearer sk_live_...'",
    });
  }

  // Apply strict rate limiting to admin endpoints
  app.use("/api/keys", strictLimiter);
  app.use("/api/webhooks", strictLimiter);

  // POST /api/admin/nil-seed — one-shot NIL collective seeding
  app.post("/api/admin/nil-seed", requireAdminAccess, async (_req, res) => {
    try {
      const { scrapeNilCollectives } = await import("./lib/nil-scraper");
      const count = await scrapeNilCollectives();
      res.json({ message: `NIL seeding complete`, newCollectives: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/news-monitor/:schoolId — manual news monitor for one school
  app.post("/api/admin/news-monitor/:schoolId", requireAdminAccess, async (req, res) => {
    try {
      const { monitorNewsForSchool } = await import("./lib/news-monitor");
      const school = await db.select({ schoolName: schoolDirectories.schoolName })
        .from(schoolDirectories).where(eq(schoolDirectories.schoolId, req.params.schoolId)).limit(1);
      if (!school.length) return res.status(404).json({ error: "School not found" });
      const count = await monitorNewsForSchool(req.params.schoolId, school[0].schoolName);
      res.json({ message: `News monitor complete`, signalsCreated: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/job-boards — manual job board scrape trigger
  app.post("/api/admin/job-boards", requireAdminAccess, async (_req, res) => {
    try {
      const { scrapeJobBoards } = await import("./lib/job-board-scraper");
      const count = await scrapeJobBoards();
      res.json({ message: `Job board scrape complete`, newPostings: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/keys - Generate a new API key
  app.post("/api/keys", requireAdminAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { label, scopes } = req.body;

      const { key, prefix, hashedKey } = generateApiKey();

      // First key gets admin scope automatically for bootstrap
      const existingKeys = await db.select({ id: apiKeys.id }).from(apiKeys).limit(1);
      const finalScopes = existingKeys.length === 0 
        ? ["admin", "read:staff", "read:schools"]
        : scopes || ["read:staff", "read:schools"];

      await db.insert(apiKeys).values({
        keyPrefix: prefix,
        hashedKey,
        label: label || "API Key",
        scopes: finalScopes,
      });

      res.json({
        message: "API key created successfully",
        key, // Return the full key only once - user must save it
        prefix,
        label: label || "API Key",
        scopes: finalScopes,
        warning: "Save this key now. You won't be able to see it again.",
      });
    } catch (error: any) {
      console.error("Create API key error:", error);
      res.status(500).json({ error: error.message || "Failed to create API key" });
    }
  });

  // GET /api/keys - List API keys (without the actual keys)
  app.get("/api/keys", requireAdminAccess, async (_req, res) => {
    try {
      const keys = await db.select({
        id: apiKeys.id,
        prefix: apiKeys.keyPrefix,
        label: apiKeys.label,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      }).from(apiKeys);

      res.json({ keys });
    } catch (error: any) {
      console.error("List API keys error:", error);
      res.status(500).json({ error: error.message || "Failed to list API keys" });
    }
  });

  // DELETE /api/keys/:id - Revoke an API key
  app.delete("/api/keys/:id", requireAdminAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(apiKeys).where(eq(apiKeys.id, id));
      res.json({ message: "API key revoked" });
    } catch (error: any) {
      console.error("Delete API key error:", error);
      res.status(500).json({ error: error.message || "Failed to revoke API key" });
    }
  });

  // ============================================================================
  // WEBHOOK MANAGEMENT (Protected - requires admin scope)
  // ============================================================================

  // POST /api/webhooks - Create a webhook subscription
  app.post("/api/webhooks", requireAdminAccess, async (req, res) => {
    try {
      const { url, eventTypes, description } = req.body;

      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      const secret = generateWebhookSecret();

      const [webhook] = await db.insert(webhookSubscriptions).values({
        url,
        eventTypes: eventTypes || ["staff.new_hire"],
        description: description || null,
        secret,
        isActive: true,
      }).returning();

      res.json({
        message: "Webhook subscription created",
        webhook: {
          id: webhook.id,
          url: webhook.url,
          eventTypes: webhook.eventTypes,
          description: webhook.description,
          isActive: webhook.isActive,
        },
        secret, // Return secret only once
        warning: "Save this secret now. You'll need it to verify webhook signatures.",
      });
    } catch (error: any) {
      console.error("Create webhook error:", error);
      res.status(500).json({ error: error.message || "Failed to create webhook" });
    }
  });

  // GET /api/webhooks - List webhook subscriptions
  app.get("/api/webhooks", requireAdminAccess, async (_req, res) => {
    try {
      const webhooks = await db.select({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        eventTypes: webhookSubscriptions.eventTypes,
        description: webhookSubscriptions.description,
        isActive: webhookSubscriptions.isActive,
        lastTriggeredAt: webhookSubscriptions.lastTriggeredAt,
        failureCount: webhookSubscriptions.failureCount,
        createdAt: webhookSubscriptions.createdAt,
      }).from(webhookSubscriptions);

      res.json({ webhooks });
    } catch (error: any) {
      console.error("List webhooks error:", error);
      res.status(500).json({ error: error.message || "Failed to list webhooks" });
    }
  });

  // DELETE /api/webhooks/:id - Delete a webhook subscription
  app.delete("/api/webhooks/:id", requireAdminAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
      res.json({ message: "Webhook subscription deleted" });
    } catch (error: any) {
      console.error("Delete webhook error:", error);
      res.status(500).json({ error: error.message || "Failed to delete webhook" });
    }
  });

  // PATCH /api/webhooks/:id - Toggle webhook active status
  app.patch("/api/webhooks/:id", requireAdminAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isActive } = req.body;

      await db.update(webhookSubscriptions)
        .set({ isActive: isActive ?? true })
        .where(eq(webhookSubscriptions.id, id));

      res.json({ message: "Webhook subscription updated" });
    } catch (error: any) {
      console.error("Update webhook error:", error);
      res.status(500).json({ error: error.message || "Failed to update webhook" });
    }
  });

  // POST /api/webhooks/test - Send a test webhook event
  app.post("/api/webhooks/test", requireAdminAccess, async (req, res) => {
    try {
      const { webhookId, eventType } = req.body;

      if (!webhookId) {
        return res.status(400).json({ error: "webhookId is required" });
      }

      // Get the webhook subscription
      const [webhook] = await db.select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.id, webhookId));

      if (!webhook) {
        return res.status(404).json({ error: "Webhook subscription not found" });
      }

      // Create a test payload
      const testPayload = {
        event: eventType || "test.ping",
        timestamp: new Date().toISOString(),
        data: {
          message: "This is a test webhook delivery",
          school_id: "test-school",
          school_name: "Test University",
          staff: {
            name: "John Doe",
            title: "Athletic Director",
            email: "john.doe@test.edu",
          },
        },
      };

      // Create HMAC signature
      const crypto = await import("crypto");
      const signature = crypto.createHmac("sha256", webhook.secret)
        .update(JSON.stringify(testPayload))
        .digest("hex");

      // Attempt delivery
      const startTime = Date.now();
      let responseStatus = 0;
      let responseBody = "";
      let success = false;

      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": `sha256=${signature}`,
            "X-Webhook-Event": testPayload.event,
            "X-Webhook-ID": `test-${Date.now()}`,
          },
          body: JSON.stringify(testPayload),
        });

        responseStatus = response.status;
        responseBody = await response.text().catch(() => "");
        success = response.ok;
      } catch (err: any) {
        responseBody = err.message || "Connection failed";
      }

      const duration = Date.now() - startTime;

      // Log the delivery attempt
      await db.insert(webhookDeliveryLogs).values({
        subscriptionId: webhook.id,
        eventType: testPayload.event,
        payload: testPayload,
        responseStatus,
        responseBody: responseBody.slice(0, 1000),
        success,
      });

      res.json({
        success,
        webhook_url: webhook.url,
        event_type: testPayload.event,
        response_status: responseStatus,
        response_time_ms: duration,
        message: success
          ? "Test webhook delivered successfully!"
          : `Delivery failed: ${responseBody}`,
        signature_header: `X-Webhook-Signature: sha256=${signature}`,
        tip: "Use this signature to verify your webhook handler is working correctly.",
      });
    } catch (error: any) {
      console.error("Test webhook error:", error);
      res.status(500).json({ error: error.message || "Failed to send test webhook" });
    }
  });

  // ============================================================================
  // SIGNALS & WARM PATHS ENDPOINTS (ABM 2.0 Signal Engine)
  // ============================================================================

  app.get("/api/signals", async (req, res) => {
    try {
      // Reject unauthenticated callers — `network_connection` rows are scoped
      // per-user and there is no public signal feed.
      const callerUserId = req.session?.userId;
      if (!callerUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const type = req.query.type as string | undefined;
      const { getRecentSignals } = await import("./lib/graph-engine");
      // Network signals are per-user; pass session userId so DB query
      // filters before applying LIMIT (no truncation across tenants).
      let signals = await getRecentSignals(limit, callerUserId);

      if (type) {
        signals = signals.filter(s => s.type === type);
      }

      res.json({ signals });
    } catch (error: any) {
      console.error("Get signals error:", error);
      res.status(500).json({ error: error.message || "Failed to get signals" });
    }
  });

  app.post("/api/signals/:id/action", attachUser, requirePlan("team"), async (req: UserRequest, res) => {
    try {
      const callerUserId = req.session?.userId;
      if (!callerUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const signalId = parseInt(req.params.id);
      if (isNaN(signalId) || signalId <= 0) {
        return res.status(400).json({ error: "Invalid signal ID" });
      }
      const { markSignalActioned } = await import("./lib/graph-engine");
      const ok = await markSignalActioned(signalId, callerUserId);
      if (!ok) {
        return res.status(403).json({ error: "Signal not found or not owned by caller" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Mark signal actioned error:", error);
      res.status(500).json({ error: error.message || "Failed to mark signal actioned" });
    }
  });

  app.post("/api/signals/warm-paths", attachUser, requirePlan("team"), async (req: UserRequest, res) => {
    try {
      const { targetSchoolId, customerSchoolIds } = req.body;
      
      if (!targetSchoolId || !customerSchoolIds || !Array.isArray(customerSchoolIds)) {
        return res.status(400).json({ error: "targetSchoolId and customerSchoolIds array required" });
      }
      
      const { findWarmPaths } = await import("./lib/graph-engine");
      const warmPaths = await findWarmPaths(targetSchoolId, customerSchoolIds);
      
      res.json({ warmPaths });
    } catch (error: any) {
      console.error("Find warm paths error:", error);
      res.status(500).json({ error: error.message || "Failed to find warm paths" });
    }
  });

  app.post("/api/ai/signal-email", async (req, res) => {
    try {
      const { signal, recipientName, recipientEmail } = req.body;
      
      if (!signal || !recipientName) {
        return res.status(400).json({ error: "signal and recipientName required" });
      }
      
      // Build context from signal
      let context = "";
      const meta = signal.metadata || {};
      
      switch (signal.type) {
        case 'new_hire':
          context = `You saw that ${recipientName} recently joined ${meta.newSchoolName || 'their new organization'}${meta.oldSchoolName ? ` from ${meta.oldSchoolName}` : ''}. Congratulate them on the new role.`;
          break;
        case 'warm_path':
          context = `${recipientName} previously worked at ${meta.oldSchoolName} where they may have used your product. They are now at ${meta.newSchoolName}. Reference their background to build rapport.`;
          break;
        case 'tech_drop':
          context = `${meta.newSchoolName} recently changed their technology stack${meta.techDropped?.length ? `, dropping ${meta.techDropped.join(', ')}` : ''}. They may be evaluating alternatives.`;
          break;
        case 'tech_add':
          context = `${meta.newSchoolName} recently adopted new technology${meta.techAdded?.length ? `: ${meta.techAdded.join(', ')}` : ''}. They are modernizing their operations.`;
          break;
        case 'departure':
          context = `There have been recent staff changes at ${meta.oldSchoolName}. New decision makers may be looking to make changes.`;
          break;
        default:
          context = signal.description || "Reach out based on recent activity.";
      }
      
      const recipient = {
        name: recipientName,
        title: meta.staffTitle || "Athletic Staff",
        email: recipientEmail || "contact@example.com",
      };
      
      const result = await generateEmailDraft(recipient, context);
      res.json(result);
    } catch (error: any) {
      console.error("Generate signal email error:", error);
      res.status(500).json({ error: error.message || "Failed to generate email" });
    }
  });

  // ============================================================================
  // CONFERENCES ENDPOINT
  // ============================================================================
  
  app.get("/api/conferences", async (_req, res) => {
    try {
      res.json({ conferences: ncaaConferences });
    } catch (error: any) {
      console.error("Get conferences error:", error);
      res.status(500).json({ error: error.message || "Failed to get conferences" });
    }
  });

  const httpServer = createServer(app);
  
  initWebSocket(httpServer);

  return httpServer;
}

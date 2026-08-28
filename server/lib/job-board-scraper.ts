/**
 * Job Board Scraper — NCAA Market + TeamWork Online
 *
 * Scrapes publicly listed athletic department job postings, stores them in
 * job_postings table, and fires a 'job_posting' signal so subscribers are alerted.
 *
 * Called by the cron job every 6 hours.
 */
import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { db } from "../db";
import { jobPostings, signals, schoolDirectories } from "@shared/schema";
import { eq } from "drizzle-orm";
import { dispatchSignalAlerts } from "./alert-subscriptions";

let genAI: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!genAI) genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return genAI;
}

interface JobListing {
  title: string;
  organization: string;
  url: string;
  postedAt?: string;
  department?: string;
}

async function extractJobsWithGemini(html: string, sourceBoard: string): Promise<JobListing[]> {
  const ai = getGenAI();
  if (!ai) return [];

  const truncated = html.substring(0, 8000);
  const prompt = `Extract all job listings from this HTML from ${sourceBoard}.

Return a JSON array of objects:
[{"title":"job title","organization":"school or org name","url":"application URL if found or empty string","postedAt":"date string if available or null","department":"department name if available or null"}]

Return ONLY the JSON array. No markdown. No explanation. If no jobs found, return [].

HTML:
${truncated}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    const text = (response.text ?? "").trim().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function scrapeWithPlaywright(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    return await page.content();
  } catch (err) {
    console.error(`[JobBoardScraper] Failed to scrape ${url}:`, err);
    return "";
  } finally {
    await browser.close();
  }
}

async function resolveSchoolId(organizationName: string): Promise<string | null> {
  if (!organizationName) return null;
  const nameLower = organizationName.toLowerCase();
  const schools = await db
    .select({ schoolId: schoolDirectories.schoolId, schoolName: schoolDirectories.schoolName })
    .from(schoolDirectories)
    .limit(500);

  const match = schools.find((s) =>
    s.schoolName?.toLowerCase().includes(nameLower) ||
    nameLower.includes(s.schoolName?.toLowerCase() ?? "---"),
  );
  return match?.schoolId ?? null;
}

async function processJobListings(listings: JobListing[], sourceBoard: string): Promise<number> {
  let newCount = 0;
  for (const listing of listings) {
    if (!listing.title || !listing.organization) continue;

    const postingUrl = listing.url || `https://whistle-scraped-${sourceBoard}-${Date.now()}`;

    // Check if already stored (unique constraint on posting_url)
    const existing = await db
      .select({ id: jobPostings.id })
      .from(jobPostings)
      .where(eq(jobPostings.postingUrl, postingUrl))
      .limit(1);
    if (existing.length) continue;

    const schoolId = await resolveSchoolId(listing.organization);

    await db.insert(jobPostings).values({
      schoolId,
      schoolName: listing.organization,
      jobTitle: listing.title,
      department: listing.department ?? null,
      postingUrl,
      sourceBoard,
      postedAt: listing.postedAt ? new Date(listing.postedAt) : null,
    });

    const description = `New job posting at ${listing.organization}: ${listing.title}`;

    // Insert a signal
    await db.insert(signals).values({
      schoolId,
      type: "job_posting",
      description,
      metadata: {
        jobTitle: listing.title,
        schoolName: listing.organization,
        postingUrl,
        sourceBoard,
      },
    });

    if (schoolId) {
      dispatchSignalAlerts({
        type: "job_posting",
        description,
        schoolId,
        metadata: { jobTitle: listing.title, sourceBoard },
      }).catch(() => {});
    }

    newCount++;
  }
  return newCount;
}

const SOURCES = [
  {
    name: "ncaa_market",
    url: "https://ncaamarket.ncaa.org/jobs",
  },
  {
    name: "teamwork_online",
    url: "https://www.teamworkonline.com/college-sports-jobs",
  },
];

export async function scrapeJobBoards(): Promise<number> {
  let total = 0;
  for (const source of SOURCES) {
    try {
      console.log(`[JobBoardScraper] Scraping ${source.name}`);
      const html = await scrapeWithPlaywright(source.url);
      if (!html) continue;
      const listings = await extractJobsWithGemini(html, source.name);
      const count = await processJobListings(listings, source.name);
      console.log(`[JobBoardScraper] ${source.name}: ${count} new postings`);
      total += count;
    } catch (err) {
      console.error(`[JobBoardScraper] Error for ${source.name}:`, err);
    }
  }
  return total;
}

/**
 * NIL Collective Scraper
 *
 * Seeds nilCollectives from publicly available NIL collective directories.
 * Sources: On3 NIL collective rankings, publicly known collective sites.
 *
 * Run manually via: npx tsx server/lib/nil-scraper.ts
 * Or exposed as an admin endpoint for one-time seeding.
 */
import { chromium } from "playwright";
import { GoogleGenAI, Type } from "@google/genai";
import { db } from "../db";
import { nilCollectives, schoolDirectories } from "@shared/schema";
import { eq } from "drizzle-orm";
import { htmlToTextForAI } from "./html-to-text";

let genAI: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!genAI) genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return genAI;
}

interface CollectiveRecord {
  name: string;
  school: string;
  website?: string;
  structure?: string;
  estimatedBudget?: string;
}

async function extractCollectivesFromHtml(html: string): Promise<CollectiveRecord[]> {
  const ai = getGenAI();
  if (!ai) return [];

  // Stripped text, not raw HTML — see htmlToTextForAI for why.
  const pageText = htmlToTextForAI(html);
  const prompt = `Extract NIL collective information from this page text.
Links appear inline as "text (url)". Return every collective found; an empty
list if there are none.

PAGE TEXT:
${pageText}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            collectives: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  school: { type: Type.STRING },
                  website: { type: Type.STRING },
                  structure: { type: Type.STRING, enum: ["nonprofit", "llc", "unknown"] },
                  estimatedBudget: { type: Type.STRING },
                },
                required: ["name", "school"],
              },
            },
          },
          required: ["collectives"],
        },
      },
    });
    const parsed = JSON.parse(response.text ?? "");
    return Array.isArray(parsed?.collectives) ? parsed.collectives : [];
  } catch (err) {
    console.error("[NilScraper] Gemini extraction failed:", err);
    return [];
  }
}

async function resolveSchoolId(schoolName: string): Promise<string | null> {
  const nameLower = schoolName.toLowerCase();
  const schools = await db
    .select({ schoolId: schoolDirectories.schoolId, schoolName: schoolDirectories.schoolName })
    .from(schoolDirectories)
    .limit(500);
  const match = schools.find(
    (s) =>
      s.schoolName?.toLowerCase().includes(nameLower) ||
      nameLower.includes(s.schoolName?.toLowerCase() ?? "---"),
  );
  return match?.schoolId ?? null;
}

const SOURCES = [
  "https://www.on3.com/nil/collectives/rankings/",
  "https://www.on3.com/nil/collectives/",
];

export async function scrapeNilCollectives(): Promise<number> {
  const browser = await chromium.launch({ headless: true });
  let total = 0;

  try {
    for (const url of SOURCES) {
      try {
        console.log(`[NILScraper] Scraping ${url}`);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
        const html = await page.content();
        await page.close();

        const collectives = await extractCollectivesFromHtml(html);
        for (const c of collectives) {
          if (!c.name || !c.school) continue;
          const schoolId = await resolveSchoolId(c.school);

          // Upsert by name (avoid duplicates on re-run)
          const existing = await db
            .select({ id: nilCollectives.id })
            .from(nilCollectives)
            .where(eq(nilCollectives.name, c.name))
            .limit(1);

          if (existing.length) {
            await db
              .update(nilCollectives)
              .set({
                website: c.website ?? null,
                structure: c.structure ?? null,
                estimatedBudget: c.estimatedBudget ?? null,
                updatedAt: new Date(),
              })
              .where(eq(nilCollectives.id, existing[0].id));
          } else {
            await db.insert(nilCollectives).values({
              schoolId,
              name: c.name,
              website: c.website ?? null,
              structure: c.structure ?? null,
              estimatedBudget: c.estimatedBudget ?? null,
            });
            total++;
          }
        }
        console.log(`[NILScraper] ${url}: processed ${collectives.length} collectives`);
      } catch (err) {
        console.error(`[NILScraper] Error for ${url}:`, err);
      }
    }
  } finally {
    await browser.close();
  }

  return total;
}

// Allow running directly: npx tsx server/lib/nil-scraper.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeNilCollectives()
    .then((n) => { console.log(`[NILScraper] Done — ${n} new collectives`); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}

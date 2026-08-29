/**
 * News Monitor — Gemini-powered Google News RSS signal detection.
 *
 * Fetches Google News RSS for each school and asks Gemini 2.5 Flash
 * whether any article describes a staff change. If yes, creates a signal.
 *
 * Signals created this way carry metadata.source = 'news_monitor' so they
 * can be distinguished from scrape-detected signals in the UI.
 */
import RSSParser from "rss-parser";
import { GoogleGenAI, Type } from "@google/genai";
import { db } from "../db";
import { staffMembers, signals } from "@shared/schema";
import { eq, and, gte } from "drizzle-orm";
import { dispatchSignalAlerts } from "./alert-subscriptions";

const parser = new RSSParser();

let genAI: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!genAI) genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return genAI;
}

interface NewsSignal {
  change_type: "new_hire" | "departure" | "title_change" | "job_posting";
  person_name: string | null;
  old_role: string | null;
  new_role: string | null;
  school_name: string | null;
}

async function classifyArticleWithGemini(title: string, snippet: string): Promise<NewsSignal | null> {
  const ai = getGenAI();
  if (!ai) return null;

  const prompt = `You are analyzing news headlines and snippets about college athletics.

Does this article report a staff change at a college athletic department?

Title: ${title}
Snippet: ${snippet}

Set is_staff_change to false if no staff change is reported. If one is,
set is_staff_change to true and fill in the change details (omit any field
you cannot determine).`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: prompt,
      config: {
        // Structured output: "no match" is a typed field, not a magic string,
        // so a malformed reply can't be confused with a genuine no-result.
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            is_staff_change: { type: Type.BOOLEAN },
            change_type: { type: Type.STRING, enum: ["new_hire", "departure", "title_change", "job_posting"] },
            person_name: { type: Type.STRING },
            old_role: { type: Type.STRING },
            new_role: { type: Type.STRING },
            school_name: { type: Type.STRING },
          },
          required: ["is_staff_change"],
        },
      },
    });
    const parsed = JSON.parse(response.text ?? "");
    if (!parsed?.is_staff_change || !parsed.change_type) return null;
    return {
      change_type: parsed.change_type,
      person_name: parsed.person_name ?? null,
      old_role: parsed.old_role ?? null,
      new_role: parsed.new_role ?? null,
      school_name: parsed.school_name ?? null,
    } as NewsSignal;
  } catch (err) {
    console.error("[NewsMonitor] Gemini classification failed:", err);
    return null;
  }
}


/**
 * Monitor Google News for a single school. Returns the number of signals created.
 */
export async function monitorNewsForSchool(schoolId: string, schoolName: string): Promise<number> {
  const ai = getGenAI();
  if (!ai) return 0;

  const query = encodeURIComponent(`"${schoolName}" athletics`);
  const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  let feed: RSSParser.Output<RSSParser.Item>;
  try {
    feed = await parser.parseURL(rssUrl);
  } catch (err) {
    console.error(`[NewsMonitor] RSS fetch failed for ${schoolName}:`, err);
    return 0;
  }

  // Only look at articles from the past 48 hours
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentItems = (feed.items ?? []).filter((item) => {
    const pub = item.pubDate ? new Date(item.pubDate) : null;
    return pub && pub > cutoff;
  });

  let created = 0;
  for (const item of recentItems.slice(0, 10)) {
    const title = item.title ?? "";
    const snippet = item.contentSnippet ?? item.content ?? "";

    const signal = await classifyArticleWithGemini(title, snippet);
    if (!signal) continue;

    // Skip if a signal of this type fired for this school within the last
    // 6 hours (avoids duplicating scrape-detected vs news-detected signals
    // for the same event). The window matters: without it, one historical
    // signal would silence this school+type forever.
    const dedupeCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentSignal = await db
      .select({ id: signals.id })
      .from(signals)
      .where(
        and(
          eq(signals.schoolId, schoolId),
          eq(signals.type, signal.change_type),
          gte(signals.detectedAt, dedupeCutoff),
        ),
      )
      .limit(1);

    if (recentSignal.length > 0) continue;

    // Try to match person to existing staff member
    let staffId: number | null = null;
    if (signal.person_name) {
      const nameLower = signal.person_name.toLowerCase();
      const staff = await db
        .select({ id: staffMembers.id, name: staffMembers.name })
        .from(staffMembers)
        .where(eq(staffMembers.schoolId, schoolId))
        .limit(100);

      const match = staff.find(
        (s) => s.name?.toLowerCase().includes(nameLower) || nameLower.includes(s.name?.toLowerCase() ?? "---"),
      );
      if (match) staffId = match.id;
    }

    const description = buildDescription(signal, schoolName);

    await db.insert(signals).values({
      schoolId,
      staffId,
      type: signal.change_type,
      description,
      metadata: {
        staffName: signal.person_name ?? undefined,
        oldTitle: signal.old_role ?? undefined,
        newTitle: signal.new_role ?? undefined,
        source: "news_monitor",
        articleTitle: title,
        articleUrl: item.link ?? undefined,
      },
    });

    dispatchSignalAlerts({
      type: signal.change_type,
      description,
      schoolId,
      staffId,
      metadata: { staffName: signal.person_name ?? undefined, source: "news_monitor" },
    }).catch(() => {});

    created++;
  }

  return created;
}

function buildDescription(signal: NewsSignal, schoolName: string): string {
  const name = signal.person_name ?? "Unknown";
  switch (signal.change_type) {
    case "new_hire":
      return `New hire at ${schoolName}: ${name}${signal.new_role ? ` as ${signal.new_role}` : ""} (via news)`;
    case "departure":
      return `Departure at ${schoolName}: ${name}${signal.old_role ? `, former ${signal.old_role}` : ""} (via news)`;
    case "title_change":
      return `Title change at ${schoolName}: ${name}${signal.old_role && signal.new_role ? ` — ${signal.old_role} → ${signal.new_role}` : ""} (via news)`;
    case "job_posting":
      return `Job posting at ${schoolName}: ${signal.new_role ?? "Open position"} (via news)`;
    default:
      return `Staff update at ${schoolName}: ${name} (via news)`;
  }
}

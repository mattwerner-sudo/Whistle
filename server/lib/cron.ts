/**
 * Whistle background cron jobs.
 * Three jobs:
 *   1. Stale school re-scrape — nightly 2am, queues up to 30 schools
 *   2. Daily alert digest     — 8am, sends digest emails for frequency='daily' subs
 *   3. Job board scrape       — every 6 hours, pulls NCAA Market + TeamWork Online
 *
 * Started once by server/index.ts at boot. Safe to call initCron() multiple times
 * (guards against double-registration).
 */
import cron from "node-cron";
import { db } from "../db";
import { schoolDirectories, alertSubscriptions, signals, users } from "@shared/schema";
import { lt, or, isNull, eq, and, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { queueJob } from "./job-queue";
import { sendMail } from "./mailer";
import { scrapeJobBoards } from "./job-board-scraper";
import { monitorNewsForSchool } from "./news-monitor";

let initialized = false;

export function initCron(): void {
  if (initialized) return;
  initialized = true;

  // ── 1. Stale school re-scrape ─────────────────────────────────────────────
  // Nightly at 2:00 AM. Schools not scraped in 90+ days (or never) get queued.
  cron.schedule("0 2 * * *", async () => {
    console.log("[Cron] Stale school re-scrape starting");
    try {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const staleSchools = await db
        .select({ schoolId: schoolDirectories.schoolId, schoolName: schoolDirectories.schoolName })
        .from(schoolDirectories)
        .where(
          or(
            isNull(schoolDirectories.lastExtractedAt),
            lt(schoolDirectories.lastExtractedAt, cutoff),
          ),
        )
        .limit(30);

      for (const school of staleSchools) {
        try {
          const job = await storage.createExtractionJob({
            type: "single",
            targetId: school.schoolId,
            status: "pending",
            totalSchools: 1,
            processedSchools: 0,
            contactsFound: 0,
            logs: [`[Cron] Stale re-scrape for ${school.schoolName}`],
          });
          queueJob(job.id);
        } catch (err) {
          console.error(`[Cron] Failed to queue ${school.schoolName}:`, err);
        }
      }
      console.log(`[Cron] Queued ${staleSchools.length} stale schools`);
    } catch (err) {
      console.error("[Cron] Stale re-scrape error:", err);
    }
  });

  // ── 2. Daily alert digest ─────────────────────────────────────────────────
  // 8:00 AM daily. Aggregates yesterday's signals for 'daily' subscribers.
  cron.schedule("0 8 * * *", async () => {
    console.log("[Cron] Daily alert digest starting");
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const subs = await db
        .select()
        .from(alertSubscriptions)
        .where(eq(alertSubscriptions.frequency, "daily"));

      for (const sub of subs) {
        try {
          const conditions: any[] = [gte(signals.detectedAt, yesterday)];
          if (sub.schoolId) conditions.push(eq(signals.schoolId, sub.schoolId));

          const types = sub.signalTypes as string[];
          const matchingSignals = await db
            .select()
            .from(signals)
            .where(and(...conditions))
            .limit(20);

          const filtered = types.length
            ? matchingSignals.filter((s) => types.includes(s.type))
            : matchingSignals;

          if (!filtered.length) continue;

          const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, sub.userId)).limit(1);
          if (!user?.email) continue;

          const appUrl = process.env.APP_URL ?? "http://localhost:5000";
          const lines = filtered.map((s) => `• [${s.type.replace("_", " ")}] ${s.description}`);
          const body = [
            `Your daily Whistle digest — ${filtered.length} signal${filtered.length === 1 ? "" : "s"} from the past 24 hours:`,
            "",
            ...lines,
            "",
            `View all signals: ${appUrl}/signals`,
            "",
            "— Whistle Intelligence",
            `Manage alerts: ${appUrl}/settings/alerts`,
          ].join("\n");

          sendMail({
            to: user.email,
            subject: `Whistle Daily Digest: ${filtered.length} new signal${filtered.length === 1 ? "" : "s"}`,
            text: body,
          }).catch((err) => console.error("[Cron] Digest email failed:", err));
        } catch (err) {
          console.error(`[Cron] Digest failed for sub ${sub.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[Cron] Daily digest error:", err);
    }
  });

  // ── 3. Job board scrape ───────────────────────────────────────────────────
  // Every 6 hours. Checks NCAA Market + TeamWork Online for new job postings.
  cron.schedule("0 */6 * * *", async () => {
    console.log("[Cron] Job board scrape starting");
    try {
      const count = await scrapeJobBoards();
      console.log(`[Cron] Job board scrape complete — ${count} new postings`);
    } catch (err) {
      console.error("[Cron] Job board scrape error:", err);
    }
  });

  // ── 4. News monitor ───────────────────────────────────────────────────────
  // Nightly at 3:00 AM. Monitors Google News for staff change mentions.
  // Only runs for high-priority schools (Power 4 / large conferences) to stay
  // within Gemini API rate limits.
  cron.schedule("0 3 * * *", async () => {
    console.log("[Cron] News monitor starting");
    try {
      const prioritySchools = await db
        .select({ schoolId: schoolDirectories.schoolId, schoolName: schoolDirectories.schoolName })
        .from(schoolDirectories)
        .where(sql`${schoolDirectories.priorityScore} > 50`)
        .limit(50);

      let signalCount = 0;
      for (const school of prioritySchools) {
        try {
          const found = await monitorNewsForSchool(school.schoolId, school.schoolName);
          signalCount += found;
          // Brief pause between schools to respect rate limits
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(`[Cron] News monitor failed for ${school.schoolName}:`, err);
        }
      }
      console.log(`[Cron] News monitor complete — ${signalCount} signals created`);
    } catch (err) {
      console.error("[Cron] News monitor error:", err);
    }
  });

  console.log("[Cron] All jobs registered (stale-scrape 2am, digest 8am, job-boards every 6h, news 3am)");
}

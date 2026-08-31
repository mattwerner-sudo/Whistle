import { db } from "../db";
import { alertSubscriptions, users, schoolDirectories } from "@shared/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { sendMail } from "./mailer";

export interface SignalPayload {
  type: string;
  description: string;
  schoolId: string | null;
  staffId?: number | null;
  metadata?: Record<string, any>;
}

// Called by graph-engine after every signal insertion.
// Finds matching subscriptions and dispatches instant alerts.
export async function dispatchSignalAlerts(signal: SignalPayload): Promise<void> {
  try {
    // Find subscriptions that match: (schoolId matches OR subscription is global) AND signalType in their list
    const subs = await db
      .select()
      .from(alertSubscriptions)
      .where(
        and(
          or(
            isNull(alertSubscriptions.schoolId),
            signal.schoolId ? eq(alertSubscriptions.schoolId, signal.schoolId) : isNull(alertSubscriptions.schoolId),
          ),
        ),
      );

    const matchingSubs = subs.filter((sub) => {
      const types = sub.signalTypes as string[];
      return types.length === 0 || types.includes(signal.type);
    });

    if (!matchingSubs.length) return;

    // Get school name for display
    let schoolName = signal.schoolId ?? "Unknown School";
    if (signal.schoolId) {
      const [school] = await db
        .select({ schoolName: schoolDirectories.schoolName })
        .from(schoolDirectories)
        .where(eq(schoolDirectories.schoolId, signal.schoolId))
        .limit(1);
      if (school) schoolName = school.schoolName;
    }

    const subject = formatSubject(signal.type, schoolName, signal.metadata);
    const body = formatBody(signal, schoolName);

    for (const sub of matchingSubs) {
      if (sub.frequency !== "instant") continue; // daily/weekly handled by digest cron

      // Email alert
      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, sub.userId)).limit(1);
      if (user?.email) {
        sendMail({ to: user.email, subject, text: body }).catch((err) =>
          console.error("[AlertSubscriptions] email failed:", err),
        );
      }

      // Slack webhook alert
      if (sub.slackWebhookUrl) {
        const emoji = signalEmoji(signal.type);
        fetch(sub.slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${emoji} *${subject}*\n${signal.description}`,
          }),
        }).catch((err) => console.error("[AlertSubscriptions] slack failed:", err));
      }
    }
  } catch (err) {
    console.error("[AlertSubscriptions] dispatch error:", err);
  }
}

function signalEmoji(type: string): string {
  const map: Record<string, string> = {
    new_hire: "🟢",
    departure: "🔴",
    title_change: "🔄",
    tech_add: "⚡",
    tech_drop: "📉",
    warm_path: "🤝",
    job_posting: "📋",
    network_connection: "🔗",
  };
  return map[type] ?? "📡";
}

function formatSubject(type: string, schoolName: string, meta?: Record<string, any>): string {
  switch (type) {
    case "new_hire":
      return `New hire at ${schoolName}: ${meta?.staffName ?? "Unknown"} — ${meta?.staffTitle ?? ""}`;
    case "departure":
      return `Departure at ${schoolName}: ${meta?.staffName ?? "Unknown"} left`;
    case "title_change":
      return `Title change at ${schoolName}: ${meta?.staffName ?? "Unknown"}`;
    case "tech_add":
      return `Tech stack update at ${schoolName}: added ${(meta?.techAdded ?? []).join(", ")}`;
    case "tech_drop":
      return `Tech stack update at ${schoolName}: dropped ${(meta?.techDropped ?? []).join(", ")}`;
    case "job_posting":
      return `New job posting at ${schoolName}: ${meta?.jobTitle ?? "Unknown role"}`;
    default:
      return `Whistle signal: ${type} at ${schoolName}`;
  }
}

function formatBody(signal: SignalPayload, schoolName: string): string {
  const appUrl = process.env.APP_URL ?? "https://gowhistle.io";
  return [
    signal.description,
    "",
    `School: ${schoolName}`,
    `Signal type: ${signal.type}`,
    "",
    `View in Whistle: ${appUrl}/signals`,
    "",
    "— Whistle Intelligence",
    "Manage your alert preferences: " + appUrl + "/settings/alerts",
  ].join("\n");
}

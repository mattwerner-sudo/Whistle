import { db } from "../db";
import { webhookSubscriptions, webhookDeliveryLogs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

export type WebhookEventType =
  | "staff.new_hire"
  | "staff.departure"
  | "staff.title_change"
  | "extraction.completed"
  | "extraction.failed";

interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, any>;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function dispatchWebhook(
  eventType: WebhookEventType,
  data: Record<string, any>,
  userId?: number
): Promise<void> {
  try {
    const whereClause = userId
      ? and(eq(webhookSubscriptions.isActive, true), eq(webhookSubscriptions.userId, userId))
      : eq(webhookSubscriptions.isActive, true);

    const subscriptions = await db
      .select()
      .from(webhookSubscriptions)
      .where(whereClause);

    const payload: WebhookPayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    const payloadString = JSON.stringify(payload);

    for (const sub of subscriptions) {
      if (!sub.eventTypes?.includes(eventType)) {
        continue;
      }

      const signature = signPayload(payloadString, sub.secret);

      try {
        const response = await fetch(sub.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Event": eventType,
            "X-Webhook-Timestamp": payload.timestamp,
          },
          body: payloadString,
          signal: AbortSignal.timeout(10000),
        });

        await db.insert(webhookDeliveryLogs).values({
          subscriptionId: sub.id,
          eventType,
          payload,
          responseStatus: response.status,
          responseBody: await response.text().catch(() => null),
          success: response.ok,
        });

        if (response.ok) {
          await db
            .update(webhookSubscriptions)
            .set({
              lastTriggeredAt: new Date(),
              failureCount: 0,
            })
            .where(eq(webhookSubscriptions.id, sub.id));
        } else {
          await db
            .update(webhookSubscriptions)
            .set({
              failureCount: (sub.failureCount || 0) + 1,
            })
            .where(eq(webhookSubscriptions.id, sub.id));

          console.error(
            `Webhook delivery failed for subscription ${sub.id}: HTTP ${response.status}`
          );
        }
      } catch (error: any) {
        await db.insert(webhookDeliveryLogs).values({
          subscriptionId: sub.id,
          eventType,
          payload,
          responseStatus: 0,
          responseBody: error.message,
          success: false,
        });

        await db
          .update(webhookSubscriptions)
          .set({
            failureCount: (sub.failureCount || 0) + 1,
          })
          .where(eq(webhookSubscriptions.id, sub.id));

        console.error(`Webhook delivery error for ${sub.url}:`, error.message);
      }
    }
  } catch (error) {
    console.error("Failed to dispatch webhooks:", error);
  }
}

export async function dispatchStaffNewHire(staffRecord: {
  id: number;
  name: string;
  title?: string;
  email: string;
  phone?: string;
  schoolId: string;
  schoolName?: string;
}): Promise<void> {
  await dispatchWebhook("staff.new_hire", {
    staff: staffRecord,
    school_id: staffRecord.schoolId,
    school_name: staffRecord.schoolName,
  });
}

export async function dispatchStaffDeparture(staffRecord: {
  name: string;
  email: string;
  title?: string;
  schoolId: string;
  schoolName?: string;
}): Promise<void> {
  await dispatchWebhook("staff.departure", {
    staff: staffRecord,
    school_id: staffRecord.schoolId,
    school_name: staffRecord.schoolName,
  });
}

export async function dispatchExtractionCompleted(data: {
  schoolId: string;
  schoolName: string;
  contactsFound: number;
  newHires: number;
  departures: number;
}): Promise<void> {
  await dispatchWebhook("extraction.completed", data);
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

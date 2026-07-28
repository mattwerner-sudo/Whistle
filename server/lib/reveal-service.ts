import { db } from "../db";
import { users, contactReveals, staffMembers, usageEvents } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { REVEAL_GRACE_DAYS } from "./contact-masking";

export interface RevealResult {
  status: "ok";
  source: "cached" | "subscription";
  email: string | null;
  phone: string | null;
  emailVerificationStatus: string | null;
}

export interface RevealError {
  status: "error";
  code: "subscription_required" | "staff_not_found" | "no_contact" | "email_undeliverable";
  message: string;
  upgradeRequired?: boolean;
}

export type RevealOutcome = RevealResult | RevealError;

interface RevealOptions {
  userId: number;
  staffId: number;
  sessionId?: string;
}

export function hasActiveSubscription(user: { subscriptionStatus: string | null }): boolean {
  return user.subscriptionStatus === "active";
}

/**
 * Reveal a contact's email/phone.
 *
 * Gating is simple: an active $25/seat subscription grants unlimited reveals.
 * Contacts revealed within the 90-day grace window stay visible even if the
 * subscription has since lapsed (the user already paid for them).
 */
export async function revealContact(
  { userId, staffId, sessionId }: RevealOptions,
): Promise<RevealOutcome> {
  const [staff] = await db.select().from(staffMembers).where(eq(staffMembers.id, staffId)).limit(1);
  if (!staff) {
    return { status: "error", code: "staff_not_found", message: "Staff member not found" };
  }
  if (!staff.email && !staff.phone) {
    return { status: "error", code: "no_contact", message: "No contact data available for this staff member" };
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return { status: "error", code: "staff_not_found", message: "User not found" };
  }

  const cutoff = new Date(Date.now() - REVEAL_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const [existing] = await db
    .select()
    .from(contactReveals)
    .where(and(eq(contactReveals.userId, userId), eq(contactReveals.staffId, staffId)))
    .limit(1);

  // Previously revealed within the grace window: always free, even without a subscription.
  if (existing && existing.revealedAt >= cutoff) {
    await db.insert(usageEvents).values({
      eventType: "reveal_cached",
      details: { staffId, userId, source: "cached" },
    });
    return {
      status: "ok",
      source: "cached",
      email: staff.email,
      phone: staff.phone,
      emailVerificationStatus: staff.emailVerificationStatus,
    };
  }

  if (!hasActiveSubscription(user)) {
    return {
      status: "error",
      code: "subscription_required",
      message: "An active subscription is required to reveal contacts. Subscribe for $25/month per seat.",
      upgradeRequired: true,
    };
  }

  // Don't spend a reveal on a contact whose only value is an undeliverable email.
  // Phone-only and mixed reveals are unaffected — we just warn instead.
  const emailUndeliverable = staff.emailVerificationStatus === "undeliverable";
  if (emailUndeliverable && !staff.phone) {
    return {
      status: "error",
      code: "email_undeliverable",
      message: "This email failed deliverability checks. It's likely to bounce.",
    };
  }

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(contactReveals)
        .set({ revealedAt: new Date(), chargedCredits: 0, source: "subscription" })
        .where(eq(contactReveals.id, existing.id));
    } else {
      await tx.insert(contactReveals).values({ userId, staffId, chargedCredits: 0, source: "subscription" });
    }

    await tx.insert(usageEvents).values({
      eventType: "contact_reveal",
      schoolId: staff.schoolId,
      sessionId: sessionId || null,
      details: { staffId, source: "subscription", userId },
    });
  });

  return {
    status: "ok",
    source: "subscription",
    email: staff.email,
    phone: staff.phone,
    emailVerificationStatus: staff.emailVerificationStatus,
  };
}

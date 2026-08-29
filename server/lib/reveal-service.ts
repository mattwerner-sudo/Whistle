import { db } from "../db";
import { users, contactReveals, creditTransactions, staffMembers, usageEvents } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { REVEAL_GRACE_DAYS } from "./contact-masking";
import { meterRevealCharge } from "./stripe-metering";
import { syncEntitlementFromUser } from "./entitlements";
import { recordPaymentFailure, friendlyDeclineMessage } from "./payment-decline";

const OVERAGE_RATES: Record<string, number> = { pro: 50, team: 35, enterprise: 25 };

export interface RevealResult {
  status: "ok";
  source: "cached" | "subscription" | "overage";
  email: string | null;
  phone: string | null;
  chargedCredits: number;
  remainingMonthlyReveals: number | null;
}

export interface RevealError {
  status: "error";
  code: "out_of_quota" | "staff_not_found" | "no_contact" | "payment_failed";
  message: string;
  upgradeRequired?: boolean;
  declineCode?: string | null;
  errorCode?: string | null;
}

export type RevealOutcome = RevealResult | RevealError;

interface RevealOptions {
  userId: number;
  staffId: number;
  sessionId?: string;
}

// Stripe-touching collaborators are injectable so the gating logic can be
// exercised in tests without making live Stripe calls. Production callers use
// the defaults, which hit Stripe.
export interface RevealDeps {
  meterRevealCharge: typeof meterRevealCharge;
  recordPaymentFailure: typeof recordPaymentFailure;
}

const defaultRevealDeps: RevealDeps = { meterRevealCharge, recordPaymentFailure };

export async function revealContact(
  { userId, staffId, sessionId }: RevealOptions,
  deps: RevealDeps = defaultRevealDeps,
): Promise<RevealOutcome> {
  const [staff] = await db.select().from(staffMembers).where(eq(staffMembers.id, staffId)).limit(1);
  if (!staff) {
    return { status: "error", code: "staff_not_found", message: "Staff member not found" };
  }
  if (!staff.email && !staff.phone) {
    return { status: "error", code: "no_contact", message: "No contact data available for this staff member" };
  }

  const cutoff = new Date(Date.now() - REVEAL_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const [existing] = await db
    .select()
    .from(contactReveals)
    .where(and(eq(contactReveals.userId, userId), eq(contactReveals.staffId, staffId)))
    .limit(1);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return { status: "error", code: "staff_not_found", message: "User not found" };
  }

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
      chargedCredits: 0,
      remainingMonthlyReveals: getRemainingMonthly(user),
    };
  }

  const isActiveSub = user.subscriptionStatus === "active" && ["pro", "team", "enterprise"].includes(user.subscriptionTier ?? "");
  const monthlyAllocation = user.monthlyCreditsAllocation ?? 0;
  const usedThisPeriod = user.creditsUsedThisPeriod ?? 0;
  const hasSubAllowance = isActiveSub && monthlyAllocation > 0 && usedThisPeriod < monthlyAllocation;

  let source: RevealResult["source"];
  let chargedCredits = 0;

  if (hasSubAllowance) {
    source = "subscription";
    chargedCredits = 1;
  } else if (isActiveSub) {
    source = "overage";
    chargedCredits = 1;
  } else {
    return {
      status: "error",
      code: "out_of_quota",
      message: "An active subscription is required to reveal contacts.",
      upgradeRequired: true,
    };
  }

  // Fail-closed: meter overage to Stripe BEFORE granting the reveal.
  // If the charge can't be recorded, refuse so we never give out paid contact data without a billing record.
  if (source === "overage") {
    const tier = user.subscriptionTier ?? "";
    const rate = OVERAGE_RATES[tier] ?? 0;
    if (rate > 0) {
      const metered = await deps.meterRevealCharge({
        stripeCustomerId: user.stripeCustomerId,
        amountCents: rate,
        description: `Whistle reveal overage (${tier})`,
        userId,
        staffId,
        source: "overage",
      });
      await db.insert(usageEvents).values({
        eventType: "stripe_meter_overage",
        details: { userId, staffId, tier, amountCents: rate, ok: metered.ok, reason: metered.reason, chargeId: metered.chargeId },
      });
      if (!metered.ok) {
        if (metered.decline) {
          await deps.recordPaymentFailure({
            userId,
            staffId,
            source: "overage",
            amountCents: rate,
            stripeCustomerId: user.stripeCustomerId,
            details: metered.decline,
          });
        }
        return {
          status: "error",
          code: "payment_failed",
          message: friendlyDeclineMessage(metered.decline ?? {}),
          upgradeRequired: true,
          declineCode: metered.decline?.declineCode ?? null,
          errorCode: metered.decline?.errorCode ?? null,
        };
      }
    }
  }

  // Sentinel thrown inside the transaction when a concurrent reveal consumed
  // the last of the monthly allowance between our read and this write.
  class AllowanceExhausted extends Error {}

  try {
    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(contactReveals)
          .set({ revealedAt: new Date(), chargedCredits, source })
          .where(eq(contactReveals.id, existing.id));
      } else {
        await tx.insert(contactReveals).values({ userId, staffId, chargedCredits, source });
      }

      if (source === "subscription") {
        // The allowance check earlier in this function read an unlocked row, so
        // two concurrent reveals can both see one credit remaining. Claim the
        // credit conditionally in the same statement that checks it: if no row
        // matches, the allowance was consumed concurrently — roll back rather
        // than granting a free reveal past the cap.
        const claimed = await tx
          .update(users)
          .set({ creditsUsedThisPeriod: sql`${users.creditsUsedThisPeriod} + 1` })
          .where(and(
            eq(users.id, userId),
            sql`coalesce(${users.creditsUsedThisPeriod}, 0) < coalesce(${users.monthlyCreditsAllocation}, 0)`,
          ))
          .returning({ id: users.id });
        if (claimed.length === 0) throw new AllowanceExhausted();
        await tx.insert(creditTransactions).values({ userId, amount: -1, reason: "reveal_subscription" });
      } else if (source === "overage") {
        // Overage has no cap to enforce — Stripe was already metered above.
        await tx.update(users).set({ creditsUsedThisPeriod: sql`${users.creditsUsedThisPeriod} + 1` }).where(eq(users.id, userId));
        await tx.insert(creditTransactions).values({ userId, amount: -1, reason: "reveal_overage" });
      }

      await tx.insert(usageEvents).values({
        eventType: "contact_reveal",
        schoolId: staff.schoolId,
        sessionId: sessionId || null,
        details: { staffId, source, chargedCredits, userId },
      });
    });
  } catch (err) {
    if (err instanceof AllowanceExhausted) {
      // A retry will re-evaluate and take the overage path (or be refused).
      return {
        status: "error",
        code: "out_of_quota",
        message: "Your monthly reveal allowance was just used up. Please retry to continue via overage.",
        upgradeRequired: false,
      };
    }
    throw err;
  }

  // Mirror updated user billing state into the canonical entitlements row so
  // /api/billing/account immediately reflects the new usage/credits.
  await syncEntitlementFromUser(userId);

  const [refreshed] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return {
    status: "ok",
    source,
    email: staff.email,
    phone: staff.phone,
    chargedCredits,
    remainingMonthlyReveals: getRemainingMonthly(refreshed ?? user),
  };
}

function getRemainingMonthly(user: typeof users.$inferSelect): number | null {
  if (user.subscriptionStatus !== "active") return null;
  const allocation = user.monthlyCreditsAllocation ?? 0;
  if (allocation <= 0) return null;
  return Math.max(0, allocation - (user.creditsUsedThisPeriod ?? 0));
}

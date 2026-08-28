import { db } from "../db";
import { users, entitlements } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Mirror the user's billing state into the `entitlements` table.
 * Webhook handlers and admin tools call this after any change to the user's
 * subscription/credit fields so the entitlements row is always the canonical
 * read-side store for plan/quota state.
 */
export async function syncEntitlementFromUser(userId: number): Promise<void> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return;

  const row = {
    userId,
    tier: u.subscriptionTier ?? "payg",
    status: u.subscriptionStatus ?? "inactive",
    stripeCustomerId: u.stripeCustomerId ?? null,
    stripeSubscriptionId: u.stripeSubscriptionId ?? null,
    monthlyAllocation: u.monthlyCreditsAllocation ?? 0,
    usedThisPeriod: u.creditsUsedThisPeriod ?? 0,
    overageRateCents: u.overageRate ?? 0,
    creditsBalance: u.creditsBalance ?? 0,
    currentPeriodStart: u.currentPeriodStart ?? null,
    currentPeriodEnd: u.currentPeriodEnd ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(entitlements)
    .values(row)
    .onConflictDoUpdate({
      target: entitlements.userId,
      set: {
        tier: row.tier,
        status: row.status,
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        monthlyAllocation: row.monthlyAllocation,
        usedThisPeriod: row.usedThisPeriod,
        overageRateCents: row.overageRateCents,
        creditsBalance: row.creditsBalance,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        updatedAt: row.updatedAt,
      },
    });
}

export async function getEntitlement(userId: number) {
  const [e] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  return e ?? null;
}

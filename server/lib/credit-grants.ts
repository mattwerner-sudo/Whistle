import { db } from "../db";
import { users, creditTransactions } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { syncEntitlementFromUser } from "./entitlements";

/**
 * Idempotently grant prepaid credits from a completed Stripe purchase.
 *
 * Stripe delivers webhooks at-least-once (retries, network races), so the same
 * credit-purchase event can arrive more than once. We key the credit ledger on
 * the Stripe purchase identifier (payment intent, falling back to the checkout
 * session id) which is covered by a unique index. The ledger insert and the
 * balance increment run in one transaction: if the insert is a no-op (the key
 * already exists) we skip the balance bump entirely, so a duplicate delivery
 * grants the credits exactly once.
 */
export async function applyCreditPurchase(opts: {
  userId: number;
  creditsAmount: number;
  idempotencyKey: string;
  customerId?: string | null;
}): Promise<{ granted: boolean }> {
  const { userId, creditsAmount, idempotencyKey, customerId } = opts;

  const granted = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(creditTransactions)
      .values({
        userId,
        amount: creditsAmount,
        reason: "purchase",
        stripePaymentIntentId: idempotencyKey,
      })
      .onConflictDoNothing({ target: creditTransactions.stripePaymentIntentId })
      .returning({ id: creditTransactions.id });

    // Conflict -> this purchase was already processed by an earlier delivery.
    if (inserted.length === 0) return false;

    await tx
      .update(users)
      .set({
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        subscriptionTier: sql`COALESCE(NULLIF(${users.subscriptionTier}, 'free'), 'payg')`,
        creditsBalance: sql`${users.creditsBalance} + ${creditsAmount}`,
      })
      .where(eq(users.id, userId));

    return true;
  });

  // Keep the entitlements mirror in sync only when we actually granted credits.
  if (granted) await syncEntitlementFromUser(userId);

  return { granted };
}

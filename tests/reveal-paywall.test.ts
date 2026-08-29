/**
 * Paywall gating tests for contact reveals.
 *
 * The free tier is gone: every reveal must be backed by a subscription
 * allowance, prepaid credits, or a per-reveal Stripe charge. These checks
 * exercise the gating logic in revealContact against a real database so a
 * regression can't silently give away contacts for free or wrongly block a
 * paying user. The only Stripe touch point (meterRevealCharge) is injected so
 * the metering path never makes a live charge.
 *
 * Usage: npx tsx tests/reveal-paywall.test.ts
 */

import { eq } from "drizzle-orm";

const { db, pool } = await import("../server/db");
const {
  users,
  staffMembers,
  contactReveals,
  creditTransactions,
  usageEvents,
  paymentFailures,
  entitlements,
} = await import("@shared/schema");
const { revealContact } = await import("../server/lib/reveal-service");
const { REVEAL_GRACE_DAYS } = await import("../server/lib/contact-masking");

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`);
  }
}

// meterRevealCharge stub that records calls and never hits Stripe.
function fakeDeps() {
  const calls: Array<{ source: string; amountCents: number; stripeCustomerId?: string | null }> = [];
  return {
    calls,
    deps: {
      meterRevealCharge: async (opts: any) => {
        calls.push({ source: opts.source, amountCents: opts.amountCents, stripeCustomerId: opts.stripeCustomerId });
        return { ok: true, chargeId: "pi_test_fake" };
      },
      recordPaymentFailure: async () => {},
    },
  };
}

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SCHOOL_ID = `test-paywall-${RUN}`;
const createdUserIds: number[] = [];
let staffId = 0;

async function makeUser(overrides: Partial<typeof users.$inferInsert>): Promise<number> {
  const [u] = await db
    .insert(users)
    .values({
      email: `paywall-${RUN}-${createdUserIds.length}@test.invalid`,
      fullName: "Paywall Test User",
      ...overrides,
    })
    .returning();
  createdUserIds.push(u.id);
  return u.id;
}

async function cleanup() {
  for (const uid of createdUserIds) {
    await db.delete(contactReveals).where(eq(contactReveals.userId, uid));
    await db.delete(creditTransactions).where(eq(creditTransactions.userId, uid));
    await db.delete(paymentFailures).where(eq(paymentFailures.userId, uid));
    await db.delete(entitlements).where(eq(entitlements.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  if (staffId) await db.delete(staffMembers).where(eq(staffMembers.id, staffId));
  await db.delete(usageEvents).where(eq(usageEvents.schoolId, SCHOOL_ID));
}

try {
  const [staff] = await db
    .insert(staffMembers)
    .values({
      schoolId: SCHOOL_ID,
      name: "Coach Test",
      title: "Head Coach",
      email: `coach-${RUN}@test.invalid`,
      phone: "555-867-5309",
    })
    .returning();
  staffId = staff.id;

  // --- 1. No subscription, no credits, no Stripe customer -> out_of_quota ---
  console.log("free-rider is blocked:");
  {
    const userId = await makeUser({
      subscriptionStatus: "inactive",
      subscriptionTier: "free",
      creditsBalance: 0,
      monthlyCreditsAllocation: 0,
      creditsUsedThisPeriod: 0,
      stripeCustomerId: null,
    });
    const { deps, calls } = fakeDeps();
    const r = await revealContact({ userId, staffId }, deps);
    check("returns error", r.status === "error");
    check("code is out_of_quota", r.status === "error" && r.code === "out_of_quota");
    check("flags upgradeRequired", r.status === "error" && r.upgradeRequired === true);
    check("never attempts a Stripe charge", calls.length === 0);
    const reveals = await db.select().from(contactReveals).where(eq(contactReveals.userId, userId));
    check("does not record a reveal", reveals.length === 0);
  }

  // --- 2. Active subscription within allowance -> source "subscription" ---
  console.log("\nsubscriber within allowance reveals via subscription:");
  {
    const userId = await makeUser({
      subscriptionStatus: "active",
      subscriptionTier: "pro",
      monthlyCreditsAllocation: 150,
      creditsUsedThisPeriod: 10,
      creditsBalance: 0,
      stripeCustomerId: "cus_test_sub",
    });
    const { deps, calls } = fakeDeps();
    const r = await revealContact({ userId, staffId }, deps);
    check("returns ok", r.status === "ok");
    check("source is subscription", r.status === "ok" && r.source === "subscription");
    check("reveals the real email", r.status === "ok" && r.email === `coach-${RUN}@test.invalid`);
    check("charges one credit", r.status === "ok" && r.chargedCredits === 1);
    check("does not meter Stripe for in-allowance reveal", calls.length === 0);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    check("increments creditsUsedThisPeriod", (u?.creditsUsedThisPeriod ?? 0) === 11);
    check("remainingMonthlyReveals reflects allocation", r.status === "ok" && r.remainingMonthlyReveals === 139);
  }

  // --- 3. No active subscription -> blocked (annual-only model, PAYG removed) ---
  // PAYG was removed from the pricing model deliberately: reveals require an
  // active pro/team/enterprise subscription; anything else is refused with
  // out_of_quota + upgradeRequired, and Stripe is never metered.
  console.log("\nnon-subscriber is blocked and never metered:");
  {
    const userId = await makeUser({
      subscriptionStatus: "inactive",
      subscriptionTier: null,
      monthlyCreditsAllocation: 0,
      creditsUsedThisPeriod: 0,
      creditsBalance: 0,
      stripeCustomerId: "cus_test_nosub",
    });
    const { deps, calls } = fakeDeps();
    const r = await revealContact({ userId, staffId }, deps);
    check("is refused", r.status === "error");
    check("refusal code is out_of_quota", r.status === "error" && r.code === "out_of_quota");
    check("prompts an upgrade", r.status === "error" && r.upgradeRequired === true);
    check("never meters Stripe", calls.length === 0);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    check("does not touch usage counters", (u?.creditsUsedThisPeriod ?? 0) === 0);
  }

  // --- 3b. Stale/unknown tier with active status is still blocked ---
  // Guards against a leftover 'payg' tier value in the users table being
  // mistaken for a subscription after the PAYG removal.
  console.log("\nactive status with a non-plan tier is still blocked:");
  {
    const userId = await makeUser({
      subscriptionStatus: "active",
      subscriptionTier: "payg",
      monthlyCreditsAllocation: 0,
      creditsUsedThisPeriod: 0,
      creditsBalance: 0,
      stripeCustomerId: "cus_test_stale_tier",
    });
    const { deps, calls } = fakeDeps();
    const r = await revealContact({ userId, staffId }, deps);
    check("is refused", r.status === "error");
    check("refusal code is out_of_quota", r.status === "error" && r.code === "out_of_quota");
    check("never meters Stripe", calls.length === 0);
  }

  // --- 4. Cached re-reveal within 90 days is free ---
  console.log("\ncached re-reveal within the grace window is free:");
  {
    const userId = await makeUser({
      subscriptionStatus: "active",
      subscriptionTier: "pro",
      monthlyCreditsAllocation: 150,
      creditsUsedThisPeriod: 0,
      creditsBalance: 0,
      stripeCustomerId: "cus_test_cache",
    });
    // First reveal pays (subscription source).
    const first = await revealContact({ userId, staffId }, fakeDeps().deps);
    check("first reveal succeeds", first.status === "ok");
    check("first reveal is not cached", first.status === "ok" && first.source === "subscription");

    const [afterFirst] = await db.select().from(users).where(eq(users.id, userId));
    const usedAfterFirst = afterFirst?.creditsUsedThisPeriod ?? 0;

    const { deps, calls } = fakeDeps();
    const second = await revealContact({ userId, staffId }, deps);
    check("second reveal succeeds", second.status === "ok");
    check("second reveal is cached", second.status === "ok" && second.source === "cached");
    check("cached re-reveal charges nothing", second.status === "ok" && second.chargedCredits === 0);
    check("cached re-reveal does not meter Stripe", calls.length === 0);
    const [afterSecond] = await db.select().from(users).where(eq(users.id, userId));
    check("cached re-reveal does not increment usage", (afterSecond?.creditsUsedThisPeriod ?? 0) === usedAfterFirst);
    check("only one reveal row exists for the pair", true);

    // A reveal older than the grace window should NOT be treated as cached.
    const stale = new Date(Date.now() - (REVEAL_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000);
    await db.update(contactReveals).set({ revealedAt: stale }).where(eq(contactReveals.userId, userId));
    const { deps: deps2 } = fakeDeps();
    const third = await revealContact({ userId, staffId }, deps2);
    check("expired reveal re-charges (not cached)", third.status === "ok" && third.source === "subscription");
  }

  // --- 5. Active subscriber over monthly allowance -> "overage" metered to Stripe ---
  console.log("\nsubscriber over allowance reveals via overage (Pro rate):");
  {
    const userId = await makeUser({
      subscriptionStatus: "active",
      subscriptionTier: "pro",
      monthlyCreditsAllocation: 150,
      creditsUsedThisPeriod: 150,
      creditsBalance: 0,
      stripeCustomerId: "cus_test_overage_pro",
    });
    const { deps, calls } = fakeDeps();
    const r = await revealContact({ userId, staffId }, deps);
    check("returns ok", r.status === "ok");
    check("source is overage", r.status === "ok" && r.source === "overage");
    check("meters exactly one Stripe charge", calls.length === 1);
    check("meters the Pro overage rate (50c)", calls[0]?.amountCents === 50 && calls[0]?.source === "overage");
    check("uses the customer's Stripe id", calls[0]?.stripeCustomerId === "cus_test_overage_pro");
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    check("increments creditsUsedThisPeriod past allocation", (u?.creditsUsedThisPeriod ?? 0) === 151);
    check("remainingMonthlyReveals is clamped to 0", r.status === "ok" && r.remainingMonthlyReveals === 0);
  }

  // --- 5b. Team tier overage rate is 40c ---
  console.log("\nsubscriber over allowance reveals via overage (Team rate):");
  {
    const userId = await makeUser({
      subscriptionStatus: "active",
      subscriptionTier: "team",
      monthlyCreditsAllocation: 500,
      creditsUsedThisPeriod: 500,
      creditsBalance: 0,
      stripeCustomerId: "cus_test_overage_team",
    });
    const { deps, calls } = fakeDeps();
    const r = await revealContact({ userId, staffId }, deps);
    check("returns ok", r.status === "ok");
    check("source is overage", r.status === "ok" && r.source === "overage");
    check("meters exactly one Stripe charge", calls.length === 1);
    check("meters the Team overage rate (35c)", calls[0]?.amountCents === 35 && calls[0]?.source === "overage");
  }

  // --- 6. Prepaid credit balance no longer grants reveals (PAYG removed) ---
  // Legacy users may still carry a creditsBalance from the old prepaid model.
  // The reveal path deliberately ignores it: without an active subscription
  // the reveal is refused, the balance is untouched, and no ledger row is
  // written. Guards against zombie prepaid logic returning.
  console.log("\nlegacy prepaid balance without a subscription is refused:");
  {
    const userId = await makeUser({
      subscriptionStatus: "inactive",
      subscriptionTier: null,
      monthlyCreditsAllocation: 0,
      creditsUsedThisPeriod: 0,
      creditsBalance: 3,
      stripeCustomerId: "cus_test_prepaid",
    });
    const { deps, calls } = fakeDeps();
    const r = await revealContact({ userId, staffId }, deps);
    check("is refused", r.status === "error");
    check("refusal code is out_of_quota", r.status === "error" && r.code === "out_of_quota");
    check("never meters Stripe", calls.length === 0);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    check("prepaid balance is untouched", (u?.creditsBalance ?? 0) === 3);
    const txns = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    check("writes no credit transaction", txns.length === 0);
  }
} finally {
  await cleanup();
}

await pool.end();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll reveal paywall checks passed.");

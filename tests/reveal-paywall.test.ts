/**
 * Paywall gating tests for contact reveals under the single-plan model.
 *
 * Gating is simple now: an active $25/seat subscription grants unlimited
 * reveals; without one, reveals are blocked with subscription_required.
 * Contacts revealed within the 90-day grace window stay free even after the
 * subscription lapses. These checks run against a real database so a
 * regression can't silently give away contacts or wrongly block a subscriber.
 *
 * Usage: npx tsx tests/reveal-paywall.test.ts
 */

import { eq } from "drizzle-orm";

const { db, pool } = await import("../server/db");
const {
  users,
  staffMembers,
  contactReveals,
  usageEvents,
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

  // --- 1. No subscription -> subscription_required ---
  console.log("non-subscriber is blocked:");
  {
    const userId = await makeUser({
      subscriptionStatus: "inactive",
      stripeCustomerId: null,
    });
    const r = await revealContact({ userId, staffId });
    check("returns error", r.status === "error");
    check("code is subscription_required", r.status === "error" && r.code === "subscription_required");
    check("flags upgradeRequired", r.status === "error" && r.upgradeRequired === true);
    const reveals = await db.select().from(contactReveals).where(eq(contactReveals.userId, userId));
    check("does not record a reveal", reveals.length === 0);
  }

  // --- 1b. past_due / canceled statuses are also blocked ---
  console.log("\npast_due and canceled subscribers are blocked:");
  for (const status of ["past_due", "canceled"] as const) {
    const userId = await makeUser({
      subscriptionStatus: status,
      subscriptionTier: "standard",
      stripeCustomerId: "cus_test_lapsed",
    });
    const r = await revealContact({ userId, staffId });
    check(`${status} is blocked with subscription_required`, r.status === "error" && r.code === "subscription_required");
  }

  // --- 2. Active subscription -> unlimited reveals via "subscription" ---
  console.log("\nactive subscriber reveals via subscription:");
  {
    const userId = await makeUser({
      subscriptionStatus: "active",
      subscriptionTier: "standard",
      seats: 3,
      stripeCustomerId: "cus_test_sub",
    });
    const r = await revealContact({ userId, staffId });
    check("returns ok", r.status === "ok");
    check("source is subscription", r.status === "ok" && r.source === "subscription");
    check("reveals the real email", r.status === "ok" && r.email === `coach-${RUN}@test.invalid`);
    const reveals = await db.select().from(contactReveals).where(eq(contactReveals.userId, userId));
    check("records exactly one reveal row", reveals.length === 1);
    check("reveal row charges zero credits", reveals[0]?.chargedCredits === 0);
  }

  // --- 3. Cached re-reveal within 90 days is free ---
  console.log("\ncached re-reveal within the grace window is free:");
  {
    const userId = await makeUser({
      subscriptionStatus: "active",
      subscriptionTier: "standard",
      stripeCustomerId: "cus_test_cache",
    });
    const first = await revealContact({ userId, staffId });
    check("first reveal succeeds", first.status === "ok");
    check("first reveal is not cached", first.status === "ok" && first.source === "subscription");

    const second = await revealContact({ userId, staffId });
    check("second reveal succeeds", second.status === "ok");
    check("second reveal is cached", second.status === "ok" && second.source === "cached");
    const reveals = await db.select().from(contactReveals).where(eq(contactReveals.userId, userId));
    check("only one reveal row exists for the pair", reveals.length === 1);

    // Grace window survives subscription lapse.
    await db.update(users).set({ subscriptionStatus: "canceled" }).where(eq(users.id, userId));
    const third = await revealContact({ userId, staffId });
    check("cached reveal stays free after cancel", third.status === "ok" && third.source === "cached");

    // A reveal older than the grace window is NOT cached; canceled user is blocked.
    const stale = new Date(Date.now() - (REVEAL_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000);
    await db.update(contactReveals).set({ revealedAt: stale }).where(eq(contactReveals.userId, userId));
    const fourth = await revealContact({ userId, staffId });
    check("expired cache + canceled sub is blocked", fourth.status === "error" && fourth.code === "subscription_required");

    // Reactivate: expired cache re-reveals via subscription and refreshes the row.
    await db.update(users).set({ subscriptionStatus: "active" }).where(eq(users.id, userId));
    const fifth = await revealContact({ userId, staffId });
    check("expired cache re-reveals via subscription", fifth.status === "ok" && fifth.source === "subscription");
    const after = await db.select().from(contactReveals).where(eq(contactReveals.userId, userId));
    check("still a single reveal row (refreshed)", after.length === 1 && after[0].revealedAt > stale);
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

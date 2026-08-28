/**
 * Idempotency tests for prepaid credit purchases.
 *
 * Stripe delivers the checkout.session.completed webhook at-least-once, so the
 * same credit purchase can arrive more than once. applyCreditPurchase must grant
 * the credits exactly once per Stripe purchase (keyed on the payment intent /
 * session id) while still working for genuine first-time purchases. These checks
 * run against a real database so a regression can't silently double-credit.
 *
 * Usage: npx tsx tests/credit-idempotency.test.ts
 */

import { eq } from "drizzle-orm";

const { db, pool } = await import("../server/db");
const { users, creditTransactions, entitlements } = await import("@shared/schema");
const { applyCreditPurchase } = await import("../server/lib/credit-grants");

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
const createdUserIds: number[] = [];

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<number> {
  const [u] = await db
    .insert(users)
    .values({
      email: `credit-idem-${RUN}-${createdUserIds.length}@test.invalid`,
      fullName: "Credit Idempotency Test User",
      subscriptionStatus: "inactive",
      subscriptionTier: "free",
      creditsBalance: 0,
      ...overrides,
    })
    .returning();
  createdUserIds.push(u.id);
  return u.id;
}

async function balanceOf(userId: number): Promise<number> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u?.creditsBalance ?? 0;
}

async function ledgerRows(userId: number) {
  return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId));
}

async function cleanup() {
  for (const uid of createdUserIds) {
    await db.delete(creditTransactions).where(eq(creditTransactions.userId, uid));
    await db.delete(entitlements).where(eq(entitlements.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
}

try {
  // --- 1. First-time purchase grants credits and writes one ledger row ---
  console.log("first-time credit purchase grants credits once:");
  {
    const userId = await makeUser();
    const key = `pi_${RUN}_first`;
    const r = await applyCreditPurchase({ userId, creditsAmount: 100, idempotencyKey: key, customerId: "cus_idem_first" });
    check("reports granted", r.granted === true);
    check("balance is 100", (await balanceOf(userId)) === 100);
    const rows = await ledgerRows(userId);
    check("writes exactly one ledger row", rows.length === 1);
    check("ledger row records +100 purchase", rows[0]?.amount === 100 && rows[0]?.reason === "purchase");
    check("ledger row keyed on the stripe id", rows[0]?.stripePaymentIntentId === key);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    check("promotes free tier to payg", u?.subscriptionTier === "payg");
    check("records the stripe customer", u?.stripeCustomerId === "cus_idem_first");
  }

  // --- 2. Same webhook delivered twice grants the credits only once ---
  console.log("\nduplicate delivery of the same purchase grants once:");
  {
    const userId = await makeUser();
    const key = `pi_${RUN}_dup`;
    const first = await applyCreditPurchase({ userId, creditsAmount: 50, idempotencyKey: key });
    const second = await applyCreditPurchase({ userId, creditsAmount: 50, idempotencyKey: key });
    check("first delivery grants", first.granted === true);
    check("second delivery is a no-op", second.granted === false);
    check("balance increases only once (50)", (await balanceOf(userId)) === 50);
    check("only one ledger row exists", (await ledgerRows(userId)).length === 1);
  }

  // --- 3. Concurrent duplicate deliveries still grant only once ---
  // Exercises the DB-level unique guard (check-then-act would race here).
  console.log("\nconcurrent duplicate deliveries grant once:");
  {
    const userId = await makeUser();
    const key = `pi_${RUN}_race`;
    const results = await Promise.allSettled([
      applyCreditPurchase({ userId, creditsAmount: 25, idempotencyKey: key }),
      applyCreditPurchase({ userId, creditsAmount: 25, idempotencyKey: key }),
    ]);
    const grantedCount = results.filter(
      (x) => x.status === "fulfilled" && x.value.granted === true,
    ).length;
    check("exactly one delivery grants", grantedCount === 1);
    check("balance increases only once (25)", (await balanceOf(userId)) === 25);
    check("only one ledger row exists", (await ledgerRows(userId)).length === 1);
  }

  // --- 4. Distinct purchases each grant (no false dedupe) ---
  console.log("\ndistinct purchases each grant credits:");
  {
    const userId = await makeUser();
    const a = await applyCreditPurchase({ userId, creditsAmount: 10, idempotencyKey: `pi_${RUN}_a` });
    const b = await applyCreditPurchase({ userId, creditsAmount: 30, idempotencyKey: `pi_${RUN}_b` });
    check("first purchase grants", a.granted === true);
    check("second purchase grants", b.granted === true);
    check("balance reflects both (40)", (await balanceOf(userId)) === 40);
    check("two ledger rows exist", (await ledgerRows(userId)).length === 2);
  }
} finally {
  await cleanup();
}

await pool.end();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll credit idempotency checks passed.");

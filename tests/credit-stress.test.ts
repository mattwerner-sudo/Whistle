/**
 * Concurrency stress test for the prepaid credit-pack reveal path.
 *
 * The risk: many simultaneous reveals racing against a small balance could
 * overspend (drive creditsBalance negative / give away free reveals). The
 * reveal path guards this with a conditional decrement inside a transaction;
 * this test fires bursts of concurrent reveals and asserts the invariant
 *   (reveals granted) === (credits actually spent) === (balance delta)
 * holds exactly, with no negative balance and no free reveals past the cap.
 *
 * Usage: npx tsx tests/credit-stress.test.ts
 */
import { eq, and, inArray } from "drizzle-orm";

const { db, pool } = await import("../server/db");
const { users, staffMembers, contactReveals, creditTransactions, usageEvents, entitlements } = await import("@shared/schema");
const { revealContact } = await import("../server/lib/reveal-service");

let failures = 0;
const check = (n: string, c: boolean) => { console.log(`  ${c ? "ok  " : "FAIL"} ${n}`); if (!c) failures++; };

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SCHOOL_ID = `test-stress-${RUN}`;
const userIds: number[] = [];
const staffIds: number[] = [];

const deps = {
  meterRevealCharge: async () => ({ ok: true, chargeId: "pi_stub" }),
  recordPaymentFailure: async () => {},
} as any;

async function makeUser(creditsBalance: number): Promise<number> {
  const [u] = await db.insert(users).values({
    email: `stress-${RUN}-${userIds.length}@test.invalid`,
    fullName: "Stress User",
    subscriptionStatus: "inactive",
    subscriptionTier: null,
    monthlyCreditsAllocation: 0,
    creditsUsedThisPeriod: 0,
    creditsBalance,
  }).returning();
  userIds.push(u.id);
  return u.id;
}

async function makeStaff(n: number): Promise<number[]> {
  const rows = await db.insert(staffMembers).values(
    Array.from({ length: n }, (_, i) => ({
      schoolId: SCHOOL_ID,
      name: `Staff ${i}`,
      title: "Coach",
      email: `s${i}-${RUN}@test.invalid`,
      phone: "555-000-0000",
    }))
  ).returning();
  rows.forEach((r) => staffIds.push(r.id));
  return rows.map((r) => r.id);
}

async function cleanup() {
  if (userIds.length) {
    await db.delete(contactReveals).where(inArray(contactReveals.userId, userIds));
    await db.delete(creditTransactions).where(inArray(creditTransactions.userId, userIds));
    await db.delete(entitlements).where(inArray(entitlements.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (staffIds.length) await db.delete(staffMembers).where(inArray(staffMembers.id, staffIds));
  await db.delete(usageEvents).where(eq(usageEvents.schoolId, SCHOOL_ID));
}

try {
  // Scenario A — the core race: balance 10, fire 40 concurrent reveals on 40
  // distinct contacts. Exactly 10 must succeed, balance must land at 0, never
  // negative, and exactly 10 spend rows written.
  console.log("\nA. 40 concurrent reveals against a balance of 10:");
  {
    const uid = await makeUser(10);
    const staff = await makeStaff(40);
    const results = await Promise.all(
      staff.map((sid) => revealContact({ userId: uid, staffId: sid }, deps).catch((e) => ({ status: "error", code: "throw", message: String(e) } as any)))
    );
    const ok = results.filter((r) => r.status === "ok");
    const okCredits = results.filter((r) => r.status === "ok" && r.source === "credits");
    const refused = results.filter((r) => r.status === "error");
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    const spendRows = await db.select().from(creditTransactions).where(and(eq(creditTransactions.userId, uid), eq(creditTransactions.reason, "reveal_credit_pack")));

    check(`exactly 10 reveals granted (got ${ok.length})`, ok.length === 10);
    check(`all grants used the credits source (got ${okCredits.length})`, okCredits.length === 10);
    check(`remaining 30 refused (got ${refused.length})`, refused.length === 30);
    check(`balance landed at 0 (got ${u?.creditsBalance})`, (u?.creditsBalance ?? -1) === 0);
    check(`balance never negative`, (u?.creditsBalance ?? -1) >= 0);
    check(`exactly 10 spend ledger rows (got ${spendRows.length})`, spendRows.length === 10);
    check(`no free reveals: granted === spent`, ok.length === spendRows.length);
  }

  // Scenario B — same contact revealed concurrently 20x on balance 5. First
  // spend costs 1 credit; the rest are cached (free) and must NOT each burn a
  // credit. So balance drops by exactly 1, not more.
  console.log("\nB. 20 concurrent reveals of the SAME contact, balance 5:");
  {
    const uid = await makeUser(5);
    const [sid] = await makeStaff(1);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => revealContact({ userId: uid, staffId: sid }, deps).catch(() => ({ status: "error" } as any)))
    );
    const ok = results.filter((r) => r.status === "ok");
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    check(`all 20 succeed (cached after first) (got ${ok.length})`, ok.length === 20);
    check(`balance dropped by at most 1 (got ${5 - (u?.creditsBalance ?? 0)})`, (u?.creditsBalance ?? 0) >= 4);
    check(`balance never negative`, (u?.creditsBalance ?? -1) >= 0);
  }

  // Scenario C — throughput: 200 sequential reveals on a fat balance, timed.
  console.log("\nC. throughput — 200 reveals on a balance of 500:");
  {
    const uid = await makeUser(500);
    const staff = await makeStaff(200);
    const t0 = Date.now();
    const results = await Promise.all(staff.map((sid) => revealContact({ userId: uid, staffId: sid }, deps).catch(() => ({ status: "error" } as any))));
    const ms = Date.now() - t0;
    const ok = results.filter((r) => r.status === "ok").length;
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    check(`all 200 granted (got ${ok})`, ok === 200);
    check(`balance is exactly 300 (got ${u?.creditsBalance})`, (u?.creditsBalance ?? -1) === 300);
    console.log(`  info  200 concurrent reveals in ${ms}ms (${(ms / 200).toFixed(1)}ms/reveal)`);
  }

  console.log(`\n${failures === 0 ? "ALL STRESS CHECKS PASSED" : failures + " STRESS CHECK(S) FAILED"}`);
} finally {
  await cleanup();
  await pool.end();
}
process.exit(failures === 0 ? 0 : 1);

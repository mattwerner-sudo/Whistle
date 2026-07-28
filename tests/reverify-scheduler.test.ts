import { storage } from "../server/storage";
import { runReverifyPass, getReverifyStatus } from "../server/lib/reverify-scheduler";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`ok  - ${name}`);
  else { console.error(`FAIL - ${name}`); failures++; }
}

// The scheduler defaults to batchSize=100, maxBatchesPerRun=5. We stub the
// storage layer so no DB or DNS is touched.
async function run() {
  {
    // A single short batch (< batchSize) should stop after one call.
    let calls = 0;
    (storage as any).reverifyStaffEmails = async (_limit: number) => {
      calls++;
      return { checked: 10, changed: 3 };
    };
    const stats = await runReverifyPass("manual");
    check("single short batch -> 1 storage call", calls === 1);
    check("aggregates checked", stats.checked === 10);
    check("aggregates changed", stats.changed === 3);
    check("records trigger", stats.trigger === "manual");
    check("no error on success", stats.error === undefined);
    check("batches counted", stats.batches === 1);
  }

  {
    // Full batches keep going until maxBatchesPerRun (5) is hit.
    let calls = 0;
    (storage as any).reverifyStaffEmails = async (limit: number) => {
      calls++;
      return { checked: limit, changed: 1 };
    };
    const stats = await runReverifyPass("scheduled");
    check("full batches stop at maxBatchesPerRun", calls === 5);
    check("bounded checked total (5 * 100)", stats.checked === 500);
    check("bounded changed total", stats.changed === 5);
  }

  {
    // Errors are captured, not thrown, and don't leave the scheduler 'running'.
    (storage as any).reverifyStaffEmails = async () => {
      throw new Error("boom");
    };
    const stats = await runReverifyPass("scheduled");
    check("error captured in stats", stats.error === "boom");
    check("scheduler not stuck running after error", getReverifyStatus().running === false);
  }

  {
    // getReverifyStatus reflects the last run and config surface.
    (storage as any).reverifyStaffEmails = async () => ({ checked: 1, changed: 0 });
    await runReverifyPass("manual");
    const status = getReverifyStatus();
    check("status exposes lastRun", status.lastRun?.trigger === "manual");
    check("status exposes batchSize", status.batchSize === 100);
    check("status exposes staleAfterMs (30d)", status.staleAfterMs === 30 * 24 * 60 * 60 * 1000);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll reverify-scheduler checks passed");
  process.exit(0);
}

run();

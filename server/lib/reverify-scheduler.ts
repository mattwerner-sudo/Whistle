import { storage } from "../storage";

// Evergreen maintenance scheduler: periodically re-runs the free email
// verifier over contacts whose verification has gone stale (or that were
// flagged inaccurate). Extraction only verifies at scrape time, so without a
// schedule deliverability status silently drifts as domains lapse, MX records
// change, and people leave.
//
// Design rules:
//   - Runs in bounded batches (batchSize * maxBatchesPerRun) so a single pass
//     can never overwhelm DNS lookups. A short delay separates batches.
//   - Never throws to the caller; a failed pass is recorded and the next tick
//     tries again.
//   - Overlapping passes are prevented via an in-flight guard.
//   - Fully env-configurable so operators can tune cadence without a redeploy.

export interface ReverifyRunStats {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  batches: number;
  checked: number;
  changed: number;
  trigger: "scheduled" | "manual" | "startup";
  error?: string;
}

export interface ReverifyStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  batchSize: number;
  maxBatchesPerRun: number;
  staleAfterMs: number;
  lastRun: ReverifyRunStats | null;
  nextRunAt: string | null;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const config = {
  // Disabled only when explicitly set to "false".
  enabled: (process.env.REVERIFY_ENABLED ?? "true").toLowerCase() !== "false",
  intervalMs: envInt("REVERIFY_INTERVAL_HOURS", 6) * 60 * 60 * 1000,
  batchSize: envInt("REVERIFY_BATCH_SIZE", 100),
  maxBatchesPerRun: envInt("REVERIFY_MAX_BATCHES_PER_RUN", 5),
  staleAfterMs: envInt("REVERIFY_STALE_DAYS", 30) * DAY_MS,
  batchDelayMs: envInt("REVERIFY_BATCH_DELAY_MS", 1500),
  initialDelayMs: envInt("REVERIFY_INITIAL_DELAY_MS", 60000),
};

let timer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let running = false;
let lastRun: ReverifyRunStats | null = null;
let nextRunAt: number | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getReverifyStatus(): ReverifyStatus {
  return {
    enabled: config.enabled,
    running,
    intervalMs: config.intervalMs,
    batchSize: config.batchSize,
    maxBatchesPerRun: config.maxBatchesPerRun,
    staleAfterMs: config.staleAfterMs,
    lastRun,
    nextRunAt: nextRunAt ? new Date(nextRunAt).toISOString() : null,
  };
}

// Run a single bounded pass. Walks up to `maxBatchesPerRun` batches; each batch
// re-verifies up to `batchSize` stale/flagged records. Stops early once a batch
// comes back short (no more eligible rows). Safe to call directly (e.g. tests).
export async function runReverifyPass(
  trigger: ReverifyRunStats["trigger"] = "scheduled",
): Promise<ReverifyRunStats> {
  if (running) {
    return (
      lastRun ?? {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        batches: 0,
        checked: 0,
        changed: 0,
        trigger,
        error: "already_running",
      }
    );
  }

  running = true;
  const startedAtMs = Date.now();
  let batches = 0;
  let checked = 0;
  let changed = 0;
  let error: string | undefined;

  try {
    for (let i = 0; i < config.maxBatchesPerRun; i++) {
      const res = await storage.reverifyStaffEmails(config.batchSize, {
        staleAfterMs: config.staleAfterMs,
      });
      batches++;
      checked += res.checked;
      changed += res.changed;

      // A short batch means the eligible pool is drained — stop early.
      if (res.checked < config.batchSize) break;
      if (i < config.maxBatchesPerRun - 1) await delay(config.batchDelayMs);
    }
  } catch (err: any) {
    error = err?.message || String(err);
    console.error("[Reverify] Scheduled pass failed:", err);
  }

  const finishedAtMs = Date.now();
  running = false;
  lastRun = {
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    batches,
    checked,
    changed,
    trigger,
    ...(error ? { error } : {}),
  };

  console.log(
    `[Reverify] Pass complete (${trigger}): ${checked} checked, ${changed} changed across ${batches} batch(es) in ${lastRun.durationMs}ms`,
  );
  return lastRun;
}

export function startReverifyScheduler(): void {
  if (!config.enabled) {
    console.log("[Reverify] Scheduler disabled (REVERIFY_ENABLED=false)");
    return;
  }
  if (timer) return;

  const intervalHours = (config.intervalMs / (60 * 60 * 1000)).toFixed(1);
  console.log(
    `[Reverify] Scheduler started: every ${intervalHours}h, up to ${config.batchSize * config.maxBatchesPerRun} records/pass, stale after ${(config.staleAfterMs / DAY_MS).toFixed(0)}d`,
  );

  const scheduleNext = () => {
    nextRunAt = Date.now() + config.intervalMs;
  };

  // Kick off an initial pass shortly after boot so freshly-restarted instances
  // start closing the staleness gap without waiting a full interval.
  initialTimer = setTimeout(() => {
    void runReverifyPass("startup").finally(scheduleNext);
  }, config.initialDelayMs);

  timer = setInterval(() => {
    void runReverifyPass("scheduled").finally(scheduleNext);
  }, config.intervalMs);

  nextRunAt = Date.now() + config.initialDelayMs;
}

export function stopReverifyScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  nextRunAt = null;
}

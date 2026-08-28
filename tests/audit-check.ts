/**
 * Regression gate for the multi-conference audit diff.
 *
 * Consumes the machine-readable diff produced by `tests/audit-diff.ts --out=...`
 * and exits non-zero when overall or per-conference `ΔEmails` (after - baseline)
 * falls below a configurable threshold. Designed to be wired into CI (or run
 * manually) so a future scraper/parser change that quietly drops email coverage
 * fails the build instead of silently shipping.
 *
 * Usage:
 *   npx tsx tests/audit-check.ts --diff=/tmp/multi-conf-diff.json \
 *     [--total-threshold=-25] [--conference-threshold=-15] \
 *     [--school-threshold=-5]
 *
 * The thresholds are interpreted as the *minimum acceptable* ΔEmails:
 *   ΔEmails < threshold  ->  regression (fail)
 *   ΔEmails >= threshold ->  pass
 *
 * Defaults (also overridable via env vars so CI can tune without editing args):
 *   --total-threshold        AUDIT_CHECK_TOTAL_THRESHOLD        (default -25)
 *   --conference-threshold   AUDIT_CHECK_CONFERENCE_THRESHOLD   (default -15)
 *   --school-threshold       AUDIT_CHECK_SCHOOL_THRESHOLD       (default -5,
 *                              applied only when at least one conference or the
 *                              overall total has already regressed, so a single
 *                              flaky school does not gate the run on its own)
 *   --baseline-max-age-days  AUDIT_CHECK_BASELINE_MAX_AGE_DAYS  (default 30 --
 *                              prints a clear warning when the baseline's
 *                              `provenance.capturedAt` is older than this many
 *                              days, so a paused/forgotten baseline-refresh
 *                              cron is visible in the regression report)
 *   --baseline-fail-age-days AUDIT_CHECK_BASELINE_FAIL_AGE_DAYS (default 90 --
 *                              fails the check with exit code 3 when the
 *                              baseline is older than this, so a forgotten
 *                              cron does not coast indefinitely. Set to 0 to
 *                              disable the hard fail and only warn.)
 *
 * Exit codes:
 *   0  no regressions past any threshold
 *   1  one or more regressions detected
 *   2  bad CLI usage / unreadable diff file
 *   3  baseline is older than --baseline-fail-age-days (stale baseline)
 */

import * as fs from 'fs';

interface Aggregate {
  sites: number;
  contacts: number;
  emails: number;
  bioRecovered: number;
  bioFetched: number;
  bioCacheHits: number;
}

interface PerConference {
  conference: string;
  baseline: Aggregate;
  after: Aggregate;
  delta: Aggregate;
}

interface PerSchool {
  key: string;
  conference: string;
  school: string;
  deltaEmails: number;
  bioRecovered: number;
  afterEmails: number;
  baseEmails: number;
}

interface BaselineProvenance {
  capturedAt?: string;
  workflow?: string;
  runId?: string;
  runUrl?: string;
  commit?: string;
  [key: string]: unknown;
}

interface DiffFile {
  baseline: {
    path: string;
    startedAt?: string;
    total: Aggregate;
    provenance?: BaselineProvenance;
  };
  after: { path: string; startedAt?: string; total: Aggregate };
  totalDelta: Aggregate;
  perConference: PerConference[];
  perSchool: PerSchool[];
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=');
      out[k] = v.length ? v.join('=') : 'true';
    }
  }
  return out;
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Expected a finite number, got: ${raw}`);
  }
  return n;
}

function main() {
  const args = parseArgs();
  const diffPath = args['diff'];
  if (!diffPath) {
    console.error(
      'Usage: npx tsx tests/audit-check.ts --diff=<file> ' +
        '[--total-threshold=-25] [--conference-threshold=-15] [--school-threshold=-5]',
    );
    process.exit(2);
  }

  const totalThreshold = readNumber(
    args['total-threshold'] ?? process.env.AUDIT_CHECK_TOTAL_THRESHOLD,
    -25,
  );
  const conferenceThreshold = readNumber(
    args['conference-threshold'] ?? process.env.AUDIT_CHECK_CONFERENCE_THRESHOLD,
    -15,
  );
  const schoolThreshold = readNumber(
    args['school-threshold'] ?? process.env.AUDIT_CHECK_SCHOOL_THRESHOLD,
    -5,
  );
  const baselineMaxAgeDays = readNumber(
    args['baseline-max-age-days'] ?? process.env.AUDIT_CHECK_BASELINE_MAX_AGE_DAYS,
    30,
  );
  const baselineFailAgeDays = readNumber(
    args['baseline-fail-age-days'] ?? process.env.AUDIT_CHECK_BASELINE_FAIL_AGE_DAYS,
    90,
  );

  let raw: string;
  try {
    raw = fs.readFileSync(diffPath, 'utf8');
  } catch (e: any) {
    console.error(`Could not read diff file ${diffPath}: ${e?.message || e}`);
    process.exit(2);
  }

  let diff: DiffFile;
  try {
    diff = JSON.parse(raw) as DiffFile;
  } catch (e: any) {
    console.error(`Diff file ${diffPath} is not valid JSON: ${e?.message || e}`);
    process.exit(2);
  }

  if (
    !diff ||
    !diff.totalDelta ||
    !Array.isArray(diff.perConference) ||
    !diff.baseline ||
    !diff.baseline.total ||
    !diff.after ||
    !diff.after.total
  ) {
    console.error(
      `Diff file ${diffPath} is missing expected fields ` +
        `(baseline.total, after.total, totalDelta, perConference). Did you produce it with ` +
        `\`audit-diff.ts --out=...\`?`,
    );
    process.exit(2);
  }

  const failures: string[] = [];

  // Resolve the baseline's `provenance.capturedAt` so we can warn (or fail)
  // when the canonical baseline is stale. The diff JSON now passes
  // `baseline.provenance` through from audit-diff.ts, but older diff files
  // (or diffs produced before this passthrough landed) may not have it -- so
  // fall back to reading the baseline file directly when possible.
  let baselineProvenance: BaselineProvenance | undefined = diff.baseline.provenance;
  if (!baselineProvenance && diff.baseline.path) {
    try {
      const baseRaw = fs.readFileSync(diff.baseline.path, 'utf8');
      const baseJson = JSON.parse(baseRaw);
      if (baseJson && typeof baseJson === 'object' && baseJson.provenance) {
        baselineProvenance = baseJson.provenance as BaselineProvenance;
      }
    } catch {
      // Baseline file may not be on disk in this environment (e.g. running
      // audit-check on a diff downloaded from CI). That's fine -- we just
      // can't determine the age.
    }
  }

  const capturedAtRaw = baselineProvenance?.capturedAt;
  let baselineAgeDays: number | null = null;
  let baselineAgeUnknown = true;
  if (capturedAtRaw) {
    const capturedMs = Date.parse(capturedAtRaw);
    if (Number.isFinite(capturedMs)) {
      baselineAgeDays = (Date.now() - capturedMs) / (24 * 60 * 60 * 1000);
      baselineAgeUnknown = false;
    }
  }

  console.log(`\n=== audit-check ===`);
  console.log(`  diff file:             ${diffPath}`);
  console.log(`  baseline:              ${diff.baseline.path} (${diff.baseline.startedAt || 'n/a'})`);
  console.log(
    `  baseline capturedAt:   ${capturedAtRaw || 'unknown'}` +
      (baselineAgeDays !== null ? ` (~${baselineAgeDays.toFixed(1)} days old)` : ''),
  );
  console.log(`  after:                 ${diff.after.path} (${diff.after.startedAt || 'n/a'})`);
  console.log(`  total threshold:       ${totalThreshold} (fail if ΔEmails < threshold)`);
  console.log(`  conference threshold:  ${conferenceThreshold}`);
  console.log(`  school threshold:      ${schoolThreshold} (only when total/conf already regressed)`);
  console.log(
    `  baseline max age:      ${baselineMaxAgeDays} days (warn) / ` +
      `${baselineFailAgeDays > 0 ? `${baselineFailAgeDays} days (fail, exit 3)` : 'no hard fail'}`,
  );
  console.log(`  observed total ΔEmails: ${diff.totalDelta.emails}\n`);

  // Surface stale-baseline warnings prominently (at the top of the report,
  // before any pass/fail summary) so a forgotten baseline-refresh cron is
  // hard to miss. We also collect a separate "stale" exit reason so a
  // missed cron does not silently coast even when ΔEmails happens to look
  // healthy.
  let baselineStaleExit = false;
  if (baselineAgeUnknown) {
    console.warn(
      `WARNING: baseline has no provenance.capturedAt timestamp; cannot tell if it is stale. ` +
        `Re-run the "Email Coverage Baseline Refresh" workflow so the canonical artifact carries a fresh capturedAt.`,
    );
    console.log('');
  } else if (baselineAgeDays !== null) {
    if (baselineFailAgeDays > 0 && baselineAgeDays > baselineFailAgeDays) {
      console.error(
        `STALE BASELINE: baseline.capturedAt=${capturedAtRaw} is ~${baselineAgeDays.toFixed(1)} days old, ` +
          `which exceeds --baseline-fail-age-days=${baselineFailAgeDays}. ` +
          `The baseline-refresh cron may be paused or failing -- re-run "Email Coverage Baseline Refresh" ` +
          `before trusting this diff.`,
      );
      console.log('');
      baselineStaleExit = true;
    } else if (baselineAgeDays > baselineMaxAgeDays) {
      console.warn(
        `WARNING: baseline.capturedAt=${capturedAtRaw} is ~${baselineAgeDays.toFixed(1)} days old, ` +
          `which exceeds --baseline-max-age-days=${baselineMaxAgeDays}. ` +
          `Consider re-running the "Email Coverage Baseline Refresh" workflow so this diff compares ` +
          `against a current baseline.`,
      );
      console.log('');
    }
  }

  if (diff.totalDelta.emails < totalThreshold) {
    failures.push(
      `TOTAL ΔEmails=${diff.totalDelta.emails} is below threshold ${totalThreshold} ` +
        `(baseline=${diff.baseline.total.emails}, after=${diff.after.total.emails})`,
    );
  }

  const regressedConferences: PerConference[] = [];
  for (const pc of diff.perConference) {
    if (pc.delta.emails < conferenceThreshold) {
      regressedConferences.push(pc);
      failures.push(
        `Conference [${pc.conference}] ΔEmails=${pc.delta.emails} is below threshold ` +
          `${conferenceThreshold} (baseline=${pc.baseline.emails}, after=${pc.after.emails})`,
      );
    }
  }

  // When anything failed, always surface the worst offenders so the next
  // agent has concrete conferences/schools to investigate -- even when the
  // regression is spread across many small per-conference drops that
  // individually stay under the conference threshold but add up to a total
  // failure.
  if (failures.length > 0) {
    if (regressedConferences.length) {
      console.log('Conferences that regressed past the conference threshold:');
      for (const pc of regressedConferences) {
        console.log(
          `  ${pc.conference}: ${pc.baseline.emails} -> ${pc.after.emails} ` +
            `(ΔEmails=${pc.delta.emails})`,
        );
      }
      console.log('');
    }

    const TOP_N = 10;
    const worstConferences = [...diff.perConference]
      .filter(pc => pc.delta.emails < 0)
      .sort((a, b) => a.delta.emails - b.delta.emails)
      .slice(0, TOP_N);
    if (worstConferences.length) {
      console.log(`Top ${worstConferences.length} most-negative conferences (any drop):`);
      for (const pc of worstConferences) {
        console.log(
          `  ${pc.conference}: ${pc.baseline.emails} -> ${pc.after.emails} ` +
            `(ΔEmails=${pc.delta.emails})`,
        );
      }
      console.log('');
    }

    const allSchoolDrops = (diff.perSchool || [])
      .filter(s => s.deltaEmails < 0)
      .sort((a, b) => a.deltaEmails - b.deltaEmails);
    const offendingSchools = allSchoolDrops.filter(s => s.deltaEmails < schoolThreshold);
    if (offendingSchools.length) {
      console.log('Schools that regressed past the school threshold:');
      for (const s of offendingSchools) {
        console.log(
          `  [${s.conference}] ${s.school}: ${s.baseEmails} -> ${s.afterEmails} ` +
            `(ΔEmails=${s.deltaEmails})`,
        );
      }
      console.log('');
    } else if (allSchoolDrops.length) {
      const top = allSchoolDrops.slice(0, TOP_N);
      console.log(
        `No school crossed --school-threshold=${schoolThreshold}, but the top ${top.length} ` +
          `most-negative schools are:`,
      );
      for (const s of top) {
        console.log(
          `  [${s.conference}] ${s.school}: ${s.baseEmails} -> ${s.afterEmails} ` +
            `(ΔEmails=${s.deltaEmails})`,
        );
      }
      console.log('');
    }
  }

  if (failures.length === 0) {
    if (baselineStaleExit) {
      console.error(
        `FAIL (stale baseline): total ΔEmails=${diff.totalDelta.emails} is within thresholds, but the ` +
          `baseline is older than --baseline-fail-age-days. Refresh the baseline before trusting this diff.`,
      );
      process.exit(3);
    }
    console.log(
      `PASS: total ΔEmails=${diff.totalDelta.emails} and all ${diff.perConference.length} ` +
        `conferences are within thresholds.`,
    );
    process.exit(0);
  }

  console.error(`FAIL: ${failures.length} email-coverage regression(s) detected:`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  console.error(
    `\nTune the thresholds via --total-threshold/--conference-threshold/--school-threshold ` +
      `or AUDIT_CHECK_TOTAL_THRESHOLD/AUDIT_CHECK_CONFERENCE_THRESHOLD/AUDIT_CHECK_SCHOOL_THRESHOLD.`,
  );
  // Regression failures take precedence over stale-baseline failures (the
  // stale warning is still printed above), so CI sees the more actionable
  // signal first.
  process.exit(1);
}

main();

# Measuring email-coverage lift from bio enrichment

The multi-conference audit (`tests/multi-conf-audit.ts`) records, for every
school it visits, how many emails the bio-page follow-up recovered
(`bioEmailsRecovered`), how many bio pages it actually fetched
(`bioPagesFetched`), and how many were served from the cache
(`bioCacheHits`). Combined with the `audit-diff.ts` script, this lets us
measure the +500-email target from Task #9 directly.

## Canonical baseline

The "bio enrichment disabled" baseline is expensive to regenerate
(~30+ minutes against every staff directory in
`shared/ncaa-conferences.ts`), so we publish a canonical copy as a
named CI artifact instead of asking each contributor to recreate one.
See `tests/baselines/PROVENANCE.md` for the full provenance contract,
but the short version is:

- The **Email Coverage Baseline Refresh** workflow
  (`.github/workflows/email-coverage-baseline.yml`) runs weekly (and on
  demand) with `SCRAPER_BIO_ENRICH_MAX_PAGES=0 --all`.
- It uploads `audit-baseline.json` as the
  `audit-baseline-canonical-latest` artifact (90-day retention) with a
  `provenance` block stamped onto the JSON (workflow run id, commit
  SHA, capture timestamp, sample knobs).
- The regression check workflow downloads that artifact by default,
  so PR runs only have to do the "after" scrape.

To grab the canonical baseline locally:

```bash
gh run download \
  --repo <owner>/<repo> \
  --name audit-baseline-canonical-latest \
  --workflow email-coverage-baseline.yml \
  --dir .
```

## Reproducing a baseline-vs-after comparison

1. **Baseline.** Either fetch the canonical artifact above (preferred),
   or regenerate locally with `SCRAPER_BIO_ENRICH_MAX_PAGES=0`:

   ```bash
   SCRAPER_BIO_ENRICH_MAX_PAGES=0 \
     npx tsx tests/multi-conf-audit.ts \
     --all --out=/tmp/multi-conf-baseline.json
   ```

2. **After run with bio enrichment enabled** (default settings):

   ```bash
   npx tsx tests/multi-conf-audit.ts \
     --all --out=/tmp/multi-conf-after.json
   ```

3. **Diff the two runs.** Per-conference `ΔEmails`, per-parser breakdown,
   and the top per-school movers all come from a single command:

   ```bash
   npx tsx tests/audit-diff.ts \
     --baseline=/tmp/multi-conf-baseline.json \
     --after=/tmp/multi-conf-after.json \
     --out=/tmp/multi-conf-diff.json
   ```

   The optional `--out` produces a machine-readable JSON that is safe to
   check in (or attach to the related task) so future scraper changes can
   be compared against the recorded baseline.

## Failing the build on email-coverage regressions

`tests/audit-check.ts` consumes the machine-readable diff above and exits
non-zero when the overall or per-conference `ΔEmails` regresses past a
configurable threshold. Wire it into CI right after `audit-diff.ts` so a
scraper/parser change that quietly drops emails fails the run instead of
relying on a human to read the table:

```bash
npx tsx tests/audit-check.ts \
  --diff=/tmp/multi-conf-diff.json \
  --total-threshold=-25 \
  --conference-threshold=-15 \
  --school-threshold=-5
```

Thresholds are interpreted as the *minimum acceptable* `ΔEmails`
(`after - baseline`); anything strictly below the threshold fails. The
defaults are `-25` overall, `-15` per conference, and `-5` per school
(per-school regressions are only reported when something larger has
already failed, so a single noisy school does not gate the run on its
own). Each threshold also has an environment-variable override so CI can
tune it without editing args:

| Flag                       | Env var                              | Default |
|----------------------------|--------------------------------------|---------|
| `--total-threshold`        | `AUDIT_CHECK_TOTAL_THRESHOLD`        | `-25`   |
| `--conference-threshold`   | `AUDIT_CHECK_CONFERENCE_THRESHOLD`   | `-15`   |
| `--school-threshold`       | `AUDIT_CHECK_SCHOOL_THRESHOLD`       | `-5`    |

When the check fails it prints the offending conferences and schools by
name (with baseline -> after counts) so the next agent can jump straight
to the regressed sites.

Exit codes: `0` = pass, `1` = regression detected, `2` = bad usage or
unreadable diff file.

## Running the regression check in CI

The whole baseline → after → diff → check sequence runs automatically on
every push and pull request that touches the scraper code paths via
`.github/workflows/email-coverage-audit.yml`. The workflow:

1. Installs deps and Playwright's Chromium build.
2. Downloads `audit-baseline.json` from the latest successful run of the
   **Email Coverage Baseline Refresh** workflow
   (`.github/workflows/email-coverage-baseline.yml`, artifact name
   `audit-baseline-canonical-latest`). If the artifact is missing, or
   the workflow_dispatch input `regenerate_baseline=true` is set, it
   falls back to running `tests/multi-conf-audit.ts` with
   `SCRAPER_BIO_ENRICH_MAX_PAGES=0` to produce a fresh baseline locally.
3. Runs `tests/multi-conf-audit.ts` with the defaults to produce
   `audit-after.json`.
4. Runs `tests/audit-diff.ts` to produce `audit-diff.json`.
5. Runs `tests/audit-check.ts --diff=audit-diff.json`. The check reads its
   thresholds from the `AUDIT_CHECK_TOTAL_THRESHOLD`,
   `AUDIT_CHECK_CONFERENCE_THRESHOLD`, and `AUDIT_CHECK_SCHOOL_THRESHOLD`
   env vars defined on the job, so they can be tuned without code edits.
6. Uploads all three JSON files as build artifacts so a failing run can be
   inspected without re-scraping.

The baseline workflow itself runs on a weekly cron (Sunday 06:00 UTC) and
on demand. See `tests/baselines/PROVENANCE.md` for the full contract,
including the `provenance` block that gets stamped onto each baseline
JSON so a regression report can always be traced back to the exact
scrape it was diffed against.

The push/PR triggers use a path filter so only changes under
`server/lib/scraper-*`, `server/lib/parser-factory.ts`,
`server/lib/browser-pool.ts`, `server/lib/bio-cache.ts`,
`server/lib/spa-host-cache.ts`, `server/lib/ai-extractor.ts`,
`server/lib/known-directory-urls.ts`, `shared/ncaa-conferences.ts`, the
`tests/audit-*` / `tests/multi-conf-audit.ts` scripts, and the workflow
file itself trigger the job. A `workflow_dispatch` trigger is also wired
up so a maintainer can run the check on demand and override the per-conf
sample size, the conference filter, and any of the three thresholds from
the GitHub Actions UI.

## Tuning bio enrichment

Relevant env vars in `server/lib/scraper-worker.ts`:

| Variable                              | Default | Purpose                                      |
|---------------------------------------|---------|----------------------------------------------|
| `SCRAPER_BIO_ENRICH_MAX_PAGES`        | `40`    | Per-scrape cap on bio-page fetches (0 = off) |
| `SCRAPER_BIO_ENRICH_CONCURRENCY`      | `5`     | Parallel bio fetches per scrape              |
| `SCRAPER_BIO_ENRICH_TIMEOUT_MS`       | `8000`  | Per-bio fetch timeout                        |

Set `SCRAPER_BIO_ENRICH_MAX_PAGES=0` to disable enrichment entirely, which
is what produces a clean baseline.

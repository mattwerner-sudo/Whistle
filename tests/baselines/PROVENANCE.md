# Canonical email-coverage baseline

The email-coverage regression check (`tests/audit-check.ts`) needs a
"bio enrichment disabled" baseline scrape to diff every PR against.
Generating one locally takes ~30+ minutes and depends on every staff
directory's network reachability, so we keep a canonical copy as a
named CI artifact instead of asking each contributor to recreate it.

## Where the canonical baseline lives

GitHub Actions artifact, produced by
`.github/workflows/email-coverage-baseline.yml`:

- Workflow: **Email Coverage Baseline Refresh**
- Artifact name: `audit-baseline-canonical-latest`
- Retention: 90 days
- Each scheduled run also uploads a per-run copy named
  `audit-baseline-canonical-<run_id>` for historical comparison.

## How it is produced

The scheduled job runs:

```bash
SCRAPER_BIO_ENRICH_MAX_PAGES=0 \
  npx tsx tests/multi-conf-audit.ts \
    --all --concurrency=4 --site-timeout=120000 \
    --out=audit-baseline.json
```

Then a post-step stamps a `provenance` block onto the JSON with the
workflow run id, commit SHA, capture timestamp, and the sample knobs
that were used:

```json
{
  "provenance": {
    "workflow": "email-coverage-baseline.yml",
    "runId": "...",
    "runUrl": "https://github.com/<owner>/<repo>/actions/runs/...",
    "commit": "<sha>",
    "ref": "refs/heads/main",
    "perConf": "all",
    "conferences": "",
    "capturedAt": "2026-04-22T06:00:00.000Z",
    "bioEnrichmentDisabled": true
  }
}
```

`audit-diff.ts` already prints `baseline.startedAt`/`after.startedAt` in
the diff header, and `audit-check.ts` echoes the baseline path it was
given, so once this provenance ships a regression report makes it
trivial to trace the exact baseline that was compared against.

## Staleness gate

`audit-diff.ts` passes `baseline.provenance` through into the
machine-readable diff, and `audit-check.ts` reads
`provenance.capturedAt` to detect a stale baseline:

- `--baseline-max-age-days` / `AUDIT_CHECK_BASELINE_MAX_AGE_DAYS`
  (default `30`) prints a clear `WARNING` in the regression report when
  the baseline was captured more than this many days ago. The check
  still passes -- this is a heads-up that the canonical refresh might
  need attention.
- `--baseline-fail-age-days` / `AUDIT_CHECK_BASELINE_FAIL_AGE_DAYS`
  (default `90`) hard-fails the check with exit code `3` when the
  baseline is older than this. Set the value to `0` to disable the
  hard fail and only warn. This way a paused baseline-refresh cron or
  an archived repo cannot let the regression gate coast indefinitely
  against an ever-older baseline.

When `provenance.capturedAt` is missing entirely (e.g. an old baseline
captured before this stamp existed), `audit-check.ts` prints a separate
"cannot tell if it is stale" warning so the missing timestamp is
visible too.

## Refresh cadence

- Weekly (`cron: '0 6 * * 0'`).
- On demand via the workflow's **Run workflow** button. The dispatch
  form exposes `per_conf` and `conferences` so a maintainer can produce
  a smaller, faster baseline for an experimental change.

## How the regression check consumes it

`.github/workflows/email-coverage-audit.yml` downloads
`audit-baseline-canonical-latest` from the latest successful run of
the baseline workflow before doing its own "after" scrape. If the
artifact is missing (e.g. brand new repo, expired retention) the job
falls back to regenerating the baseline locally so the check still
runs. A `regenerate_baseline` workflow_dispatch input forces the
regenerate path explicitly -- use it when something in
`tests/multi-conf-audit.ts` changes the JSON schema in a way that
makes the canonical artifact stale.

## Reproducing the baseline locally

If you need to diff against the same baseline locally, download the
artifact from the latest **Email Coverage Baseline Refresh** run and
unzip it next to your "after" JSON:

```bash
gh run download \
  --repo <owner>/<repo> \
  --name audit-baseline-canonical-latest \
  --workflow email-coverage-baseline.yml \
  --dir .

npx tsx tests/multi-conf-audit.ts --all --out=audit-after.json
npx tsx tests/audit-diff.ts \
  --baseline=audit-baseline.json \
  --after=audit-after.json \
  --out=audit-diff.json
npx tsx tests/audit-check.ts --diff=audit-diff.json
```

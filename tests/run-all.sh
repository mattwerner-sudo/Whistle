#!/usr/bin/env bash
# Whistle test runner.
#
# The files in tests/ are standalone tsx scripts (each prints its own
# ok/FAIL lines and exits non-zero on failure) — they are NOT jest tests,
# despite jest having been in package.json historically. Two of them
# (credit-idempotency, reveal-paywall) write to the real DATABASE_URL and
# clean up after themselves; they are skipped unless DATABASE_URL is set.
set -uo pipefail
cd "$(dirname "$0")/.."

# The scripts import server modules directly, bypassing server/index.ts where
# dotenv is loaded — so export .env here for the DB-backed suites.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_TESTS="credit-idempotency.test.ts reveal-paywall.test.ts"
failures=0
ran=0
skipped=0

for f in tests/*.test.ts; do
  base="$(basename "$f")"
  if [[ " $DB_TESTS " == *" $base "* ]] && [[ -z "${DATABASE_URL:-}" ]] && ! grep -q '^DATABASE_URL=.' .env 2>/dev/null; then
    echo "SKIP  $base (needs DATABASE_URL)"
    skipped=$((skipped + 1))
    continue
  fi
  echo "=== $base ==="
  if npx tsx "$f"; then
    ran=$((ran + 1))
  else
    failures=$((failures + 1))
    echo "FAILED: $base"
  fi
done

echo
echo "passed suites: $ran, failed: $failures, skipped: $skipped"
exit "$failures"

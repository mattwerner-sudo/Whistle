#!/usr/bin/env bash
# Whistle test runner.
#
# The files in tests/ are standalone tsx scripts (each prints its own
# ok/FAIL lines and exits non-zero on failure) — they are NOT jest tests,
# despite jest having been in package.json historically. Two of them
# (credit-idempotency, reveal-paywall) write to the real DATABASE_URL and
# clean up after themselves; they are skipped unless DATABASE_URL is set.
# One (api-auth-gate) makes real HTTP requests and needs a live server; this
# script boots and tears one down around it rather than requiring the caller
# to have npm run dev already running.
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
HTTP_TESTS="api-auth-gate.test.ts"
SERVER_PORT="${PORT:-5001}"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

start_server_if_needed() {
  if [[ -n "$SERVER_PID" ]]; then return; fi
  if curl -s -o /dev/null -m 2 "http://localhost:${SERVER_PORT}/health" 2>/dev/null; then
    echo "  (using already-running server on :${SERVER_PORT})"
    return
  fi
  echo "  (booting dev server on :${SERVER_PORT} for HTTP-based tests)"
  npm run dev > /tmp/whistle-test-server.log 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 30); do
    curl -s -o /dev/null -m 1 "http://localhost:${SERVER_PORT}/health" 2>/dev/null && return
    sleep 1
  done
  echo "  server did not become healthy in time; see /tmp/whistle-test-server.log"
}

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
  if [[ " $HTTP_TESTS " == *" $base "* ]]; then
    start_server_if_needed
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

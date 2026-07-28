---
name: testing conventions
description: How tests are written/run in this repo and how to test DB/Stripe-touching server code.
---

# Testing conventions

Tests live in `tests/*.test.ts` and run as standalone scripts via `npx tsx tests/<file>.test.ts`.
They use a hand-rolled `check(name, cond)` helper that logs `ok`/`FAIL` and `process.exit(1)` on any failure.
There is **no test runner configured** — `jest`/`ts-jest` are in `package.json` deps but unused, and there is no `test` npm script. Do not assume `npm test` works. Follow the tsx-script pattern.

**Why:** the repo never wired up jest; the established, working convention is tsx scripts.

## Testing code that touches the DB or Stripe
- The real Postgres DB is available in this env (`DATABASE_URL` is set). Tests can `import { db, pool } from "../server/db"`, seed rows, assert, then clean up. **Always `await pool.end()` at the end** or the Neon websocket keeps the process alive and the harness kills it with a non-zero exit.
- Stripe must not be hit in tests. The seam used: server services that call Stripe expose an injectable `deps` parameter (default = real impls) so tests pass fakes. Example: `revealContact(opts, deps?)` in `server/lib/reveal-service.ts` injects `meterRevealCharge`/`recordPaymentFailure`. Prefer this dependency-injection seam over module mocking (ESM `type: module` makes mocking hard).
- `*.test.ts` is excluded from `tsconfig.json`, so tests don't affect `npm run check`/`tsc`.

# Whistle — CLAUDE.md

## What this is
Whistle is a collegiate athletics sales intelligence platform — a purpose-built ZoomInfo/Apollo alternative for B2B vendors selling into college athletic departments. It scrapes, aggregates, and enriches contact and organizational data for 1,168 NCAA schools, then surfaces intent signals (AD/coach turnover, new hires, tech-stack changes) that generalist tools don't cover.

**This project is completely separate from GDNE (the aggregator app). Do not reference, import from, or interact with GDNE in any way.**

---

## Dev Environment

### Stack
- **Runtime**: Node.js 20+, TypeScript (ESM), Express
- **Frontend**: React 18 + Vite, shadcn/ui, Tailwind CSS, Wouter routing, React Query
- **Database**: PostgreSQL via [Neon](https://neon.tech) (serverless Postgres) + Drizzle ORM
- **AI**: Google Gemini 2.5 Flash (`@google/genai`)
- **Scraping**: Playwright/Chromium (headless), custom parser-factory pattern
- **Auth**: Session-based (express-session + connect-pg-simple), Argon2id password hashing

### Local setup
```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, GEMINI_API_KEY, SESSION_SECRET
npx drizzle-kit push        # push schema to Neon
npm run dev                 # runs Express + Vite concurrently
```

### Environment variables (required)
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon connection string (postgresql://...) |
| `GEMINI_API_KEY` | Google Gemini AI |
| `SESSION_SECRET` | express-session signing key |
| `STRIPE_SECRET_KEY` | Stripe billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `SENDGRID_API_KEY` | Transactional email |
| `ADMIN_SECRET` | Admin endpoint protection |

### Source control
- **GitHub** is the source of truth: `git push origin main`
- No Replit, no Replit-specific config should be added
- Keep `.replit` and `replit.md` in the repo but don't maintain them

---

## Architecture

### Data pipeline (the core product)
```
School list (1,168 schools)
  → parser-factory.ts (strategy dispatch by school/CMS type)
  → Playwright headless browser (JS-rendered pages)
  → Gemini AI extraction (unstructured HTML → structured staff records)
  → staff_members table (PostgreSQL/Neon)
  → change detection (new hires, departures, title changes → staff_change_logs)
  → signals table (intent signal generation)
```

Key files:
- `server/lib/parser-factory.ts` — dispatch strategy by school; extend this when adding new parsers
- `server/lib/job-queue.ts` — background job queue with p-limit concurrency; single Chromium instance
- `server/lib/health-monitor.ts` — extraction stats tracking
- `shared/schema.ts` — canonical schema; Drizzle migrations are the source of truth for DB shape
- `server/lib/reveal-service.ts` — contact reveal / quota enforcement (subscription-gated)

### Pricing model (annual-only, no PAYG)
| Tier | Price | Reveals/yr | Seats |
|------|-------|------------|-------|
| Pro | $2,400/yr | 2,400 | 1 |
| Team | $7,200/yr | 9,600 | 5 |
| Enterprise | $18,000/yr | 36,000 | unlimited |

- All plans: 14-day trial, card required at signup
- Overage charged via Stripe invoice items
- `entitlements` table is canonical for billing state; always sync via `syncEntitlementFromUser()`
- Billing code lives in `server/routes/billing.ts`, `server/routes/stripe.ts`, `server/stripeService.ts`, `server/webhookHandlers.ts` — treat this as the money path, be careful

### Seat / org model
Every user belongs to an `organization`. The org owner is the billing user. Members share the owner's quota.
- `organizations` / `organizationMembers` / `organizationInvites` tables
- Seat enforcement: `server/routes/org.ts`
- Org is created automatically on signup

### Auth
- Session auth for web app (`requireUser` middleware in `server/middleware/require-user.ts`)
- API key auth for external API v1 and Whistle Connect extension (`validateApiKey` in `server/middleware/api-auth.ts`)
- Dead no-op `requireAuth` in `server/middleware/auth.ts` has been fixed — it now does real session validation

### External API (v1)
Lives at `/api/v1/*`. Has Swagger UI at `/api/docs`. Authenticated via API keys. Rate-limited. This is the basis for the marketplace-listed API.

---

## MCP Server (target: ship this)

Whistle should be listable as an MCP server so AI agents (Claude, Cursor, etc.) can query athletic department data directly.

### Tools to expose
| MCP Tool | Description |
|----------|-------------|
| `search_staff` | Query staff by name, title, school, conference |
| `get_school` | Full school profile — staff list, org data, NIL collective |
| `get_signals` | Recent hire/departure/tech-change signals for a school or conference |
| `trigger_scrape` | Queue a scrape/refresh for a school (rate-limited, auth required) |

### Implementation plan
- `server/mcp/index.ts` — MCP server entry point using `@modelcontextprotocol/sdk`
- Tool definitions map 1:1 to existing DB queries (most already exist as API endpoints)
- Auth: API key in MCP client config (`WHISTLE_API_KEY` env var)
- Rate limit: reuse `apiLimiter` middleware logic
- Transport: stdio for local use, HTTP SSE for hosted use

### MCP server listing
- List on [mcp.so](https://mcp.so) and [Smithery](https://smithery.ai)
- README must include: install snippet, auth instructions, tool list with examples

---

## API Marketplace Strategy

Primary value prop for marketplace buyers: **contact database API** — query staff emails/phones/titles for 1,168 schools without scraping yourself.

### Target platforms
1. **RapidAPI** — largest API marketplace; list under "Data / Business" category
2. **AppSumo** — lifetime deal for early traction; good for the "1,168 schools" angle
3. **Pipedream** / **Zapier** — integration platform listings for no-code buyers

### Key endpoints to surface
```
GET  /api/v1/schools                   # list/search schools
GET  /api/v1/schools/:id/staff         # staff for a school
GET  /api/v1/staff/search              # search across all staff
POST /api/v1/schools/:id/refresh       # trigger a data refresh
GET  /api/v1/signals                   # intent signals feed
```

### Pricing on marketplaces
- **Free tier**: 100 requests/mo (drives trial)
- **Basic**: $49/mo — 5,000 requests
- **Pro**: $199/mo — 50,000 requests + signals access
- These are marketplace-specific prices, separate from the Whistle app subscription

---

## Data quality standards (enforce these)
- Every `staff_members` row must have `lastScrapedAt` — add this if missing
- Email confidence: `confirmed` (bounce-verified), `extracted` (AI-parsed), `inferred` (guessed from pattern)
- No duplicates: deduplicate on `(schoolId, normalizedLastName, normalizedFirstName)` at ingest
- Stale threshold: records >90 days old should be flagged for re-scrape

---

## Key patterns

### Adding a new school parser
Extend `server/lib/parser-factory.ts`. Match on `knownDirectoryUrl` patterns. Return structured `StaffMember[]`. Don't scrape if `lastScrapedAt` is fresh.

### Adding a new intent signal type
1. Detect in the staff comparison logic in `server/lib/job-queue.ts`
2. Insert into `signals` table with appropriate `type` and `schoolId`
3. Dispatch to `server/lib/webhooks.ts` if subscriber exists

### Running a migration
```bash
npx drizzle-kit generate   # generate migration file
npx drizzle-kit push       # apply to Neon
```
Never edit the `entitlements` table structure without updating `server/lib/entitlements.ts`.

---

## What NOT to do
- Don't add Replit-specific config or dependencies
- Don't reference or import from the GDNE aggregator project
- Don't modify `server/webhookHandlers.ts` billing logic without reading the full file first
- Don't add a free tier or PAYG — pricing is annual-only subscriptions
- Don't auto-commit Drizzle migrations on a live schema — generate and review first
- Don't remove the `entitlements` table or change its primary key
- Don't skip SSRF validation on any endpoint that fetches a user-supplied URL

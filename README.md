# Whistle

**Collegiate Athletics Intelligence Platform** — a GTM (go-to-market) tool that gives sales, recruiting, and marketing teams searchable, AI-enriched contact data and signal-driven account intelligence for every NCAA athletic department.

Whistle ingests staff directories from 1,168 college athletic department websites, deduplicates and enriches the data with Google Gemini, and surfaces high-intent events (new hires, departures, tech-stack changes, warm paths, and personal LinkedIn connections) through a HubSpot-style dashboard.

---

## Highlights

- **College Schools Browser** — search, filter, and bulk-export all 1,168 institutions and their staff.
- **AI-powered staff extraction** — headless Chromium + a parser-strategy pipeline (Sidearm, Presto, WordPress, Table, Generic) with circuit-breaker fault tolerance, validated through Gemini.
- **ABM 2.0 Signal Engine** — detects new hires, departures, tech adds/drops, warm paths through prior employers, and your own LinkedIn network connections.
- **Whistle Connect** — a Chrome extension that syncs your 1st-degree LinkedIn network to Whistle and matches it against staff records, so each school shows "you know N people here."
- **External REST API (`/api/v1`)** — data enrichment, account matching, school listings, staff search, API-key management, and webhook subscriptions, with Swagger UI and rate limiting.
- **Data Health dashboard** — freshness metrics, priority-based staleness, bulk re-extraction, failure categorization, and a needs-review queue.

---

## Tech Stack

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript (Vite), Wouter, TanStack Query, shadcn/ui, Tailwind, Radix UI |
| Backend | Node.js, Express, TypeScript (ESM) |
| Database | PostgreSQL (Neon serverless driver) + Drizzle ORM |
| AI | Google Gemini (`@google/genai`, `gemini-2.5-flash`) |
| Scraping | Playwright (single shared Chromium pool), `p-limit` worker queue |
| Payments | Stripe |
| Validation | Zod (+ `drizzle-zod`) |

---

## Repository Layout

```
.
├── client/                    # React + Vite frontend (pages, components, hooks)
├── server/                    # Express API, scraper workers, AI integrations
│   ├── routes/                # Route modules (linkedin, auth, etc.)
│   ├── lib/                   # Matchers, parsers, browser pool, signal engine
│   └── middleware/            # API key + session auth
├── shared/                    # Drizzle schema + Zod types shared by client & server
├── whistle-connect-extension/ # Chrome extension source (LinkedIn sync)
├── drizzle.config.ts          # Drizzle migration config
├── vite.config.ts             # Vite config (do not edit on Replit)
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- A PostgreSQL database (e.g. Neon, Supabase, or local Postgres)
- A Google Gemini API key
- (Optional) Stripe API keys if you intend to exercise billing flows

### 1. Install

```bash
npm install
```

### 2. Configure environment

Create a `.env` file at the repo root (Replit users: use the Secrets pane instead — never commit secrets):

```bash
DATABASE_URL=postgres://user:pass@host:5432/whistle
GEMINI_API_KEY=your-gemini-key
ADMIN_SECRET=some-long-random-string         # protects /api/admin/* endpoints
SESSION_SECRET=another-long-random-string    # signs session cookies

# Optional
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 3. Push the schema

```bash
npm run db:push
```

### 4. Run

```bash
npm run dev
```

The Express server and Vite dev server share a single port and are reverse-proxied automatically. Open the printed URL in your browser.

---

## Available Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (Express + Vite, hot reload). |
| `npm run check` | TypeScript type-check the entire repo. |
| `npm run build` | Build the production client bundle and ESM server bundle to `dist/`. |
| `npm run start` | Run the built production server (expects `dist/` to exist). |
| `npm run db:push` | Push the Drizzle schema to the configured database. |

---

## External API

The headless v1 API lives under `/api/v1` and is documented via Swagger UI at `/api/v1/docs`. All endpoints require a per-user API key (`Authorization: Bearer <key>` or `X-API-Key`) and are rate-limited.

Key endpoints:

- `POST /api/v1/enrich` — enrich a single school
- `POST /api/v1/match` — bulk account matching
- `GET  /api/v1/schools` — list all schools
- `GET  /api/v1/staff` — search staff across schools
- `POST /api/v1/linkedin/connections` — Whistle Connect ingestion (extension)

---

## Whistle Connect (LinkedIn Sync)

The Chrome extension in `whistle-connect-extension/` is a fork of the open-source GTMBase LinkedIn sync, stripped of all third-party analytics. It pulls 1st-degree connections from LinkedIn's voyager API and POSTs batches to `POST /api/v1/linkedin/connections` using a per-user Whistle API key. The Whistle base URL is baked in at zip-build time via `server/lib/extension-zip.ts` (a pure-Node ZIP builder), and users download the ready-to-install zip from the **Whistle Connect** page in-app.

Connections are matched against staff records by exact LinkedIn slug (high confidence) and a fuzzy name + headline-school fallback (capped at 90% confidence). On the first null→matched transition, a `network_connection` signal is emitted and surfaced in the Signal Feed and on the relevant school page ("you know N people here").

---

## Deployment

This project is built to deploy on Replit (one-click via the **Publish** button). It can also run on any Node.js host: build with `npm run build` and serve with `npm run start`, with the same environment variables set.

When deploying:

- Provision a managed Postgres and set `DATABASE_URL`.
- Run `npm run db:push` once before first start to create the schema.
- Set all secrets listed in the **Configure environment** section.

---

## Development Notes

- Schema-first: model changes go in `shared/schema.ts` (Drizzle table + `createInsertSchema`); types flow to both client and server.
- Storage access goes through the `IStorage` interface in `server/storage.ts`.
- Frontend data fetching uses TanStack Query with the shared default fetcher in `client/src/lib/queryClient.ts`. Query keys are arrays (e.g. `['/api/staff', id]`) so cache invalidation works.
- All interactive elements carry stable `data-testid` attributes for end-to-end testing.
- Do **not** modify `vite.config.ts`, `server/vite.ts`, `drizzle.config.ts`, or `package.json` scripts directly when developing on Replit — the platform manages them.

---

## License

Proprietary — internal use only.

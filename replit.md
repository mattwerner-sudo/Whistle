# Whistle - Collegiate Athletics Intelligence Platform

## Overview
Whistle is an open internal enterprise GTM intelligence tool providing college athletic staff data and sales intelligence. It offers a College Schools Browser with search, filter, and bulk download capabilities for all 1168 college institutions. The platform utilizes AI-powered staff extraction to gather contact details from athletic department websites and leverages Google Gemini AI for advanced functionalities like team structure analysis, email drafting, and meeting preparation, aiding sales, recruiting, and marketing efforts. The project aims to transition from an internal tool to a public-facing product.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript (Vite).
- **UI**: shadcn/ui (New York style) with Radix UI primitives, Tailwind CSS for styling, and an Inter font.
- **State Management**: React Query for server state; local React hooks for component state.
- **Routing**: Wouter.
- **Key Design Decisions**: Staff Directory at root, sidebar navigation, conference filtering, click-to-extract functionality, modal-based AI interactions, responsive design, real-time job progress, and HubSpot CRM-inspired UI with purple branding.

### Backend
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript with ES modules.
- **API Structure**: RESTful endpoints for college schools, staff extraction, account matching, new hire tracking, and external API integrations.
- **External API (v1)**: Provides data enrichment, bulk account matching, school listing, staff search, API key management, and webhook subscriptions with Swagger UI.
- **Rate Limiting**: Implemented for API v1 and admin endpoints.
- **Security**: Admin endpoints protected by `ADMIN_SECRET`.
- **JavaScript Rendering**: Headless Chromium (Playwright) for JS-rendered pages with caching and retry logic.
- **Validation**: Zod schemas.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Tables for `school_directories`, `staff_members`, `extraction_jobs`, `usage_events`, `staff_change_logs`, `api_keys`, `webhook_subscriptions`, and `webhook_delivery_logs`.
- **Full-Text Search**: PostgreSQL `tsvector` with GIN index on `staff_members`.

### Background Job Queue
- **Architecture**: Worker pool using `p-limit` for concurrency.
- **Job Types**: Single school, conference, and bulk pending schools extraction.
- **Browser Pool**: Single global Chromium instance, shared across extractions, with lightweight BrowserSession.
- **Turnover Tracking**: Compares staff by email to detect new hires, departures, and title changes.

### AI Integration
- **Provider**: Google Gemini AI (`@google/genai` SDK).
- **Model**: `gemini-2.5-flash`.
- **Use Cases**: Team structure analysis, data cleaning, email drafting, meeting preparation.

### GTM Intelligence - Buyer Personas
- **Classification**: Identifies persona types (champion, signer, blocker, etc.) and functional areas (executive, operations, finance, etc.) based on titles.
- **Priority-Based Matching**: More specific titles match before general ones.

### Whistle Connect (LinkedIn Network Sync)
- **Chrome Extension** (`whistle-connect-extension/`): Forked from open-source GTMBase LinkedIn sync; Clay analytics endpoint stripped. Pulls 1st-degree connections from LinkedIn's voyager API and POSTs batches to `/api/linkedin/v1/connections` with a per-user `Authorization: Bearer <api-key>`. Packaged on demand by `server/lib/extension-zip.ts` (pure-Node ZIP builder using `zlib.deflateRawSync`).
- **Per-User Scoping**: `apiKeys.userId` binds the key to a Whistle account; `validateApiKey` middleware now sets `req.apiKeyUserId` so ingestion writes land under the right user. Browser endpoints use session auth (`req.session.userId`) — no Internal User fallback.
- **Schema**: `linkedin_connections` table — unique `(userId, entityUrn)` for idempotent upserts; tracks match → `matchedStaffId`, `matchedSchoolId`, `matchConfidence`.
- **Matcher** (`server/lib/linkedin-matcher.ts`): Strategy 1 = exact LinkedIn slug match against `staffMembers.linkedinUrl` (confidence 100). Strategy 2 = fuzzy name match (`nameSimilarity` ≥ 0.9) when the connection's headline contains a school's name (capped at 90). Emits a `network_connection` signal only on first null→matched transition (idempotent on resync).
- **UI**: `/whistle-connect` page (extension download, key management, matched-people list). Signal Feed has a Network tab. School detail pages show a "You know N people at <school>" card.

### ABM 2.0 Signal Engine
- **Signal Types**: Detects new hires, departures, tech stack changes, and warm paths.
- **Career History**: Tracks past employers for staff.
- **Warm Path Detection**: Identifies staff at target accounts who previously worked at customer accounts.
- **Signal Feed Dashboard**: Displays signals with filtering, AI email drafting, and action tracking.

### Data Health & Evergreen Maintenance
- **Dashboard**: Provides freshness metrics, stale school lists, and failed schools section.
- **Priority-Based Staleness**: Defines max age for data based on conference tiers.
- **Bulk Refresh/Retry**: Allows queuing stale or failed schools for re-extraction.
- **Failure Categorization**: Classifies extraction failures (e.g., `url_not_found`, `timeout`).
- **Needs Review Flagging**: Flags schools with consecutive failures.

### Scraping Engine Reliability (v3.0)
- **Circuit Breaker Pattern**: Disables parsers after consecutive failures with auto-recovery.
- **Fail-Closed AI Validation**: Validates Gemini responses with Zod schemas.
- **User-Agent Rotation**: Random user-agent selection per request.
- **Expanded Parser Selectors**: Utilizes broader CSS selectors across multiple strategies (Sidearm, Presto, WordPress, Table, Generic) for higher contact yield.
- **Contact Validation**: Includes email format/domain validation and generic email filtering.
- **Deduplication**: Post-extraction deduplication by normalized email.
- **Extended Retry**: Automatic retry with longer waits for zero-contact or low-yield extractions.

### Commercial-Grade Ingestion Engine
- **Data Flow**: Seed List → Job Queue → ScraperWorker → Browser Pool → ParserFactory → AI Enhancement → Database.
- **Parser Factory**: Strategy pattern (Sidearm Sports, Presto, WordPress, Table, Generic) for different site layouts.
- **Scraper Worker**: Smart fetch selection, progressive content-aware waiting, quality-based selection, exponential backoff, and detailed extraction metadata logging.

### HTML Parsing Strategy
- **Method**: Client-side parsing using DOMParser, container-first approach.
- **Extraction**: Extracts name, title, department, office, LinkedIn, bio URL, and phone number.
- **Filtering**: Pronoun filtering from title fields.

### URL Override System
- **Multi-Tier Resolution**: Prioritizes hardcoded URLs, database entries, conference URL matching, and automated discovery.
- **Redirect Chain Tracking**: Captures and persists final URLs after redirects.
- **Static Subresource Overrides**: Some sites (e.g., Michigan) ship a JS shell that XHRs a static HTML file with the real staff table; the override points directly at the static URL (e.g., `static.mgoblue.com/custompages/library/staff/staff-dept.html`).

### Parser Strategy Detection
- **Table-Strategy Fallback**: Pages with `<table>` + `<th>` are routed to the table parser whenever they contain `mailto:`/cfemail, OR when they have `tel:` / many rows (>=30) AND a staff-related keyword (staff/coach/directory/personnel/department/etc). Standings, schedules, and stats tables fall through to `generic`.

## External Dependencies

### Third-Party Services
- **Google Gemini AI**: Requires `GEMINI_API_KEY`.
- **CORS Proxy Services**: AllOrigins API, CodeTabs API.

### Database
- **PostgreSQL**: Used with Neon serverless driver and Drizzle ORM.

### Package Dependencies
- **UI Components**: Radix UI.
- **Styling**: Tailwind CSS.
- **Forms**: React Hook Form.
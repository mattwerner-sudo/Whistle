/**
 * Public, unauthenticated, server-rendered pages — the SEO surface.
 *
 * The BioPharmGuy play: a free public directory as the traffic flywheel.
 * Strict rule enforced here: NO contact data (names, emails, phones) ever
 * appears in these responses. Pages show school metadata, staff COUNTS by
 * functional area, and recent signal activity — enough to rank and to make
 * a visitor ask "where do I get the contacts?", never enough to answer it.
 *
 * Plain HTML templates rather than React: the client app is a Vite SPA with
 * no SSR, and crawlable HTML is the whole point of these routes.
 */
import { Router } from "express";
import { db } from "../db";
import { schoolDirectories, staffMembers, signals, jobPostings, optOutRequests } from "@shared/schema";
import { eq, sql, desc, and, gte, isNotNull } from "drizzle-orm";

const router = Router();

const BASE_URL = (process.env.APP_URL && !process.env.APP_URL.includes("localhost"))
  ? process.env.APP_URL.replace(/\/$/, "")
  : "https://gowhistle.io";

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(opts: { title: string; description: string; canonicalPath: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${BASE_URL}${esc(opts.canonicalPath)}">
<style>
  :root { --ink:#1a211c; --soft:#5a645e; --green:#1e4d3a; --line:#e2e6e2; --bg:#fafbf9; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:var(--ink); background:var(--bg); line-height:1.6; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 24px 20px 64px; }
  header.site { display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid var(--green); padding-bottom:10px; margin-bottom:28px; }
  .brand { font-weight:700; font-size:20px; color:var(--green); text-decoration:none; }
  .cta { background:var(--green); color:#fff; text-decoration:none; padding:8px 16px; border-radius:6px; font-size:14px; font-weight:600; }
  h1 { font-size:30px; line-height:1.2; margin:0 0 8px; }
  .sub { color:var(--soft); margin:0 0 28px; }
  h2 { font-size:19px; margin:32px 0 12px; color:var(--green); }
  table { border-collapse:collapse; width:100%; font-size:14.5px; background:#fff; }
  th { text-align:left; padding:8px 12px; border-bottom:2px solid var(--green); font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--soft); white-space:nowrap; }
  td { padding:8px 12px; border-bottom:1px solid var(--line); }
  .num { font-variant-numeric: tabular-nums; text-align:right; }
  a { color:var(--green); }
  .pill { display:inline-block; background:#e9efe9; color:var(--green); border-radius:99px; padding:1px 10px; font-size:12.5px; margin:2px 4px 2px 0; }
  .callout { border:1px solid var(--line); background:#fff; border-left:4px solid var(--green); padding:16px 18px; margin:32px 0 0; }
  .muted { color:var(--soft); font-size:13.5px; }
  footer.site { margin-top:48px; border-top:1px solid var(--line); padding-top:14px; font-size:13px; color:var(--soft); }
  .tablewrap { overflow-x:auto; }
</style>
</head>
<body>
<div class="wrap">
<header class="site">
  <a class="brand" href="/directory">Whistle</a>
  <a class="cta" href="/pricing">Unlock contact data</a>
</header>
${opts.body}
<footer class="site">
  Whistle — collegiate athletics sales intelligence · <a href="/directory">Directory</a> · <a href="/jobs-board">Jobs</a> · <a href="/data">Purchase data</a> · <a href="/remove-my-info">Remove my info</a> · <a href="/">About</a>
</footer>
</div>
</body>
</html>`;
}

function slugConf(conference: string): string {
  return encodeURIComponent(conference);
}

// ---------------------------------------------------------------------------
// /directory — all covered schools grouped by conference
// ---------------------------------------------------------------------------
router.get("/directory", async (_req, res) => {
  try {
    const rows = await db
      .select({
        conference: schoolDirectories.conference,
        schools: sql<number>`count(*)`,
        contacts: sql<number>`coalesce(sum(${schoolDirectories.contactsCount}), 0)`,
      })
      .from(schoolDirectories)
      .where(eq(schoolDirectories.status, "success"))
      .groupBy(schoolDirectories.conference)
      .orderBy(desc(sql`count(*)`));

    const totals = rows.reduce(
      (a, r) => ({ schools: a.schools + Number(r.schools), contacts: a.contacts + Number(r.contacts) }),
      { schools: 0, contacts: 0 },
    );

    const body = `
<h1>College Athletics Staff Directory</h1>
<p class="sub">Staff coverage for ${totals.schools} NCAA athletic departments — ${totals.contacts.toLocaleString()} tracked positions, refreshed continuously from official staff directories.</p>
<div class="tablewrap"><table>
<thead><tr><th>Conference</th><th class="num">Schools covered</th><th class="num">Tracked positions</th></tr></thead>
<tbody>
${rows.map((r) => `<tr><td><a href="/directory/${slugConf(r.conference ?? "Other")}">${esc(r.conference ?? "Other")}</a></td><td class="num">${r.schools}</td><td class="num">${Number(r.contacts).toLocaleString()}</td></tr>`).join("\n")}
</tbody>
</table></div>
<div class="callout">Need names, emails, and phone numbers behind these counts? <a href="/pricing">Whistle plans</a> unlock full contact data with hiring alerts.</div>`;

    res.type("html").send(page({
      title: "College Athletics Staff Directory — Whistle",
      description: `Staff directory coverage for ${totals.schools} NCAA athletic departments across ${rows.length} conferences, refreshed continuously.`,
      canonicalPath: "/directory",
      body,
    }));
  } catch (err) {
    console.error("[Public] /directory error:", err);
    res.status(500).type("html").send("Something went wrong loading the directory.");
  }
});

// ---------------------------------------------------------------------------
// /directory/:conference — schools within one conference
// ---------------------------------------------------------------------------
router.get("/directory/:conference", async (req, res, next) => {
  // /directory/school/:id is handled below; don't swallow it here.
  if (req.params.conference === "school") return next();
  try {
    const conference = decodeURIComponent(req.params.conference);
    const schools = await db
      .select({
        schoolId: schoolDirectories.schoolId,
        name: schoolDirectories.schoolFullName,
        division: schoolDirectories.division,
        contacts: schoolDirectories.contactsCount,
        lastExtractedAt: schoolDirectories.lastExtractedAt,
      })
      .from(schoolDirectories)
      .where(and(eq(schoolDirectories.conference, conference), eq(schoolDirectories.status, "success")))
      .orderBy(schoolDirectories.schoolFullName);

    if (schools.length === 0) {
      return res.status(404).type("html").send(page({
        title: "Conference not found — Whistle",
        description: "No coverage for this conference yet.",
        canonicalPath: "/directory",
        body: `<h1>No coverage yet</h1><p class="sub">We don't have extracted staff data for “${esc(conference)}” yet. <a href="/directory">Back to the directory</a>.</p>`,
      }));
    }

    const body = `
<h1>${esc(conference)} Athletics Staff Directory</h1>
<p class="sub">${schools.length} athletic departments covered in the ${esc(conference)}.</p>
<div class="tablewrap"><table>
<thead><tr><th>School</th><th>Division</th><th class="num">Tracked positions</th><th>Last refreshed</th></tr></thead>
<tbody>
${schools.map((s) => `<tr><td><a href="/directory/school/${esc(s.schoolId)}">${esc(s.name)}</a></td><td>${esc(s.division ?? "")}</td><td class="num">${s.contacts ?? 0}</td><td class="muted">${s.lastExtractedAt ? new Date(s.lastExtractedAt).toISOString().slice(0, 10) : ""}</td></tr>`).join("\n")}
</tbody>
</table></div>
<div class="callout">Selling into the ${esc(conference)}? <a href="/pricing">Unlock every contact</a> — emails, phones, and hiring alerts for all ${schools.length} departments.</div>`;

    res.type("html").send(page({
      title: `${conference} Athletics Staff Directory — Whistle`,
      description: `Athletics staff coverage for ${schools.length} ${conference} schools: department sizes, hiring activity, and data freshness.`,
      canonicalPath: `/directory/${slugConf(conference)}`,
      body,
    }));
  } catch (err) {
    console.error("[Public] conference page error:", err);
    res.status(500).type("html").send("Something went wrong.");
  }
});

// ---------------------------------------------------------------------------
// /directory/school/:schoolId — one school's public profile (no contact data)
// ---------------------------------------------------------------------------
router.get("/directory/school/:schoolId", async (req, res) => {
  try {
    const { schoolId } = req.params;
    const [school] = await db
      .select()
      .from(schoolDirectories)
      .where(eq(schoolDirectories.schoolId, schoolId))
      .limit(1);

    if (!school || school.status !== "success") {
      return res.status(404).type("html").send(page({
        title: "School not found — Whistle",
        description: "No coverage for this school yet.",
        canonicalPath: "/directory",
        body: `<h1>Not covered yet</h1><p class="sub"><a href="/directory">Back to the directory</a>.</p>`,
      }));
    }

    const areas = await db
      .select({ area: staffMembers.functionalArea, n: sql<number>`count(*)` })
      .from(staffMembers)
      .where(eq(staffMembers.schoolId, schoolId))
      .groupBy(staffMembers.functionalArea)
      .orderBy(desc(sql`count(*)`));

    const recentSignals = await db
      .select({ type: signals.type, description: signals.description, detectedAt: signals.detectedAt })
      .from(signals)
      .where(and(
        eq(signals.schoolId, schoolId),
        sql`${signals.type} <> 'network_connection'`,
      ))
      .orderBy(desc(signals.detectedAt))
      .limit(8);

    const areaLabel: Record<string, string> = {
      executive: "Executive & Administration", operations: "Operations",
      finance: "Finance & Business", external: "External Relations & Revenue",
      performance: "Sports Performance", general: "General Staff",
    };

    const techStack = (school.techStack as string[] | null) ?? [];
    const totalStaff = areas.reduce((a, r) => a + Number(r.n), 0);

    const body = `
<h1>${esc(school.schoolFullName)} — Athletics Staff Directory</h1>
<p class="sub">${esc(school.conference ?? "")} · ${esc(school.division ?? "")} · ${totalStaff} tracked positions · refreshed ${school.lastExtractedAt ? new Date(school.lastExtractedAt).toISOString().slice(0, 10) : "recently"}</p>

<h2>Department composition</h2>
<div class="tablewrap"><table>
<thead><tr><th>Functional area</th><th class="num">Positions tracked</th></tr></thead>
<tbody>
${areas.map((a) => `<tr><td>${esc(areaLabel[a.area ?? "general"] ?? a.area ?? "General Staff")}</td><td class="num">${a.n}</td></tr>`).join("\n")}
</tbody>
</table></div>

${techStack.length > 0 ? `<h2>Detected technology</h2><p>${techStack.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</p>` : ""}

${recentSignals.length > 0 ? `<h2>Recent activity</h2>
<div class="tablewrap"><table>
<thead><tr><th>Date</th><th>Signal</th></tr></thead>
<tbody>
${recentSignals.map((s) => `<tr><td class="muted">${s.detectedAt ? new Date(s.detectedAt).toISOString().slice(0, 10) : ""}</td><td>${esc((s.description ?? s.type).slice(0, 120))}</td></tr>`).join("\n")}
</tbody>
</table></div>` : ""}

<div class="callout">Whistle tracks every one of these ${totalStaff} positions with names, verified emails, phone numbers, and change alerts. <a href="/pricing">Unlock ${esc(school.schoolName)} contacts</a>.</div>`;

    res.type("html").send(page({
      title: `${school.schoolFullName} Athletics Staff Directory — Whistle`,
      description: `${school.schoolFullName} athletic department: ${totalStaff} tracked staff positions, hiring activity, and detected technology. ${school.conference ?? ""}.`,
      canonicalPath: `/directory/school/${schoolId}`,
      body,
    }));
  } catch (err) {
    console.error("[Public] school page error:", err);
    res.status(500).type("html").send("Something went wrong.");
  }
});

// ---------------------------------------------------------------------------
// /jobs-board — public athletics job board (RevOpsRoles pattern)
// ---------------------------------------------------------------------------
router.get("/jobs-board", async (req, res) => {
  try {
    const { area, conference } = req.query as { area?: string; conference?: string };

    const conds = [eq(jobPostings.isActive, true)];
    if (area) conds.push(eq(jobPostings.functionalArea, area));

    let rows = await db
      .select({
        jobTitle: jobPostings.jobTitle,
        schoolId: jobPostings.schoolId,
        schoolName: jobPostings.schoolName,
        postingUrl: jobPostings.postingUrl,
        sourceBoard: jobPostings.sourceBoard,
        functionalArea: jobPostings.functionalArea,
        detectedAt: jobPostings.detectedAt,
        conference: schoolDirectories.conference,
      })
      .from(jobPostings)
      .leftJoin(schoolDirectories, eq(schoolDirectories.schoolId, jobPostings.schoolId))
      .where(and(...conds))
      .orderBy(desc(jobPostings.detectedAt))
      .limit(200);

    if (conference) rows = rows.filter((r) => r.conference === conference);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [stats] = await db
      .select({
        active: sql<number>`count(*) filter (where ${jobPostings.isActive})`,
        newThisWeek: sql<number>`count(*) filter (where ${jobPostings.isActive} and ${jobPostings.detectedAt} >= ${weekAgo})`,
        schoolsHiring: sql<number>`count(distinct ${jobPostings.schoolName}) filter (where ${jobPostings.isActive})`,
      })
      .from(jobPostings);

    const areaLabel: Record<string, string> = {
      executive: "Executive", operations: "Operations", finance: "Finance",
      external: "External / Revenue", performance: "Performance", general: "General",
    };

    const body = `
<h1>College Athletics Jobs</h1>
<p class="sub"><strong>${stats?.active ?? 0}</strong> open athletic-department roles · <strong>${stats?.newThisWeek ?? 0}</strong> new this week · <strong>${stats?.schoolsHiring ?? 0}</strong> schools hiring — scraped from public job boards, classified by function.</p>
<p>${Object.entries(areaLabel).map(([k, v]) => `<a class="pill" href="/jobs-board?area=${k}">${esc(v)}</a>`).join("")}${area || conference ? ` <a href="/jobs-board">clear filters</a>` : ""}</p>
${rows.length === 0 ? `<p class="muted">No postings match — new postings are ingested every 6 hours.</p>` : `
<div class="tablewrap"><table>
<thead><tr><th>Role</th><th>School</th><th>Function</th><th>Found</th><th></th></tr></thead>
<tbody>
${rows.map((r) => `<tr>
<td>${esc(r.jobTitle)}</td>
<td>${r.schoolId ? `<a href="/directory/school/${esc(r.schoolId)}">${esc(r.schoolName)}</a>` : esc(r.schoolName)}</td>
<td>${esc(areaLabel[r.functionalArea ?? ""] ?? r.functionalArea ?? "—")}</td>
<td class="muted">${r.detectedAt ? new Date(r.detectedAt).toISOString().slice(0, 10) : ""}</td>
<td><a href="${esc(r.postingUrl)}" rel="nofollow noopener" target="_blank">Apply ↗</a></td>
</tr>`).join("\n")}
</tbody>
</table></div>`}
<div class="callout">A new posting means a department in motion. Whistle customers see who owns that budget — and get alerted the day the hire lands. <a href="/pricing">See plans</a>.</div>`;

    res.type("html").send(page({
      title: "College Athletics Jobs — Whistle",
      description: `${stats?.active ?? 0} open college athletic department jobs, classified by function and refreshed every 6 hours.`,
      canonicalPath: "/jobs-board",
      body,
    }));
  } catch (err) {
    console.error("[Public] jobs board error:", err);
    res.status(500).type("html").send("Something went wrong.");
  }
});

// ---------------------------------------------------------------------------
// /data — published data-purchase menu + live freshness audit trail.
//
// The BioPharmGuy commercial pattern: transparent à la carte pricing (their
// differentiator vs. talk-to-sales incumbents) plus a per-field freshness
// record — except ours is generated live from the pipeline's own timestamps
// instead of typed by hand. Dataset purchases are deliberately priced so the
// "everything" bundle sits above the Pro subscription: snapshots don't
// cannibalize the living platform.
// ---------------------------------------------------------------------------
router.get("/data", async (_req, res) => {
  try {
    const [staffStats] = await db
      .select({
        total: sql<number>`count(*)`,
        withEmail: sql<number>`count(*) filter (where ${staffMembers.email} <> '')`,
        verified: sql<number>`count(*) filter (where ${staffMembers.emailVerificationStatus} = 'verified')`,
        lastVerifyPass: sql<string>`max(${staffMembers.emailVerifiedAt})`,
        newestExtraction: sql<string>`max(${staffMembers.extractedAt})`,
      })
      .from(staffMembers);

    const [schoolStats] = await db
      .select({
        covered: sql<number>`count(*) filter (where ${schoolDirectories.status} = 'success')`,
        oldestRefresh: sql<string>`min(${schoolDirectories.lastExtractedAt}) filter (where ${schoolDirectories.status} = 'success')`,
        newestRefresh: sql<string>`max(${schoolDirectories.lastExtractedAt}) filter (where ${schoolDirectories.status} = 'success')`,
      })
      .from(schoolDirectories);

    const [signalStats] = await db
      .select({ total: sql<number>`count(*)`, newest: sql<string>`max(${signals.detectedAt})` })
      .from(signals);

    const d = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "—");
    const n = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString();

    const body = `
<h1>Purchase Whistle Data</h1>
<p class="sub">One-time dataset purchases, delivered as CSV with stable IDs for CRM import. Every price is published — the same for everyone, no demo call required. For continuously refreshed data with hiring alerts, see <a href="/pricing">Whistle plans</a>.</p>

<h2>What's in the database right now</h2>
<div class="tablewrap"><table>
<thead><tr><th>Metric</th><th class="num">Count</th><th>Last checked</th></tr></thead>
<tbody>
<tr><td>Athletic departments covered</td><td class="num">${n(schoolStats?.covered)}</td><td class="muted">oldest directory refresh ${d(schoolStats?.oldestRefresh)}, newest ${d(schoolStats?.newestRefresh)}</td></tr>
<tr><td>Staff contacts</td><td class="num">${n(staffStats?.total)}</td><td class="muted">newest extraction ${d(staffStats?.newestExtraction)}</td></tr>
<tr><td>Contacts with email</td><td class="num">${n(staffStats?.withEmail)}</td><td class="muted">${n(staffStats?.verified)} domain-verified, last verification pass ${d(staffStats?.lastVerifyPass)}</td></tr>
<tr><td>Hiring &amp; change signals</td><td class="num">${n(signalStats?.total)}</td><td class="muted">newest signal ${d(signalStats?.newest)}</td></tr>
</tbody>
</table></div>
<p class="muted">This table is generated live from the production database — the timestamps are the pipeline's own records, not marketing copy. Extraction runs continuously; email deliverability is re-verified on a rolling schedule.</p>

<h2>Pricing</h2>
<div class="tablewrap"><table>
<thead><tr><th>Product</th><th class="num">Price (USD)</th><th>Includes</th></tr></thead>
<tbody>
<tr><td>Custom slice</td><td class="num">$0.12 / contact<br><span class="muted">$249 minimum</span></td><td>Your title keywords &times; conferences. Name, title, school, verified email, phone where published.</td></tr>
<tr><td>Single conference</td><td class="num">$399</td><td>Every covered school in one conference — full staff contacts.</td></tr>
<tr><td>Full database — contacts</td><td class="num">$1,995</td><td>Every covered school, every contact, verified emails and phones.</td></tr>
<tr><td>Everything</td><td class="num">$3,500</td><td>Full contacts plus the signals history (hires, departures, title changes) and detected technology per school.</td></tr>
<tr><td>Quarterly refresh plan</td><td class="num">40% of purchase / year</td><td>A fully updated copy of your dataset every quarter.</td></tr>
</tbody>
</table></div>

<h2>How it works</h2>
<div class="tablewrap"><table>
<tbody>
<tr><td class="muted" style="white-space:nowrap;">01</td><td>Email <a href="mailto:support@gowhistle.io">support@gowhistle.io</a> with what you need (titles, conferences, or a bundle above). Include "data purchase" in the subject.</td></tr>
<tr><td class="muted">02</td><td>We confirm the exact row count and price before you pay — no surprises.</td></tr>
<tr><td class="muted">03</td><td>Pay by card; your CSV is delivered within 2 business days (usually same-day).</td></tr>
</tbody>
</table></div>

<div class="callout">Datasets are point-in-time snapshots licensed for your internal sales and marketing use — no resale or redistribution, and no FCRA-regulated uses (see <a href="/terms">terms</a>). Need the data to stay current on its own, with alerts when your buyers change jobs? That's the <a href="/pricing">Whistle platform</a>.</div>`;

    res.type("html").send(page({
      title: "Purchase Whistle Data",
      description: "Transparent, published pricing for one-time college athletics contact datasets — with a live freshness audit trail.",
      canonicalPath: "/data",
      body,
    }));
  } catch (err) {
    console.error("[Public] /data error:", err);
    res.status(500).type("html").send("Something went wrong.");
  }
});

// ---------------------------------------------------------------------------
// /remove-my-info — data-subject opt-out (form + processing)
//
// Removal is honored immediately (matching staff rows deleted) and
// permanently (the email lands on a suppression list that ingest checks, so
// re-scraping can never silently re-add the person). Anyone can submit for
// any email; the only effect is removal of that email's data from the
// product, which is a safe worst case.
// ---------------------------------------------------------------------------
router.get("/remove-my-info", (_req, res) => {
  const body = `
<h1>Remove my information</h1>
<p class="sub">Whistle indexes work contact details published on official university athletics staff directories. If yours is listed and you'd like it removed, submit your work email below.</p>
<form method="POST" action="/remove-my-info" style="display:grid;gap:14px;max-width:480px;background:#fff;border:1px solid var(--line);padding:22px;">
  <label>Work email (the address to remove)<br>
    <input type="email" name="email" required style="width:100%;padding:9px;border:1px solid var(--line);border-radius:5px;font-size:15px;margin-top:4px;">
  </label>
  <label>Name (optional)<br>
    <input type="text" name="name" maxlength="200" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:5px;font-size:15px;margin-top:4px;">
  </label>
  <label>Anything we should know (optional)<br>
    <textarea name="details" maxlength="1000" rows="3" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:5px;font-size:15px;margin-top:4px;"></textarea>
  </label>
  <button type="submit" class="cta" style="border:none;cursor:pointer;font-size:15px;">Remove my information</button>
</form>
<p class="muted" style="margin-top:18px;">What happens: any record matching this email is deleted from our database immediately, and the address is added to a permanent suppression list so future data collection skips it. Removal covers Whistle's database; it does not change your university's own public directory.</p>`;
  res.type("html").send(page({
    title: "Remove My Information — Whistle",
    description: "Request removal of your contact information from Whistle's database.",
    canonicalPath: "/remove-my-info",
    body,
  }));
});

router.post("/remove-my-info", async (req, res) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const name = String(req.body?.name ?? "").trim().slice(0, 200) || null;
    const details = String(req.body?.details ?? "").trim().slice(0, 1000) || null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).type("html").send(page({
        title: "Remove My Information — Whistle",
        description: "Request removal of your contact information from Whistle's database.",
        canonicalPath: "/remove-my-info",
        body: `<h1>That didn't look like an email address</h1><p class="sub"><a href="/remove-my-info">Try again</a>.</p>`,
      }));
    }

    // Record the request (idempotent — resubmitting the same email is a no-op).
    await db.insert(optOutRequests)
      .values({ email, name, details })
      .onConflictDoNothing({ target: optOutRequests.email });

    // Honor it immediately.
    const deleted = await db.delete(staffMembers)
      .where(sql`lower(${staffMembers.email}) = ${email}`)
      .returning({ id: staffMembers.id });

    await db.update(optOutRequests)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(optOutRequests.email, email));

    console.log(`[OptOut] Processed removal for ${email}: ${deleted.length} record(s) deleted, email suppressed`);

    res.type("html").send(page({
      title: "Removal Complete — Whistle",
      description: "Your removal request has been processed.",
      canonicalPath: "/remove-my-info",
      body: `<h1>Done — your information is removed</h1>
<p class="sub">${deleted.length > 0
        ? `We deleted ${deleted.length} record${deleted.length === 1 ? "" : "s"} matching that address, effective immediately.`
        : `That address wasn't in our database, and we've added it to our suppression list as a precaution.`}
Either way, the address is now permanently suppressed — future data collection will skip it.</p>
<p class="muted">If your details appear under a different email address, submit that one too. Questions: this page is the fastest path, and requests are processed automatically.</p>`,
    }));
  } catch (err) {
    console.error("[Public] opt-out error:", err);
    res.status(500).type("html").send("Something went wrong processing your request. Please try again.");
  }
});

// ---------------------------------------------------------------------------
// sitemap.xml + robots.txt
// ---------------------------------------------------------------------------
router.get("/sitemap.xml", async (_req, res) => {
  try {
    const schools = await db
      .select({ schoolId: schoolDirectories.schoolId, conference: schoolDirectories.conference, updatedAt: schoolDirectories.lastExtractedAt })
      .from(schoolDirectories)
      .where(eq(schoolDirectories.status, "success"));

    const conferences = Array.from(new Set(schools.map((s) => s.conference).filter(Boolean))) as string[];
    const urls = [
      { loc: `${BASE_URL}/directory` },
      { loc: `${BASE_URL}/jobs-board` },
      { loc: `${BASE_URL}/data` },
      ...conferences.map((c) => ({ loc: `${BASE_URL}/directory/${slugConf(c)}` })),
      ...schools.map((s) => ({
        loc: `${BASE_URL}/directory/school/${encodeURIComponent(s.schoolId)}`,
        lastmod: s.updatedAt ? new Date(s.updatedAt).toISOString().slice(0, 10) : undefined,
      })),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${"lastmod" in u && u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
    res.type("application/xml").send(xml);
  } catch (err) {
    console.error("[Public] sitemap error:", err);
    res.status(500).send("");
  }
});

router.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(`User-agent: *
Allow: /directory
Allow: /jobs-board
Disallow: /api/
Disallow: /dashboard
Disallow: /staff
Disallow: /settings

Sitemap: ${BASE_URL}/sitemap.xml
`);
});

export default router;

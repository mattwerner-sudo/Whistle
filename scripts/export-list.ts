/**
 * Fulfillment engine for hand-delivered prospect lists (the pilot offer).
 *
 * Exports a clean CSV of staff contacts filtered by title keywords,
 * conference, and/or buyer persona — only rows with an email. Each row is
 * annotated with confidence and any recent signals for that person/school so
 * the deliverable reads as intelligence, not a raw dump.
 *
 * Usage:
 *   npx tsx scripts/export-list.ts --titles "ticket,revenue" --out list.csv
 *   npx tsx scripts/export-list.ts --titles "director" --conference SEC --limit 500
 *   npx tsx scripts/export-list.ts --persona signer,champion --out signers.csv
 *   npx tsx scripts/export-list.ts --titles "ticket" --sample     # 5-row teaser
 *   npx tsx scripts/export-list.ts --titles "ticket" --fields core          # à la carte tiers
 *
 * --fields controls which column groups ship (the published /data menu):
 *   core     name, title, school, conference, verified email  (custom slice / conference)
 *   contacts core + phone, department, persona, confidence     (full-database tier)
 *   all      contacts + recent signals per school              (everything tier; default)
 * Every export includes a stable "Whistle ID" per contact for CRM import/dedupe.
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { Pool } from "pg";

type FieldTier = "core" | "contacts" | "all";

interface Args {
  titles: string[];
  conference: string | null;
  persona: string[];
  limit: number;
  out: string;
  sample: boolean;
  fields: FieldTier;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const sample = argv.includes("--sample");
  const fieldsRaw = (get("--fields") ?? "all").toLowerCase();
  const fields: FieldTier = fieldsRaw === "core" || fieldsRaw === "contacts" ? fieldsRaw : "all";
  return {
    titles: (get("--titles") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    conference: get("--conference"),
    persona: (get("--persona") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    limit: sample ? 5 : parseInt(get("--limit") ?? "10000", 10),
    out: get("--out") ?? (sample ? "sample.csv" : "export.csv"),
    sample,
    fields,
  };
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const args = parseArgs();
  if (args.titles.length === 0 && args.persona.length === 0) {
    console.error('Provide at least --titles "kw1,kw2" or --persona signer,champion');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const where: string[] = [`s.email is not null and s.email <> ''`];
  const params: unknown[] = [];

  if (args.titles.length > 0) {
    const ors = args.titles.map((kw) => {
      params.push(`%${kw}%`);
      return `s.title ilike $${params.length}`;
    });
    where.push(`(${ors.join(" or ")})`);
  }
  if (args.persona.length > 0) {
    params.push(args.persona);
    where.push(`s.buyer_persona = any($${params.length})`);
  }
  if (args.conference) {
    params.push(args.conference);
    where.push(`d.conference = $${params.length}`);
  }
  params.push(args.limit);

  const sql = `
    select
      s.id as whistle_id,
      s.name,
      s.title,
      s.email,
      s.phone,
      s.department,
      d.school_full_name as school,
      d.conference,
      s.buyer_persona,
      s.email_confidence,
      coalesce((s.confidence->>'overall')::int, 0) as confidence,
      s.extracted_at::date as extracted_on,
      (
        select string_agg(sig.description, ' | ')
        from (
          select description from signals
          where school_id = s.school_id
            and type in ('new_hire','departure','title_change')
            and detected_at > now() - interval '60 days'
          order by detected_at desc limit 2
        ) sig
      ) as recent_school_signals
    from staff_members s
    join school_directories d on d.school_id = s.school_id
    where ${where.join(" and ")}
    order by coalesce((s.confidence->>'overall')::int, 0) desc, s.extracted_at desc
    limit $${params.length}
  `;

  const res = await pool.query(sql, params);
  await pool.end();

  // Column groups by tier — mirrors the published /data menu. "Whistle ID"
  // is always first: a stable per-contact key for CRM import and dedupe
  // across refresh deliveries.
  type Col = { header: string; value: (r: any) => unknown };
  const coreCols: Col[] = [
    { header: "Whistle ID", value: (r) => r.whistle_id },
    { header: "Name", value: (r) => r.name },
    { header: "Title", value: (r) => r.title },
    { header: "School", value: (r) => r.school },
    { header: "Conference", value: (r) => r.conference },
    { header: "Email", value: (r) => r.email },
    { header: "Email Confidence", value: (r) => r.email_confidence ?? "extracted" },
    { header: "Extracted On", value: (r) => r.extracted_on?.toISOString?.()?.slice(0, 10) ?? r.extracted_on },
  ];
  const contactCols: Col[] = [
    { header: "Phone", value: (r) => r.phone },
    { header: "Department", value: (r) => r.department },
    { header: "Buyer Persona", value: (r) => r.buyer_persona },
    { header: "Overall Confidence", value: (r) => r.confidence },
  ];
  const signalCols: Col[] = [
    { header: "Recent School Signals", value: (r) => r.recent_school_signals },
  ];
  const cols = [
    ...coreCols,
    ...(args.fields === "contacts" || args.fields === "all" ? contactCols : []),
    ...(args.fields === "all" ? signalCols : []),
  ];

  const lines = [cols.map((c) => c.header).join(",")];
  for (const r of res.rows) {
    lines.push(cols.map((c) => csvEscape(c.value(r))).join(","));
  }
  writeFileSync(args.out, lines.join("\n") + "\n");

  const schools = new Set(res.rows.map((r) => r.school)).size;
  console.log(`Wrote ${res.rows.length} contacts across ${schools} schools -> ${args.out}`);
  if (args.sample) {
    console.log("(sample mode: 5 rows, use in outreach as the free teaser)");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

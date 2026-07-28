/**
 * Multi-Conference Staff Directory Audit
 *
 * Generalized cross-conference version of tests/big12-audit.ts.
 *
 * - Samples N schools per conference from shared/ncaa-conferences.ts
 * - Runs each through the production scraping pipeline (scrapeUrl)
 * - Captures per-school yield + DOM fingerprint hints
 * - Writes JSON results so multiple runs (baseline / after) can be diffed
 *
 * Usage:
 *   npx tsx tests/multi-conf-audit.ts [--out=/tmp/multi-conf-baseline.json] \
 *       [--per-conf=4] [--concurrency=8] [--conferences=SEC,BigTen,...] \
 *       [--save-html=/tmp/audit-html] [--all] \
 *       [--site-timeout=120000] [--resume]
 *
 * `--resume` (alias `--append`) loads any existing rows from `--out` and skips
 * schools already present in that file, so an interrupted run can be picked
 * back up without re-scraping completed sites or losing partial results.
 * `--site-timeout` enforces a hard upper bound (ms) on each scrapeUrl call so
 * a single slow Playwright fetch can't block a worker for the rest of the run.
 * Defaults: 120000ms per site, no resume.
 */

import { scrapeUrl } from '../server/lib/scraper-worker';
import { detectParserStrategy, PARSER_STRATEGIES, type SelectorConfig } from '../server/lib/scraper-config';
import { closeBrowser } from '../server/lib/browser-pool';
import type { SelectorUsage } from '../server/lib/parser-factory';
import { ncaaConferencesWithSchools } from '../shared/ncaa-conferences';
import * as fs from 'fs';
import * as path from 'path';

interface AuditRow {
  conference: string;
  school: string;
  url: string;
  ok: boolean;
  contacts: number;
  parser: string;
  detected: string;
  method: string;
  http: number | null;
  resolvedUrl: string | null;
  timeMs: number;
  containers: number;
  emailLinks: number;
  avgConf: number;
  withEmail: number;
  withTitle: number;
  withPhone: number;
  error?: string;
  containerHints: string[];
  htmlLen: number;
  sampleContacts: { name: string; title: string; email: string; phone: string }[];
  selectorUsage?: SelectorUsage;
  bioEmailsRecovered: number;
  bioPagesFetched: number;
  bioCacheHits: number;
}

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=');
      out[k] = v.length ? v.join('=') : true;
    }
  }
  return out;
}

function pad(s: string, n: number) { return (s + ' '.repeat(n)).slice(0, n); }

function detectContainerHints(html: string): string[] {
  const hints: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['mailto', /<a[^>]+href=["']mailto:/i],
    ['data-cfemail', /data-cfemail=/i],
    ['sidearm-staff', /sidearm-staff/i],
    ['s-person-card', /s-person-card/i],
    ['s-stamp', /s-stamp/i],
    ['s-table', /s-table/i],
    ['c-staff', /c-staff/i],
    ['staff-directory-table-member', /staff-directory-table-member/i],
    ['presto', /prestosports|presto-/i],
    ['wp-content', /wp-content/i],
    ['<table', /<table[\s>]/i],
    ['itemtype Person', /itemtype=["'][^"']*Person/i],
    ['data-bind staff', /data-bind=[^>]*staff/i],
    ['vue', /__vue|v-app|data-v-/i],
    ['react', /__NEXT_DATA__|data-reactroot|data-react-/i],
    ['elementor', /elementor-widget|elementor-element/i],
    ['wpb_', /wpb_column|wpb_wrapper|vc_row/i],
    ['et_pb', /et_pb_/i],
    ['fl-module', /fl-module/i],
  ];
  for (const [name, re] of checks) if (re.test(html)) hints.push(name);
  return hints;
}

function pickSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  // Deterministic sample: evenly spaced indices
  const step = arr.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

async function main() {
  const args = parseArgs();
  const perConf = parseInt(String(args['per-conf'] || '4'), 10);
  const concurrency = parseInt(String(args['concurrency'] || '8'), 10);
  const outPath = String(args['out'] || '/tmp/multi-conf-audit.json');
  const all = !!args['all'];
  const saveHtmlDir = args['save-html'] ? String(args['save-html']) : null;
  const siteTimeoutMs = parseInt(String(args['site-timeout'] || '120000'), 10);
  const resume = !!args['resume'] || !!args['append'];
  const onlyConfs = args['conferences']
    ? String(args['conferences']).split(',').map(s => s.trim().toLowerCase())
    : null;

  if (saveHtmlDir) fs.mkdirSync(saveHtmlDir, { recursive: true });

  const allTargets: { conference: string; school: string; url: string }[] = [];
  for (const conf of ncaaConferencesWithSchools) {
    if (onlyConfs && !onlyConfs.includes(conf.id.toLowerCase()) && !onlyConfs.includes(conf.shortName.toLowerCase())) continue;
    const schools = all ? conf.schools : pickSample(conf.schools, perConf);
    for (const s of schools) {
      if (!s.staffDirectoryUrl) continue;
      allTargets.push({ conference: conf.shortName, school: s.name, url: s.staffDirectoryUrl });
    }
  }

  // Resume support: load any existing rows and skip targets already audited.
  // Key on conference+school+url so re-running with a different `--out` or
  // tweaked URL still re-scrapes those entries.
  const rows: AuditRow[] = [];
  const completedKeys = new Set<string>();
  const keyOf = (t: { conference: string; school: string; url: string }) =>
    `${t.conference}|${t.school}|${t.url}`;
  const startedAt = new Date().toISOString();
  let resumedFrom: string | undefined;

  if (resume && fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (Array.isArray(existing?.rows)) {
        for (const r of existing.rows as AuditRow[]) {
          rows.push(r);
          completedKeys.add(`${r.conference}|${r.school}|${r.url}`);
        }
        resumedFrom = existing.startedAt || undefined;
        console.log(`[resume] Loaded ${rows.length} existing rows from ${outPath}`);
      }
    } catch (e: any) {
      console.warn(`[resume] Failed to parse existing ${outPath}: ${e.message} — starting fresh`);
    }
  }

  const targets = allTargets.filter(t => !completedKeys.has(keyOf(t)));
  const skipped = allTargets.length - targets.length;

  console.log(`\n=== Multi-Conference Audit (${targets.length} sites, concurrency=${concurrency}) ===`);
  console.log(`Per-conference sample: ${all ? 'ALL' : perConf}`);
  console.log(`Site timeout: ${siteTimeoutMs}ms  Resume: ${resume ? 'yes' : 'no'}${skipped ? `  (skipping ${skipped} already-audited)` : ''}`);
  console.log(`Output: ${outPath}\n`);

  // Persist rows after every completion so an interrupted run still leaves
  // a usable file behind (no need for the previous "every 5" batching).
  const flush = () => fs.writeFileSync(
    outPath,
    JSON.stringify({ startedAt: resumedFrom || startedAt, resumedAt: resumedFrom ? startedAt : undefined, rows }, null, 2),
  );
  // Initialize/refresh the file so partial state is on disk before any worker runs.
  flush();

  let idx = 0;
  let done = 0;
  async function worker() {
    while (idx < targets.length) {
      const my = idx++;
      const { conference, school, url } = targets[my];
      const t0 = Date.now();
      try {
        const result = await scrapeUrl(url, undefined, { timeoutMs: siteTimeoutMs });
        const elapsed = Date.now() - t0;
        const html = result.html || '';
        const hints = html ? detectContainerHints(html) : [];
        const detected = html ? detectParserStrategy(html, url) : 'none';
        const contacts = result.parseResult?.contacts || [];
        const withEmail = contacts.filter(c => c.email).length;
        const withTitle = contacts.filter(c => c.title).length;
        const withPhone = contacts.filter(c => c.phone).length;
        const row: AuditRow = {
          conference, school, url,
          ok: result.success,
          contacts: contacts.length,
          parser: result.metadata.parserUsed,
          detected,
          method: result.metadata.method,
          http: result.metadata.httpStatus,
          resolvedUrl: result.metadata.resolvedUrl,
          timeMs: elapsed,
          containers: result.parseResult?.diagnostics.containersDetected || 0,
          emailLinks: result.parseResult?.diagnostics.totalEmailLinksFound || 0,
          avgConf: Math.round(result.parseResult?.diagnostics.averageConfidence || 0),
          withEmail, withTitle, withPhone,
          error: result.error,
          containerHints: hints,
          htmlLen: html.length,
          sampleContacts: contacts.slice(0, 3).map(c => ({
            name: c.name, title: c.title, email: c.email, phone: c.phone,
          })),
          selectorUsage: result.parseResult?.diagnostics.selectorUsage,
          bioEmailsRecovered: result.metadata.bioEmailsRecovered || 0,
          bioPagesFetched: result.metadata.bioPagesFetched || 0,
          bioCacheHits: result.metadata.bioCacheHits || 0,
        };
        rows.push(row);
        if (saveHtmlDir && html && (contacts.length === 0 || withEmail < 5)) {
          const slug = (conference + '_' + school).replace(/[^a-z0-9]+/gi, '_');
          fs.writeFileSync(path.join(saveHtmlDir, `${slug}.html`), html);
        }
        done++;
        process.stdout.write(`[${pad(conference, 8)} ${pad(school, 22)}] ${result.success ? 'OK ' : 'FAIL'} c=${pad(String(contacts.length), 4)} parser=${pad(result.metadata.parserUsed, 9)} http=${pad(String(result.metadata.httpStatus), 4)} ${elapsed}ms  (${done}/${targets.length})\n`);
        flush();
      } catch (e: any) {
        const elapsed = Date.now() - t0;
        const row: AuditRow = {
          conference, school, url, ok: false, contacts: 0,
          parser: 'error', detected: 'error', method: 'error', http: null, resolvedUrl: null,
          timeMs: elapsed, containers: 0, emailLinks: 0, avgConf: 0,
          withEmail: 0, withTitle: 0, withPhone: 0, error: e.message,
          containerHints: [], htmlLen: 0, sampleContacts: [],
          bioEmailsRecovered: 0, bioPagesFetched: 0, bioCacheHits: 0,
        };
        rows.push(row);
        done++;
        console.log(`[${pad(conference, 8)} ${pad(school, 22)}] THROW ${e.message} (${done}/${targets.length})`);
        flush();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  flush();

  // Summary by conference
  console.log('\n=== Per-Conference Summary ===\n');
  console.log(pad('Conf', 12) + pad('Sites', 6) + pad('OK', 4) + pad('TotC', 6) + pad('Avg', 5) + pad('Email%', 7) + pad('Title%', 7) + pad('Phone%', 7) + pad('Zero', 5) + pad('BioRec', 7) + pad('BioFch', 7) + pad('BioHit', 7));
  console.log('-'.repeat(94));
  const byConf = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!byConf.has(r.conference)) byConf.set(r.conference, []);
    byConf.get(r.conference)!.push(r);
  }
  let totalC = 0, totalE = 0, totalT = 0, totalP = 0, totalSites = 0, okSites = 0, zero = 0;
  let totalBioRec = 0, totalBioFch = 0, totalBioHit = 0;
  for (const [conf, list] of byConf) {
    const ok = list.filter(r => r.ok).length;
    const c = list.reduce((s, r) => s + r.contacts, 0);
    const e = list.reduce((s, r) => s + r.withEmail, 0);
    const t = list.reduce((s, r) => s + r.withTitle, 0);
    const p = list.reduce((s, r) => s + r.withPhone, 0);
    const zeroC = list.filter(r => r.contacts === 0).length;
    const bioRec = list.reduce((s, r) => s + r.bioEmailsRecovered, 0);
    const bioFch = list.reduce((s, r) => s + r.bioPagesFetched, 0);
    const bioHit = list.reduce((s, r) => s + r.bioCacheHits, 0);
    totalSites += list.length; okSites += ok; totalC += c; totalE += e; totalT += t; totalP += p; zero += zeroC;
    totalBioRec += bioRec; totalBioFch += bioFch; totalBioHit += bioHit;
    const avg = list.length ? (c / list.length).toFixed(1) : '0';
    const ePct = c ? Math.round(e / c * 100) : 0;
    const tPct = c ? Math.round(t / c * 100) : 0;
    const pPct = c ? Math.round(p / c * 100) : 0;
    console.log(pad(conf, 12) + pad(String(list.length), 6) + pad(String(ok), 4) + pad(String(c), 6) + pad(String(avg), 5) + pad(ePct + '%', 7) + pad(tPct + '%', 7) + pad(pPct + '%', 7) + pad(String(zeroC), 5) + pad(String(bioRec), 7) + pad(String(bioFch), 7) + pad(String(bioHit), 7));
  }
  console.log('-'.repeat(94));
  const avg = totalSites ? (totalC / totalSites).toFixed(1) : '0';
  const ePct = totalC ? Math.round(totalE / totalC * 100) : 0;
  const tPct = totalC ? Math.round(totalT / totalC * 100) : 0;
  const pPct = totalC ? Math.round(totalP / totalC * 100) : 0;
  console.log(pad('TOTAL', 12) + pad(String(totalSites), 6) + pad(String(okSites), 4) + pad(String(totalC), 6) + pad(String(avg), 5) + pad(ePct + '%', 7) + pad(tPct + '%', 7) + pad(pPct + '%', 7) + pad(String(zero), 5) + pad(String(totalBioRec), 7) + pad(String(totalBioFch), 7) + pad(String(totalBioHit), 7));

  // Per-strategy breakdown
  console.log('\n=== Per-Parser Breakdown ===\n');
  const byParser = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const k = r.parser || 'none';
    if (!byParser.has(k)) byParser.set(k, []);
    byParser.get(k)!.push(r);
  }
  for (const [parser, list] of byParser) {
    const c = list.reduce((s, r) => s + r.contacts, 0);
    const ok = list.filter(r => r.ok).length;
    const bioRec = list.reduce((s, r) => s + r.bioEmailsRecovered, 0);
    const bioFch = list.reduce((s, r) => s + r.bioPagesFetched, 0);
    const bioHit = list.reduce((s, r) => s + r.bioCacheHits, 0);
    console.log(`  ${pad(parser, 12)} sites=${list.length}  ok=${ok}  contacts=${c}  avg=${list.length ? (c / list.length).toFixed(1) : 0}  bioRecovered=${bioRec}  bioFetched=${bioFch}  bioCacheHits=${bioHit}`);
  }

  // Per-parser selector usage report
  console.log('\n=== Selector Usage by Parser ===\n');
  const trackedFields: Array<keyof SelectorUsage> = [
    'container', 'name', 'title', 'email', 'phone', 'department', 'office',
  ];
  type FieldUsage = Map<string, { hits: number; sites: number }>;
  const usageByParser = new Map<string, Map<keyof SelectorUsage, FieldUsage>>();
  for (const r of rows) {
    if (!r.selectorUsage) continue;
    const parser = r.parser || 'none';
    let parserMap = usageByParser.get(parser);
    if (!parserMap) { parserMap = new Map(); usageByParser.set(parser, parserMap); }
    for (const field of trackedFields) {
      let fieldMap = parserMap.get(field);
      if (!fieldMap) { fieldMap = new Map(); parserMap.set(field, fieldMap); }
      const entries: Record<string, number> = r.selectorUsage[field] || {};
      for (const [sel, hits] of Object.entries(entries)) {
        const prev = fieldMap.get(sel);
        if (prev) { prev.hits += hits; prev.sites += 1; }
        else { fieldMap.set(sel, { hits, sites: 1 }); }
      }
    }
  }
  for (const [parser, parserMap] of usageByParser) {
    console.log(`\n  Parser: ${parser}`);
    for (const field of trackedFields) {
      const fieldMap = parserMap.get(field);
      if (!fieldMap || fieldMap.size === 0) continue;
      const sorted = Array.from(fieldMap.entries()).sort((a, b) => b[1].hits - a[1].hits);
      const top = sorted.slice(0, 5).map(([sel, v]) => `${sel} (${v.hits} hits / ${v.sites} sites)`).join(', ');
      console.log(`    ${pad(field, 11)}: ${top}`);
    }
  }

  // Unused selector report (configured selectors that never matched in this run)
  console.log('\n=== Never-Used Configured Selectors ===\n');
  const fieldKeyMap: Record<keyof SelectorUsage, keyof SelectorConfig> = {
    container: 'containerSelectors',
    name: 'nameSelectors',
    title: 'titleSelectors',
    email: 'emailSelectors',
    phone: 'phoneSelectors',
    department: 'departmentSelectors',
    office: 'officeSelectors',
  };
  for (const [parser, parserMap] of usageByParser) {
    const strategy: SelectorConfig | undefined = PARSER_STRATEGIES[parser];
    if (!strategy) continue;
    const lines: string[] = [];
    for (const field of trackedFields) {
      const configValue = strategy[fieldKeyMap[field]];
      const configured: string[] = Array.isArray(configValue) ? configValue : [];
      const used = parserMap.get(field) || new Map<string, { hits: number; sites: number }>();
      const unused = configured.filter(s => !used.has(s));
      if (unused.length) lines.push(`    ${pad(field, 11)}: ${unused.length}/${configured.length} unused -> ${unused.slice(0, 8).join(' ; ')}${unused.length > 8 ? ' ...' : ''}`);
    }
    if (lines.length) {
      console.log(`\n  Parser: ${parser}`);
      for (const l of lines) console.log(l);
    }
  }

  // Worst performers (zero contacts)
  console.log('\n=== Zero-Contact Schools ===\n');
  for (const r of rows.filter(r => r.contacts === 0)) {
    console.log(`  [${pad(r.conference, 10)}] ${pad(r.school, 24)} parser=${pad(r.parser, 10)} http=${r.http} hints=${r.containerHints.slice(0, 4).join(',')}`);
  }

  console.log(`\nWritten to ${outPath}`);
  await closeBrowser();
  process.exit(0);
}

main().catch(e => {
  console.error('Audit failed:', e);
  process.exit(1);
});

/**
 * Parser-only replay over saved HTML snapshots from the multi-conference audit.
 *
 * The full live audit (tests/multi-conf-audit.ts) is expensive and prone to
 * OOM under sandboxed concurrency. Since the optimization work in this task
 * is scoped to the *parser* layer (selectors + script-email decoder + aria
 * name fallback) and not network/Playwright behavior, replaying ParserFactory
 * over the saved HTML gives a fast, deterministic before/after comparison.
 *
 * Usage:
 *   npx tsx tests/replay-html-audit.ts [--dir=/tmp/multi-conf-html] [--baseline=/tmp/multi-conf-baseline.json]
 */
import * as fs from 'fs';
import * as path from 'path';
import { ParserFactory } from '../server/lib/parser-factory';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.+)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
}));
const htmlDir = args.dir || '/tmp/multi-conf-html';
const baselinePath = args.baseline || '/tmp/multi-conf-baseline.json';

// Canonical slug — MUST match the one used in tests/multi-conf-audit.ts when
// writing HTML snapshots (conference + '_' + school sanitized identically).
function slug(conference: string, school: string): string {
  return (conference + '_' + school).replace(/[^a-z0-9]+/gi, '_');
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const baselineByKey = new Map<string, any>();
for (const r of baseline.rows || []) {
  baselineByKey.set(slug(r.conference, r.school), r);
}

interface Row {
  key: string; before: number; after: number;
  beforeEmail: number; afterEmail: number;
  beforeTitle: number; afterTitle: number;
  beforePhone: number; afterPhone: number;
  parser: string;
}

(async () => {
  const files = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html')).sort();
  console.log(`Replaying ${files.length} saved HTML snapshots...\n`);
  const rows: Row[] = [];
  let unmatched = 0;

  for (const file of files) {
    const key = file.replace(/\.html$/, '');
    if (!baselineByKey.has(key)) unmatched++;
    const html = fs.readFileSync(path.join(htmlDir, file), 'utf8');
    const url = `https://replay.example.com/staff?key=${key}`;
    let after = 0, aE = 0, aT = 0, aP = 0, parserUsed = 'unknown';
    try {
      const result = await new ParserFactory(html, url).parse();
      after = result.contacts.length;
      parserUsed = result.parserUsed;
      for (const c of result.contacts) {
        if (c.email) aE++;
        if (c.title) aT++;
        if (c.phone) aP++;
      }
    } catch (e: any) {
      console.error(`  [PARSE-ERR] ${key}: ${e.message}`);
    }

    const base = baselineByKey.get(key);
    const before = base?.contacts ?? 0;
    const bE = base?.withEmail ?? 0;
    const bT = base?.withTitle ?? 0;
    const bP = base?.withPhone ?? 0;
    rows.push({ key, before, after, beforeEmail: bE, afterEmail: aE, beforeTitle: bT, afterTitle: aT, beforePhone: bP, afterPhone: aP, parser: parserUsed });
  }

  const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
  console.log(pad('Site', 36) + pad('Parser', 10) + pad('Before', 8) + pad('After', 8) + pad('+Δ', 6) + pad('E b/a', 10) + pad('T b/a', 10) + pad('P b/a', 10));
  console.log('-'.repeat(100));
  let beforeTot = 0, afterTot = 0, fixed = 0;
  let bET = 0, aET = 0, bTT = 0, aTT = 0, bPT = 0, aPT = 0;
  for (const r of rows) {
    beforeTot += r.before; afterTot += r.after;
    bET += r.beforeEmail; aET += r.afterEmail;
    bTT += r.beforeTitle; aTT += r.afterTitle;
    bPT += r.beforePhone; aPT += r.afterPhone;
    if (r.before === 0 && r.after > 0) fixed++;
    const delta = r.after - r.before;
    const arrow = delta > 0 ? `+${delta}` : `${delta}`;
    console.log(
      pad(r.key, 36) + pad(r.parser, 10) +
      pad(String(r.before), 8) + pad(String(r.after), 8) + pad(arrow, 6) +
      pad(`${r.beforeEmail}/${r.afterEmail}`, 10) +
      pad(`${r.beforeTitle}/${r.afterTitle}`, 10) +
      pad(`${r.beforePhone}/${r.afterPhone}`, 10)
    );
  }
  console.log('-'.repeat(100));
  console.log(pad('TOTAL', 46) + pad(String(beforeTot), 8) + pad(String(afterTot), 8) + pad(`+${afterTot - beforeTot}`, 6) + pad(`${bET}/${aET}`, 10) + pad(`${bTT}/${aTT}`, 10) + pad(`${bPT}/${aPT}`, 10));
  console.log(`\nZero→Non-Zero recovered: ${fixed} sites`);
  console.log(`Net contacts gained: +${afterTot - beforeTot}`);
  console.log(`Email fields gained: +${aET - bET}`);
  console.log(`Title fields gained: +${aTT - bTT}`);
  console.log(`Phone fields gained: +${aPT - bPT}`);
  if (unmatched > 0) {
    console.error(`\nERROR: ${unmatched}/${rows.length} snapshot files had no matching baseline row.`);
    console.error(`This corrupts before/after deltas. Check that slug() in this file matches the slug in tests/multi-conf-audit.ts.`);
    process.exit(1);
  }
  console.log(`\nAll ${rows.length} snapshots matched a baseline row.`);
})();

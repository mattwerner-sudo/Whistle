/**
 * Parser-Strategy Audit
 *
 * Most NCAA staff directories fingerprint as the Sidearm parser, so the
 * regular multi-conf audit collects almost no real selector usage data for
 * the Presto / WordPress / Table strategies. This audit fills that gap by:
 *
 *   1. Fetching HTML for a curated list of staff-directory URLs.
 *   2. Running ParserFactory once per target strategy (forced) against each
 *      HTML body — even when the auto-detector would have picked Sidearm.
 *   3. Aggregating per-strategy selector usage and reporting which configured
 *      selectors NEVER fire across the sample.
 *
 * The "shadow" forced-strategy passes never write back to the production
 * pipeline; they only inspect what the strategy WOULD parse from real-world
 * HTML, giving us evidence to trim selectors that no real site uses.
 *
 * Usage:
 *   npx tsx tests/parser-strategy-audit.ts \
 *     [--urls=tests/parser-strategy-audit-urls.txt] \
 *     [--out=/tmp/parser-strategy-audit.json] \
 *     [--strategies=presto,wordpress,table] \
 *     [--concurrency=8] [--save-html=/tmp/parser-strategy-html]
 */

import * as fs from 'fs';
import * as path from 'path';
import { ParserFactory, type SelectorUsage } from '../server/lib/parser-factory';
import { PARSER_STRATEGIES, type SelectorConfig } from '../server/lib/scraper-config';

interface SiteResult {
  url: string;
  status: number | null;
  htmlLen: number;
  err?: string;
  perStrategy: Record<string, {
    contacts: number;
    withEmail: number;
    selectorUsage: SelectorUsage;
  }>;
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

async function fetchHtml(url: string, ms: number): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

function pad(s: string, n: number) { return (s + ' '.repeat(n)).slice(0, n); }

const FIELD_TO_CONFIG_KEY: Record<keyof SelectorUsage, keyof SelectorConfig> = {
  container: 'containerSelectors',
  name: 'nameSelectors',
  title: 'titleSelectors',
  email: 'emailSelectors',
  phone: 'phoneSelectors',
  department: 'departmentSelectors',
  office: 'officeSelectors',
};

async function main() {
  const args = parseArgs();
  const urlsFile = String(args['urls'] || 'tests/parser-strategy-audit-urls.txt');
  const outPath = String(args['out'] || '/tmp/parser-strategy-audit.json');
  const concurrency = parseInt(String(args['concurrency'] || '8'), 10);
  const saveHtmlDir = args['save-html'] ? String(args['save-html']) : null;
  const strategies = String(args['strategies'] || 'presto,wordpress,table')
    .split(',').map(s => s.trim()).filter(Boolean);

  for (const s of strategies) {
    if (!PARSER_STRATEGIES[s]) {
      console.error(`Unknown strategy: ${s}`);
      process.exit(1);
    }
  }
  if (saveHtmlDir) fs.mkdirSync(saveHtmlDir, { recursive: true });

  const urls = fs.readFileSync(urlsFile, 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  console.log(`\n=== Parser-Strategy Audit ===`);
  console.log(`URLs: ${urls.length}, strategies: ${strategies.join(',')}, concurrency: ${concurrency}\n`);

  const results: SiteResult[] = [];
  let idx = 0;

  const origLog = console.log;

  async function worker() {
    while (idx < urls.length) {
      const my = idx++;
      const url = urls[my];
      const r: SiteResult = { url, status: null, htmlLen: 0, perStrategy: {} };
      try {
        const { status, body } = await fetchHtml(url, 20000);
        r.status = status;
        r.htmlLen = body.length;
        if (status >= 200 && status < 400 && body.length > 1000) {
          if (saveHtmlDir) {
            const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
            fs.writeFileSync(path.join(saveHtmlDir, `${slug}.html`), body);
          }
          // Cap HTML size to keep cheerio memory bounded (real staff pages
          // are usually <500KB; large 2-3MB pages are mostly inline scripts).
          const cappedBody = body.length > 400_000 ? body.slice(0, 400_000) : body;
          for (const strategy of strategies) {
            try {
              const parser = new ParserFactory(cappedBody, url, strategy);
              const result = await parser.parse();
              r.perStrategy[strategy] = {
                contacts: result.contacts.length,
                withEmail: result.contacts.filter(c => c.email).length,
                selectorUsage: result.diagnostics.selectorUsage,
              };
            } catch (e: any) {
              r.perStrategy[strategy] = {
                contacts: 0, withEmail: 0,
                selectorUsage: { container: {}, name: {}, title: {}, email: {}, phone: {}, department: {}, office: {} },
              };
            }
          }
        }
      } catch (e: any) {
        r.err = e.message;
      }
      results.push(r);
      origLog(`[${pad(String(results.length), 3)}/${urls.length}] ${pad(String(r.status ?? 'ERR'), 4)} len=${pad(String(r.htmlLen), 7)} ${url}`);
      // Persist partial results frequently so a crash mid-run still leaves
      // usable evidence on disk.
      if (results.length % 3 === 0) {
        fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), strategies, results }, null, 2));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), strategies, results }, null, 2));

  // Per-strategy report
  console.log('\n=== Per-Strategy Site Coverage ===\n');
  for (const strategy of strategies) {
    const sitesParsed = results.filter(r => r.perStrategy[strategy] && r.htmlLen > 0).length;
    const sitesWithContacts = results.filter(r => (r.perStrategy[strategy]?.contacts ?? 0) > 0).length;
    const sitesWithEmail = results.filter(r => (r.perStrategy[strategy]?.withEmail ?? 0) > 0).length;
    console.log(`  ${pad(strategy, 12)} parsed=${sitesParsed}  contacts>0=${sitesWithContacts}  withEmail>0=${sitesWithEmail}`);
  }

  // Aggregate selector usage per strategy.
  console.log('\n=== Per-Strategy Selector Usage (real-world HTML) ===\n');
  for (const strategy of strategies) {
    const config = PARSER_STRATEGIES[strategy];
    const fieldTotals = new Map<keyof SelectorUsage, Map<string, { hits: number; sites: number }>>();
    for (const r of results) {
      const su = r.perStrategy[strategy]?.selectorUsage;
      if (!su) continue;
      for (const field of Object.keys(su) as Array<keyof SelectorUsage>) {
        let m = fieldTotals.get(field);
        if (!m) { m = new Map(); fieldTotals.set(field, m); }
        for (const [sel, hits] of Object.entries(su[field] || {})) {
          const prev = m.get(sel);
          if (prev) { prev.hits += hits; prev.sites += 1; }
          else { m.set(sel, { hits, sites: 1 }); }
        }
      }
    }
    const sitesParsed = results.filter(r => r.perStrategy[strategy] && r.htmlLen > 0).length;
    console.log(`\n  Parser: ${strategy}   (sites parsed: ${sitesParsed})`);
    for (const field of Object.keys(FIELD_TO_CONFIG_KEY) as Array<keyof SelectorUsage>) {
      const configured: string[] = (config[FIELD_TO_CONFIG_KEY[field]] as string[]) || [];
      const usage = fieldTotals.get(field) || new Map();
      const used = configured.filter(s => usage.has(s));
      const unused = configured.filter(s => !usage.has(s));
      console.log(`    ${pad(field, 11)} configured=${configured.length}  used=${used.length}  unused=${unused.length}`);
      // Top 3 used
      const sorted = configured
        .filter(s => usage.has(s))
        .map(s => ({ s, ...usage.get(s)! }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 3);
      if (sorted.length) {
        console.log(`        top: ${sorted.map(x => `${x.s} (${x.hits}h/${x.sites}s)`).join(' | ')}`);
      }
      if (unused.length) {
        console.log(`        unused: ${unused.join(' ; ')}`);
      }
    }
  }

  console.log(`\nResults JSON: ${outPath}`);
  if (saveHtmlDir) console.log(`HTML saved:   ${saveHtmlDir}/`);
}

main().catch(e => { console.error(e); process.exit(1); });

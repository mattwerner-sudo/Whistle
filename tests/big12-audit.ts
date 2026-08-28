/**
 * Big 12 Staff Directory Audit
 *
 * Fetches each of the 15 Big 12 staff directories using the production
 * scraping pipeline (CORS proxy + Playwright fallback), runs them through
 * the ParserFactory, and reports per-site diagnostics so we can identify
 * structural gaps to optimize.
 */

import { scrapeUrl } from '../server/lib/scraper-worker';
import { ParserFactory } from '../server/lib/parser-factory';
import { detectParserStrategy } from '../server/lib/scraper-config';
import { closeBrowser } from '../server/lib/browser-pool';
import * as fs from 'fs';

const RESULTS_PATH = '/tmp/big12-results.json';
function appendResult(row: any) {
  let arr: any[] = [];
  try { arr = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')); } catch {}
  arr.push(row);
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(arr, null, 2));
}

const URLS: { school: string; url: string }[] = [
  { school: 'Baylor', url: 'https://baylorbears.com/staff-directory' },
  { school: 'WVU', url: 'https://wvusports.com/staff-directory' },
  { school: 'Utah', url: 'https://utahutes.com/staff-directory' },
  { school: 'UCF', url: 'https://ucfknights.com/staff-directory' },
  { school: 'Texas Tech', url: 'https://texastech.com/staff-directory' },
  { school: 'TCU', url: 'https://gofrogs.com/staff-directory' },
  { school: 'Oklahoma State', url: 'https://okstate.com/staff-directory' },
  { school: 'Kansas State', url: 'https://www.kstatesports.com/staff-directory' },
  { school: 'Kansas', url: 'https://kuathletics.com/staff-directory' },
  { school: 'Iowa State', url: 'https://cyclones.com/staff-directory' },
  { school: 'Houston', url: 'https://uhcougars.com/staff-directory' },
  { school: 'Colorado', url: 'https://cubuffs.com/staff-directory' },
  { school: 'BYU', url: 'https://byucougars.com/staff-directory' },
  { school: 'Arizona', url: 'https://arizonawildcats.com/staff-directory' },
  { school: 'Arizona State', url: 'https://thesundevils.com/staff-directory' },
];

interface AuditRow {
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
  containerHints?: string[];
  htmlLen?: number;
}

function pad(s: string, n: number) { return (s + ' '.repeat(n)).slice(0, n); }

async function detectContainerHints(html: string): Promise<string[]> {
  const hints: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['mailto', /<a[^>]+href=["']mailto:/i],
    ['data-cfemail', /data-cfemail=/i],
    ['sidearm-staff', /sidearm-staff/i],
    ['s-person-card', /s-person-card/i],
    ['s-stamp', /s-stamp/i],
    ['s-table', /s-table/i],
    ['c-staff', /c-staff/i],
    ['staff-directory', /class=["'][^"']*staff-directory/i],
    ['presto', /prestosports|presto-/i],
    ['wp-content', /wp-content/i],
    ['<table', /<table[\s>]/i],
    ['itemtype Person', /itemtype=["'][^"']*Person/i],
    ['data-bind staff', /data-bind=[^>]*staff/i],
  ];
  for (const [name, re] of checks) {
    if (re.test(html)) hints.push(name);
  }
  return hints;
}

async function audit(): Promise<void> {
  const rows: AuditRow[] = [];
  console.log(`\n=== Big 12 Staff Directory Audit (${URLS.length} sites) ===\n`);

  const CONCURRENCY = 8;
  let idx = 0;
  async function worker() {
    while (idx < URLS.length) {
      const my = idx++;
      const { school, url } = URLS[my];
      const t0 = Date.now();
      try {
        const result = await scrapeUrl(url);
        const elapsed = Date.now() - t0;
        const hints = result.html ? await detectContainerHints(result.html) : [];
        const detected = result.html ? detectParserStrategy(result.html, url) : 'none';
        const contacts = result.parseResult?.contacts || [];
        const withEmail = contacts.filter(c => c.email).length;
        const withTitle = contacts.filter(c => c.title).length;
        const withPhone = contacts.filter(c => c.phone).length;
        const row = {
          school, url,
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
          htmlLen: result.html?.length || 0,
          sampleContacts: contacts.slice(0, 3).map(c => ({ name: c.name, title: c.title, email: c.email, phone: c.phone })),
        };
        rows.push(row);
        appendResult(row);
        process.stdout.write(`[${pad(school, 16)}] ${result.success ? 'OK  ' : 'FAIL'} contacts=${contacts.length} parser=${result.metadata.parserUsed} http=${result.metadata.httpStatus} ${elapsed}ms\n`);
      } catch (e: any) {
        const elapsed = Date.now() - t0;
        rows.push({
          school, url, ok: false, contacts: 0, parser: 'error', detected: 'error',
          method: 'error', http: null, resolvedUrl: null, timeMs: elapsed,
          containers: 0, emailLinks: 0, avgConf: 0, withEmail: 0, withTitle: 0, withPhone: 0,
          error: e.message,
        });
        console.log(`[${pad(school, 16)}] THROW ${e.message} ${elapsed}ms`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  rows.sort((a, b) => URLS.findIndex(u => u.school === a.school) - URLS.findIndex(u => u.school === b.school));

  console.log('\n=== Summary Table ===\n');
  console.log(
    pad('School', 16) + pad('OK', 4) + pad('#', 5) + pad('Email', 6) + pad('Title', 6) +
    pad('Phone', 6) + pad('Conf%', 6) + pad('Cnt', 5) + pad('Mailto', 7) +
    pad('Parser', 12) + pad('Detect', 12) + pad('Method', 18) + 'HTTP'
  );
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(
      pad(r.school, 16) + pad(r.ok ? 'YES' : 'NO', 4) +
      pad(String(r.contacts), 5) + pad(String(r.withEmail), 6) +
      pad(String(r.withTitle), 6) + pad(String(r.withPhone), 6) +
      pad(String(r.avgConf), 6) + pad(String(r.containers), 5) +
      pad(String(r.emailLinks), 7) + pad(r.parser, 12) +
      pad(r.detected, 12) + pad(r.method, 18) + String(r.http)
    );
  }

  console.log('\n=== Diagnostic Hints (HTML structural fingerprint) ===\n');
  for (const r of rows) {
    console.log(`[${pad(r.school, 16)}] htmlLen=${r.htmlLen}  hints=${(r.containerHints || []).join(',') || '(none)'}`);
    if (r.resolvedUrl) console.log(`  -> redirected to: ${r.resolvedUrl}`);
    if (r.error) console.log(`  ERROR: ${r.error}`);
  }

  const ok = rows.filter(r => r.ok).length;
  const total = rows.length;
  const totalContacts = rows.reduce((s, r) => s + r.contacts, 0);
  console.log(`\n=== Result ===`);
  console.log(`Sites OK: ${ok}/${total} (${Math.round(ok / total * 100)}%)`);
  console.log(`Total contacts extracted: ${totalContacts}`);
  console.log(`Avg contacts per OK site: ${ok ? Math.round(totalContacts / ok) : 0}`);

  await closeBrowser();
  process.exit(0);
}

audit().catch(e => {
  console.error('Audit failed:', e);
  process.exit(1);
});

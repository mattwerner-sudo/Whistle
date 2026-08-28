/**
 * Parser Probe
 *
 * Quick utility to identify which parser strategy a list of candidate
 * staff-directory URLs would route to. Used to build a targeted audit
 * sample for non-Sidearm parsers (presto / wordpress / table).
 *
 * Usage:
 *   npx tsx tests/parser-probe.ts [--urls=tests/parser-probe-urls.txt]
 */

import * as fs from 'fs';
import { detectParserStrategy } from '../server/lib/scraper-config';

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

async function fetchWithTimeout(url: string, ms: number): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Parser-Probe/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = parseArgs();
  const urlsFile = String(args['urls'] || 'tests/parser-probe-urls.txt');
  const lines = fs.readFileSync(urlsFile, 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  const results: Array<{ url: string; status: number | null; parser: string; len: number; err?: string }> = [];

  let idx = 0;
  const concurrency = 8;
  async function worker() {
    while (idx < lines.length) {
      const my = idx++;
      const url = lines[my];
      try {
        const { status, body } = await fetchWithTimeout(url, 15000);
        const parser = detectParserStrategy(body, url);
        results.push({ url, status, parser, len: body.length });
        process.stdout.write(`[${parser.padEnd(10)}] ${status} ${url}\n`);
      } catch (e: any) {
        results.push({ url, status: null, parser: 'error', len: 0, err: e.message });
        process.stdout.write(`[error     ] -- ${url}  (${e.message})\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log('\n=== Per-Parser Counts ===');
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.parser, (counts.get(r.parser) || 0) + 1);
  for (const [p, n] of counts) console.log(`  ${p.padEnd(10)} ${n}`);

  console.log('\n=== URLs by Parser ===');
  for (const target of ['presto', 'wordpress', 'table', 'sidearm', 'generic', 'error']) {
    const list = results.filter(r => r.parser === target);
    if (!list.length) continue;
    console.log(`\n  ${target}:`);
    for (const r of list) console.log(`    ${r.url}`);
  }

  fs.writeFileSync('/tmp/parser-probe.json', JSON.stringify(results, null, 2));
  console.log('\nWrote /tmp/parser-probe.json');
}

main().catch(e => { console.error(e); process.exit(1); });

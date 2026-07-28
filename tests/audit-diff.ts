/**
 * Diff two multi-conference audit JSON files.
 *
 * Designed to compare a "baseline" audit (e.g. with bio enrichment disabled
 * via SCRAPER_BIO_ENRICH_MAX_PAGES=0) against an "after" audit with bio
 * enrichment turned on. Reports per-conference and overall delta in emails
 * recovered so the +500 email target from Task #9 can be verified, plus the
 * bio-page fetch counters so we can see exactly where the lift came from.
 *
 * Usage:
 *   npx tsx tests/audit-diff.ts \
 *     --baseline=/tmp/multi-conf-baseline.json \
 *     --after=/tmp/multi-conf-after.json \
 *     [--out=/tmp/multi-conf-diff.json]
 */

import * as fs from 'fs';

interface AuditRow {
  conference: string;
  school: string;
  url: string;
  ok: boolean;
  contacts: number;
  parser: string;
  withEmail: number;
  withTitle: number;
  withPhone: number;
  bioEmailsRecovered?: number;
  bioPagesFetched?: number;
  bioCacheHits?: number;
}

interface AuditFile {
  startedAt?: string;
  rows: AuditRow[];
  provenance?: Record<string, unknown>;
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=');
      out[k] = v.length ? v.join('=') : 'true';
    }
  }
  return out;
}

function pad(s: string | number, n: number) {
  return (String(s) + ' '.repeat(n)).slice(0, n);
}

function loadAudit(p: string): AuditFile {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!raw || !Array.isArray(raw.rows)) {
    throw new Error(`Invalid audit file (no rows[]): ${p}`);
  }
  return raw as AuditFile;
}

interface Aggregate {
  sites: number;
  contacts: number;
  emails: number;
  bioRecovered: number;
  bioFetched: number;
  bioCacheHits: number;
}

function emptyAgg(): Aggregate {
  return { sites: 0, contacts: 0, emails: 0, bioRecovered: 0, bioFetched: 0, bioCacheHits: 0 };
}

function addRow(agg: Aggregate, r: AuditRow): void {
  agg.sites += 1;
  agg.contacts += r.contacts || 0;
  agg.emails += r.withEmail || 0;
  agg.bioRecovered += r.bioEmailsRecovered || 0;
  agg.bioFetched += r.bioPagesFetched || 0;
  agg.bioCacheHits += r.bioCacheHits || 0;
}

function aggregate(rows: AuditRow[]): { byConference: Map<string, Aggregate>; byParser: Map<string, Aggregate>; byKey: Map<string, AuditRow>; total: Aggregate } {
  const byConference = new Map<string, Aggregate>();
  const byParser = new Map<string, Aggregate>();
  const byKey = new Map<string, AuditRow>();
  const total = emptyAgg();
  for (const r of rows) {
    const confAgg = byConference.get(r.conference) || emptyAgg();
    addRow(confAgg, r);
    byConference.set(r.conference, confAgg);
    const parser = r.parser || 'none';
    const parserAgg = byParser.get(parser) || emptyAgg();
    addRow(parserAgg, r);
    byParser.set(parser, parserAgg);
    addRow(total, r);
    byKey.set(`${r.conference}::${r.school}`, r);
  }
  return { byConference, byParser, byKey, total };
}

function diffAgg(baseline: Aggregate | undefined, after: Aggregate | undefined): Aggregate {
  const b = baseline || emptyAgg();
  const a = after || emptyAgg();
  return {
    sites: a.sites - b.sites,
    contacts: a.contacts - b.contacts,
    emails: a.emails - b.emails,
    bioRecovered: a.bioRecovered - b.bioRecovered,
    bioFetched: a.bioFetched - b.bioFetched,
    bioCacheHits: a.bioCacheHits - b.bioCacheHits,
  };
}

function fmtSign(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : String(n);
}

function main() {
  const args = parseArgs();
  const baselinePath = args['baseline'];
  const afterPath = args['after'];
  if (!baselinePath || !afterPath) {
    console.error('Usage: npx tsx tests/audit-diff.ts --baseline=<file> --after=<file> [--out=<file>]');
    process.exit(2);
  }

  const baseline = loadAudit(baselinePath);
  const after = loadAudit(afterPath);
  const baseAgg = aggregate(baseline.rows);
  const afterAgg = aggregate(after.rows);

  console.log(`\n=== Audit Diff ===`);
  console.log(`  baseline: ${baselinePath}  (${baseline.rows.length} rows, started ${baseline.startedAt || 'n/a'})`);
  console.log(`  after:    ${afterPath}  (${after.rows.length} rows, started ${after.startedAt || 'n/a'})\n`);

  // Per-conference table
  console.log('=== Per-Conference Delta (after - baseline) ===\n');
  console.log(
    pad('Conf', 12) +
    pad('Sites', 6) +
    pad('ΔEmails', 9) +
    pad('Δ Contacts', 12) +
    pad('AfterEm', 9) +
    pad('BaseEm', 9) +
    pad('BioRec', 8) +
    pad('BioFch', 8) +
    pad('BioHit', 8),
  );
  console.log('-'.repeat(82));
  const allConfs = new Set([...baseAgg.byConference.keys(), ...afterAgg.byConference.keys()]);
  const sortedConfs = Array.from(allConfs).sort();
  for (const conf of sortedConfs) {
    const b = baseAgg.byConference.get(conf);
    const a = afterAgg.byConference.get(conf);
    const d = diffAgg(b, a);
    console.log(
      pad(conf, 12) +
      pad(a?.sites ?? b?.sites ?? 0, 6) +
      pad(fmtSign(d.emails), 9) +
      pad(fmtSign(d.contacts), 12) +
      pad(a?.emails ?? 0, 9) +
      pad(b?.emails ?? 0, 9) +
      pad(a?.bioRecovered ?? 0, 8) +
      pad(a?.bioFetched ?? 0, 8) +
      pad(a?.bioCacheHits ?? 0, 8),
    );
  }
  console.log('-'.repeat(82));
  const totalDelta = diffAgg(baseAgg.total, afterAgg.total);
  console.log(
    pad('TOTAL', 12) +
    pad(afterAgg.total.sites, 6) +
    pad(fmtSign(totalDelta.emails), 9) +
    pad(fmtSign(totalDelta.contacts), 12) +
    pad(afterAgg.total.emails, 9) +
    pad(baseAgg.total.emails, 9) +
    pad(afterAgg.total.bioRecovered, 8) +
    pad(afterAgg.total.bioFetched, 8) +
    pad(afterAgg.total.bioCacheHits, 8),
  );

  // Per-parser delta
  console.log('\n=== Per-Parser Delta ===\n');
  const allParsers = new Set([...baseAgg.byParser.keys(), ...afterAgg.byParser.keys()]);
  for (const parser of Array.from(allParsers).sort()) {
    const b = baseAgg.byParser.get(parser);
    const a = afterAgg.byParser.get(parser);
    const d = diffAgg(b, a);
    console.log(
      `  ${pad(parser, 12)} ΔEmails=${pad(fmtSign(d.emails), 7)} ΔContacts=${pad(fmtSign(d.contacts), 7)} ` +
      `afterEmails=${a?.emails ?? 0} baseEmails=${b?.emails ?? 0} ` +
      `bioRecovered=${a?.bioRecovered ?? 0} bioFetched=${a?.bioFetched ?? 0} bioCacheHits=${a?.bioCacheHits ?? 0}`,
    );
  }

  // Per-school top movers (where bio enrichment recovered the most emails)
  console.log('\n=== Top Per-School Email Lifts ===\n');
  const movers: Array<{ key: string; conference: string; school: string; deltaEmails: number; bioRecovered: number; afterEmails: number; baseEmails: number }> = [];
  for (const [key, afterRow] of afterAgg.byKey) {
    const baseRow = baseAgg.byKey.get(key);
    const baseEmails = baseRow?.withEmail ?? 0;
    const deltaEmails = (afterRow.withEmail || 0) - baseEmails;
    if (deltaEmails === 0 && (afterRow.bioEmailsRecovered || 0) === 0) continue;
    movers.push({
      key,
      conference: afterRow.conference,
      school: afterRow.school,
      deltaEmails,
      bioRecovered: afterRow.bioEmailsRecovered || 0,
      afterEmails: afterRow.withEmail || 0,
      baseEmails,
    });
  }
  movers.sort((x, y) => y.deltaEmails - x.deltaEmails || y.bioRecovered - x.bioRecovered);
  for (const m of movers.slice(0, 30)) {
    console.log(
      `  [${pad(m.conference, 10)}] ${pad(m.school, 26)} ` +
      `ΔEmails=${pad(fmtSign(m.deltaEmails), 6)} bioRecovered=${pad(m.bioRecovered, 4)} ` +
      `(${m.baseEmails} -> ${m.afterEmails})`,
    );
  }

  // Schools that regressed (lost emails)
  const regressions = movers.filter(m => m.deltaEmails < 0);
  if (regressions.length) {
    console.log('\n=== Regressions (after has fewer emails than baseline) ===\n');
    for (const m of regressions) {
      console.log(`  [${pad(m.conference, 10)}] ${pad(m.school, 26)} ${m.baseEmails} -> ${m.afterEmails} (${fmtSign(m.deltaEmails)})`);
    }
  }

  if (args['out']) {
    const machine = {
      baseline: {
        path: baselinePath,
        startedAt: baseline.startedAt,
        total: baseAgg.total,
        provenance: baseline.provenance,
      },
      after: { path: afterPath, startedAt: after.startedAt, total: afterAgg.total },
      totalDelta,
      perConference: sortedConfs.map(conf => ({
        conference: conf,
        baseline: baseAgg.byConference.get(conf) || emptyAgg(),
        after: afterAgg.byConference.get(conf) || emptyAgg(),
        delta: diffAgg(baseAgg.byConference.get(conf), afterAgg.byConference.get(conf)),
      })),
      perParser: Array.from(allParsers).sort().map(parser => ({
        parser,
        baseline: baseAgg.byParser.get(parser) || emptyAgg(),
        after: afterAgg.byParser.get(parser) || emptyAgg(),
        delta: diffAgg(baseAgg.byParser.get(parser), afterAgg.byParser.get(parser)),
      })),
      perSchool: movers,
    };
    fs.writeFileSync(args['out'], JSON.stringify(machine, null, 2));
    console.log(`\nWrote machine-readable diff to ${args['out']}`);
  }
}

main();

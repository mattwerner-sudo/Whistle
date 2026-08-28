/**
 * Quick checks for the SPA host auto-detection cache.
 *
 * Usage: npx tsx tests/spa-host-cache.test.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-host-cache-'));
process.env.SCRAPER_SPA_HOST_CACHE_PATH = path.join(tmpDir, 'spa-hosts.json');

const {
  detectClientRenderedShell,
  rememberSpaHost,
  isLearnedSpaHost,
  clearSpaHostCacheForTests,
  listLearnedSpaHosts,
} = await import('../server/lib/spa-host-cache');
const { needsJavaScriptRendering } = await import('../server/lib/scraper-config');

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`);
  }
}

console.log('detectClientRenderedShell heuristics:');

const vueShell = `<!doctype html><html><head><title>Staff</title></head><body><div id="app"></div><script src="/static/app.js"></script></body></html>`;
check('flags empty Vue/React #app shell', detectClientRenderedShell(vueShell) !== null);

const reactShell = `<!doctype html><html><body><div id="root"></div><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`;
check('flags Next.js __NEXT_DATA__ shell', detectClientRenderedShell(reactShell) !== null);

const dataVShell = `<!doctype html><html><body><div data-v-1a2b3c4d="" class="layout"></div></body></html>`;
check('flags Vue data-v hashed shell', detectClientRenderedShell(dataVShell) !== null);

const angularShell = `<!doctype html><html><body><app-root ng-version="17.0.0"></app-root></body></html>`;
check('flags Angular shell', detectClientRenderedShell(angularShell) !== null);

const pageWithEmail = `<!doctype html><html><body><div id="app"></div><a href="mailto:coach@example.edu">Coach</a></body></html>`;
check('does NOT flag pages that already contain mailto links', detectClientRenderedShell(pageWithEmail) === null);

const pageWithStaffCard = `<!doctype html><html><body><div class="s-person-card">Coach Doe</div></body></html>`;
check('does NOT flag pages with sidearm staff cards', detectClientRenderedShell(pageWithStaffCard) === null);

const ssrTablePage = `<!doctype html><html><body><table><tr><td>Coach</td><td><a href="mailto:c@x.edu">c@x.edu</a></td></tr></table></body></html>`;
check('does NOT flag a server-rendered table page', detectClientRenderedShell(ssrTablePage) === null);

console.log('\ncache behavior:');
clearSpaHostCacheForTests();

check('unknown host is not flagged before learning', !isLearnedSpaHost('https://example-school.athletics.com/staff'));

const learnedFirst = rememberSpaHost('https://example-school.athletics.com/staff', 'auto:vue-app-shell');
check('rememberSpaHost returns true the first time', learnedFirst === true);

check('isLearnedSpaHost picks up freshly-learned host', isLearnedSpaHost('https://example-school.athletics.com/staff'));
check('subdomain inherits the learned root host', isLearnedSpaHost('https://www.example-school.athletics.com/staff/john-doe'));
check('different host is still not flagged', !isLearnedSpaHost('https://other-school.org/staff'));

const learnedSecond = rememberSpaHost('https://example-school.athletics.com/staff', 'auto:vue-app-shell');
check('rememberSpaHost is idempotent (returns false the second time)', learnedSecond === false);

check('needsJavaScriptRendering honors learned hosts', needsJavaScriptRendering('https://example-school.athletics.com/staff'));
check('needsJavaScriptRendering still false for plain hosts', !needsJavaScriptRendering('https://random-school.edu/staff'));

const cachePath = process.env.SCRAPER_SPA_HOST_CACHE_PATH!;
check('cache file is persisted to disk', fs.existsSync(cachePath));
const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
check('persisted file contains the learned host', !!persisted.hosts['example-school.athletics.com']);

check('listLearnedSpaHosts returns the host', listLearnedSpaHosts().includes('example-school.athletics.com'));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll SPA host cache checks passed.');

/**
 * Quick checks for the bio-page lookup cache.
 *
 * Usage: npx tsx tests/bio-cache.test.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-cache-'));
process.env.SCRAPER_BIO_CACHE_PATH = path.join(tmpDir, 'bio-cache.json');

const {
  getCachedBio,
  setCachedBio,
  flushBioCache,
  clearBioCacheForTests,
  getBioCacheStats,
} = await import('../server/lib/bio-cache');

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`);
  }
}

console.log('basic cache behavior:');
clearBioCacheForTests();

const url = 'https://example.edu/staff/jane-doe';
check('miss before set', getCachedBio(url).hit === false);

setCachedBio(url, 'jane@example.edu');
const hit = getCachedBio(url);
check('positive entry hits', hit.hit === true && hit.email === 'jane@example.edu');

const url2 = 'https://example.edu/staff/john-roe';
setCachedBio(url2, null);
const negHit = getCachedBio(url2);
check('negative entry hits', negHit.hit === true && negHit.email === null);

const stats = getBioCacheStats();
check('stats size accurate', stats.size === 2);
check('stats positive count', stats.positive === 1);
check('stats negative count', stats.negative === 1);

console.log('\npersistence:');
flushBioCache();
const cachePath = process.env.SCRAPER_BIO_CACHE_PATH!;
check('cache file persisted', fs.existsSync(cachePath));
const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
check('persisted contains positive entry', persisted.entries[url] && persisted.entries[url].email === 'jane@example.edu');
check('persisted contains negative entry', persisted.entries[url2] && persisted.entries[url2].email === null);

console.log('\nrescrape simulation (a second pass should be all cache hits):');
clearBioCacheForTests();

const urls = [
  'https://school.edu/staff/coach-1',
  'https://school.edu/staff/coach-2',
  'https://school.edu/staff/coach-3',
];

// First scrape: every URL is a miss, then we record the result of the fetch.
let firstPassMisses = 0;
for (const u of urls) {
  if (!getCachedBio(u).hit) firstPassMisses++;
  setCachedBio(u, `${u.split('/').pop()}@school.edu`);
}
check('first scrape misses every url', firstPassMisses === urls.length);

// Second scrape: every URL should be a hit and the cached email should
// match what we stored, so no fetches needed.
let secondPassHits = 0;
let secondPassMisses = 0;
for (const u of urls) {
  const r = getCachedBio(u);
  if (r.hit && r.email === `${u.split('/').pop()}@school.edu`) secondPassHits++;
  else secondPassMisses++;
}
check('second scrape hits every url', secondPassHits === urls.length);
check('second scrape has zero misses', secondPassMisses === 0);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll bio cache checks passed.');

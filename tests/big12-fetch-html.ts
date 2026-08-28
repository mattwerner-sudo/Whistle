/**
 * Fetches raw HTML from problematic Big 12 sites and saves to /tmp for inspection.
 * Also identifies key DOM patterns: containers, name/title/email locations.
 */
import { scrapeUrl } from '../server/lib/scraper-worker';
import { closeBrowser } from '../server/lib/browser-pool';
import * as cheerio from 'cheerio';
import * as fs from 'fs';

const TARGETS = [
  { school: 'UCF', url: 'https://ucfknights.com/staff-directory' },
  { school: 'KState', url: 'https://www.kstatesports.com/staff-directory' },
  { school: 'Houston', url: 'https://uhcougars.com/staff-directory' },
  { school: 'Colorado', url: 'https://cubuffs.com/staff-directory' },
  { school: 'TexasTech', url: 'https://texastech.com/staff-directory' },
  { school: 'Arizona', url: 'https://arizonawildcats.com/staff-directory' },
  { school: 'ASU', url: 'https://thesundevils.com/staff-directory' },
];

async function processOne(school: string, url: string) {
    console.log(`\n=== ${school} (${url}) ===`);
    const r = await scrapeUrl(url);
    if (!r.html) {
      console.log('NO HTML');
      return;
    }
    fs.writeFileSync(`/tmp/big12-${school}.html`, r.html);
    const $ = cheerio.load(r.html);

    // Sample of key class fingerprints
    const classCounts = new Map<string, number>();
    $('[class]').each((_, el) => {
      const cls = $(el).attr('class') || '';
      cls.split(/\s+/).forEach(c => {
        if (c && (c.includes('staff') || c.includes('person') || c.includes('coach') ||
                  c.includes('directory') || c.includes('contact') || c.includes('card') ||
                  c.includes('s-') || c.includes('c-') || c.includes('member'))) {
          classCounts.set(c, (classCounts.get(c) || 0) + 1);
        }
      });
    });

    const top = Array.from(classCounts.entries())
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
    console.log('Top staff-related class names:');
    for (const [c, n] of top) console.log(`  ${n}x .${c}`);

    // Sample mailto and tel link contexts
    const mailtos = $('a[href^="mailto:"]').length;
    const tels = $('a[href^="tel:"]').length;
    const cfEmails = $('[data-cfemail]').length;
    console.log(`mailto=${mailtos}  tel=${tels}  data-cfemail=${cfEmails}`);

    // Find the highest-frequency parent of mailto links
    const parentMap = new Map<string, number>();
    $('a[href^="mailto:"]').each((_, el) => {
      let parent = $(el).parent();
      // Walk up 2-4 levels to find "card" container
      for (let i = 0; i < 4 && parent.length; i++) {
        const cls = parent.attr('class') || parent.prop('tagName')?.toLowerCase() || '';
        if (cls) parentMap.set(`${i}: ${cls.substring(0, 80)}`, (parentMap.get(`${i}: ${cls.substring(0, 80)}`) || 0) + 1);
        parent = parent.parent();
      }
    });
    console.log('Mailto ancestor classes (top 10):');
    Array.from(parentMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([c, n]) => console.log(`  ${n}x ${c}`));

    // Sample first staff-like element snippet
    const firstStaff = $('a[href^="mailto:"]').first().closest('[class*="staff"], [class*="person"], [class*="card"], tr, li').first();
    if (firstStaff.length) {
      const snippet = $.html(firstStaff).substring(0, 600);
      console.log('First container snippet (truncated):');
      console.log(snippet.replace(/\s+/g, ' '));
    }

    // For Kansas State - look at how emails are encoded
    if (school === 'KState') {
      const personLikes = $('[class*="s-person"], [class*="staff"], [class*="contact"]').slice(0, 2);
      personLikes.each((i, el) => {
        console.log(`KState person sample ${i}:`);
        console.log($.html(el).substring(0, 800).replace(/\s+/g, ' '));
      });
    }
}

async function main() {
  await Promise.all(TARGETS.map(t => processOne(t.school, t.url).catch(e => console.log(`${t.school} err: ${e.message}`))));
  await closeBrowser();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

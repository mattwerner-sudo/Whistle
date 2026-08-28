/**
 * Pure cheerio-based local inspection of saved HTML files.
 * Avoids any network/playwright. Identifies the structural pattern of staff items.
 */
import * as cheerio from 'cheerio';
import * as fs from 'fs';

const SITES = ['UCF', 'KState', 'Houston', 'Colorado', 'TexasTech', 'Arizona'];

function describeFirstStaffRow(html: string, label: string) {
  const $ = cheerio.load(html);
  console.log(`\n=== ${label} ===`);
  const mailtoLinks = $('a[href^="mailto:"]').not('a[href*="mailto:redraidertickets"]'); // skip nav links for ttu
  const tels = $('a[href^="tel:"]');
  const cfemails = $('[data-cfemail]');
  console.log(`mailto=${mailtoLinks.length}  tel=${tels.length}  cfemail=${cfemails.length}`);

  // Find the staff container by finding common row class with most siblings
  const candidateContainers = [
    'tr.staff-directory-table-member-position',
    'tr.staff-directory-table-department__row',
    '.s-table-body__row',
    '.s-person-card',
    '.staff-card',
    '.staff-directory-table-member-position',
    'tr[has-email="true"]',
    '[class*="staff-directory-table-member-position"]',
  ];
  for (const sel of candidateContainers) {
    const n = $(sel).length;
    if (n > 0) console.log(`  container ${sel}: ${n}`);
  }

  // Get the first 3 mailto link's containers
  let printed = 0;
  $('a[href^="mailto:"]').each((i, el) => {
    if (printed >= 1) return;
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (href.includes('redraider') || href.includes('@athletics.com')) return;
    let row = $a.closest('tr, li, article, [class*="card"], [class*="person"], [class*="staff"], [class*="member"]').first();
    if (!row.length) row = $a.parent().parent();
    const html = $.html(row).substring(0, 1500).replace(/\s+/g, ' ');
    console.log(`  Container HTML for mailto[${i}]:`);
    console.log('   ', html);
    printed++;
  });

  // Also check rows that have NO email but might be staff
  if (mailtoLinks.length === 0) {
    // Check tel containers
    console.log(`  mailto absent — sampling tel container...`);
    const tel = $('a[href^="tel:"]').first();
    if (tel.length) {
      let row = tel.closest('tr, li, article, [class*="card"], [class*="person"], [class*="staff"], [class*="member"]').first();
      if (!row.length) row = tel.parent().parent();
      console.log('   tel container:', $.html(row).substring(0, 1500).replace(/\s+/g, ' '));
    }
    // Check for click-to-reveal email patterns
    const emailButtons = $('button[class*="email"], a[class*="email"]:not([href^="mailto:"]), [data-email], [data-cfemail]');
    console.log(`  email reveal candidates: ${emailButtons.length}`);
    if (emailButtons.length) {
      const e = emailButtons.first();
      console.log('   sample:', $.html(e).substring(0, 400).replace(/\s+/g, ' '));
    }
  }

  // Iterate and show first non-mailto, non-nav staff person container HTML
  const pcards = $('.s-person-card').first();
  if (pcards.length) {
    console.log('  s-person-card sample:');
    console.log('   ', $.html(pcards).substring(0, 1500).replace(/\s+/g, ' '));
  }
}

for (const site of SITES) {
  const path = `/tmp/big12-${site}.html`;
  if (!fs.existsSync(path)) { console.log(`(no file ${path})`); continue; }
  const html = fs.readFileSync(path, 'utf8');
  describeFirstStaffRow(html, site);
}

/**
 * Scraper Configuration - Commercial-Grade Parser Strategies
 * 
 * This file defines selector configurations for different university athletic
 * directory layouts. The ParserFactory uses these to select the appropriate
 * extraction strategy based on detected site patterns.
 */

import { isLearnedSpaHost } from './spa-host-cache';

export interface SelectorConfig {
  name: string;
  description: string;
  detectPatterns: string[];
  containerSelectors: string[];
  nameSelectors: string[];
  titleSelectors: string[];
  emailSelectors: string[];
  phoneSelectors: string[];
  departmentSelectors: string[];
  officeSelectors: string[];
  imageSelectors: string[];
  bioLinkSelectors: string[];
  linkedinSelectors: string[];
}

export const PARSER_STRATEGIES: Record<string, SelectorConfig> = {
  sidearm: {
    name: 'Sidearm Sports',
    description: 'Most common NCAA athletic site provider (600+ schools)',
    detectPatterns: [
      'sidearm',
      'sidearmsports.com',
      's-person-card',
      'sidearm-staff',
      's-table-body',
      's-person-details',
      'sidearm-roster',
      'sidearm-table',
      'sidearm-list',
      's-stamp',
      's-grid',
      'data-sidearm',
    ],
    // Selectors trimmed via tests/multi-conf-audit.ts (45 Sidearm sites).
    // Kept: every selector seen firing + a few "known-important" Sidearm
    // class shapes (e.g. .staff-directory-table-member-position*) that are
    // standard in the Sidearm template but happened not to appear in this
    // sample. Removed: speculative [class*=...] catch-alls and dead variants.
    containerSelectors: [
      'tr[has-email="true"]',
      'tr.staff-directory-table-member-position',
      '[class*="staff-directory-table-member-position"]:has(a[href^="mailto:"])',
      'tr.s-table-body__row',
      '.sidearm-staff-member',
      '.s-person-card',
      '.s-person-card--staff',
      '.s-stamp__item',
    ],
    nameSelectors: [
      '.staff-directory-table-member-position__link--name',
      '.sidearm-staff-member-name',
      '.s-person-details__personal-single-line',
      '[class*="s-person-card__name"]',
      '.name:not(.title):not(.position)',
      '.s-stamp__header a',
      '.s-stamp__name',
      'a[aria-label*="full bio" i]',
      'td[headers*="fullname"] a',
      'td[headers*="staff_name"] a',
      'a[href*="/staff-directory/"] span.s-text-regular-bold',
      'span.s-text-regular-bold',
      'h3 a',
      'h4 a',
      'h3',
      'h4',
    ],
    titleSelectors: [
      '.staff-directory-table-member-position__position',
      '.staff-directory-table-member-position__position p',
      '.sidearm-staff-member-title',
      '.s-person-details__position',
      '[class*="s-person-card__position"]',
      '.title:not(.name)',
      '.s-stamp__position',
      '[itemprop="jobTitle"]',
      'td[headers*="staff_title"]',
      'td[headers*="staff_position"]',
      'td:nth-child(2) > div',
      'td:nth-child(2)',
    ],
    emailSelectors: [
      'a[href^="mailto:"]:not([href="mailto:"]):not([href="#"])',
      'a[data-cfemail]',
      'span.__cf_email__',
      'a[href*="/cdn-cgi/l/email-protection"]',
      '[itemprop="email"]',
      'td[headers*="staff_email"]',
    ],
    phoneSelectors: [
      'a[href^="tel:"]',
      '[itemprop="telephone"]',
      '[class*="phone"]',
      'td[headers*="staff_phone"] a[href^="tel:"]',
    ],
    departmentSelectors: [
      '.s-person-card__sport',
      '[class*="sport"]',
    ],
    officeSelectors: [
      '[class*="office"]',
      '[class*="location"]',
    ],
    imageSelectors: [
      '.s-person-card__image img',
      '[class*="person"] img',
      '.sidearm-staff-member img',
      'img[class*="headshot"]',
      '.s-stamp__image img',
      '.s-person-card__photo img',
      '[class*="c-staff__image"] img',
      'img[itemprop="image"]',
    ],
    bioLinkSelectors: [
      'a[aria-label*="bio" i]',
      'a[href*="/staff/"]',
      'a[href*="/coaches/"]',
      'a[href*="/staff-directory/"]',
    ],
    linkedinSelectors: [
      'a[href*="linkedin.com"]',
    ],
  },
  
  presto: {
    name: 'Presto/PrestoSports',
    description: 'Common in DII/DIII schools',
    detectPatterns: [
      'prestosports',
      'presto',
      'roster-card',
      'presto-athletics',
      'prestosports.com',
      'data-presto',
      'presto-widget',
      'presto-module',
    ],
    // Selectors trimmed via tests/parser-strategy-audit.ts (58 sites,
    // shadow-parsing the presto strategy onto each fetched HTML).
    // Kept: every selector seen firing + canonical Presto/Bootstrap shapes
    // that didn't appear in the sample but are standard in real Presto
    // staff cards. Removed: speculative [class*="..."] catch-alls
    // (presto-staff/people-card/personnel/listing/coach-listing/etc) and
    // dead variants ([class*="bio-name"], [class*="role"], etc.) that
    // never matched.
    containerSelectors: [
      '[class*="card"]:has(a[href^="mailto:"])',
      '.staff-card',
      '.coach-card',
      '.bio-card',
      '.roster-card',
      '.staff-listing__item',
      '[itemtype*="Person"]',
    ],
    nameSelectors: [
      'h4',
      'h3',
      'h3 a',
      '.card-title',
      '.staff-name',
      '.coach-name',
      '[itemprop="name"]',
    ],
    titleSelectors: [
      '[class*="position"]',
      '.card-subtitle',
      '.staff-title',
      '.coach-title',
      '[itemprop="jobTitle"]',
    ],
    emailSelectors: [
      'a[href^="mailto:"]',
      'a[data-cfemail]',
      '[itemprop="email"]',
      'a[href*="/cdn-cgi/l/email-protection"]',
    ],
    phoneSelectors: [
      'a[href^="tel:"]',
      '[class*="phone"]',
      '[itemprop="telephone"]',
    ],
    departmentSelectors: [
      '[class*="department"]',
      '[class*="sport"]',
    ],
    officeSelectors: [
      '[class*="office"]',
      '[class*="location"]',
    ],
    imageSelectors: [
      '.card-img img',
      'img.staff-photo',
      'img[class*="headshot"]',
      '[itemprop="image"]',
      '.bio-photo img',
      '.roster-photo img',
    ],
    bioLinkSelectors: [
      'a[href*="/bio/"]',
      'a[href*="/coaches/"]',
      'a[href*="/staff/"]',
      'a[href*="/profile/"]',
    ],
    linkedinSelectors: [
      'a[href*="linkedin.com"]',
    ],
  },

  wordpress: {
    name: 'WordPress Generic',
    description: 'Custom WordPress athletic sites',
    detectPatterns: [
      'wp-content',
      'wordpress',
      'wp-block',
      'wp-json',
      'wp-includes',
      'wp-admin',
      'elementor',
      'et_pb_',
      'wpb_column',
    ],
    // Selectors trimmed via tests/parser-strategy-audit.ts (58 sites,
    // shadow-parsing the wordpress strategy onto each fetched HTML).
    // Kept: every selector seen firing + canonical WP/Elementor/Divi shapes
    // that didn't appear in this Sidearm-heavy sample but are standard in
    // pure-WordPress staff plugins. Removed: the [class*="staff-name"]
    // family and the speculative legacy-builder containers (VC/WPBakery/
    // Avia/Beaver Builder fl-module/.entry-content row|li:has(...)) that
    // never matched.
    containerSelectors: [
      '.staff-member',
      '.team-member',
      '.person-card',
      'article:has(a[href^="mailto:"])',
      '.wp-block-group:has(a[href^="mailto:"])',
      '.elementor-widget-container:has(a[href^="mailto:"])',
      '[class*="et_pb_"]:has(a[href^="mailto:"])',
      '[itemtype*="Person"]',
    ],
    nameSelectors: [
      'strong:first-of-type',
      'h3',
      'h2',
      'h4',
      'h2 a',
      'h3 a',
      '.member-name',
      '.person-name',
      '[itemprop="name"]',
    ],
    titleSelectors: [
      'em',
      '[class*="position"]',
      '.member-title',
      '.person-title',
      '[itemprop="jobTitle"]',
    ],
    emailSelectors: [
      'a[href^="mailto:"]',
      '[itemprop="email"]',
      'a[data-cfemail]',
      'a[href*="/cdn-cgi/l/email-protection"]',
    ],
    phoneSelectors: [
      'a[href^="tel:"]',
      '[itemprop="telephone"]',
      '[class*="phone"]',
    ],
    departmentSelectors: [
      '[class*="department"]',
      '[class*="sport"]',
    ],
    officeSelectors: [
      '[class*="office"]',
      '[itemprop="address"]',
      '[class*="location"]',
    ],
    imageSelectors: [
      '.member-photo img',
      '.person-image img',
      '[itemprop="image"]',
      'img[class*="wp-image"]',
      'img[class*="attachment"]',
      '.wp-block-image img',
    ],
    bioLinkSelectors: [
      'a[href*="/staff/"]',
      'a.read-more',
      'a[href*="/coaches/"]',
      'a[href*="/profile/"]',
    ],
    linkedinSelectors: [
      'a[href*="linkedin.com"]',
    ],
  },

  table: {
    name: 'HTML Table Layout',
    description: 'Traditional table-based staff directories',
    detectPatterns: [
      'table.staff',
      'table.directory',
      'table:has(th:contains("Name"))',
      'tablepress',
      'wp-table',
      'table.athletic',
      'table#staff',
      'table.coaches',
      'table.personnel',
    ],
    // Selectors trimmed via tests/parser-strategy-audit.ts (58 sites,
    // shadow-parsing the table strategy onto each fetched HTML).
    // Removed: container duplicates already covered by `tbody tr`
    // (.tablepress tr / table.staff tr / table.directory tr), `td:nth-child(1)`
    // (== `td:first-child`), and the rare/never-firing `td:contains("(")`,
    // `td[data-label="Extension"]`, `td span.__cf_email__`, and
    // `td:has([data-cfemail])` (already covered by `td a[data-cfemail]`).
    containerSelectors: [
      'tr:has(a[href^="mailto:"])',
      'tr:has(td a[data-cfemail])',
      'tr:has(a[href*="/cdn-cgi/l/email-protection"])',
      'tbody tr',
    ],
    nameSelectors: [
      'td:first-child',
      'th[scope="row"]',
      'td:first-child a',
      'td:first-child strong',
      'td[data-label="Name"]',
      'td[data-label="Staff"]',
      'td[data-column="name"]',
    ],
    titleSelectors: [
      'td:nth-child(2)',
      'td:nth-child(3)',
      'td[data-label="Title"]',
      'td[data-label="Position"]',
      'td[data-label="Role"]',
      'td[data-column="title"]',
      'td[data-column="position"]',
    ],
    emailSelectors: [
      'td a[href^="mailto:"]',
      'a[href^="mailto:"]',
      'td a[data-cfemail]',
      'td a[href*="/cdn-cgi/l/email-protection"]',
    ],
    phoneSelectors: [
      'td a[href^="tel:"]',
      'td[data-label="Phone"]',
      'td[data-label="Telephone"]',
      'td[data-column="phone"]',
    ],
    departmentSelectors: [
      'td[data-label="Department"]',
      'td[data-label="Sport"]',
      'td[data-column="department"]',
    ],
    officeSelectors: [
      'td[data-label="Office"]',
      'td[data-label="Location"]',
      'td[data-column="office"]',
    ],
    imageSelectors: [
      'td img',
    ],
    bioLinkSelectors: [
      'td a[href*="/bio/"]',
      'td a[href*="/staff/"]',
      'td a[href*="/profile/"]',
    ],
    linkedinSelectors: [
      'a[href*="linkedin.com"]',
    ],
  },

  generic: {
    name: 'Generic Fallback',
    description: 'Universal selectors for unknown layouts',
    detectPatterns: [],
    // Selectors trimmed via tests/multi-conf-audit.ts (6 generic sites).
    // Removed obvious duplicates (e.g. [itemscope][itemtype*="Person"] is
    // covered by [itemtype*="Person"]) and very speculative [class*=...]
    // catch-alls that never matched. Kept schema.org and common heading-/
    // mailto-based fallbacks since this is the catch-all parser.
    containerSelectors: [
      '[itemtype*="schema.org/Person"]',
      '[itemtype*="Person"]',
      '[class*="staff-card"]',
      '[class*="person-card"]',
      '[class*="contact-card"]',
      '[class*="employee"]',
      '[class*="member-card"]',
      '[class*="coach-card"]',
      '[class*="directory-card"]',
      '[class*="team-member"]',
      '[class*="profile-card"]',
      'tr:has(a[href^="mailto:"])',
      'li:has(a[href^="mailto:"])',
      'article:has(a[href^="mailto:"])',
      'div.row:has(a[href^="mailto:"])',
      'div[class*="col"]:has(a[href^="mailto:"])',
      'section:has(a[href^="mailto:"])',
      '[data-type="person"]',
      '[data-type="staff"]',
    ],
    nameSelectors: [
      '[itemprop="name"]',
      '[class*="name"]:not([class*="file"]):not([class*="site"]):not([class*="user"])',
      '[class*="fullname"]',
      '[data-field="name"]',
      'td:first-child a',
      'th[scope="row"]',
      'h2', 'h3', 'h4',
      'h2 a', 'h3 a', 'h4 a',
      'a[aria-label*="bio" i]',
      'strong:first-of-type',
      'td:first-child',
    ],
    titleSelectors: [
      '[itemprop="jobTitle"]',
      '[class*="title"]:not([class*="name"]):not([class*="page"]):not([class*="site"]):not([class*="card-title"])',
      '[class*="position"]',
      '[class*="role"]:not([class*="user"])',
      '[class*="job-title"]',
      '[data-field="title"]',
      '[data-field="position"]',
      'em:first-of-type',
    ],
    emailSelectors: [
      'a[href^="mailto:"]',
      'a[data-cfemail]',
      'span.__cf_email__',
      'a[href*="/cdn-cgi/l/email-protection"]',
      '[itemprop="email"]',
    ],
    phoneSelectors: [
      'a[href^="tel:"]',
      '[class*="phone"]',
      '[itemprop="telephone"]',
    ],
    departmentSelectors: [
      '[class*="department"]',
      '[class*="sport"]',
      '[itemprop="department"]',
    ],
    officeSelectors: [
      '[class*="office"]',
      '[class*="location"]',
      '[itemprop="address"]',
    ],
    imageSelectors: [
      'img[class*="photo"]',
      'img[class*="avatar"]',
      'img[class*="headshot"]',
      'img[class*="portrait"]',
      '[itemprop="image"]',
      'img[class*="profile"]',
    ],
    bioLinkSelectors: [
      'a[href*="/bio/"]',
      'a[href*="/profile/"]',
      'a[href*="/staff/"]',
      'a[href*="/coaches/"]',
      'a[href*="/people/"]',
    ],
    linkedinSelectors: [
      'a[href*="linkedin.com"]',
    ],
  },
};

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  minDelayBetweenRequestsMs: number;
}

export interface BrowserConfig {
  maxSessions: number;
  pageTimeoutMs: number;
}

export interface ScraperGlobalConfig {
  retry: RetryConfig;
  rateLimit: RateLimitConfig;
  browser: BrowserConfig;
  userAgents: string[];
  timeoutMs: number;
  playwrightWaitMs: number;
  aiConfidenceThreshold: number;
  enableAIFallback: boolean;
}

export const SCRAPER_CONFIG: ScraperGlobalConfig = {
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
  rateLimit: {
    requestsPerMinute: 20,
    minDelayBetweenRequestsMs: 1000,
  },
  browser: {
    maxSessions: parseInt(process.env.SCRAPER_MAX_SESSIONS || '5', 10),
    pageTimeoutMs: parseInt(process.env.SCRAPER_PAGE_TIMEOUT_MS || '60000', 10),
  },
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  ],
  timeoutMs: 30000,
  playwrightWaitMs: 3000,
  aiConfidenceThreshold: 60,
  enableAIFallback: true,
};

export function getRandomUserAgent(): string {
  return SCRAPER_CONFIG.userAgents[Math.floor(Math.random() * SCRAPER_CONFIG.userAgents.length)];
}

const JS_RENDERED_DOMAINS = [
  'sidearmsports.com',
  'sidearm',
  'prestosports.com',
  'presto',
  'sidearmstats.com',
  'jumpforward.com',
  'learfield.com',
  'cstv.com',
  'collegesports.com',
  'cbssports.com',
  'bfrdr.com',
  // Sites that build their staff directory client-side (s-person-card / Vue
  // layouts and other SPA staff pages) — confirmed via multi-conf-audit:
  // mgoblue.com / arizonawildcats.com return empty contacts via CORS proxy,
  // and georgiadogs.com returns rows but 0 emails until JS hydrates the cards.
  'mgoblue.com',
  'arizonawildcats.com',
  'georgiadogs.com',
];

export function needsJavaScriptRendering(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  for (let i = 0; i < JS_RENDERED_DOMAINS.length; i++) {
    if (lowerUrl.includes(JS_RENDERED_DOMAINS[i])) return true;
  }
  try {
    if (isLearnedSpaHost(url)) return true;
  } catch {
    // If the cache can't be read for any reason, fall back to the
    // hard-coded list above — never block scraping on cache failures.
  }
  return false;
}

export function detectParserStrategy(html: string, url: string): string {
  const lowerHtml = html.substring(0, 50000).toLowerCase();
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('sidearm') || lowerUrl.includes('sidearmsports')) {
    return 'sidearm';
  }
  if (lowerUrl.includes('prestosports') || lowerUrl.includes('presto-athletics')) {
    return 'presto';
  }

  const metaGenerator = lowerHtml.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/);
  if (metaGenerator) {
    const gen = metaGenerator[1].toLowerCase();
    if (gen.includes('wordpress')) return 'wordpress';
    if (gen.includes('sidearm')) return 'sidearm';
    if (gen.includes('presto')) return 'presto';
  }

  for (const [strategyName, config] of Object.entries(PARSER_STRATEGIES)) {
    if (strategyName === 'generic') continue;
    
    for (const pattern of config.detectPatterns) {
      if (lowerHtml.includes(pattern.toLowerCase()) || lowerUrl.includes(pattern.toLowerCase())) {
        return strategyName;
      }
    }
  }
  
  const hasTableHeaders = lowerHtml.includes('<table') &&
    (lowerHtml.includes('<th') || lowerHtml.includes('<thead'));
  if (hasTableHeaders) {
    const hasEmail = lowerHtml.includes('mailto:') || lowerHtml.includes('data-cfemail');
    if (hasEmail) {
      return 'table';
    }
    const hasTel = lowerHtml.includes('tel:');
    const trMatches = lowerHtml.match(/<tr[\s>]/g);
    const manyRows = (trMatches?.length || 0) >= 30;
    const staffSignal = /\b(staff|coach|directory|personnel|administration|assistant\s+ad|associate\s+ad|head\s+coach|athletic\s+director|department)\b/.test(lowerHtml);
    if ((hasTel || manyRows) && staffSignal) {
      return 'table';
    }
  }
  
  return 'generic';
}

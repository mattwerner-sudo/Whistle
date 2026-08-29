import * as cheerio from 'cheerio';
import type { InsertStaffMember } from '@shared/schema';
import { getBrowserSession, type BrowserSession } from './lib/browser-pool';
import { categorizePersona, classifyDepartmentTags } from './lib/ai-extractor';
import { getRandomUserAgent } from './lib/scraper-health';
import { 
  getKnownDirectoryUrl, 
  getAthleticsDomainOverride,
  EXTENDED_STAFF_PATTERNS,
  STAFF_LINK_KEYWORDS,
} from './lib/known-directory-urls';
import { needsJavaScriptRendering } from './lib/scraper-config';

// Playwright's own per-step timeouts (goto, waitForSelector, etc.) only bound
// that individual call — nothing bounds the sum of an entire fetch flow. On a
// pathological page, that lets one job hang forever, permanently occupying a
// pLimit queue slot. Race the whole flow against a hard wall-clock timeout so
// a hang degrades to a logged failure instead of an unrecoverable stall.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[Extraction] ${label} exceeded ${ms}ms wall-clock timeout — abandoning`);
      resolve(null);
    }, ms);
    promise.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err) => { clearTimeout(timer); console.error(`[Extraction] ${label} failed:`, err); resolve(null); },
    );
  });
}

const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchWithProxy(url: string): Promise<string | null> {
  for (const proxyFn of CORS_PROXIES) {
    // Node's fetch has no built-in timeout — a stalled third-party proxy
    // (these are free, unaffiliated services with no uptime guarantee) hangs
    // this call forever with no error, which previously stalled the entire
    // extraction job (and its pLimit queue slot) indefinitely. Bound it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const proxyUrl = proxyFn(url);
      const response = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
        },
      });
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        console.warn(`[Extraction] CORS proxy timed out after 15s: ${proxyFn(url)}`);
      }
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function decodeCloudflareEmail(encoded: string): string | null {
  try {
    const key = parseInt(encoded.substring(0, 2), 16);
    let email = '';
    for (let i = 2; i < encoded.length; i += 2) {
      email += String.fromCharCode(parseInt(encoded.substring(i, i + 2), 16) ^ key);
    }
    return email;
  } catch {
    return null;
  }
}

function isPronoun(text: string): boolean {
  if (!text || text.length > 50) return false;
  const normalizedText = text.toLowerCase().trim().replace(/\s*\/\s*/g, '/');
  const pronounPatterns = [
    /^he\/him$/,
    /^she\/her$/,
    /^they\/them$/,
    /^he\/him\/his$/,
    /^she\/her\/hers$/,
    /^they\/them\/theirs$/,
    /^he\/they$/,
    /^she\/they$/,
    /^\(he\/him\)$/,
    /^\(she\/her\)$/,
    /^\(they\/them\)$/,
    /^pronouns?:\s*he\/him(\/his)?$/,
    /^pronouns?:\s*she\/her(\/hers)?$/,
    /^pronouns?:\s*they\/them(\/theirs)?$/,
    /^[a-z]{2,5}\s*\/\s*[a-z]{2,5}(\s*\/\s*[a-z]{2,5})?$/,
  ];
  return pronounPatterns.some(pattern => pattern.test(normalizedText));
}

function cleanSidearmText(text: string): string {
  return text
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s\s+/g, ' ')
    .trim();
}

function extractNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  const cleaned = localPart
    .replace(/[._-]/g, ' ')
    .replace(/\d+/g, '')
    .trim();
  return cleaned
    .split(' ')
    .filter(part => part.length > 1)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Unknown';
}

interface ExtractedContact {
  name: string;
  title: string;
  email: string;
  phone: string;
  department?: string;
  office?: string;
  linkedinUrl?: string;
  bioUrl?: string;
  imageUrl?: string;
  confidence: {
    name: number;
    title: number;
    email: number;
    phone: number;
    overall: number;
  };
}

export interface ExtractionResult {
  contacts: ExtractedContact[];
  diagnostics: {
    totalEmailLinksFound: number;
    cloudflareEmailsFound: number;
    mailtoLinksFound: number;
    containersDetected: number;
    contactsExtracted: number;
    averageConfidence: number;
  };
  html?: string;
}

function extractEmailFromElement($: cheerio.CheerioAPI, element: any): string {
  const $el = $(element);
  
  const cfEmail = $el.attr('data-cfemail');
  if (cfEmail) {
    const decoded = decodeCloudflareEmail(cfEmail);
    if (decoded) return decoded;
  }
  
  const cfSpan = $el.find('span.__cf_email__, span[data-cfemail]').first();
  if (cfSpan.length) {
    const spanCfEmail = cfSpan.attr('data-cfemail');
    if (spanCfEmail) {
      const decoded = decodeCloudflareEmail(spanCfEmail);
      if (decoded) return decoded;
    }
  }
  
  const mailtoLink = $el.find('a[href^="mailto:"]').first();
  if (mailtoLink.length) {
    const href = mailtoLink.attr('href');
    if (href) return href.replace('mailto:', '').split('?')[0].trim();
  }
  
  if ($el.is('a[href^="mailto:"]')) {
    const href = $el.attr('href');
    if (href) return href.replace('mailto:', '').split('?')[0].trim();
  }
  
  const $clone = $el.clone();
  $clone.find('br').replaceWith('\n');
  const text = $clone.text() || '';
  const emailMatch = text.match(/(?:^|[\s\n,;:])([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
  if (emailMatch) return emailMatch[1];
  
  return '';
}

function extractPersonFromContainer($: cheerio.CheerioAPI, container: any): ExtractedContact | null {
  const $container = $(container);
  const textContent = $container.text().replace(/\s+/g, ' ').trim();
  
  const email = extractEmailFromElement($, container);
  
  const phoneMatch = textContent.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const phone = phoneMatch ? phoneMatch[0] : '';
  
  let name = 'Unknown';
  let nameSource = 'unknown';
  
  const nameSelectors = [
    '[class*="person-details__name"]',
    '[class*="person__name"]',
    '[class*="staff-name"]',
    '[class*="contact-name"]',
    '[class*="member-name"]',
    '[class*="employee-name"]',
    '[class*="directory-name"]',
    '[class*="fullname"]',
    '[class*="s-person-card__name"]',
    '.s-stamp__name',
    '.s-stamp__header a',
    '[class*="c-staff__name"]',
    '[class*="person-name"]',
    '[class*="bio-name"]',
    '[class*="team-member-name"]',
    '[itemprop="name"]',
    '[data-field="name"]',
    'td[data-label="Name"]',
    'td[data-label="Staff"]',
    'td[data-column="name"]',
    'td:first-child a',
    'th[scope="row"]',
    '.name:not(.title):not(.position)',
    'header h2',
    'h2:first-child',
    'h3:first-child',
    'strong:first-child',
    'td:first-child',
    'h3', 'h4', 'h5',
  ];
  
  for (const selector of nameSelectors) {
    const nameEl = $container.find(selector).first();
    if (nameEl.length) {
      const nameText = nameEl.text().trim();
      if (nameText.length > 2 && !nameText.includes('@') && !nameText.match(/^\d/)) {
        name = nameText.replace(/Full Bio for/i, '').trim();
        nameSource = 'name-class';
        break;
      }
    }
  }
  
  if (name === 'Unknown') {
    const bioLink = $container.find('a[aria-label*="full bio" i], a[aria-label*="Full Bio" i]').first();
    if (bioLink.length) {
      const ariaLabel = bioLink.attr('aria-label') || '';
      const ariaMatch = ariaLabel.match(/(.+?)\s+full bio/i);
      if (ariaMatch) {
        name = ariaMatch[1].trim();
        nameSource = 'aria-label';
      }
    }
  }
  
  if (name === 'Unknown') {
    name = extractNameFromEmail(email);
    nameSource = 'email-derived';
  }
  
  let title = '';
  let titleSource = 'unknown';
  
  const titleSelectors = [
    '.sidearm-staff-member-title',
    '.sidearm-staff-member-details-title',
    '[class*="sidearm-staff"][class*="title"]',
    '.s-person-details__position',
    '.s-person-card__meta',
    '.s-stamp__body',
    '.s-stamp__position',
    '[class*="s-person-card__position"]',
    '[class*="c-staff__title"]',
    '[class*="position"]',
    '[class*="job-title"]',
    '[class*="staff-title"]',
    '[class*="person-title"]',
    '[class*="team-member-title"]',
    '[class*="bio-title"]',
    '[class*="role"]:not([class*="user"])',
    '[class*="designation"]',
    '[itemprop="jobTitle"]',
    '[data-field="title"]',
    '[data-field="position"]',
    'td[data-label="Title"]',
    'td[data-label="Position"]',
    'td[data-label="Role"]',
    'td[data-column="title"]',
    'td[data-column="position"]',
    '.title:not(.name)',
    'header h3',
    'h2 + h3',
    'h3 + h4',
    'strong + p',
    'h4 + p',
    'h3 + p',
    '.name + .title',
    '[class*="s-table-body_cell"]:nth-child(2)',
    'td:nth-child(2)',
  ];
  
  for (const selector of titleSelectors) {
    try {
      const titleEl = $container.find(selector).first();
      if (titleEl.length) {
        const titleText = cleanSidearmText(titleEl.text());
        if (titleText.length > 2 && titleText.length < 100 && !titleText.includes('@') && !isPronoun(titleText)) {
          title = titleText;
          titleSource = 'selector-match';
          break;
        }
      }
    } catch {
      continue;
    }
  }
  
  if (!title && name !== 'Unknown') {
    try {
      const nameEl = $container.find(`:contains("${name}")`).last();
      
      if (nameEl.length) {
        const nextEl = nameEl.next();
        const nextText = cleanSidearmText(nextEl.text());
        
        if (nextText && !nextText.includes('@') && !/\d{3}/.test(nextText) && nextText.length > 2 && nextText.length < 60) {
          title = nextText;
          titleSource = 'sibling-heuristic';
        }
        
        if (!title) {
          const parentEl = nameEl.parent();
          const $parentClone = parentEl.clone();
          $parentClone.find('br').replaceWith('\n');
          const parentText = $parentClone.text();
          const parts = parentText.split(name);
          if (parts.length > 1) {
            let candidate = parts[1].split('\n')
              .map((line: string) => cleanSidearmText(line))
              .filter((line: string) => line.length > 0 && !line.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/) && !/\d{3}/.test(line))
              [0] || '';
            candidate = candidate.replace(/^[-–—,]\s*/, '').trim();
            candidate = candidate.replace(/\s*(Phone|Email|Tel|Fax)\s*:?\s*/gi, '').trim();
            if (candidate.length > 3 && candidate.length < 50 && !candidate.includes('@') && !/\d{3}/.test(candidate)) {
              title = candidate;
              titleSource = 'text-node-parsing';
            }
          }
        }
      }
    } catch {
    }
  }
  
  let department: string | undefined;
  const deptSelectors = ['[class*="department"]', '[class*="dept"]', '[class*="sport"]', '.s-person-card__sport', '[data-field="department"]', '[itemprop="department"]'];
  for (const selector of deptSelectors) {
    const deptEl = $container.find(selector).first();
    if (deptEl.length) {
      const dept = deptEl.text().trim();
      if (dept.length > 2 && dept.length < 100) {
        department = dept;
        break;
      }
    }
  }
  
  let office: string | undefined;
  const officeSelectors = ['[class*="office"]', '[class*="location"]', '[class*="room"]', '[class*="building"]', '[itemprop="address"]', '[data-field="office"]'];
  for (const selector of officeSelectors) {
    const officeEl = $container.find(selector).first();
    if (officeEl.length) {
      const officeText = officeEl.text().trim();
      if (officeText.length > 1 && officeText.length < 100 && !officeText.includes('@')) {
        office = officeText;
        break;
      }
    }
  }
  
  const linkedinLink = $container.find('a[href*="linkedin.com"]').first();
  const linkedinUrl = linkedinLink.length ? linkedinLink.attr('href') : undefined;
  
  const bioLink = $container.find('a[aria-label*="bio" i], a[title*="bio" i], a[href*="/bio/"], a[href*="/profile/"]').first();
  const bioUrl = bioLink.length ? bioLink.attr('href') : undefined;
  
  const imageEl = $container.find('img').first();
  const imageUrl = imageEl.length ? (imageEl.attr('src') || imageEl.attr('data-src')) : undefined;
  
  let nameScore = 0;
  if (name !== 'Unknown') {
    const wordCount = name.split(' ').length;
    if (nameSource === 'aria-label' || nameSource === 'name-class') {
      nameScore = 90;
    } else if (nameSource === 'email-derived') {
      nameScore = wordCount >= 2 ? 60 : 40;
    } else {
      nameScore = wordCount >= 2 ? 75 : 50;
    }
  }
  
  let titleScore = 0;
  if (title && title.length > 2) {
    if (titleSource === 'selector-match') {
      titleScore = 90;
    } else if (titleSource === 'sibling-heuristic') {
      titleScore = 75;
    } else if (titleSource === 'text-node-parsing') {
      titleScore = 60;
    } else {
      titleScore = 50;
    }
    if (title.length > 80) titleScore = Math.max(30, titleScore - 40);
  }
  
  const emailScore = email && email.includes('@') ? 100 : 0;
  const phoneScore = phone && phone.match(/\d{3}.*\d{3}.*\d{4}/) ? 90 : 0;
  
  const hasValidName = name !== 'Unknown' && isValidPersonName(name);
  const hasEmail = emailScore > 0;
  const hasPhone = phoneScore > 0;
  const hasTitle = titleScore > 0;

  if (!hasValidName) return null;
  if (!hasEmail && !hasPhone && !hasTitle) return null;
  
  const overall = Math.round(
    (nameScore * 0.35) +
    (titleScore * 0.30) +
    (emailScore * 0.25) +
    (phoneScore * 0.10)
  );
  
  return {
    name,
    title,
    email: email || '',
    phone,
    department,
    office,
    linkedinUrl,
    bioUrl,
    imageUrl,
    confidence: { name: nameScore, title: titleScore, email: emailScore, phone: phoneScore, overall },
  };
}

export function parseHtmlForContacts(htmlString: string): ExtractionResult {
  const $ = cheerio.load(htmlString);
  const contacts: ExtractedContact[] = [];
  
  let cloudflareEmailsFound = 0;
  let mailtoLinksFound = 0;
  
  mailtoLinksFound = $('a[href^="mailto:"]').length;
  cloudflareEmailsFound = $('a[data-cfemail], span.__cf_email__, a[href*="/cdn-cgi/l/email-protection"]').length;
  
  const containerSelectors = [
    '.sidearm-staff-member',
    '[class*="sidearm-staff"]',
    '[class*="s-table-body__row"]',
    '.s-person-card',
    '[class*="s-person"]',
    '.s-stamp__item',
    '[class*="s-grid__item"]',
    '.s-table__row',
    '.s-card',
    '[class*="c-staff"]',
    '[itemtype*="schema.org/Person"]',
    '[itemtype*="Person"]',
    '[class*="person-card"]',
    '[class*="staff-card"]',
    '[class*="staff-item"]',
    '[class*="staff-member"]',
    '[class*="contact-card"]',
    '[class*="directory-item"]',
    '[class*="directory-card"]',
    '[class*="employee-card"]',
    '[class*="coach-card"]',
    '[class*="team-member"]',
    '[class*="faculty-card"]',
    '[class*="people-card"]',
    '[class*="profile-card"]',
    '[class*="bio-card"]',
    '[class*="personnel-card"]',
    '.staff-listing__item',
    '.staff-directory__item',
    '.roster-card',
    '.roster-list__item',
    '[data-type="person"]',
    '[data-type="staff"]',
    '[role="listitem"]:has(a[href^="mailto:"])',
    'tr:has(a[href^="mailto:"])',
    'tr:has(a[data-cfemail])',
    'tr:has(a[href*="/cdn-cgi/l/email-protection"])',
    'li:has(a[href^="mailto:"])',
    'article:has(a[href^="mailto:"])',
    'div.row:has(a[href^="mailto:"])',
    'div[class*="col"]:has(a[href^="mailto:"])',
    'section:has(a[href^="mailto:"])',
    '[class*="accordion-item"]:has(a[href^="mailto:"])',
    '[class*="grid-item"]:has(a[href^="mailto:"])',
  ];
  
  let containers: any[] = [];
  for (const selector of containerSelectors) {
    try {
      const found = $(selector).toArray();
      if (found.length > 0) {
        containers = found;
        break;
      }
    } catch {
      continue;
    }
  }
  
  if (containers.length === 0) {
    const emailLinks = $('a[href^="mailto:"], a[data-cfemail], a[href*="/cdn-cgi/l/email-protection"]').toArray();
    for (const link of emailLinks) {
      const $link = $(link);
      let container = $link.closest('tr, li, article, section, [role="listitem"], div[class*="card"], div[class*="item"], div[class*="member"], div[class*="person"], div[class*="staff"], div[class*="coach"], div[class*="profile"], div[class*="bio"]');
      if (!container.length) {
        container = $link.parent().parent();
      }
      if (container.length) {
        containers.push(container[0]);
      }
    }
  }

  if (containers.length === 0) {
    const bodyText = $.text();
    const plaintextEmailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/g;
    const foundEmails = bodyText.match(plaintextEmailRegex);
    if (foundEmails && foundEmails.length > 0) {
      const allElements = $('div, article, section, li, tr, [role="listitem"]').toArray();
      for (const el of allElements) {
        const $el = $(el);
        const elText = $el.text();
        const hasEmail = plaintextEmailRegex.test(elText);
        plaintextEmailRegex.lastIndex = 0;
        if (hasEmail) {
          const childDivs = $el.children('div, article, section, li, tr').length;
          if (childDivs === 0 || $el.text().length < 500) {
            containers.push(el);
          }
        }
      }
    }
  }
  
  for (const container of containers) {
    const contact = extractPersonFromContainer($, container);
    if (contact) {
      contacts.push(contact);
    }
  }
  
  if (contacts.length === 0) {
    const fallbackContacts = extractFromUnstructuredHtml($, htmlString);
    for (const contact of fallbackContacts) {
      contacts.push(contact);
    }
  }
  
  const validatedContacts = filterLowQualityContacts(deduplicateContacts(contacts));
  
  const totalConfidence = validatedContacts.reduce((sum, c) => sum + c.confidence.overall, 0);
  const averageConfidence = validatedContacts.length > 0 ? Math.round(totalConfidence / validatedContacts.length) : 0;
  
  return {
    contacts: validatedContacts,
    diagnostics: {
      totalEmailLinksFound: mailtoLinksFound + cloudflareEmailsFound,
      cloudflareEmailsFound,
      mailtoLinksFound,
      containersDetected: containers.length,
      contactsExtracted: validatedContacts.length,
      averageConfidence,
    },
  };
}

function extractFromUnstructuredHtml($: cheerio.CheerioAPI, htmlString: string): ExtractedContact[] {
  const contacts: ExtractedContact[] = [];
  
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g;
  const fullText = $.text();
  const emails = fullText.match(emailRegex) || [];
  
  for (const email of emails) {
    if (email.toLowerCase().includes('example') || email.includes('test@')) continue;
    
    const lines = htmlString.split('\n');
    let emailLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(email)) {
        emailLineIdx = i;
        break;
      }
    }
    
    let name = extractNameFromEmail(email);
    let title = '';
    
    if (emailLineIdx >= 0) {
      for (let i = Math.max(0, emailLineIdx - 5); i < emailLineIdx; i++) {
        const line = lines[i].replace(/<[^>]+>/g, '').trim();
        
        if (line.length > 2 && line.length < 60) {
          const nameParts = line.split(/\s+/).filter(p => p.length > 1);
          const looksLikeName = nameParts.length >= 2 && 
            nameParts.every(p => /^[A-Z][a-z]+$|^[A-Z]\.$|^Dr\.?$/.test(p));
          
          if (looksLikeName) {
            name = line;
          } else if (!line.includes('@') && !line.match(/^\d/) && line.length > 5) {
            const titleKeywords = ['coach', 'director', 'manager', 'assistant', 'coordinator', 'trainer', 'head'];
            if (titleKeywords.some(k => line.toLowerCase().includes(k))) {
              title = line;
            } else if (!title && i === emailLineIdx - 1) {
              title = line;
            }
          }
        }
      }
    }
    
    const phoneMatch = fullText.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
    const phone = phoneMatch ? phoneMatch[0] : '';
    
    contacts.push({
      name,
      title,
      email,
      phone,
      confidence: {
        name: name.split(' ').length >= 2 ? 60 : 40,
        title: title ? 50 : 0,
        email: 100,
        phone: phone ? 80 : 0,
        overall: 50,
      },
    });
  }
  
  return contacts;
}

const STAFF_DIRECTORY_PATTERNS = [
  '/staff-directory',
  '/staff',
  '/athletics-staff',
  '/athletic-staff',
  '/directory',
  '/about/staff',
  '/about/directory',
  '/sports/staff',
  '/administration',
  '/front-office',
];

function isValidAthleticsUrl(href: string): boolean {
  if (!href || !href.startsWith('http')) return false;
  
  const excludePatterns = [
    'ncaa.com',
    'shop',
    'store',
    'facebook.com',
    'twitter.com',
    'instagram.com',
    'youtube.com',
    'tiktok.com',
    'linkedin.com',
    'amazon.com',
    'fanatics.com',
    'ticketmaster',
    'vivid',
    'stubhub',
    'espn.com',
    'cbs',
    'fox',
    'nbc',
  ];
  
  const hrefLower = href.toLowerCase();
  return !excludePatterns.some(pattern => hrefLower.includes(pattern));
}

async function findAthleticsWebsite(ncaaUrl: string, schoolName: string): Promise<string | null> {
  try {
    console.log(`Looking for athletics website from ${ncaaUrl}...`);
    const html = await fetchWithProxy(ncaaUrl);
    if (!html) return null;
    
    const $ = cheerio.load(html);
    
    const websiteLink = $('a[href*="athletics"], a.school-website, a:contains("Athletics Website"), a:contains("Official Site"), a:contains("Official Athletics")')
      .toArray()
      .map(el => $(el).attr('href'))
      .filter((href): href is string => !!href && isValidAthleticsUrl(href))
      .find(href => href.length > 10);
    
    if (websiteLink) {
      console.log(`Found athletics website for ${schoolName}: ${websiteLink}`);
      return websiteLink;
    }
    
    const allLinks = $('a[href^="http"]')
      .toArray()
      .map(el => $(el).attr('href'))
      .filter((href): href is string => 
        !!href && 
        isValidAthleticsUrl(href) &&
        (href.includes('sports') || href.includes('athletics'))
      );
    
    if (allLinks.length > 0) {
      console.log(`Found potential athletics website for ${schoolName}: ${allLinks[0]}`);
      return allLinks[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Error finding athletics website for ${schoolName}:`, error);
    return null;
  }
}

export async function discoverDirectoryUrl(schoolUrl: string, schoolName: string, schoolId?: string): Promise<string | null> {
  try {
    // Step 1: Check for known directory URL override
    if (schoolId) {
      const knownOverride = getKnownDirectoryUrl(schoolId);
      if (knownOverride) {
        console.log(`[URL Discovery] Using known override for ${schoolName}: ${knownOverride.directoryUrl}`);
        try {
          const html = await fetchWithProxy(knownOverride.directoryUrl);
          if (html && html.length > 1000) {
            const result = parseHtmlForContacts(html);
            if (result.contacts.length >= 1) {
              console.log(`[URL Discovery] Known URL verified with ${result.contacts.length} contacts`);
              return knownOverride.directoryUrl;
            }
          }
        } catch (e) {
          console.log(`[URL Discovery] Known URL failed verification, continuing with discovery...`);
        }
      }
    }

    // Step 1b: Check conference URLs from ncaaConferencesWithSchools
    const { resolveDirectoryUrl } = await import('./lib/known-directory-urls');
    const conferenceUrl = resolveDirectoryUrl(schoolId || '', schoolName);
    if (conferenceUrl) {
      console.log(`[URL Discovery] Using conference URL for ${schoolName}: ${conferenceUrl}`);
      return conferenceUrl;
    }
    
    let baseUrl: string | undefined;
    
    // Step 2: Check for athletics domain override based on school name
    const domainOverride = getAthleticsDomainOverride(schoolName);
    if (domainOverride) {
      baseUrl = `https://${domainOverride}`;
      console.log(`[URL Discovery] Using domain override for ${schoolName}: ${baseUrl}`);
    }
    
    // Step 3: Standard discovery from NCAA page
    if (!baseUrl && schoolUrl.includes('ncaa.com')) {
      const athleticsUrl = await findAthleticsWebsite(schoolUrl, schoolName);
      if (athleticsUrl) {
        baseUrl = new URL(athleticsUrl).origin;
        console.log(`[URL Discovery] Using athletics website: ${baseUrl}`);
      } else {
        // Try common patterns based on school name
        const schoolSlug = schoolName.toLowerCase()
          .replace(/[^a-z0-9]+/g, '')
          .replace(/university|college|state/gi, '');
        const commonPatterns = [
          `https://${schoolSlug}sports.com`,
          `https://www.${schoolSlug}sports.com`,
          `https://${schoolSlug}athletics.com`,
          `https://athletics.${schoolSlug}.edu`,
          `https://${schoolSlug}.com`,
        ];
        console.log(`[URL Discovery] No athletics link found, trying common patterns for ${schoolName}...`);
        for (const pattern of commonPatterns) {
          try {
            const html = await fetchWithProxy(pattern);
            if (html && html.length > 1000) {
              baseUrl = pattern;
              console.log(`[URL Discovery] Found working site at ${pattern}`);
              break;
            }
          } catch {
            continue;
          }
        }
        if (!baseUrl) {
          console.log(`[URL Discovery] Could not find athletics website for ${schoolName}`);
          return null;
        }
      }
    } else if (!baseUrl) {
      baseUrl = new URL(schoolUrl).origin;
    }
    
    // Step 4: Try extended staff directory patterns
    const allPatterns = [...STAFF_DIRECTORY_PATTERNS, ...EXTENDED_STAFF_PATTERNS];
    const uniquePatterns = Array.from(new Set(allPatterns));
    
    for (const pattern of uniquePatterns) {
      const candidateUrl = baseUrl + pattern;
      try {
        const html = await fetchWithProxy(candidateUrl);
        if (html && html.length > 1000) {
          const result = parseHtmlForContacts(html);
          if (result.contacts.length >= 3) {
            console.log(`[URL Discovery] Found directory for ${schoolName}: ${candidateUrl} (${result.contacts.length} contacts)`);
            return candidateUrl;
          }
        }
      } catch {
        continue;
      }
    }
    
    // Step 5: Enhanced link discovery from main page
    const mainHtml = await fetchWithProxy(baseUrl);
    if (mainHtml) {
      const $ = cheerio.load(mainHtml);
      
      // Build comprehensive selector for staff-related links
      const staffLinkSelectors = [
        'a[href*="staff"]',
        'a[href*="directory"]',
        'a[href*="administration"]',
        'a[href*="department"]',
        'a[href*="front-office"]',
      ];
      
      // Also search by link text content
      const staffLinks = new Set<string>();
      
      // First, get links by href pattern
      $(staffLinkSelectors.join(', '))
        .toArray()
        .forEach(el => {
          const href = $(el).attr('href');
          if (href) staffLinks.add(href);
        });
      
      // Then, search by link text content
      $('a').each((_, el) => {
        const text = $(el).text().toLowerCase().trim();
        const href = $(el).attr('href');
        if (href && STAFF_LINK_KEYWORDS.some(keyword => text.includes(keyword))) {
          staffLinks.add(href);
        }
      });
      
      // Try each discovered link
      const linksToTry = Array.from(staffLinks).slice(0, 10);
      for (const link of linksToTry) {
        try {
          const fullUrl = link.startsWith('http') ? link : new URL(link, baseUrl).href;
          const html = await fetchWithProxy(fullUrl);
          if (html && html.length > 1000) {
            const result = parseHtmlForContacts(html);
            if (result.contacts.length >= 3) {
              console.log(`[URL Discovery] Found directory for ${schoolName}: ${fullUrl} (${result.contacts.length} contacts)`);
              return fullUrl;
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    // Step 6: Try sitemap parsing as last resort
    const sitemapUrl = await tryParseSitemap(baseUrl, schoolName);
    if (sitemapUrl) {
      return sitemapUrl;
    }
    
    return null;
  } catch (error) {
    console.error(`[URL Discovery] Error discovering directory for ${schoolName}:`, error);
    return null;
  }
}

/**
 * Parse sitemap.xml to find staff directory URLs
 */
async function tryParseSitemap(baseUrl: string, schoolName: string): Promise<string | null> {
  const sitemapUrls = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/sitemaps/sitemap.xml`,
  ];
  
  for (const sitemapUrl of sitemapUrls) {
    try {
      const xml = await fetchWithProxy(sitemapUrl);
      if (!xml || !xml.includes('<urlset') && !xml.includes('<sitemapindex')) {
        continue;
      }
      
      const $ = cheerio.load(xml, { xmlMode: true });
      
      // Look for staff-related URLs in sitemap
      const staffUrls: string[] = [];
      $('url loc').each((_, el) => {
        const url = $(el).text();
        const urlLower = url.toLowerCase();
        if (urlLower.includes('staff') || urlLower.includes('directory') || urlLower.includes('administration')) {
          staffUrls.push(url);
        }
      });
      
      // Prioritize URLs that look like staff directories
      const prioritizedUrls = staffUrls.sort((a, b) => {
        const aScore = a.includes('staff-directory') ? 3 : (a.includes('staff') ? 2 : 1);
        const bScore = b.includes('staff-directory') ? 3 : (b.includes('staff') ? 2 : 1);
        return bScore - aScore;
      });
      
      for (const url of prioritizedUrls.slice(0, 5)) {
        try {
          const html = await fetchWithProxy(url);
          if (html && html.length > 1000) {
            const result = parseHtmlForContacts(html);
            if (result.contacts.length >= 3) {
              console.log(`[URL Discovery] Found directory from sitemap for ${schoolName}: ${url} (${result.contacts.length} contacts)`);
              return url;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  
  return null;
}

interface PlaywrightFetchResult {
  html: string;
  resolvedUrl: string | null;
  httpStatus?: number | null;
}

const STAFF_CONTENT_SELECTORS = [
  'a[href^="mailto:"]',
  'a[data-cfemail]',
  'a[href*="/cdn-cgi/l/email-protection"]',
  '.sidearm-staff-member',
  '[class*="s-person-card"]',
  '[class*="s-person"]',
  '[class*="staff-card"]',
  '[class*="staff-member"]',
  '[class*="person-card"]',
  '[class*="roster-card"]',
  '[class*="directory-item"]',
  '[class*="directory-card"]',
  '[class*="sidearm-staff"]',
  '[class*="coach-card"]',
  '[class*="team-member"]',
  '[class*="staff-listing"]',
  '[class*="staff-directory"]',
  '[class*="people-card"]',
  '[class*="faculty-card"]',
  'table.staff',
  'table.directory',
];

async function progressiveWaitForContent(session: BrowserSession, url: string): Promise<string> {
  const selectorList = STAFF_CONTENT_SELECTORS.join(', ');
  try {
    await session.page.waitForSelector(selectorList, { timeout: 15000 });
    return 'content-selector';
  } catch {}

  try {
    await session.page.waitForLoadState('networkidle', { timeout: 8000 });
    return 'network-idle';
  } catch {}

  await session.page.waitForTimeout(3000);
  return 'fixed-fallback';
}

async function progressiveScroll(session: BrowserSession): Promise<number> {
  let scrollSteps = 0;
  try {
    const viewportHeight = await session.page.evaluate(() => window.innerHeight);
    const scrollHeight = await session.page.evaluate(() => document.body.scrollHeight);
    const maxScrolls = Math.min(Math.ceil(scrollHeight / viewportHeight), 8);

    for (let i = 0; i < maxScrolls; i++) {
      await session.page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      scrollSteps++;
      await session.page.waitForTimeout(400);
    }

    await session.page.evaluate(() => window.scrollTo(0, 0));
    await session.page.waitForTimeout(500);
  } catch {}
  return scrollSteps;
}

interface PlaywrightFetchResultDetailed extends PlaywrightFetchResult {
  waitStrategy: string;
  contentWaitMs: number;
  scrollSteps: number;
}

async function fetchWithPlaywright(url: string): Promise<PlaywrightFetchResultDetailed | null> {
  let session: BrowserSession | null = null;
  try {
    console.log(`[Playwright] Fetching: ${url}`);
    session = await getBrowserSession();

    await session.context.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    await session.page.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}', route => route.abort());

    const response = await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const httpStatus = response?.status() || null;

    const waitStart = Date.now();
    const waitStrategy = await progressiveWaitForContent(session, url);
    const contentWaitMs = Date.now() - waitStart;

    const scrollSteps = await progressiveScroll(session);

    const html = await session.page.content();
    const finalUrl = session.page.url();
    const resolvedUrl = finalUrl !== url ? finalUrl : null;

    if (resolvedUrl) {
      console.log(`[Playwright] Redirect: ${url} -> ${resolvedUrl}`);
    }
    console.log(`[Playwright] Success: HTTP ${httpStatus}, HTML ${html.length} chars, wait: ${waitStrategy} (${contentWaitMs}ms), scrolls: ${scrollSteps}`);
    return { html, resolvedUrl, httpStatus, waitStrategy, contentWaitMs, scrollSteps };
  } catch (error) {
    console.error('[Playwright] Fetch error:', error);
    return null;
  } finally {
    if (session) {
      await session.close();
    }
  }
}

const GENERIC_EMAIL_PREFIXES = [
  'info', 'noreply', 'no-reply', 'admin', 'webmaster', 'support',
  'help', 'contact', 'general', 'office', 'mail', 'team', 'hello',
  'feedback', 'sales', 'marketing', 'press', 'media', 'news',
  'events', 'tickets', 'donations', 'alumni', 'development',
  'compliance', 'hr', 'humanresources', 'recruiting', 'admissions',
  'registrar', 'financial', 'billing', 'accounts', 'do-not-reply',
  'donotreply', 'postmaster', 'hostmaster', 'abuse', 'security',
  'athletics', 'athletic', 'sports', 'goathletics', 'gocats',
  'gobulldogs', 'goeagles', 'athletics-info', 'staff',
];

const INVALID_EMAIL_DOMAINS = [
  'example.com', 'test.com', 'localhost', 'invalid.com',
  'placeholder.com', 'domain.com', 'email.com',
];

function isValidContactEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;

  const normalized = email.toLowerCase().trim();

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(normalized)) return false;

  const domain = normalized.split('@')[1];
  if (INVALID_EMAIL_DOMAINS.some(d => domain === d)) return false;

  const localPart = normalized.split('@')[0];
  if (GENERIC_EMAIL_PREFIXES.some(prefix => localPart === prefix)) return false;

  if (/^athletics?[-_.]?/i.test(localPart) && !/[a-z]\.[a-z]/i.test(localPart)) return false;

  if (localPart.length < 2 || localPart.length > 64) return false;
  if (domain.length < 4) return false;

  return true;
}

const PLACEHOLDER_NAMES = [
  'staff', 'tbd', 'tba', 'vacant', 'open position', 'open', 'position',
  'hiring', 'to be determined', 'to be announced', 'unknown', 'n/a',
  'na', 'none', 'test', 'admin', 'administrator', 'department',
  'office', 'athletics', 'athletic department', 'general', 'new hire',
];

function isValidPersonName(name: string): boolean {
  if (!name || name.length < 2) return false;

  const normalized = name.toLowerCase().trim();

  if (PLACEHOLDER_NAMES.includes(normalized)) return false;

  if (normalized.split(' ').length < 2 && normalized.length < 15) {
    if (!/^(dr|mr|ms|mrs|prof)\.?\s/i.test(name)) return false;
  }

  if (/^(head|assistant|associate|deputy|senior|junior|chief|director|manager|coordinator|coach)/i.test(normalized)) {
    return false;
  }

  if (/^\d/.test(normalized)) return false;

  if (name.length > 80) return false;

  return true;
}

interface ContactQualityScore {
  score: number;
  hasName: boolean;
  hasEmail: boolean;
  hasTitle: boolean;
  hasPhone: boolean;
  rejectReason: string | null;
}

function assessContactQuality(contact: ExtractedContact): ContactQualityScore {
  const hasName = isValidPersonName(contact.name);
  const hasEmail = isValidContactEmail(contact.email);
  const hasTitle = !!contact.title && contact.title.length > 2;
  const hasPhone = !!contact.phone && contact.phone.length >= 7;

  let rejectReason: string | null = null;

  if (!hasName) {
    rejectReason = 'no_valid_name';
  } else if (!hasEmail && !hasPhone && !hasTitle) {
    rejectReason = 'name_only_no_other_fields';
  }

  const fieldCount = [hasName, hasEmail, hasTitle, hasPhone].filter(Boolean).length;
  const score = Math.round((fieldCount / 4) * 100);

  return { score, hasName, hasEmail, hasTitle, hasPhone, rejectReason };
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0;

  const dist = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const levenshteinScore = 1 - dist / maxLen;

  const partsA = na.split(/\s+/);
  const partsB = nb.split(/\s+/);
  let tokenMatches = 0;
  const tokenTotal = Math.max(partsA.length, partsB.length);
  for (const pa of partsA) {
    if (partsB.some(pb => pb === pa || levenshteinDistance(pa, pb) <= 1)) {
      tokenMatches++;
    }
  }
  const tokenScore = tokenMatches / tokenTotal;

  return Math.max(levenshteinScore, tokenScore);
}

function normalizeContactName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(part => {
      if (part.length <= 1) return part.toUpperCase();
      if (/^(II|III|IV|JR|SR|PHD|MD|DBA|MBA|MED|EDD|JD)\.?$/i.test(part)) {
        return part.toUpperCase().replace(/\.$/, '');
      }
      if (/^(Mc|Mac|O')[A-Z]/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function mergeContacts(primary: ExtractedContact, secondary: ExtractedContact): ExtractedContact {
  return {
    ...primary,
    name: isValidPersonName(primary.name) ? primary.name : secondary.name,
    title: (primary.title && primary.title.length > 2) ? primary.title : secondary.title,
    email: primary.email || secondary.email,
    phone: primary.phone || secondary.phone,
    department: primary.department || secondary.department,
    office: primary.office || secondary.office,
    linkedinUrl: primary.linkedinUrl || secondary.linkedinUrl,
    bioUrl: primary.bioUrl || secondary.bioUrl,
    imageUrl: primary.imageUrl || secondary.imageUrl,
    confidence: primary.confidence.overall >= secondary.confidence.overall
      ? primary.confidence
      : secondary.confidence,
  };
}

function deduplicateContacts(contacts: ExtractedContact[]): ExtractedContact[] {
  const byEmail = new Map<string, ExtractedContact>();
  const byName = new Map<string, ExtractedContact>();
  const noEmailContacts: ExtractedContact[] = [];
  const rejected: { contact: ExtractedContact; reason: string }[] = [];

  for (const contact of contacts) {
    const quality = assessContactQuality(contact);

    if (quality.rejectReason) {
      rejected.push({ contact, reason: quality.rejectReason });
      continue;
    }

    if (!isValidPersonName(contact.name)) {
      if (contact.email && isValidContactEmail(contact.email)) {
        contact.name = extractNameFromEmail(contact.email);
      } else {
        rejected.push({ contact, reason: 'no_valid_name' });
        continue;
      }
    }

    const hasValidEmail = contact.email && isValidContactEmail(contact.email);
    if (!hasValidEmail) {
      contact.email = '';
    }
    const normalizedName = normalizeContactName(contact.name);
    const nameKey = normalizedName.toLowerCase();

    if (hasValidEmail) {
      const emailKey = contact.email.toLowerCase().trim();

      const existingByEmail = byEmail.get(emailKey);
      if (existingByEmail) {
        byEmail.set(emailKey, mergeContacts(
          contact.confidence.overall >= existingByEmail.confidence.overall ? contact : existingByEmail,
          contact.confidence.overall >= existingByEmail.confidence.overall ? existingByEmail : contact
        ));
        continue;
      }

      let mergedWithName = false;
      if (nameKey.length > 3) {
        for (const [existingNameKey, existingContact] of Array.from(byName.entries())) {
          if (nameSimilarity(nameKey, existingNameKey) >= 0.85) {
            const merged = mergeContacts(
              contact.confidence.overall >= existingContact.confidence.overall ? contact : existingContact,
              contact.confidence.overall >= existingContact.confidence.overall ? existingContact : contact
            );
            byEmail.set(merged.email.toLowerCase().trim(), merged);
            byName.delete(existingNameKey);
            byName.set(nameKey, merged);
            mergedWithName = true;
            break;
          }
        }
      }

      if (!mergedWithName) {
        byEmail.set(emailKey, {
          ...contact,
          email: emailKey,
          name: normalizedName,
        });
        byName.set(nameKey, contact);
      }
    } else {
      let mergedWithExisting = false;
      if (nameKey.length > 3) {
        for (const [existingNameKey, existingContact] of Array.from(byName.entries())) {
          if (nameSimilarity(nameKey, existingNameKey) >= 0.85) {
            const merged = mergeContacts(
              existingContact.confidence.overall >= contact.confidence.overall ? existingContact : contact,
              existingContact.confidence.overall >= contact.confidence.overall ? contact : existingContact
            );
            if (merged.email && isValidContactEmail(merged.email)) {
              byEmail.set(merged.email.toLowerCase().trim(), merged);
            }
            byName.delete(existingNameKey);
            byName.set(nameKey, merged);
            mergedWithExisting = true;
            break;
          }
        }
      }
      if (!mergedWithExisting) {
        noEmailContacts.push({ ...contact, name: normalizedName });
        byName.set(nameKey, contact);
      }
    }
  }

  if (rejected.length > 0) {
    console.log(`[Dedup] Rejected ${rejected.length} contacts: ${rejected.map(r => `${r.contact.name} (${r.reason})`).join(', ')}`);
  }

  const results = Array.from(byEmail.values());
  for (const c of noEmailContacts) {
    if (!results.some(r => nameSimilarity(r.name.toLowerCase(), c.name.toLowerCase()) >= 0.85)) {
      results.push(c);
    }
  }
  return results;
}

const MIN_CONFIDENCE_FLOOR = 20;

function filterLowQualityContacts(contacts: ExtractedContact[]): ExtractedContact[] {
  return contacts.filter(c => {
    if (c.confidence.overall < MIN_CONFIDENCE_FLOOR) return false;
    if (c.name === 'Unknown' && !c.title && c.confidence.overall < 40) return false;
    const quality = assessContactQuality(c);
    if (quality.rejectReason) return false;
    return true;
  });
}

export interface ExtractionResultWithMeta extends ExtractionResult {
  method?: string;
  resolvedUrl?: string | null;
  httpStatus?: number | null;
  extractionMeta?: {
    fetchReason: string;
    waitStrategy?: string;
    contentWaitMs?: number;
    scrollSteps?: number;
    timeTakenMs: number;
  };
}

async function fetchWithPlaywrightExtended(url: string): Promise<{
  html: string;
  resolvedUrl: string | null;
  waitStrategy: string;
  contentWaitMs: number;
  scrollSteps: number;
} | null> {
  let session: BrowserSession | null = null;
  try {
    session = await getBrowserSession();
    if (!session) return null;

    await session.page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
        return route.abort();
      }
      return route.continue();
    });

    await session.page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    });

    await session.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    await session.page.waitForTimeout(8000);

    try {
      await session.page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {}

    const scrollSteps = await progressiveScroll(session);

    await session.page.waitForTimeout(2000);

    const html = await session.page.content();
    const finalUrl = session.page.url();
    const resolvedUrl = finalUrl !== url ? finalUrl : null;

    return { html, resolvedUrl, waitStrategy: 'extended-retry', contentWaitMs: 8000, scrollSteps };
  } catch (error) {
    console.error('[Playwright-Extended] Fetch error:', error);
    return null;
  } finally {
    if (session) {
      await session.close();
    }
  }
}

export async function extractStaffFromUrl(url: string, usePlaywrightFallback = true): Promise<ExtractionResultWithMeta> {
  const startTime = Date.now();
  const jsRequired = needsJavaScriptRendering(url);

  const emptyResult: ExtractionResultWithMeta = {
    contacts: [],
    diagnostics: {
      totalEmailLinksFound: 0,
      cloudflareEmailsFound: 0,
      mailtoLinksFound: 0,
      containersDetected: 0,
      contactsExtracted: 0,
      averageConfidence: 0,
    },
    method: 'none',
    resolvedUrl: null,
  };

  let lastHtml: string | undefined;
  let resolvedUrl: string | null = null;
  let httpStatus: number | null = null;
  let proxyResult: ExtractionResult | null = null;
  let fetchReason = '';
  let waitStrategy: string | undefined;
  let contentWaitMs: number | undefined;
  let scrollSteps: number | undefined;

  if (jsRequired) {
    fetchReason = 'js-rendered-domain';
    console.log(`[Extraction] JS-rendered site detected, skipping CORS proxy: ${url}`);
  } else {
    fetchReason = 'standard-cors-first';
    console.log(`[Extraction] CORS proxy first for ${url}`);
    const proxyHtml = await fetchWithProxy(url);

    if (proxyHtml) {
      lastHtml = proxyHtml;
      proxyResult = parseHtmlForContacts(proxyHtml);
      const hasGoodQuality = proxyResult.diagnostics.averageConfidence >= 65;

      if (proxyResult.contacts.length >= 3 && hasGoodQuality) {
        fetchReason = 'cors-proxy-sufficient';
        const timeTakenMs = Date.now() - startTime;
        console.log(`[Extraction] CORS proxy success: ${proxyResult.contacts.length} contacts @ ${proxyResult.diagnostics.averageConfidence}% (${timeTakenMs}ms)`);
        return { ...proxyResult, method: 'proxy', html: proxyHtml, resolvedUrl: null, extractionMeta: { fetchReason, timeTakenMs } };
      }
      fetchReason = 'cors-proxy-low-yield';
      console.log(`[Extraction] CORS proxy: ${proxyResult.contacts.length} contacts @ ${proxyResult.diagnostics.averageConfidence}% - escalating to Playwright`);
    } else {
      fetchReason = 'cors-proxy-failed';
    }
  }

  let bestResult: ExtractionResultWithMeta | null = null;

  if (usePlaywrightFallback) {
    console.log(`[Extraction] Playwright for ${url} (reason: ${fetchReason})`);
    const playwrightFetch = await withTimeout(fetchWithPlaywright(url), 60_000, `fetchWithPlaywright(${url})`);
    if (playwrightFetch) {
      lastHtml = playwrightFetch.html;
      resolvedUrl = playwrightFetch.resolvedUrl;
      httpStatus = playwrightFetch.httpStatus || null;
      waitStrategy = playwrightFetch.waitStrategy;
      contentWaitMs = playwrightFetch.contentWaitMs;
      scrollSteps = playwrightFetch.scrollSteps;
      const playwrightResult = parseHtmlForContacts(playwrightFetch.html);

      if (playwrightResult.contacts.length > 0) {
        console.log(`[Extraction] Playwright: ${playwrightResult.contacts.length} contacts @ ${playwrightResult.diagnostics.averageConfidence}%`);

        const usePlaywrightResult = !proxyResult
          || playwrightResult.contacts.length > proxyResult.contacts.length
          || playwrightResult.diagnostics.averageConfidence > proxyResult.diagnostics.averageConfidence;

        if (usePlaywrightResult) {
          const timeTakenMs = Date.now() - startTime;
          console.log(`[Extraction] Using Playwright result (${timeTakenMs}ms, wait: ${waitStrategy})`);
          bestResult = { ...playwrightResult, method: jsRequired ? 'playwright-direct' : 'playwright', html: playwrightFetch.html, resolvedUrl, httpStatus, extractionMeta: { fetchReason, waitStrategy, contentWaitMs, scrollSteps, timeTakenMs } };
        }
      }
    }

    if (!bestResult && proxyResult && proxyResult.contacts.length > 0) {
      const timeTakenMs = Date.now() - startTime;
      bestResult = { ...proxyResult, method: 'proxy', html: lastHtml, resolvedUrl, extractionMeta: { fetchReason, timeTakenMs } };
    }

    const shouldRetry = !bestResult
      || bestResult.contacts.length === 0
      || (bestResult.contacts.length < 3 && bestResult.diagnostics.averageConfidence < 50);

    if (shouldRetry) {
      const retryReason = !bestResult || bestResult.contacts.length === 0 ? 'zero-contacts' : 'low-yield';
      console.log(`[Extraction] ${retryReason} (${bestResult?.contacts.length ?? 0} contacts) — retrying with extended Playwright wait: ${url}`);
      const extendedFetch = await withTimeout(fetchWithPlaywrightExtended(url), 90_000, `fetchWithPlaywrightExtended(${url})`);
      if (extendedFetch) {
        const retryResult = parseHtmlForContacts(extendedFetch.html);
        const retryImproves = !bestResult
          || retryResult.contacts.length > bestResult.contacts.length
          || retryResult.diagnostics.averageConfidence > (bestResult.diagnostics.averageConfidence + 10);

        if (retryResult.contacts.length > 0 && retryImproves) {
          const timeTakenMs = Date.now() - startTime;
          console.log(`[Extraction] Extended retry success: ${retryResult.contacts.length} contacts @ ${retryResult.diagnostics.averageConfidence}% (${timeTakenMs}ms)`);
          return {
            ...retryResult,
            method: 'playwright-extended-retry',
            html: extendedFetch.html,
            resolvedUrl: extendedFetch.resolvedUrl,
            extractionMeta: { fetchReason: `${retryReason}-retry`, waitStrategy: 'extended-retry', contentWaitMs: extendedFetch.contentWaitMs, scrollSteps: extendedFetch.scrollSteps, timeTakenMs },
          };
        }
        console.log(`[Extraction] Extended retry did not improve (${retryResult.contacts.length} contacts @ ${retryResult.diagnostics.averageConfidence}%)`);
      }
    }
  }

  if (bestResult) {
    return bestResult;
  }

  if (proxyResult && proxyResult.contacts.length > 0) {
    const timeTakenMs = Date.now() - startTime;
    console.log(`[Extraction] Falling back to proxy result: ${proxyResult.contacts.length} contacts (${timeTakenMs}ms)`);
    return { ...proxyResult, method: 'proxy', html: lastHtml, resolvedUrl, extractionMeta: { fetchReason, timeTakenMs } };
  }

  const timeTakenMs = Date.now() - startTime;
  return { ...emptyResult, html: lastHtml, resolvedUrl, httpStatus, extractionMeta: { fetchReason, waitStrategy, contentWaitMs, scrollSteps, timeTakenMs } };
}

export { isValidContactEmail, isValidPersonName, assessContactQuality };

export function convertToStaffMembers(
  contacts: ExtractedContact[],
  schoolId: string
): InsertStaffMember[] {
  return contacts.map(contact => {
    const { persona, area } = categorizePersona(contact.title);
    const departmentTags = classifyDepartmentTags(contact.title, contact.department);
    const sanitizedEmail = (contact.email && isValidContactEmail(contact.email)) ? contact.email : '';
    return {
      schoolId,
      name: contact.name,
      title: contact.title || null,
      email: sanitizedEmail,
      phone: contact.phone || null,
      department: contact.department || null,
      office: contact.office || null,
      linkedinUrl: contact.linkedinUrl || null,
      bioUrl: contact.bioUrl || null,
      imageUrl: contact.imageUrl || null,
      confidence: contact.confidence,
      buyerPersona: persona,
      functionalArea: area,
      departmentTags,
    };
  });
}

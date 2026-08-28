/**
 * Parser Factory - Strategy Pattern for HTML Extraction
 * 
 * Selects the appropriate parser based on detected site patterns.
 * Supports: Sidearm Sports, Presto, WordPress, Table layouts, and Generic fallback.
 */

import * as cheerio from 'cheerio';
import { PARSER_STRATEGIES, detectParserStrategy, type SelectorConfig } from './scraper-config';
import { extractWithAI, isAIAvailable, enhanceContactWithAI } from './ai-extractor';
import { SCRAPER_CONFIG } from './scraper-config';
import { isValidContactEmail, isValidPersonName } from '../staffExtractor';

export interface ParsedContact {
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
  aiEnhanced?: boolean;
  parserUsed?: string;
}

export type SelectorField = 'container' | 'name' | 'title' | 'email' | 'phone' | 'department' | 'office';

export interface SelectorUsage {
  container: Record<string, number>;
  name: Record<string, number>;
  title: Record<string, number>;
  email: Record<string, number>;
  phone: Record<string, number>;
  department: Record<string, number>;
  office: Record<string, number>;
}

export interface SelectorUsageSummary {
  topUsed: Array<{ field: SelectorField; selector: string; hits: number }>;
  unused: Array<{ field: SelectorField; selector: string }>;
}

/**
 * Per-container record of which selector index (within the strategy's
 * configured list) actually matched for each field. -1 means a non-indexed
 * fallback path matched (synthetic selector label is recorded separately
 * in `selectorUsage`). null means no match at all.
 */
export interface PerContainerSelectorMatch {
  containerIndex: number;
  name: { index: number; selector: string } | null;
  title: { index: number; selector: string } | null;
  email: { index: number; selector: string } | null;
  phone: { index: number; selector: string } | null;
}

export interface ParseResult {
  contacts: ParsedContact[];
  diagnostics: {
    parserUsed: string;
    totalEmailLinksFound: number;
    containersDetected: number;
    contactsExtracted: number;
    aiEnhancedCount: number;
    averageConfidence: number;
    selectorUsage: SelectorUsage;
    selectorUsageSummary: SelectorUsageSummary;
    perContainerMatches: PerContainerSelectorMatch[];
  };
}

/**
 * Phone extraction patterns. We try config phoneSelectors first, then
 * these regex patterns as labeled fallbacks so we can track which one
 * actually matched.
 */
const PHONE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: '<phone-regex-paren>', re: /(\(\d{3}\)\s?\d{3}[\s.-]?\d{4})/ },
  { label: '<phone-regex-dashed>', re: /(\d{3}-\d{3}-\d{4})/ },
  { label: '<phone-regex-dotted>', re: /(\d{3}\.\d{3}\.\d{4})/ },
  { label: '<phone-regex-spaced>', re: /(\d{3}\s\d{3}\s\d{4})/ },
  { label: '<phone-regex-generic>', re: /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/ },
];

export function decodeCloudflareEmail(encoded: string): string | null {
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

/**
 * Decode the Sidearm "split-email" obfuscation pattern. Many Sidearm sites
 * (300+ schools surveyed) hide each row's email behind an inline script:
 *   <a id="staff_email_0" href="#"></a>
 *   <script>
 *     var firstHalf = "athleticdirector";
 *     var secondHalf = "appstate.edu";
 *     ...
 *   </script>
 * Without JS execution the <a> stays empty. This recovers the pieces from
 * the script source.
 */
export function decodeSidearmSplitEmailScript(html: string): string | null {
  if (!html) return null;
  if (html.indexOf('firstHalf') >= 0) {
    const first = html.match(/firstHalf\s*=\s*['"]([^'"]+)['"]/);
    const second = html.match(/secondHalf\s*=\s*['"]([^'"]+)['"]/);
    if (first && second && first[1] && second[1]) {
      const candidate = `${first[1]}@${second[1]}`;
      if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(candidate)) return candidate;
    }
  }
  // document.write("local" + "@" + "domain.tld") style obfuscation
  const concatMatch = html.match(/['"]([a-zA-Z0-9._%+-]+)['"]\s*\+\s*['"]@['"]\s*\+\s*['"]([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['"]/);
  if (concatMatch) {
    const candidate = `${concatMatch[1]}@${concatMatch[2]}`;
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Extract a person name from common aria-label patterns used by Sidearm
 * tabular layouts:
 *   <a aria-label="Doug Gillin, Administration, Director of Athletics" ...>
 *   <a aria-label="Josh Brooks full bio">
 * Returns the leading token before the first comma / "full bio".
 */
/**
 * Extract a single email address from a fetched staff bio page. Tries the
 * same decoders the per-row parser uses (Cloudflare obfuscation, Sidearm
 * split-script, mailto hrefs, plaintext) so we can recover emails that the
 * directory listing hides.
 */
export function extractEmailFromBioHtml(html: string): string | null {
  if (!html) return null;

  const split = decodeSidearmSplitEmailScript(html);
  if (split) return split;

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return null;
  }

  const mailto = $('a[href^="mailto:"]').first();
  if (mailto.length) {
    const href = mailto.attr('href') || '';
    const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
    if (email && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) return email;
  }

  const cfNodes = $('[data-cfemail]').toArray();
  for (const node of cfNodes) {
    const enc = $(node).attr('data-cfemail');
    if (!enc) continue;
    const decoded = decodeCloudflareEmail(enc);
    if (decoded && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(decoded)) return decoded;
  }

  const text = $('body').text() || $.text();
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (m) return m[0];

  return null;
}

function extractNameFromAriaLabel(label: string): string | null {
  if (!label) return null;
  let head = label.split(',')[0].trim();
  head = head.replace(/\s+full bio.*$/i, '').trim();
  head = head.replace(/^Full bio for\s+/i, '').trim();
  if (head.length >= 3 && head.length <= 80 && /[A-Za-z]/.test(head)) return head;
  return null;
}

function isPronoun(text: string): boolean {
  if (!text || text.length > 50) return false;
  const normalizedText = text.toLowerCase().trim().replace(/\s*\/\s*/g, '/');
  const pronounPatterns = [
    /^he\/him(\/his)?$/,
    /^she\/her(\/hers)?$/,
    /^they\/them(\/theirs)?$/,
    /^\(he\/him\)$/,
    /^\(she\/her\)$/,
    /^\(they\/them\)$/,
  ];
  return pronounPatterns.some(pattern => pattern.test(normalizedText));
}

function cleanText(text: string): string {
  return text.replace(/[\n\r\t]+/g, ' ').replace(/\s\s+/g, ' ').trim();
}

function extractNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  const cleaned = localPart.replace(/[._-]/g, ' ').replace(/\d+/g, '').trim();
  return cleaned
    .split(' ')
    .filter(part => part.length > 1)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Unknown';
}

export class ParserFactory {
  private strategyName: string;
  private config: SelectorConfig;
  private $: cheerio.CheerioAPI;
  private url: string;
  private selectorUsage: SelectorUsage = {
    container: {},
    name: {},
    title: {},
    email: {},
    phone: {},
    department: {},
    office: {},
  };
  private perContainerMatches: PerContainerSelectorMatch[] = [];
  private currentMatch: PerContainerSelectorMatch | null = null;

  constructor(html: string, url: string, forceStrategy?: string) {
    this.$ = cheerio.load(html);
    this.url = url;
    if (forceStrategy && PARSER_STRATEGIES[forceStrategy]) {
      this.strategyName = forceStrategy;
    } else {
      this.strategyName = detectParserStrategy(html, url);
    }
    this.config = PARSER_STRATEGIES[this.strategyName] || PARSER_STRATEGIES.generic;
    const wasForced = !!forceStrategy && PARSER_STRATEGIES[forceStrategy] && this.strategyName === forceStrategy;
    console.log(`[ParserFactory] Using ${this.strategyName} parser for ${url}${wasForced ? ' (forced)' : ''}`);
  }

  getStrategyName(): string {
    return this.strategyName;
  }

  private recordHit(field: SelectorField, selector: string): void {
    this.selectorUsage[field][selector] = (this.selectorUsage[field][selector] || 0) + 1;
  }

  private recordContainerMatch(
    field: 'name' | 'title' | 'email' | 'phone',
    index: number,
    selector: string,
  ): void {
    if (!this.currentMatch) return;
    this.currentMatch[field] = { index, selector };
  }

  private extractEmail(container: cheerio.Cheerio<any>): string {
    const noteHit = (i: number, selector: string) => {
      this.recordHit('email', selector);
      this.recordContainerMatch('email', i, selector);
    };
    for (let i = 0; i < this.config.emailSelectors.length; i++) {
      const selector = this.config.emailSelectors[i];
      try {
        const el = container.find(selector).first();
        if (!el.length) continue;

        const cfEmail = el.attr('data-cfemail');
        if (cfEmail) {
          const decoded = decodeCloudflareEmail(cfEmail);
          if (decoded) { noteHit(i, selector); return decoded; }
        }

        const cfSpan = el.find('span.__cf_email__, span[data-cfemail]').first();
        if (cfSpan.length) {
          const spanCf = cfSpan.attr('data-cfemail');
          if (spanCf) {
            const decoded = decodeCloudflareEmail(spanCf);
            if (decoded) { noteHit(i, selector); return decoded; }
          }
        }

        if (el.is('a[href^="mailto:"]')) {
          const href = el.attr('href');
          if (href) { noteHit(i, selector); return href.replace('mailto:', '').split('?')[0].trim(); }
        }

        const mailtoLink = el.find('a[href^="mailto:"]').first();
        if (mailtoLink.length) {
          const href = mailtoLink.attr('href');
          if (href) { noteHit(i, selector); return href.replace('mailto:', '').split('?')[0].trim(); }
        }

        const text = el.text();
        const match = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
        if (match) { noteHit(i, selector); return match[1]; }
      } catch {
        continue;
      }
    }

    const containerHtml = container.html() || '';
    const splitEmail = decodeSidearmSplitEmailScript(containerHtml);
    if (splitEmail) {
      this.recordHit('email', '<sidearm-split-script>');
      this.recordContainerMatch('email', -1, '<sidearm-split-script>');
      return splitEmail;
    }

    const containerText = container.text();
    const textMatch = containerText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
    if (textMatch) {
      this.recordHit('email', '<container-text-regex>');
      this.recordContainerMatch('email', -1, '<container-text-regex>');
      return textMatch[1];
    }

    return '';
  }

  private extractName(container: cheerio.Cheerio<any>): { name: string; source: string } {
    for (let i = 0; i < this.config.nameSelectors.length; i++) {
      const selector = this.config.nameSelectors[i];
      try {
        const el = container.find(selector).first();
        if (el.length) {
          const text = cleanText(el.text());
          if (text.length > 2 && !text.includes('@') && !text.match(/^\d/)) {
            this.recordHit('name', selector);
            this.recordContainerMatch('name', i, selector);
            return { name: text.replace(/Full Bio for/i, '').trim(), source: 'selector' };
          }
        }
      } catch {
        continue;
      }
    }

    const bioLink = container.find('a[aria-label*="bio" i]').first();
    if (bioLink.length) {
      const ariaLabel = bioLink.attr('aria-label') || '';
      const match = ariaLabel.match(/(.+?)\s+full bio/i);
      if (match) {
        this.recordHit('name', '<aria-label-bio>');
        this.recordContainerMatch('name', -1, '<aria-label-bio>');
        return { name: match[1].trim(), source: 'aria-label' };
      }
      const head = extractNameFromAriaLabel(ariaLabel);
      if (head) {
        this.recordHit('name', '<aria-label-bio>');
        this.recordContainerMatch('name', -1, '<aria-label-bio>');
        return { name: head, source: 'aria-label' };
      }
    }

    // Sidearm tabular pattern: <a aria-label="Name, Dept, Title" href="/staff-directory/...">
    const ariaAnyLink = container.find('a[aria-label]').filter((_: any, el: any) => {
      const href = (el.attribs && el.attribs.href) || '';
      return !href.startsWith('mailto:') && !href.startsWith('tel:');
    }).first();
    if (ariaAnyLink.length) {
      const head = extractNameFromAriaLabel(ariaAnyLink.attr('aria-label') || '');
      if (head) {
        this.recordHit('name', '<aria-label-any>');
        this.recordContainerMatch('name', -1, '<aria-label-any>');
        return { name: head, source: 'aria-label' };
      }
    }

    return { name: 'Unknown', source: 'unknown' };
  }

  private extractTitle(container: cheerio.Cheerio<any>, name: string): { title: string; source: string } {
    for (let i = 0; i < this.config.titleSelectors.length; i++) {
      const selector = this.config.titleSelectors[i];
      try {
        const el = container.find(selector).first();
        if (el.length) {
          const text = cleanText(el.text());
          if (text.length > 2 && text.length < 100 && !text.includes('@') && !isPronoun(text)) {
            this.recordHit('title', selector);
            this.recordContainerMatch('title', i, selector);
            return { title: text, source: 'selector' };
          }
        }
      } catch {
        continue;
      }
    }

    if (name !== 'Unknown') {
      try {
        const nameEl = container.find(`:contains("${name}")`).last();
        if (nameEl.length) {
          const nextEl = nameEl.next();
          const nextText = cleanText(nextEl.text());
          if (nextText && !nextText.includes('@') && !/\d{3}/.test(nextText) && nextText.length > 2 && nextText.length < 60) {
            this.recordHit('title', '<title-sibling-of-name>');
            this.recordContainerMatch('title', -1, '<title-sibling-of-name>');
            return { title: nextText, source: 'sibling' };
          }

          const parentEl = nameEl.parent();
          parentEl.find('br').replaceWith('\n');
          const parentText = parentEl.text();
          const parts = parentText.split(name);
          if (parts.length > 1) {
            let candidate = parts[1].split('\n')
              .map((line: string) => cleanText(line))
              .filter((line: string) => line.length > 0 && !line.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/) && !/\d{3}/.test(line))
              [0] || '';
            candidate = candidate.replace(/^[-–—,]\s*/, '').trim();
            candidate = candidate.replace(/\s*(Phone|Email|Tel|Fax)\s*:?\s*/gi, '').trim();
            if (candidate.length > 3 && candidate.length < 50 && !candidate.includes('@') && !/\d{3}/.test(candidate)) {
              this.recordHit('title', '<title-text-node>');
              this.recordContainerMatch('title', -1, '<title-text-node>');
              return { title: candidate, source: 'text-node' };
            }
          }
        }
      } catch {
      }
    }

    return { title: '', source: 'unknown' };
  }

  private extractPhone(container: cheerio.Cheerio<any>): string {
    for (let i = 0; i < this.config.phoneSelectors.length; i++) {
      const selector = this.config.phoneSelectors[i];
      try {
        const el = container.find(selector).first();
        if (!el.length) continue;
        if (el.is('a[href^="tel:"]')) {
          const href = el.attr('href') || '';
          const v = href.replace(/^tel:/, '').trim();
          if (v) {
            this.recordHit('phone', selector);
            this.recordContainerMatch('phone', i, selector);
            return v;
          }
        }
        const txt = cleanText(el.text());
        const m = txt.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
        if (m) {
          this.recordHit('phone', selector);
          this.recordContainerMatch('phone', i, selector);
          return m[0];
        }
      } catch {
        continue;
      }
    }

    const text = container.text();
    for (const pat of PHONE_PATTERNS) {
      const m = text.match(pat.re);
      if (m) {
        this.recordHit('phone', pat.label);
        this.recordContainerMatch('phone', -1, pat.label);
        return m[0];
      }
    }
    return '';
  }

  private extractField(container: cheerio.Cheerio<any>, selectors: string[], field: SelectorField): string | undefined {
    for (const selector of selectors) {
      try {
        const el = container.find(selector).first();
        if (el.length) {
          const text = cleanText(el.text());
          if (text.length > 1 && text.length < 100) {
            this.recordHit(field, selector);
            return text;
          }
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private extractContactFromContainer(container: cheerio.Cheerio<any>, containerIndex: number): ParsedContact | null {
    this.currentMatch = {
      containerIndex,
      name: null,
      title: null,
      email: null,
      phone: null,
    };
    const rawEmail = this.extractEmail(container);
    const email = (rawEmail && isValidContactEmail(rawEmail)) ? rawEmail : '';

    const { name, source: nameSource } = this.extractName(container);
    const rawName = (name === 'Unknown' && email) ? extractNameFromEmail(email) : name;
    const finalName = isValidPersonName(rawName) ? rawName : (email ? extractNameFromEmail(email) : rawName);

    if (!isValidPersonName(finalName)) {
      this.flushContainerMatch();
      return null;
    }
    const { title, source: titleSource } = this.extractTitle(container, finalName);

    const phone = this.extractPhone(container);
    const department = this.extractField(container, this.config.departmentSelectors, 'department');
    const office = this.extractField(container, this.config.officeSelectors, 'office');

    const linkedinEl = container.find(this.config.linkedinSelectors.join(',')).first();
    const linkedinUrl = linkedinEl.length ? linkedinEl.attr('href') : undefined;

    const bioLinkEl = container.find(this.config.bioLinkSelectors.join(',')).first();
    const bioUrl = bioLinkEl.length ? bioLinkEl.attr('href') : undefined;

    const imageEl = container.find(this.config.imageSelectors.join(',')).first();
    const imageUrl = imageEl.length ? (imageEl.attr('src') || imageEl.attr('data-src')) : undefined;

    let nameScore = 0;
    if (finalName !== 'Unknown') {
      const wordCount = finalName.split(' ').length;
      if (nameSource === 'aria-label' || nameSource === 'selector') {
        nameScore = 90;
      } else {
        nameScore = wordCount >= 2 ? 60 : 40;
      }
    }

    let titleScore = 0;
    if (title && title.length > 2) {
      if (titleSource === 'selector') titleScore = 90;
      else if (titleSource === 'sibling') titleScore = 75;
      else if (titleSource === 'text-node') titleScore = 60;
      else titleScore = 50;
    }

    const emailScore = email && email.includes('@') ? 100 : 0;
    const phoneScore = phone.match(/\d{3}.*\d{3}.*\d{4}/) ? 90 : 0;

    if (!emailScore && !titleScore && !phoneScore) {
      this.flushContainerMatch();
      return null;
    }

    const overall = Math.round(
      (nameScore * 0.35) + (titleScore * 0.30) + (emailScore * 0.25) + (phoneScore * 0.10)
    );

    this.flushContainerMatch();
    return {
      name: finalName,
      title,
      email,
      phone,
      department,
      office,
      linkedinUrl,
      bioUrl,
      imageUrl,
      confidence: { name: nameScore, title: titleScore, email: emailScore, phone: phoneScore, overall },
      parserUsed: this.strategyName,
    };
  }

  private flushContainerMatch(): void {
    if (this.currentMatch) {
      this.perContainerMatches.push(this.currentMatch);
      this.currentMatch = null;
    }
  }

  async parse(): Promise<ParseResult> {
    const $ = this.$;
    const contacts: ParsedContact[] = [];
    const processedEmails = new Set<string>();

    const totalEmailLinks = $('a[href^="mailto:"], a[data-cfemail]').length;

    let containers: cheerio.Cheerio<any>[] = [];
    let containerSelectorUsed: string | null = null;
    for (const selector of this.config.containerSelectors) {
      try {
        const found = $(selector).toArray().map(el => $(el));
        if (found.length > 0) {
          containers = found;
          containerSelectorUsed = selector;
          this.selectorUsage.container[selector] = found.length;
          break;
        }
      } catch {
        continue;
      }
    }

    if (containers.length === 0) {
      const emailLinks = $('a[href^="mailto:"], a[data-cfemail], a[href*="/cdn-cgi/l/email-protection"]').toArray();
      
      const parentMap = new Map<string, { parent: cheerio.Cheerio<any>; count: number; children: cheerio.Cheerio<any>[] }>();
      for (const link of emailLinks) {
        const $link = $(link);
        let container = $link.closest('tr, li, article, section, [role="listitem"], div[class*="card"], div[class*="item"], div[class*="member"], div[class*="person"], div[class*="staff"], div[class*="coach"], div[class*="profile"], div[class*="bio"]');
        let viaClosest = container.length > 0;
        if (!container.length) {
          container = $link.parent().parent();
        }
        if (container.length) {
          this.recordHit('container', viaClosest ? '<fallback-mailto-closest>' : '<fallback-mailto-grandparent>');
          containers.push(container);
          
          const parent = container.parent();
          if (parent.length) {
            const parentHtml = parent.prop('tagName') + '_' + (parent.attr('class') || '') + '_' + (parent.attr('id') || '');
            const entry = parentMap.get(parentHtml);
            if (entry) {
              entry.count++;
              entry.children.push(container);
            } else {
              parentMap.set(parentHtml, { parent, count: 1, children: [container] });
            }
          }
        }
      }
      
      if (containers.length < 2) {
        const parentEntries = Array.from(parentMap.values());
        for (const entry of parentEntries) {
          if (entry.count >= 3) {
            const tagName = entry.children[0].prop('tagName');
            if (tagName) {
              const siblings = entry.parent.children(tagName.toLowerCase()).toArray().map((el: any) => $(el));
              if (siblings.length > containers.length) {
                containers = siblings;
                this.selectorUsage.container['<fallback-sibling-cluster>'] = siblings.length;
                break;
              }
            }
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
                this.recordHit('container', '<fallback-plaintext-email>');
                containers.push($el);
              }
            }
          }
        }
      }
    }

    let aiEnhancedCount = 0;

    const processedNames = new Set<string>();
    for (let ci = 0; ci < containers.length; ci++) {
      const container = containers[ci];
      const contact = this.extractContactFromContainer(container, ci);
      if (!contact) continue;
      const dedupKey = contact.email ? contact.email.toLowerCase() : contact.name.toLowerCase();
      if (processedEmails.has(dedupKey) || processedNames.has(dedupKey)) continue;
      if (contact.email) processedEmails.add(contact.email.toLowerCase());
      processedNames.add(contact.name.toLowerCase());
      {

        if (
          SCRAPER_CONFIG.enableAIFallback &&
          isAIAvailable() &&
          contact.confidence.overall < SCRAPER_CONFIG.aiConfidenceThreshold
        ) {
          try {
            const html = container.html() || '';
            const { enhanced, contact: enhancedContact } = await enhanceContactWithAI(
              contact,
              html,
              SCRAPER_CONFIG.aiConfidenceThreshold
            );
            if (enhanced) {
              contact.name = enhancedContact.name;
              contact.title = enhancedContact.title;
              contact.email = enhancedContact.email;
              contact.phone = enhancedContact.phone;
              contact.aiEnhanced = true;
              aiEnhancedCount++;
            }
          } catch (e) {
            console.error('[ParserFactory] AI enhancement failed:', e);
          }
        }

        contacts.push(contact);
      }
    }

    const totalConfidence = contacts.reduce((sum, c) => sum + c.confidence.overall, 0);
    const averageConfidence = contacts.length > 0 ? Math.round(totalConfidence / contacts.length) : 0;

    const selectorUsageSummary = this.buildSelectorUsageSummary();
    this.logSelectorUsageSummary(selectorUsageSummary);

    return {
      contacts,
      diagnostics: {
        parserUsed: this.strategyName,
        totalEmailLinksFound: totalEmailLinks,
        containersDetected: containers.length,
        contactsExtracted: contacts.length,
        aiEnhancedCount,
        averageConfidence,
        selectorUsage: this.selectorUsage,
        selectorUsageSummary,
        perContainerMatches: this.perContainerMatches,
      },
    };
  }

  private buildSelectorUsageSummary(topN = 5): SelectorUsageSummary {
    const fields: SelectorField[] = ['container', 'name', 'title', 'email', 'phone', 'department', 'office'];
    const all: Array<{ field: SelectorField; selector: string; hits: number }> = [];
    for (const field of fields) {
      for (const [selector, hits] of Object.entries(this.selectorUsage[field])) {
        all.push({ field, selector, hits });
      }
    }
    all.sort((a, b) => b.hits - a.hits);
    const topUsed = all.slice(0, topN);

    const configured: Record<SelectorField, string[]> = {
      container: this.config.containerSelectors,
      name: this.config.nameSelectors,
      title: this.config.titleSelectors,
      email: this.config.emailSelectors,
      phone: this.config.phoneSelectors,
      department: this.config.departmentSelectors,
      office: this.config.officeSelectors,
    };
    const unused: Array<{ field: SelectorField; selector: string }> = [];
    for (const field of fields) {
      const used = this.selectorUsage[field];
      for (const selector of configured[field] || []) {
        if (!used[selector]) unused.push({ field, selector });
      }
    }
    return { topUsed, unused };
  }

  private logSelectorUsageSummary(summary: SelectorUsageSummary): void {
    if (!summary.topUsed.length) return;
    const top = summary.topUsed
      .map(t => `${t.field}:${t.selector}=${t.hits}`)
      .join(' | ');
    console.log(`[ParserFactory] Selector hits (${this.strategyName}) top: ${top} | unused-configured=${summary.unused.length}`);
  }
}

export function createParser(html: string, url: string): ParserFactory {
  return new ParserFactory(html, url);
}

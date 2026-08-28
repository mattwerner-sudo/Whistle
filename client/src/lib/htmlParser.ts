import type { ContactPerson, ConfidenceScore, ParseResult, ExtractionDiagnostics } from "@shared/schema";

// Helper: Decode Cloudflare email protection
function decodeCloudflareEmail(encodedString: string): string {
  try {
    const email = encodedString.substr(0,2);
    const r = parseInt(email, 16);
    let decoded = '';
    for (let n = 2; encodedString.length - n; n += 2) {
      const i = parseInt(encodedString.substr(n, 2), 16) ^ r;
      decoded += String.fromCharCode(i);
    }
    return decoded;
  } catch (e) {
    return '';
  }
}

// Helper: Extract email from Cloudflare-protected links or plain text
function extractEmailFromElement(element: Element): string {
  // Strategy 1: Check for Cloudflare email protection (on element or descendants)
  // Check the element itself first
  let cfEmail = element.getAttribute('data-cfemail');
  if (cfEmail) {
    const decoded = decodeCloudflareEmail(cfEmail);
    if (decoded) return decoded;
  }
  
  // Search for __cf_email__ spans (common Cloudflare pattern)
  const cfSpan = element.querySelector('span.__cf_email__, span[data-cfemail]');
  if (cfSpan) {
    cfEmail = cfSpan.getAttribute('data-cfemail');
    if (cfEmail) {
      const decoded = decodeCloudflareEmail(cfEmail);
      if (decoded) return decoded;
    }
  }
  
  // Check for Cloudflare protection links
  const cfLink = element.querySelector('a[href*="/cdn-cgi/l/email-protection"]');
  if (cfLink) {
    // Look for adjacent __cf_email__ span
    const adjacentSpan = cfLink.querySelector('.__cf_email__') || 
                        cfLink.parentElement?.querySelector('.__cf_email__');
    if (adjacentSpan) {
      cfEmail = adjacentSpan.getAttribute('data-cfemail');
      if (cfEmail) {
        const decoded = decodeCloudflareEmail(cfEmail);
        if (decoded) return decoded;
      }
    }
  }
  
  // Strategy 2: Check for mailto link
  const mailtoLink = element.querySelector('a[href^="mailto:"]');
  if (mailtoLink) {
    const href = mailtoLink.getAttribute('href');
    if (href) return href.replace('mailto:', '').trim();
  }
  
  // Strategy 3: Extract plain text email from content
  const text = element.textContent || '';
  const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
  if (emailMatch) return emailMatch[1];
  
  return "";
}

// Helper: Detect if a string is a pronoun pattern (he/him, she/her, they/them, etc.)
function isPronoun(text: string): boolean {
  if (!text || text.length > 50) return false;
  
  // Normalize: lowercase, trim, normalize whitespace around slashes
  const normalizedText = text.toLowerCase().trim().replace(/\s*\/\s*/g, '/');
  
  // Common pronoun patterns (including possessive forms)
  const pronounPatterns = [
    // Basic patterns
    /^he\/him$/,
    /^she\/her$/,
    /^they\/them$/,
    // Extended patterns with possessive
    /^he\/him\/his$/,
    /^she\/her\/hers$/,
    /^they\/them\/theirs$/,
    // Mixed patterns
    /^he\/they$/,
    /^she\/they$/,
    // Gender-neutral
    /^xe\/xem$/,
    /^ze\/zir$/,
    // Generic
    /^any pronouns?$/,
    // With parentheses (basic and extended)
    /^\(he\/him\)$/,
    /^\(she\/her\)$/,
    /^\(they\/them\)$/,
    /^\(he\/him\/his\)$/,
    /^\(she\/her\/hers\)$/,
    /^\(they\/them\/theirs\)$/,
    // With "Pronouns:" prefix (handles both 2-part and 3-part)
    /^pronouns?:\s*he\/him(\/his)?$/,
    /^pronouns?:\s*she\/her(\/hers)?$/,
    /^pronouns?:\s*they\/them(\/theirs)?$/,
    // Catch-all for slash-separated pronouns (2-3 parts with optional spaces)
    /^[a-z]{2,5}\s*\/\s*[a-z]{2,5}(\s*\/\s*[a-z]{2,5})?$/,
  ];
  
  return pronounPatterns.some(pattern => pattern.test(normalizedText));
}

function calculateConfidenceScores(contact: {
  name: string;
  title: string;
  email: string;
  phone: string;
  nameSource: string;
  titleSource: string;
}): ConfidenceScore {
  let nameScore = 0;
  let titleScore = 0;
  let emailScore = 0;
  let phoneScore = 0;

  // Name confidence
  if (contact.name !== "Unknown") {
    const wordCount = contact.name.split(' ').length;
    if (contact.nameSource === 'aria-label' || contact.nameSource === 'heading') {
      nameScore = 90; // High confidence from explicit name fields
    } else if (contact.nameSource === 'email-derived') {
      nameScore = wordCount >= 2 ? 60 : 40; // Medium confidence from email parsing
    } else {
      nameScore = wordCount >= 2 ? 75 : 50;
    }
  } else {
    nameScore = 0;
  }

  // Title confidence
  if (contact.title && contact.title.length > 2) {
    if (contact.titleSource === 'position-class') {
      titleScore = 85; // High confidence from explicit position elements
    } else if (contact.titleSource === 'data-label') {
      titleScore = 90; // Very high confidence from data attributes
    } else if (contact.titleSource === 'table-cell') {
      titleScore = 70; // Medium-high for table layouts
    } else {
      titleScore = 60; // Lower confidence for parsed titles
    }
    // Penalize very long titles (likely not a real title)
    if (contact.title.length > 100) titleScore = Math.max(30, titleScore - 30);
  } else {
    titleScore = 0;
  }

  // Email confidence (email validation already done)
  emailScore = contact.email && contact.email.includes('@') ? 100 : 0;

  // Phone confidence
  if (contact.phone) {
    phoneScore = contact.phone.match(/\d{3}.*\d{3}.*\d{4}/) ? 90 : 60;
  } else {
    phoneScore = 0;
  }

  // Overall confidence (weighted average)
  const overall = Math.round(
    (nameScore * 0.35) + 
    (titleScore * 0.30) + 
    (emailScore * 0.25) + 
    (phoneScore * 0.10)
  );

  return { name: nameScore, title: titleScore, email: emailScore, phone: phoneScore, overall };
}

function extractAdditionalFields(container: HTMLElement): {
  department?: string;
  office?: string;
  linkedinUrl?: string;
  bioUrl?: string;
} {
  const result: {
    department?: string;
    office?: string;
    linkedinUrl?: string;
    bioUrl?: string;
  } = {};

  // Extract department from common patterns
  const deptSelectors = [
    '[class*="department"]',
    '[class*="dept"]',
    '[data-label="Department" i]',
    '[data-label="Dept" i]',
  ];
  for (const selector of deptSelectors) {
    const deptEl = container.querySelector(selector);
    if (deptEl && deptEl.textContent) {
      const dept = deptEl.textContent.trim();
      if (dept.length > 2 && dept.length < 100) {
        result.department = dept;
        break;
      }
    }
  }

  // Extract office/location
  const officeSelectors = [
    '[class*="office"]',
    '[class*="location"]',
    '[class*="room"]',
    '[data-label="Office" i]',
    '[data-label="Location" i]',
  ];
  for (const selector of officeSelectors) {
    const officeEl = container.querySelector(selector);
    if (officeEl && officeEl.textContent) {
      const office = officeEl.textContent.trim();
      if (office.length > 1 && office.length < 100 && !office.includes('@')) {
        result.office = office;
        break;
      }
    }
  }

  // Extract LinkedIn URL
  const linkedinLink = container.querySelector('a[href*="linkedin.com"]');
  if (linkedinLink) {
    result.linkedinUrl = linkedinLink.getAttribute('href') || undefined;
  }

  // Extract bio URL
  const bioLink = container.querySelector('a[aria-label*="bio" i], a[title*="bio" i], a[href*="/bio/"], a[href*="/profile/"]');
  if (bioLink) {
    result.bioUrl = bioLink.getAttribute('href') || undefined;
  }

  return result;
}

function findSmallestReasonableContainer(link: Element): HTMLElement | null {
  let current = link.parentElement;
  let maxLevels = 5; // Don't traverse too far up
  let level = 0;
  
  while (current && level < maxLevels) {
    // Check if this element looks like a contact container
    const hasMultipleMailtoLinks = current.querySelectorAll('a[href^="mailto:"]').length > 1;
    
    // If this container has multiple email links, it's too large - use the previous one
    if (hasMultipleMailtoLinks && level > 0) {
      return link.parentElement as HTMLElement;
    }
    
    // Check if this div has reasonable content that looks like a single contact
    const text = current.textContent || '';
    const hasReasonableLength = text.length > 10 && text.length < 1000;
    
    if (hasReasonableLength && current.tagName === 'DIV') {
      return current;
    }
    
    current = current.parentElement;
    level++;
  }
  
  // Fallback to immediate parent
  return link.parentElement as HTMLElement;
}

function extractNameFromEmail(email: string): string {
  if (!email || !email.includes('@')) return "Unknown";
  
  // Get the local part (before @)
  const localPart = email.split('@')[0];
  
  // Remove common separators and numbers
  let namePart = localPart
    .replace(/[._-]/g, ' ')
    .replace(/\d+/g, '')
    .trim();
  
  // If we have something, capitalize each word
  if (namePart.length > 0) {
    return namePart
      .split(' ')
      .map(word => {
        if (word.length === 0) return '';
        if (word.length === 1) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .filter(word => word.length > 0)
      .join(' ');
  }
  
  return "Unknown";
}

export function parseHtmlForContacts(htmlString: string): ParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const contacts: ContactPerson[] = [];
  const processedEmails = new Set<string>();
  
  // Diagnostic tracking
  let cloudflareEmailsFound = 0;
  let mailtoLinksFound = 0;
  let plainTextEmailsFound = 0;

  // Container-first approach: Find all potential contact containers first
  // Note: Using :has() with multiple email indicators (mailto OR Cloudflare-protected OR plain text emails)
  const containerSelectors = [
    // Mailto links (traditional)
    '[class*="person-card__content"]:has(a[href^="mailto:"])',
    '[class*="person-card"]:has(a[href^="mailto:"])',
    '[class*="s-person-card"]:has(a[href^="mailto:"])',
    '[class*="staff-card"]:has(a[href^="mailto:"])',
    '[class*="staff-item"]:has(a[href^="mailto:"])',
    '[class*="staff-member"]:has(a[href^="mailto:"])',
    '[class*="contact-card"]:has(a[href^="mailto:"])',
    '[class*="directory-item"]:has(a[href^="mailto:"])',
    'tr:has(a[href^="mailto:"])',
    'li:has(a[href^="mailto:"])',
    'article:has(a[href^="mailto:"])',
    // Cloudflare-protected emails
    '[class*="person-card"]:has(a[data-cfemail])',
    '[class*="staff-card"]:has(a[data-cfemail])',
    '[class*="staff-item"]:has(a[data-cfemail])',
    '[class*="staff-member"]:has(a[data-cfemail])',
    '[class*="directory-item"]:has(a[data-cfemail])',
    'tr:has(a[data-cfemail])',
    'li:has(a[data-cfemail])',
  ];

  const containers: HTMLElement[] = [];
  for (const selector of containerSelectors) {
    try {
      const found = doc.querySelectorAll(selector);
      found.forEach(el => containers.push(el as HTMLElement));
      if (containers.length > 0) break; // Use first successful selector
    } catch (e) {
      // :has() might not be supported in some browsers, skip
      continue;
    }
  }

  // Count email types before extraction
  mailtoLinksFound = doc.querySelectorAll('a[href^="mailto:"]').length;
  cloudflareEmailsFound = doc.querySelectorAll('a[data-cfemail], span.__cf_email__, a[href*="/cdn-cgi/l/email-protection"]').length;
  
  // Fallback: if no containers found with :has(), use email link-based approach
  if (containers.length === 0) {
    // Look for both mailto AND Cloudflare-protected links
    const emailLinks = doc.querySelectorAll('a[href^="mailto:"], a[data-cfemail], a[href*="/cdn-cgi/l/email-protection"]');
    emailLinks.forEach(link => {
      // Try to find container using multiple strategies
      const container = 
        // Staff/person card patterns
        link.closest('[class*="person-card"]') ||
        link.closest('[class*="person"]') ||
        link.closest('[class*="staff-card"]') ||
        link.closest('[class*="staff-item"]') ||
        link.closest('[class*="staff-member"]') ||
        link.closest('[class*="staff"]') ||
        link.closest('[class*="directory-item"]') ||
        link.closest('[class*="employee"]') ||
        link.closest('[class*="member"]') ||
        link.closest('[class*="contact"]') ||
        // Structural elements
        link.closest('tr') || 
        link.closest('li') || 
        link.closest('article') ||
        link.closest('div[role="article"]') ||
        link.closest('[itemtype*="Person"]') ||
        // Generic fallback
        findSmallestReasonableContainer(link);
      if (container) containers.push(container as HTMLElement);
    });
  }

  // Extract person data from each container
  containers.forEach(container => {
    const person = extractPersonFromContainer(container);
    if (person.email && !processedEmails.has(person.email)) {
      processedEmails.add(person.email);
      contacts.push(person);
    }
  });

  // Ultimate fallback: If we found no contacts but there ARE mailto links,
  // extract minimal data directly from the links and nearby text
  if (contacts.length === 0) {
    const mailtoLinks = doc.querySelectorAll('a[href^="mailto:"]');
    console.log(`Ultimate fallback: Found ${mailtoLinks.length} mailto links with no containers`);
    
    mailtoLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      
      const email = href.replace('mailto:', '').trim();
      if (processedEmails.has(email)) return;
      
      // Try to find name and title near the email link
      const parent = link.parentElement;
      if (!parent) return;
      
      let name = "Unknown";
      let title = "";
      
      // Look for name in nearby elements
      const nameEl = parent.querySelector('[class*="name"]') || 
                     parent.querySelector('h1, h2, h3, h4, h5, h6') ||
                     parent.querySelector('strong, b');
      if (nameEl && nameEl.textContent) {
        name = nameEl.textContent.trim();
      }
      
      // Look for title in nearby elements
      const titleEl = parent.querySelector('[class*="title"]') ||
                      parent.querySelector('[class*="position"]') ||
                      parent.querySelector('.role');
      if (titleEl && titleEl.textContent && !isPronoun(titleEl.textContent.trim())) {
        title = titleEl.textContent.trim();
      }
      
      // If still no name, extract from email
      if (name === "Unknown" || name.length < 2) {
        name = extractNameFromEmail(email);
      }
      
      processedEmails.add(email);
      contacts.push({
        id: crypto.randomUUID(),
        name,
        title,
        email,
        phone: "",
        department: "",
        office: "",
        linkedinUrl: "",
        bioUrl: "",
        confidence: calculateConfidenceScores({
          name,
          title,
          email,
          phone: "",
          nameSource: "ultimate-fallback",
          titleSource: title ? "ultimate-fallback" : "unknown",
        }),
      });
    });
  }

  console.log(`Parser extracted ${contacts.length} total contacts`);
  
  // Calculate diagnostics
  const totalEmailLinksFound = mailtoLinksFound + cloudflareEmailsFound;
  const averageConfidence = contacts.length > 0
    ? contacts.reduce((sum, c) => sum + (c.confidence?.overall || 0), 0) / contacts.length
    : 0;
  
  // Determine failure reason and suggestions
  let failureReason: string | undefined;
  const suggestions: string[] = [];
  
  if (contacts.length === 0) {
    if (totalEmailLinksFound === 0) {
      failureReason = "No email addresses found in HTML";
      suggestions.push("This site may load contacts via AJAX or use server-side email protection");
      suggestions.push("Try enabling 'Render JavaScript' if not already enabled");
      suggestions.push("Consider contacting the site directly for staff directory access");
    } else if (containers.length === 0) {
      failureReason = "Email links found but container detection failed";
      suggestions.push("The HTML structure is unusual - contact card detection patterns don't match");
      suggestions.push("This may require custom parsing for this specific site");
    }
  } else if (averageConfidence < 60) {
    suggestions.push("Low confidence extraction - review data quality before using");
    suggestions.push("Consider using AI data cleaning feature to improve accuracy");
  }
  
  const diagnostics: ExtractionDiagnostics = {
    totalEmailLinksFound,
    cloudflareEmailsFound,
    mailtoLinksFound,
    plainTextEmailsFound,
    containersDetected: containers.length,
    contactsExtracted: contacts.length,
    averageConfidence: Math.round(averageConfidence),
    failureReason,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
  
  return {
    contacts,
    diagnostics,
  };
}

function extractPersonFromContainer(container: HTMLElement): ContactPerson {
  const textContent = container.innerText.replace(/\s+/g, ' ').trim();
  
  // Extract email first (required field) - supports mailto, Cloudflare, and plain text
  const email = extractEmailFromElement(container);
  
  // Extract phone
  const phoneMatch = textContent.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const phone = phoneMatch ? phoneMatch[0] : "";
  
  let name = "Unknown";
  let nameSource = "unknown";

  // Name extraction logic
  // Strategy 1: Look for name class patterns (person-details__name, staff-name, etc.)
  const nameSelectors = [
    '[class*="person-details__name"]',
    '[class*="person__name"]',
    '[class*="s-person-details__name"]',
    '[class*="staff-name"]',
    '[class*="contact-name"]',
    '[class*="member-name"]',
    '[class*="employee-name"]',
    '[class*="directory-name"]',
    '[itemprop="name"]',  // Schema.org markup
    '.name:not(.title):not(.position)',  // Generic .name class (but not title/position)
  ];
  
  for (const selector of nameSelectors) {
    const nameEl = container.querySelector(selector);
    if (nameEl) {
      const nameText = nameEl.textContent?.trim() || "";
      if (nameText.length > 2 && !nameText.includes('@') && !nameText.match(/^\d/)) {
        name = nameText.replace(/Full Bio for/i, '').trim();
        nameSource = "name-class";
        break;
      }
    }
  }
  
  // Strategy 2: Look for links with "full bio" aria-label (JS-rendered athletic sites)
  if (name === "Unknown") {
    const bioLink = container.querySelector('a[aria-label*="full bio" i]');
    if (bioLink) {
      // First try to extract from aria-label
      const ariaLabel = bioLink.getAttribute('aria-label') || "";
      const ariaMatch = ariaLabel.match(/(.+?)\s+full bio/i);
      if (ariaMatch) {
        name = ariaMatch[1].trim();
        nameSource = "aria-label";
      } else {
        // Otherwise get text from h4 inside the link
        const h4 = bioLink.querySelector('h4');
        if (h4) {
          name = h4.textContent?.trim() || "Unknown";
          nameSource = "heading";
        }
      }
    }
  }
  
  // Strategy 2: Check for old "Full Bio for" pattern
  // Strategy 3: Alternative bio link patterns
  if (name === "Unknown") {
    const bioLinkAlt = container.querySelector('a[aria-label*="Bio"], a[title*="Bio"]');
    if (bioLinkAlt) {
      const bioText = bioLinkAlt.getAttribute('aria-label') || bioLinkAlt.getAttribute('title') || bioLinkAlt.textContent || "";
      const bioMatch = bioText.match(/Full Bio for (.+)/i);
      if (bioMatch) {
        name = bioMatch[1];
        nameSource = "aria-label";
      }
    }
  }
  
  // Strategy 3: Look for data-label="Name" or similar
  // Strategy 4: Data label attributes
  if (name === "Unknown") {
    const dataLabelName = container.querySelector('[data-label="Name" i], [data-label="Full Name" i]');
    if (dataLabelName) {
      name = dataLabelName.textContent?.trim() || "Unknown";
      if (name !== "Unknown") nameSource = "data-label";
    }
  }

  // Strategy 4: Look for h1-h5 tags (prioritize h4 for JS sites)
  // Strategy 5: Heading tags and .name class
  if (name === "Unknown") {
    const nameCandidates = container.querySelectorAll('h4, h3, h2, h1, h5, strong, b, .name');
    if (nameCandidates.length > 0) {
      name = nameCandidates[0].textContent?.trim() || "Unknown";
      if (name !== "Unknown") nameSource = "heading";
    }
  }

  // Strategy 5: For table rows, use first cell
  // Strategy 6: For table rows, use first cell
  if (name === "Unknown" && container.tagName === 'TR') {
    const cells = container.querySelectorAll('td');
    if (cells.length > 0) {
      name = cells[0].textContent?.trim() || "Unknown";
      if (name !== "Unknown") nameSource = "table-cell";
    }
  }
  
  name = name.replace(/Full Bio for/i, '').trim();
  
  // Fallback: Extract name from email address if still unknown
  if (name === "Unknown" || name.length < 2) {
    name = extractNameFromEmail(email);
    nameSource = "email-derived";
  }

  // Title extraction logic
  let title = "";
  let titleSource = "unknown";
  
  // Strategy 1: Look for JS-rendered site patterns (s-person-details__position, etc.)
  const jsPositionSelectors = [
    '[class*="person-details__position"]',
    '[class*="person__position"]',
    '[class*="s-person-details__position"]',
    '[class*="staff-position"]',
    '[class*="staff-title"]',
    '[class*="contact-position"]',
    '[class*="member-title"]',
    '[class*="employee-title"]',
    '[class*="job-title"]',
    '[class*="directory-title"]',
    '[itemprop="jobTitle"]',  // Schema.org markup
  ];
  
  for (const selector of jsPositionSelectors) {
    const positionEl = container.querySelector(selector);
    if (positionEl) {
      // Get the first child div if it exists, otherwise use the element itself
      const titleDiv = positionEl.querySelector('div') || positionEl;
      const titleText = titleDiv.textContent?.trim() || "";
      // Validate it's not a phone number, email, or pronoun
      if (titleText.length > 2 && !titleText.match(/^\d{3,}$/) && !titleText.includes('@') && !isPronoun(titleText)) {
        title = titleText;
        titleSource = "position-class";
        break;
      }
    }
  }
  
  // Strategy 2: Look for data-label="Title" or "Position"
  if (!title || title.length < 2) {
    const dataLabelTitle = container.querySelector('[data-label="Title" i], [data-label="Position" i], [data-label="Job Title" i]');
    if (dataLabelTitle) {
      const titleText = dataLabelTitle.textContent?.trim() || "";
      if (titleText && titleText.length >= 2 && !isPronoun(titleText)) {
        title = titleText;
        titleSource = "data-label";
      }
    }
  }
  
  // Strategy 3: Look for elements with common title/position classes
  if (!title || title.length < 2) {
    const titleCandidates = container.querySelectorAll('.title, .position, .role, .job-title, .job_title');
    if (titleCandidates.length > 0) {
      const titleText = titleCandidates[0].textContent?.trim() || "";
      if (!titleText.match(/^\d{3,}$/) && !titleText.includes('@') && !isPronoun(titleText)) {
        title = titleText;
        if (title && title.length >= 2) titleSource = "class-selector";
      }
    }
  }
  
  // Strategy 4: For tables, check second column
  if ((!title || title.length < 2) && container.tagName === 'TR') {
    const cells = container.querySelectorAll('td');
    if (cells.length >= 2) {
      const cellText = cells[1].textContent?.trim() || "";
      // Only use if it's not an email, phone, or pronoun
      if (cellText && !cellText.includes('@') && !cellText.match(/\d{3}.*\d{3}.*\d{4}/) && !cellText.match(/^\d{3,}$/) && !isPronoun(cellText)) {
        title = cellText;
        titleSource = "table-cell";
      }
    }
  }
  
  // Strategy 5: Parse remaining text intelligently
  if ((!title || title.length < 2) && name !== "Unknown") {
    let cleanText = textContent
      .replace(name, "")
      .replace(email, "")
      .replace(phone, "")
      .replace(/Full Bio for/gi, "")
      .replace(/Phone:?/gi, "")
      .replace(/Email:?/gi, "")
      .replace(/Tel:?/gi, "")
      .replace(/Contact:?/gi, "")
      .trim();
    
    // Split by common delimiters and take first meaningful piece (skip pronouns)
    const parts = cleanText.split(/[\n|•]/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 2 && trimmed.length < 80 && !trimmed.includes('@') && !isPronoun(trimmed)) {
        title = trimmed;
        titleSource = "parsed-text";
        break;
      }
    }
  }

  // Calculate confidence scores
  const confidence = calculateConfidenceScores({
    name,
    title,
    email,
    phone,
    nameSource,
    titleSource,
  });

  // Extract additional fields
  const additionalFields = extractAdditionalFields(container);

  return { 
    id: crypto.randomUUID(),
    name, 
    title, 
    email, 
    phone,
    ...additionalFields,
    confidence,
  };
}

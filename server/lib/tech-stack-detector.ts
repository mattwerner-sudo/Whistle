/**
 * Tech Stack Detector - Technographic Detection Engine
 * 
 * Scans HTML content for "digital signatures" of software vendors
 * commonly used by collegiate athletic departments.
 * 
 * Categories:
 * - CMS/Website Providers (Sidearm, Neulion, WMT Digital)
 * - Ticketing Systems (Ticketmaster, Paciolan, Fevo)
 * - Operations/Logistics (Teamworks, ARMS, Catapult)
 * - Performance Analytics (Hudl, Genius Sports)
 */

export interface TechDetectionResult {
  techStack: string[];
  detectedSignatures: {
    technology: string;
    confidence: 'high' | 'medium' | 'low';
    evidence: string;
  }[];
}

interface TechSignature {
  name: string;
  patterns: {
    type: 'html' | 'href' | 'script' | 'meta';
    pattern: string;
    confidence: 'high' | 'medium' | 'low';
  }[];
}

const TECH_SIGNATURES: TechSignature[] = [
  {
    name: 'Sidearm Sports',
    patterns: [
      { type: 'html', pattern: 'sidearmsports', confidence: 'high' },
      { type: 'href', pattern: 'sidearmsports.com', confidence: 'high' },
      { type: 'html', pattern: 'sidearm-sports', confidence: 'high' },
      { type: 'script', pattern: 'sidearm', confidence: 'medium' },
    ]
  },
  {
    name: 'Neulion',
    patterns: [
      { type: 'html', pattern: 'neulion', confidence: 'high' },
      { type: 'href', pattern: 'neulionsports.com', confidence: 'high' },
      { type: 'script', pattern: 'neulion', confidence: 'medium' },
    ]
  },
  {
    name: 'WMT Digital',
    patterns: [
      { type: 'html', pattern: 'wmt.digital', confidence: 'high' },
      { type: 'href', pattern: 'wmt.digital', confidence: 'high' },
      { type: 'html', pattern: 'wmtdigital', confidence: 'medium' },
    ]
  },
  {
    name: 'Presto Sports',
    patterns: [
      { type: 'html', pattern: 'prestosports', confidence: 'high' },
      { type: 'href', pattern: 'prestosports.com', confidence: 'high' },
      { type: 'script', pattern: 'presto', confidence: 'low' },
    ]
  },
  {
    name: 'Ticketmaster',
    patterns: [
      { type: 'href', pattern: 'ticketmaster.com', confidence: 'high' },
      { type: 'html', pattern: 'ticketmaster', confidence: 'medium' },
      { type: 'href', pattern: 'ticketmaster', confidence: 'medium' },
    ]
  },
  {
    name: 'Paciolan',
    patterns: [
      { type: 'href', pattern: 'paciolan.com', confidence: 'high' },
      { type: 'html', pattern: 'paciolan', confidence: 'medium' },
      { type: 'href', pattern: 'ev3.evenue.net', confidence: 'high' },
      { type: 'href', pattern: 'ev9.evenue.net', confidence: 'high' },
    ]
  },
  {
    name: 'Fevo',
    patterns: [
      { type: 'href', pattern: 'fevo.com', confidence: 'high' },
      { type: 'html', pattern: 'fevo', confidence: 'low' },
    ]
  },
  {
    name: 'Teamworks',
    patterns: [
      { type: 'html', pattern: 'teamworks', confidence: 'medium' },
      { type: 'href', pattern: 'teamworks.com', confidence: 'high' },
      { type: 'script', pattern: 'teamworksapp', confidence: 'high' },
    ]
  },
  {
    name: 'ARMS Software',
    patterns: [
      { type: 'html', pattern: 'arms software', confidence: 'high' },
      { type: 'html', pattern: 'armssoftware', confidence: 'high' },
      { type: 'href', pattern: 'armssoftware.com', confidence: 'high' },
    ]
  },
  {
    name: 'Catapult Sports',
    patterns: [
      { type: 'html', pattern: 'catapult', confidence: 'low' },
      { type: 'href', pattern: 'catapultsports.com', confidence: 'high' },
      { type: 'html', pattern: 'catapultsports', confidence: 'high' },
    ]
  },
  {
    name: 'Hudl',
    patterns: [
      { type: 'href', pattern: 'hudl.com', confidence: 'high' },
      { type: 'html', pattern: 'hudl', confidence: 'low' },
    ]
  },
  {
    name: 'Genius Sports',
    patterns: [
      { type: 'html', pattern: 'genius sports', confidence: 'high' },
      { type: 'href', pattern: 'geniussports.com', confidence: 'high' },
    ]
  },
  {
    name: 'NCAA Compliance',
    patterns: [
      { type: 'href', pattern: 'ncaacompliance', confidence: 'high' },
      { type: 'html', pattern: 'ncaa compliance', confidence: 'medium' },
    ]
  },
  {
    name: 'JumpForward',
    patterns: [
      { type: 'html', pattern: 'jumpforward', confidence: 'high' },
      { type: 'href', pattern: 'jumpforward.com', confidence: 'high' },
    ]
  },
  {
    name: 'INFLCR',
    patterns: [
      { type: 'html', pattern: 'inflcr', confidence: 'high' },
      { type: 'href', pattern: 'inflcr.com', confidence: 'high' },
    ]
  },
];

export function detectTechStack(html: string): TechDetectionResult {
  const detectedSignatures: TechDetectionResult['detectedSignatures'] = [];
  const foundTech = new Set<string>();
  const htmlLower = html.toLowerCase();

  for (const tech of TECH_SIGNATURES) {
    for (const pattern of tech.patterns) {
      const searchPattern = pattern.pattern.toLowerCase();
      
      let matched = false;
      let evidence = '';
      
      switch (pattern.type) {
        case 'html':
          if (htmlLower.includes(searchPattern)) {
            matched = true;
            const idx = htmlLower.indexOf(searchPattern);
            evidence = html.substring(Math.max(0, idx - 20), Math.min(html.length, idx + searchPattern.length + 20));
          }
          break;
        case 'href':
          const hrefRegex = new RegExp(`href\\s*=\\s*["'][^"']*${searchPattern.replace(/\./g, '\\.')}[^"']*["']`, 'i');
          const hrefMatch = html.match(hrefRegex);
          if (hrefMatch) {
            matched = true;
            evidence = hrefMatch[0];
          }
          break;
        case 'script':
          const scriptRegex = new RegExp(`<script[^>]*${searchPattern}[^>]*>`, 'i');
          const scriptMatch = html.match(scriptRegex);
          if (scriptMatch) {
            matched = true;
            evidence = scriptMatch[0];
          }
          break;
        case 'meta':
          const metaRegex = new RegExp(`<meta[^>]*${searchPattern}[^>]*>`, 'i');
          const metaMatch = html.match(metaRegex);
          if (metaMatch) {
            matched = true;
            evidence = metaMatch[0];
          }
          break;
      }
      
      if (matched && !foundTech.has(tech.name)) {
        foundTech.add(tech.name);
        detectedSignatures.push({
          technology: tech.name,
          confidence: pattern.confidence,
          evidence: evidence.substring(0, 100),
        });
        break;
      }
    }
  }

  return {
    techStack: Array.from(foundTech),
    detectedSignatures,
  };
}

export function categorizeTechStack(techStack: string[]): {
  cms: string[];
  ticketing: string[];
  operations: string[];
  analytics: string[];
  compliance: string[];
} {
  const categories = {
    cms: [] as string[],
    ticketing: [] as string[],
    operations: [] as string[],
    analytics: [] as string[],
    compliance: [] as string[],
  };

  const categoryMap: Record<string, keyof typeof categories> = {
    'Sidearm Sports': 'cms',
    'Neulion': 'cms',
    'WMT Digital': 'cms',
    'Presto Sports': 'cms',
    'Ticketmaster': 'ticketing',
    'Paciolan': 'ticketing',
    'Fevo': 'ticketing',
    'Teamworks': 'operations',
    'ARMS Software': 'operations',
    'Catapult Sports': 'analytics',
    'Hudl': 'analytics',
    'Genius Sports': 'analytics',
    'NCAA Compliance': 'compliance',
    'JumpForward': 'operations',
    'INFLCR': 'operations',
  };

  for (const tech of techStack) {
    const category = categoryMap[tech];
    if (category) {
      categories[category].push(tech);
    }
  }

  return categories;
}

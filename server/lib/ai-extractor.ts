/**
 * AI Extraction Service - Google Gemini Integration
 * 
 * Uses Gemini AI as a fallback parser when standard DOM extraction
 * produces low-confidence results. Handles edge cases like:
 * - Titles in text nodes (Oregon State)
 * - Non-standard layouts
 * - JS-rendered content
 */

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const emailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const phonePattern = /^[\d\s()+-]{7,20}$/;

const AIContactSchema = z.object({
  name: z.string().nullable().transform(v => v && v.length < 3 ? null : v),
  title: z.string().nullable().transform(v => v && v.length < 3 ? null : v),
  email: z.string().nullable().transform(v => {
    if (!v) return null;
    if (!emailPattern.test(v)) return null;
    return v.toLowerCase();
  }),
  phone: z.string().nullable().transform(v => {
    if (!v) return null;
    const digits = v.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return v;
  }),
  department: z.string().nullable().optional(),
});

type AIContactResult = z.infer<typeof AIContactSchema>;

interface AIExtractedContact {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  department?: string | null;
  aiEnhanced: boolean;
}

let genAI: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  if (!genAI) {
    genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genAI;
}

export async function extractWithAI(htmlSnippet: string): Promise<AIExtractedContact | null> {
  const ai = getGenAI();
  if (!ai) {
    console.log("[AI-Extractor] No GEMINI_API_KEY configured, skipping AI extraction");
    return null;
  }

  try {
    const truncatedHtml = htmlSnippet.substring(0, 3000);
    
    const prompt = `
Analyze this HTML snippet from a university athletic staff directory.
Extract contact information for the staff member found.

Return ONLY a valid JSON object with these exact fields (no markdown, no explanation):
{
  "name": "Full Name or null if not found",
  "title": "Job Title or null if not found",
  "email": "email@domain.edu or null if not found",
  "phone": "Phone number or null if not found",
  "department": "Department name or null if not found"
}

Important:
- For name: Look for person names in headings, aria-labels, or structured data
- For title: Look for job titles like "Head Coach", "Assistant Director", etc.
- For email: Extract from mailto: links or data-cfemail attributes
- For phone: Extract formatted phone numbers
- If a field cannot be found, return null for that field

HTML Snippet:
${truncatedHtml}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text || '';
    const jsonStr = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    
    const rawParsed = JSON.parse(jsonStr);
    
    const validationResult = AIContactSchema.safeParse(rawParsed);
    if (!validationResult.success) {
      console.error("[AI-Extractor] Schema validation failed (rejecting malformed data):", validationResult.error.message);
      return null;
    }
    
    const parsed = validationResult.data;
    
    return {
      name: parsed.name || null,
      title: parsed.title || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      department: parsed.department || null,
      aiEnhanced: true,
    };
  } catch (error: any) {
    console.error("[AI-Extractor] Extraction failed:", error.message);
    return null;
  }
}

export async function batchExtractWithAI(htmlSnippets: string[]): Promise<(AIExtractedContact | null)[]> {
  const results: (AIExtractedContact | null)[] = [];
  
  for (const snippet of htmlSnippets.slice(0, 10)) {
    const result = await extractWithAI(snippet);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}

export function isAIAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function enhanceContactWithAI(
  existingContact: {
    name: string;
    title: string;
    email: string;
    phone: string;
    confidence: { overall: number };
  },
  htmlSnippet: string,
  confidenceThreshold: number = 60
): Promise<{ enhanced: boolean; contact: typeof existingContact }> {
  if (existingContact.confidence.overall >= confidenceThreshold) {
    return { enhanced: false, contact: existingContact };
  }

  const aiResult = await extractWithAI(htmlSnippet);
  
  if (!aiResult) {
    return { enhanced: false, contact: existingContact };
  }

  const enhanced = {
    ...existingContact,
    name: existingContact.name === 'Unknown' && aiResult.name 
      ? aiResult.name 
      : existingContact.name,
    title: !existingContact.title && aiResult.title 
      ? aiResult.title 
      : existingContact.title,
    email: !existingContact.email && aiResult.email 
      ? aiResult.email 
      : existingContact.email,
    phone: !existingContact.phone && aiResult.phone 
      ? aiResult.phone 
      : existingContact.phone,
  };

  return { enhanced: true, contact: enhanced };
}

// ============================================================================
// PERSONA MAPPING - Categorize staff by buyer persona for GTM Intelligence
// ============================================================================

export type BuyerPersona = 'champion' | 'signer' | 'blocker' | 'influencer' | 'user' | 'gatekeeper';
export type FunctionalArea = 'executive' | 'operations' | 'finance' | 'external' | 'performance' | 'general';

interface PersonaMapping {
  persona: BuyerPersona;
  area: FunctionalArea;
}

const PERSONA_RULES: { keywords: string[]; persona: BuyerPersona; area: FunctionalArea; priority: number }[] = [
  { keywords: ['deputy athletic director', 'deputy ad', 'senior associate ad'], persona: 'signer', area: 'executive', priority: 110 },
  { keywords: ['associate athletic director', 'associate ad'], persona: 'champion', area: 'executive', priority: 105 },
  { keywords: ['assistant athletic director', 'assistant ad'], persona: 'champion', area: 'executive', priority: 103 },
  { keywords: ['athletic director', 'athletics director'], persona: 'signer', area: 'executive', priority: 100 },
  { keywords: ['cfo', 'chief financial', 'vp finance', 'vp of finance'], persona: 'blocker', area: 'finance', priority: 95 },
  { keywords: ['business operations', 'business manager', 'finance director'], persona: 'blocker', area: 'finance', priority: 80 },
  { keywords: ['budget', 'accounting', 'controller', 'fiscal'], persona: 'blocker', area: 'finance', priority: 75 },
  { keywords: ['director of operations', 'operations director'], persona: 'champion', area: 'operations', priority: 90 },
  { keywords: ['director of marketing', 'marketing director'], persona: 'champion', area: 'external', priority: 88 },
  { keywords: ['operations manager', 'ops manager', 'equipment manager'], persona: 'champion', area: 'operations', priority: 85 },
  { keywords: ['facilities', 'operations coordinator', 'ops coordinator'], persona: 'champion', area: 'operations', priority: 80 },
  { keywords: ['events', 'game day', 'scheduling'], persona: 'champion', area: 'operations', priority: 75 },
  { keywords: ['head coach', 'head football', 'head basketball', 'head baseball', 'head volleyball', 'head soccer', 'head softball', 'head tennis', 'head golf', 'head swim', 'head track', 'head wrestling', 'head lacrosse', 'head hockey'], persona: 'champion', area: 'performance', priority: 85 },
  { keywords: ['strength', 'conditioning', 's&c'], persona: 'user', area: 'performance', priority: 70 },
  { keywords: ['sports medicine', 'athletic training', 'athletic trainer', 'sports science'], persona: 'user', area: 'performance', priority: 65 },
  { keywords: ['nutrition', 'sports psycholog', 'mental performance'], persona: 'user', area: 'performance', priority: 60 },
  { keywords: ['marketing', 'communications', 'media relations', 'sid ', 'sports information'], persona: 'influencer', area: 'external', priority: 75 },
  { keywords: ['ticket', 'ticketing', 'box office'], persona: 'influencer', area: 'external', priority: 70 },
  { keywords: ['development', 'fundraising', 'donor', 'major gifts'], persona: 'influencer', area: 'external', priority: 70 },
  { keywords: ['compliance', 'eligibility', 'ncaa compliance'], persona: 'blocker', area: 'operations', priority: 85 },
  { keywords: ['technology', 'it director', 'information technology'], persona: 'blocker', area: 'operations', priority: 80 },
  { keywords: ['administrative assistant', 'admin assistant', 'executive assistant', 'office manager', 'receptionist'], persona: 'gatekeeper', area: 'general', priority: 65 },
  { keywords: ['video', 'analytics', 'data analyst'], persona: 'user', area: 'performance', priority: 55 },
  { keywords: ['intern', 'graduate assistant', 'student assistant'], persona: 'user', area: 'general', priority: 10 },
  { keywords: ['assistant coach', 'associate coach'], persona: 'user', area: 'performance', priority: 40 },
  { keywords: ['coordinator'], persona: 'influencer', area: 'external', priority: 50 },
];

export function categorizePersona(title: string | null | undefined): PersonaMapping {
  if (!title) {
    return { persona: 'user', area: 'general' };
  }

  const t = title.toLowerCase().trim();
  
  let bestMatch: PersonaMapping | null = null;
  let bestPriority = -1;

  for (const rule of PERSONA_RULES) {
    for (const keyword of rule.keywords) {
      if (t.includes(keyword)) {
        if (rule.priority > bestPriority) {
          bestPriority = rule.priority;
          bestMatch = { persona: rule.persona, area: rule.area };
        }
        break;
      }
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  return { persona: 'user', area: 'general' };
}

export async function categorizePersonaWithAI(title: string): Promise<PersonaMapping> {
  const heuristic = categorizePersona(title);
  if (heuristic.persona !== 'user' || heuristic.area !== 'general') {
    return heuristic;
  }

  const ai = getGenAI();
  if (!ai) {
    return heuristic;
  }

  try {
    const prompt = `
Categorize this athletic department job title into a buyer persona for B2B sales.

Title: "${title}"

Return ONLY a JSON object (no markdown):
{
  "persona": "champion" | "signer" | "blocker" | "influencer" | "user",
  "area": "executive" | "operations" | "finance" | "external" | "performance" | "general"
}

Persona definitions:
- signer: Final decision makers (AD, Deputy AD)
- champion: Operational leaders who drive purchases (Ops Directors, Facilities)
- blocker: Budget/compliance gatekeepers (Finance, CFO, Compliance)
- influencer: Stakeholders who influence decisions (Marketing, Development, Coaches)
- user: End users with limited buying power (Assistants, Interns)

Area definitions:
- executive: C-suite, AD office
- operations: Facilities, equipment, logistics, IT, compliance
- finance: Budget, accounting, business operations
- external: Marketing, ticketing, development, communications
- performance: Coaches, S&C, sports medicine, analytics
- general: Administrative, support roles
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text || '';
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      persona: parsed.persona || 'user',
      area: parsed.area || 'general',
    };
  } catch (error: any) {
    console.error("[AI-Extractor] Persona categorization failed:", error.message);
    return heuristic;
  }
}

export function getBuyingWindowStatus(): 'open' | 'closed' | 'planning' {
  const month = new Date().getMonth() + 1;
  
  if (month >= 4 && month <= 6) {
    return 'open';
  }
  if (month >= 2 && month <= 3) {
    return 'planning';
  }
  return 'closed';
}

// ============================================================================
// DEPARTMENT TAG CLASSIFICATION - Categorize staff by sport/department
// Inspired by Discolike's keyword-based industry classification
// ============================================================================

export type DepartmentTag = 
  | 'Football'
  | 'Basketball'
  | 'Baseball'
  | 'Softball'
  | 'Soccer'
  | 'Volleyball'
  | 'Tennis'
  | 'Golf'
  | 'Swimming'
  | 'Track & Field'
  | 'Wrestling'
  | 'Lacrosse'
  | 'Hockey'
  | 'Gymnastics'
  | 'Olympic Sports'
  | 'Administration'
  | 'Operations'
  | 'Marketing'
  | 'Sports Medicine'
  | 'Strength & Conditioning'
  | 'Compliance'
  | 'Academics'
  | 'Development'
  | 'Communications'
  | 'Ticketing'
  | 'Facilities';

const DEPARTMENT_TAG_RULES: { keywords: string[]; tag: DepartmentTag }[] = [
  { keywords: ['football', 'fb ops'], tag: 'Football' },
  { keywords: ['basketball', 'hoops', 'mbb', 'wbb', 'mens basketball', 'womens basketball'], tag: 'Basketball' },
  { keywords: ['baseball', 'bb ops'], tag: 'Baseball' },
  { keywords: ['softball', 'sb ops'], tag: 'Softball' },
  { keywords: ['soccer', 'futbol'], tag: 'Soccer' },
  { keywords: ['volleyball', 'vb ops'], tag: 'Volleyball' },
  { keywords: ['tennis'], tag: 'Tennis' },
  { keywords: ['golf'], tag: 'Golf' },
  { keywords: ['swim', 'diving', 'aquatics'], tag: 'Swimming' },
  { keywords: ['track', 'field', 'cross country', 'xc'], tag: 'Track & Field' },
  { keywords: ['wrestling'], tag: 'Wrestling' },
  { keywords: ['lacrosse', 'lax'], tag: 'Lacrosse' },
  { keywords: ['hockey', 'ice hockey'], tag: 'Hockey' },
  { keywords: ['gymnastics', 'gym ops'], tag: 'Gymnastics' },
  { keywords: ['olympic sports', 'olympic sport'], tag: 'Olympic Sports' },
  { keywords: ['athletic director', 'deputy ad', 'associate ad', 'assistant ad', 'administration', 'executive'], tag: 'Administration' },
  { keywords: ['operations', 'ops manager', 'facilities manager', 'equipment'], tag: 'Operations' },
  { keywords: ['marketing', 'promotions', 'brand', 'digital'], tag: 'Marketing' },
  { keywords: ['sports medicine', 'athletic training', 'trainer', 'sports science', 'nutrition', 'psychology'], tag: 'Sports Medicine' },
  { keywords: ['strength', 'conditioning', 's&c', 'performance'], tag: 'Strength & Conditioning' },
  { keywords: ['compliance', 'eligibility', 'ncaa compliance', 'rules'], tag: 'Compliance' },
  { keywords: ['academic', 'student-athlete', 'tutoring', 'learning'], tag: 'Academics' },
  { keywords: ['development', 'fundraising', 'donor', 'gifts', 'advancement'], tag: 'Development' },
  { keywords: ['communications', 'media relations', 'sid', 'sports information', 'public relations', 'pr'], tag: 'Communications' },
  { keywords: ['ticket', 'ticketing', 'box office', 'sales'], tag: 'Ticketing' },
  { keywords: ['facilities', 'venue', 'stadium', 'arena', 'turf', 'grounds'], tag: 'Facilities' },
];

export function classifyDepartmentTags(
  title: string | null | undefined,
  department: string | null | undefined
): DepartmentTag[] {
  const tags: Set<DepartmentTag> = new Set();
  
  const combined = `${title || ''} ${department || ''}`.toLowerCase().trim();
  
  if (!combined) {
    return [];
  }
  
  for (const rule of DEPARTMENT_TAG_RULES) {
    for (const keyword of rule.keywords) {
      if (combined.includes(keyword)) {
        tags.add(rule.tag);
        break;
      }
    }
  }
  
  return Array.from(tags);
}

export async function classifyDepartmentTagsWithAI(
  title: string | null,
  department: string | null
): Promise<DepartmentTag[]> {
  const heuristicTags = classifyDepartmentTags(title, department);
  if (heuristicTags.length > 0) {
    return heuristicTags;
  }

  const ai = getGenAI();
  if (!ai) {
    return [];
  }

  const input = `${title || ''} ${department || ''}`.trim();
  if (!input) {
    return [];
  }

  try {
    const prompt = `
Classify this athletic department staff member into one or more department categories.

Title/Department: "${input}"

Return ONLY a JSON array of applicable tags (no markdown):
["tag1", "tag2"]

Available tags:
Football, Basketball, Baseball, Softball, Soccer, Volleyball, Tennis, Golf, Swimming, 
Track & Field, Wrestling, Lacrosse, Hockey, Gymnastics, Olympic Sports, Administration, 
Operations, Marketing, Sports Medicine, Strength & Conditioning, Compliance, Academics, 
Development, Communications, Ticketing, Facilities

Return an empty array [] if no tags apply.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text || '';
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is DepartmentTag => 
        typeof t === 'string' && DEPARTMENT_TAG_RULES.some(r => r.tag === t)
      );
    }

    return [];
  } catch (error: any) {
    console.error("[AI-Extractor] Department classification failed:", error.message);
    return [];
  }
}

/**
 * Infer a missing email address using the school's confirmed email patterns.
 *
 * Looks at existing staff emails from the same school, detects the pattern
 * (first.last, flast, firstl, etc.), then applies it to the target name.
 * Returns null if pattern is ambiguous or GEMINI_API_KEY is not set.
 * The caller should store the result with emailConfidence = 'inferred'.
 */
export async function inferEmailFromPattern(
  name: string,
  schoolId: string,
  confirmedEmails: string[], // other staff emails from same school
): Promise<string | null> {
  const ai = getGenAI();
  if (!ai || !confirmedEmails.length || !name) return null;

  // Only use emails from the same domain (filter out personal/non-edu)
  const eduEmails = confirmedEmails.filter((e) => e.includes("@") && e.split("@")[1]?.includes(".edu"));
  if (eduEmails.length < 2) return null; // not enough signal

  const prompt = `You are helping infer a missing work email address.

These are confirmed email addresses from staff at the same university:
${eduEmails.slice(0, 10).join("\n")}

The person whose email is unknown is: ${name}

1. Detect the email pattern (e.g., first.last@domain.edu, flast@domain.edu, first@domain.edu, etc.)
2. Apply the pattern to the person's name
3. Return ONLY the inferred email address. No explanation. No markdown.

If the pattern is unclear or you are not confident, return exactly: null`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    const text = (response.text ?? "").trim().toLowerCase();
    if (text === "null" || !text.includes("@")) return null;
    // Basic validation
    if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

import fuzzysort from 'fuzzysort';
import { seedSchools } from "../../shared/ncaa-seed-data";

interface SchoolSearchItem {
  id: string;
  name: string;
  full: string;
  searchStr: string;
  division?: string;
  conference?: string;
}

const searchIndex: SchoolSearchItem[] = seedSchools.map(s => ({
  id: s.schoolId,
  name: s.schoolName,
  full: s.schoolFullName,
  division: s.division,
  conference: s.conference,
  searchStr: `${s.schoolName} ${s.schoolFullName} ${s.schoolId}`
}));

// In-memory alias cache (loaded from DB on startup)
let aliasCache: Map<string, string> = new Map();

export function loadAliases(aliases: Array<{ alias: string; schoolId: string }>) {
  aliasCache = new Map(aliases.map(a => [a.alias.toLowerCase().trim(), a.schoolId]));
}

export function addAlias(alias: string, schoolId: string) {
  aliasCache.set(alias.toLowerCase().trim(), schoolId);
}

export interface MatchResult {
  id: string;
  name: string;
  fullName: string;
  score: number;
  division?: string;
  conference?: string;
}

export interface MatchResultWithAlternatives extends MatchResult {
  isAmbiguous: boolean;
  alternatives: MatchResult[];
}

// Confidence thresholds for ambiguous detection
// fuzzysort scores are negative (closer to 0 is better)
// HIGH_CONFIDENCE means a strong clear match (close to 0)
const HIGH_CONFIDENCE_THRESHOLD = -1500;  // Scores worse than -1500 are likely ambiguous
const AMBIGUOUS_GAP_THRESHOLD = 300;      // If top 2 matches are within 300 points, it's ambiguous

// Known ambiguous base names - only trigger when input is EXACTLY this short name
// Longer/more specific names like "University of Miami" or "Miami Florida" should match directly
const KNOWN_AMBIGUOUS_SHORT_NAMES = new Set(['miami', 'washington', 'georgia', 'indiana', 'louisiana']);

export function matchSchool(rawName: string): MatchResult | null {
  // First check alias cache
  const normalizedInput = rawName.toLowerCase().trim();
  const aliasSchoolId = aliasCache.get(normalizedInput);
  
  if (aliasSchoolId) {
    const school = searchIndex.find(s => s.id === aliasSchoolId);
    if (school) {
      return {
        id: school.id,
        name: school.name,
        fullName: school.full,
        score: 0, // Perfect match via alias
        division: school.division,
        conference: school.conference
      };
    }
  }

  const results = fuzzysort.go(rawName, searchIndex, {
    key: 'searchStr',
    limit: 1,
    threshold: -10000
  });

  if (results.length > 0) {
    const match = results[0];
    return {
      id: match.obj.id,
      name: match.obj.name,
      fullName: match.obj.full,
      score: match.score,
      division: match.obj.division,
      conference: match.obj.conference
    };
  }
  return null;
}

export function matchSchoolWithAlternatives(rawName: string): MatchResultWithAlternatives | null {
  // First check alias cache
  const normalizedInput = rawName.toLowerCase().trim();
  const aliasSchoolId = aliasCache.get(normalizedInput);
  
  if (aliasSchoolId) {
    const school = searchIndex.find(s => s.id === aliasSchoolId);
    if (school) {
      return {
        id: school.id,
        name: school.name,
        fullName: school.full,
        score: 0,
        division: school.division,
        conference: school.conference,
        isAmbiguous: false,
        alternatives: []
      };
    }
  }

  const results = fuzzysort.go(rawName, searchIndex, {
    key: 'searchStr',
    limit: 5,
    threshold: -10000
  });

  if (results.length === 0) return null;

  const topMatch = results[0];
  const alternatives: MatchResult[] = [];
  let isAmbiguous = false;

  // Check for known ambiguous short names (e.g., just "Miami" which could be Miami FL or Miami OH)
  // Only trigger for exact short names - "University of Miami" or "Miami FL" should match directly
  if (KNOWN_AMBIGUOUS_SHORT_NAMES.has(normalizedInput)) {
    isAmbiguous = true;
    // Add all reasonable alternatives
    for (let i = 1; i < Math.min(4, results.length); i++) {
      const alt = results[i];
      // Only include if reasonably close in score to top match
      if (Math.abs(topMatch.score - alt.score) < 1000) {
        alternatives.push({
          id: alt.obj.id,
          name: alt.obj.name,
          fullName: alt.obj.full,
          score: alt.score,
          division: alt.obj.division,
          conference: alt.obj.conference
        });
      }
    }
  } 
  // Check if top matches are close in score (ambiguous)
  else if (results.length > 1) {
    const scoreDiff = Math.abs(topMatch.score - results[1].score);
    if (scoreDiff < AMBIGUOUS_GAP_THRESHOLD && topMatch.score < HIGH_CONFIDENCE_THRESHOLD) {
      isAmbiguous = true;
      // Get top 3 alternatives excluding the first one
      for (let i = 1; i < Math.min(4, results.length); i++) {
        const alt = results[i];
        alternatives.push({
          id: alt.obj.id,
          name: alt.obj.name,
          fullName: alt.obj.full,
          score: alt.score,
          division: alt.obj.division,
          conference: alt.obj.conference
        });
      }
    }
  }

  return {
    id: topMatch.obj.id,
    name: topMatch.obj.name,
    fullName: topMatch.obj.full,
    score: topMatch.score,
    division: topMatch.obj.division,
    conference: topMatch.obj.conference,
    isAmbiguous,
    alternatives
  };
}

export function matchSchoolsBulk(rawNames: string[]): Array<{
  rawName: string;
  matched: boolean;
  schoolId: string | null;
  schoolName: string | null;
  fullName: string | null;
  score: number | null;
  division: string | null;
  conference: string | null;
}> {
  return rawNames.map(name => {
    const match = matchSchool(name);
    return {
      rawName: name,
      matched: !!match,
      schoolId: match?.id || null,
      schoolName: match?.name || null,
      fullName: match?.fullName || null,
      score: match?.score || null,
      division: match?.division || null,
      conference: match?.conference || null
    };
  });
}

export interface BatchMatchResult {
  rawName: string;
  matched: boolean;
  schoolId: string | null;
  schoolName: string | null;
  fullName: string | null;
  score: number | null;
  division: string | null;
  conference: string | null;
  isAmbiguous: boolean;
  alternatives: Array<{
    id: string;
    name: string;
    fullName: string;
    score: number;
    division?: string;
    conference?: string;
  }>;
}

export async function matchSchoolsBatch(rawNames: string[]): Promise<BatchMatchResult[]> {
  const results: BatchMatchResult[] = [];
  
  for (let i = 0; i < rawNames.length; i++) {
    const name = rawNames[i];
    const match = matchSchoolWithAlternatives(name);
    
    results.push({
      rawName: name,
      matched: !!match,
      schoolId: match?.id || null,
      schoolName: match?.name || null,
      fullName: match?.fullName || null,
      score: match?.score || null,
      division: match?.division || null,
      conference: match?.conference || null,
      isAmbiguous: match?.isAmbiguous || false,
      alternatives: match?.alternatives || []
    });

    // Yield to event loop every 10 items to keep server responsive
    if (i > 0 && i % 10 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  return results;
}

export function getSchoolById(schoolId: string): MatchResult | null {
  const school = searchIndex.find(s => s.id === schoolId);
  if (!school) return null;
  return {
    id: school.id,
    name: school.name,
    fullName: school.full,
    score: 0,
    division: school.division,
    conference: school.conference
  };
}

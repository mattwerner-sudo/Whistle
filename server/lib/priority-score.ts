import { SchoolDirectory } from "@shared/schema";
import { getConferenceTier, getDaysSinceExtraction, getMaxStaleDays } from "./data-health";

export interface PriorityScoreComponents {
  tierScore: number;        // 0-40 points based on conference tier
  staffScore: number;       // 0-30 points based on staff count
  freshnessScore: number;   // 0-30 points based on data recency
  totalScore: number;       // 0-100 combined score
  confidence: number;       // 0-1 confidence in the score
}

export function computePriorityScore(school: SchoolDirectory): PriorityScoreComponents {
  let tierScore = 0;
  let staffScore = 0;
  let freshnessScore = 0;
  let confidenceFactors: number[] = [];

  const tier = getConferenceTier(school.conference);
  switch (tier) {
    case "power5":
      tierScore = 40;
      break;
    case "midTier":
      tierScore = 25;
      break;
    case "other":
      tierScore = 10;
      break;
  }
  confidenceFactors.push(school.conference ? 1.0 : 0.5);

  const staffCount = school.contactsCount || 0;
  if (staffCount >= 100) {
    staffScore = 30;
  } else if (staffCount >= 50) {
    staffScore = 25;
  } else if (staffCount >= 25) {
    staffScore = 20;
  } else if (staffCount >= 10) {
    staffScore = 15;
  } else if (staffCount >= 5) {
    staffScore = 10;
  } else if (staffCount > 0) {
    staffScore = 5;
  }
  confidenceFactors.push(staffCount > 0 ? 1.0 : 0.3);

  if (school.status === "success" && school.lastExtractedAt) {
    const daysSince = getDaysSinceExtraction(school);
    const maxDays = getMaxStaleDays(school.conference);
    
    if (daysSince !== null) {
      const freshnessRatio = Math.max(0, 1 - (daysSince / maxDays));
      freshnessScore = Math.round(freshnessRatio * 30);
      confidenceFactors.push(freshnessRatio > 0.5 ? 1.0 : freshnessRatio + 0.3);
    }
  }
  confidenceFactors.push(school.status === "success" ? 1.0 : 0.4);

  const totalScore = tierScore + staffScore + freshnessScore;
  const confidence = confidenceFactors.length > 0
    ? confidenceFactors.reduce((a, b) => a + b, 0) / confidenceFactors.length
    : 0.5;

  return {
    tierScore,
    staffScore,
    freshnessScore,
    totalScore,
    confidence: Math.round(confidence * 100) / 100,
  };
}

export function formatScoreWithConfidence(score: number, confidence: number): string {
  return `${score}:${confidence.toFixed(2)}`;
}

export function parseScoreWithConfidence(scoreString: string): { score: number; confidence: number } | null {
  const parts = scoreString.split(":");
  if (parts.length !== 2) return null;
  
  const score = parseInt(parts[0], 10);
  const confidence = parseFloat(parts[1]);
  
  if (isNaN(score) || isNaN(confidence)) return null;
  
  return { score, confidence };
}

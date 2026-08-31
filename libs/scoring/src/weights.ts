/**
 * Versioned scoring weights (ADR-0007). This module is deliberately free of any UI
 * concern. Changing a weight is a reviewed change: bump WEIGHTS_VERSION and expect
 * snapshot tests to churn.
 */
export const WEIGHTS_VERSION = 1;

export type WeightMap = Readonly<Record<string, number>>;

export const REPOSITORY_MATCH_WEIGHTS: WeightMap = {
  skill: 0.4,
  technology: 0.25,
  experience: 0.15,
  activity: 0.1,
  learning: 0.1,
};

export const ISSUE_MATCH_WEIGHTS: WeightMap = {
  skill: 0.35,
  difficultyFit: 0.3,
  repositoryMatch: 0.2,
  scopeClarity: 0.1,
  mentorship: 0.05,
};

export const CONTRIBUTION_CONFIDENCE_WEIGHTS: WeightMap = {
  skillMatch: 0.35,
  difficultyFit: 0.25,
  repositoryHealth: 0.2,
  newcomerFriendliness: 0.15,
  priorContributions: 0.05,
};

export const HEALTH_WEIGHTS: WeightMap = {
  commitActivity: 0.25,
  maintainerActivity: 0.2,
  issueResponsiveness: 0.2,
  prThroughput: 0.15,
  contributorBase: 0.1,
  documentation: 0.1,
};

/** Presets let a user bias discovery without touching code (ADR-0007). */
export type WeightPreset = 'balanced' | 'learning' | 'quick-win';

export function repositoryWeightsFor(preset: WeightPreset): WeightMap {
  switch (preset) {
    case 'learning':
      return {
        skill: 0.25,
        technology: 0.2,
        experience: 0.1,
        activity: 0.1,
        learning: 0.35,
      };
    case 'quick-win':
      return {
        skill: 0.45,
        technology: 0.3,
        experience: 0.15,
        activity: 0.1,
        learning: 0,
      };
    case 'balanced':
    default:
      return REPOSITORY_MATCH_WEIGHTS;
  }
}

/** Label thresholds for the "High / Medium / Low" style summaries (ADR-0008). */
export const LABEL_THRESHOLDS = { high: 0.75, medium: 0.45 } as const;

export function label(score01: number): 'High' | 'Medium' | 'Low' {
  if (score01 >= LABEL_THRESHOLDS.high) return 'High';
  if (score01 >= LABEL_THRESHOLDS.medium) return 'Medium';
  return 'Low';
}

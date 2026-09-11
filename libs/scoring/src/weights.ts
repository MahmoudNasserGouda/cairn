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

/**
 * Contribution readiness (ADR-0007). Scored against the merged profile alone — there
 * is no target repository, so it is meaningful before any discovery has happened.
 */
export const READINESS_WEIGHTS: WeightMap = {
  skillDepth: 0.25,
  skillBreadth: 0.2,
  experience: 0.2,
  track: 0.2,
  completeness: 0.15,
};

export const HEALTH_WEIGHTS: WeightMap = {
  commitActivity: 0.25,
  maintainerActivity: 0.2,
  issueResponsiveness: 0.2,
  prThroughput: 0.15,
  contributorBase: 0.1,
  documentation: 0.1,
};

/**
 * Repository *discovery* (ADR-0007, ADR-0027). Distinct from `REPOSITORY_MATCH_WEIGHTS`
 * because the two answer different questions off different data: match scores a repo
 * the user already chose, using the full per-repo analysis; discovery ranks dozens of
 * candidates from search-result fields alone, so it leans on what a search response
 * actually carries — declared stack, push recency, star band, good-first-issue
 * provenance — and never on the health engine.
 */
export const DISCOVERY_WEIGHTS: WeightMap = {
  skillFit: 0.3,
  technologyFit: 0.2,
  newcomerSignal: 0.2,
  activity: 0.15,
  approachability: 0.1,
  learning: 0.05,
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

/**
 * The same three presets, applied to discovery. `learning` tolerates an unfamiliar
 * stack and stops rewarding what the user already knows; `quick-win` does the
 * opposite and leans hard on newcomer signals.
 */
export function discoveryWeightsFor(preset: WeightPreset): WeightMap {
  switch (preset) {
    case 'learning':
      return {
        skillFit: 0.15,
        technologyFit: 0.1,
        newcomerSignal: 0.2,
        activity: 0.15,
        approachability: 0.1,
        learning: 0.3,
      };
    case 'quick-win':
      return {
        skillFit: 0.35,
        technologyFit: 0.2,
        newcomerSignal: 0.25,
        activity: 0.15,
        approachability: 0.05,
        learning: 0,
      };
    case 'balanced':
    default:
      return DISCOVERY_WEIGHTS;
  }
}

/** Label thresholds for the "High / Medium / Low" style summaries (ADR-0008). */
export const LABEL_THRESHOLDS = { high: 0.75, medium: 0.45 } as const;

export function label(score01: number): 'High' | 'Medium' | 'Low' {
  if (score01 >= LABEL_THRESHOLDS.high) return 'High';
  if (score01 >= LABEL_THRESHOLDS.medium) return 'Medium';
  return 'Low';
}

import { clamp01, normalize, roundTo } from '@cairn/shared';
import {
  weightedScore,
  HEALTH_WEIGHTS,
  label,
  type ScoreBreakdown,
} from '@cairn/scoring';

/**
 * Raw, already-windowed signals about a repository. The caller (@cairn/github) is
 * responsible for turning API responses into these numbers so that this module
 * stays pure and clock-free (ADR-0008).
 */
export interface HealthSignals {
  readonly commitsLast30d: number;
  readonly daysSinceLastCommit: number;
  readonly activeMaintainersLast90d: number;
  readonly medianIssueResponseHours: number;
  readonly issueCloseRatioLast90d: number; // closed / (closed + opened)
  readonly medianPrReviewHours: number;
  readonly mergedPrRatioLast90d: number;
  readonly contributorCount: number;
  readonly busFactor: number;
  readonly hasReadme: boolean;
  readonly hasContributing: boolean;
  readonly hasCodeOfConduct: boolean;
  readonly hasDocsFolder: boolean;
  readonly openGoodFirstIssues: number;
}

export interface HealthReport {
  readonly score: ScoreBreakdown;
  /** 0-100 for the "Health Score: 92" headline. */
  readonly headline: number;
  readonly activity: 'High' | 'Medium' | 'Low';
  readonly maintenance: 'High' | 'Medium' | 'Low';
  readonly documentation: 'High' | 'Medium' | 'Low';
  readonly newContributorSupport: 'High' | 'Medium' | 'Low';
}

function commitActivity(s: HealthSignals): number {
  const freq = normalize(s.commitsLast30d, 0, 60);
  const recency = 1 - normalize(s.daysSinceLastCommit, 0, 90);
  return clamp01(0.6 * freq + 0.4 * recency);
}

function maintainerActivity(s: HealthSignals): number {
  return normalize(s.activeMaintainersLast90d, 0, 4);
}

function issueResponsiveness(s: HealthSignals): number {
  const speed = 1 - normalize(s.medianIssueResponseHours, 2, 24 * 14);
  return clamp01(0.6 * speed + 0.4 * clamp01(s.issueCloseRatioLast90d));
}

function prThroughput(s: HealthSignals): number {
  const speed = 1 - normalize(s.medianPrReviewHours, 4, 24 * 21);
  return clamp01(0.5 * speed + 0.5 * clamp01(s.mergedPrRatioLast90d));
}

function contributorBase(s: HealthSignals): number {
  return clamp01(
    0.6 * normalize(s.contributorCount, 1, 50) + 0.4 * normalize(s.busFactor, 1, 5),
  );
}

function documentation(s: HealthSignals): number {
  return clamp01(
    (Number(s.hasReadme) * 0.4 +
      Number(s.hasContributing) * 0.3 +
      Number(s.hasCodeOfConduct) * 0.1 +
      Number(s.hasDocsFolder) * 0.2) *
      1,
  );
}

export function newcomerFriendliness(s: HealthSignals): number {
  return clamp01(
    0.5 * normalize(s.openGoodFirstIssues, 0, 15) +
      0.3 * Number(s.hasContributing) +
      0.2 * issueResponsiveness(s),
  );
}

/** Deterministic, AI-free repository health (ADR-0008). */
export function healthScore(s: HealthSignals): HealthReport {
  const commit = commitActivity(s);
  const maint = maintainerActivity(s);
  const issues = issueResponsiveness(s);
  const prs = prThroughput(s);
  const contrib = contributorBase(s);
  const docs = documentation(s);

  const score = weightedScore(
    {
      commitActivity: commit,
      maintainerActivity: maint,
      issueResponsiveness: issues,
      prThroughput: prs,
      contributorBase: contrib,
      documentation: docs,
    },
    HEALTH_WEIGHTS,
  );

  return {
    score,
    headline: score.percent,
    activity: label(roundTo(0.5 * commit + 0.5 * prs, 4)),
    maintenance: label(roundTo(0.5 * maint + 0.5 * issues, 4)),
    documentation: label(docs),
    newContributorSupport: label(newcomerFriendliness(s)),
  };
}

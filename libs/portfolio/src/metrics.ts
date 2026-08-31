import { weightedScore, label, type ScoreBreakdown } from '@osc/scoring';
import { clamp01, normalize } from '@osc/shared';

export interface Contribution {
  readonly repo: string;
  readonly title: string;
  readonly url: string;
  readonly mergedYear: number;
  readonly mergedMonth: number; // 1-12
  readonly additions: number;
  readonly deletions: number;
  readonly repoStars: number;
}

export interface PortfolioMetrics {
  readonly contribution: ScoreBreakdown;
  readonly consistency: ScoreBreakdown;
  readonly impact: ScoreBreakdown;
  readonly community: ScoreBreakdown;
  readonly headline: {
    contribution: number;
    consistency: number;
    impact: number;
    community: number;
  };
}

/** Deterministic portfolio metrics (Phase 5). Pure — caller supplies the data. */
export function computeMetrics(contributions: readonly Contribution[]): PortfolioMetrics {
  const count = contributions.length;
  const repos = new Set(contributions.map((c) => c.repo));
  const months = new Set(contributions.map((c) => `${c.mergedYear}-${c.mergedMonth}`));
  const spanMonths = monthSpan(contributions);
  const totalLines = contributions.reduce((s, c) => s + c.additions + c.deletions, 0);
  const maxStars = contributions.reduce((m, c) => Math.max(m, c.repoStars), 0);

  const contribution = weightedScore(
    {
      volume: normalize(count, 0, 40),
      breadth: normalize(repos.size, 0, 15),
      substance: normalize(totalLines, 0, 5000),
    },
    { volume: 0.5, breadth: 0.3, substance: 0.2 },
  );

  const consistency = weightedScore(
    {
      activeMonths: spanMonths > 0 ? clamp01(months.size / spanMonths) : 0,
      recency: recencyScore(contributions),
      cadence: normalize(months.size, 0, 18),
    },
    { activeMonths: 0.5, recency: 0.3, cadence: 0.2 },
  );

  const impact = weightedScore(
    {
      reach: normalize(Math.log10(maxStars + 1), 0, 5),
      depth: normalize(totalLines / Math.max(count, 1), 0, 400),
    },
    { reach: 0.6, depth: 0.4 },
  );

  const community = weightedScore(
    {
      projectsHelped: normalize(repos.size, 0, 12),
      sustained: months.size >= 3 ? 1 : months.size / 3,
    },
    { projectsHelped: 0.6, sustained: 0.4 },
  );

  return {
    contribution,
    consistency,
    impact,
    community,
    headline: {
      contribution: contribution.percent,
      consistency: consistency.percent,
      impact: impact.percent,
      community: community.percent,
    },
  };
}

export function metricLabel(score01: number): 'High' | 'Medium' | 'Low' {
  return label(score01);
}

function monthSpan(contributions: readonly Contribution[]): number {
  if (contributions.length === 0) return 0;
  const idx = contributions.map((c) => c.mergedYear * 12 + c.mergedMonth);
  return Math.max(...idx) - Math.min(...idx) + 1;
}

function recencyScore(contributions: readonly Contribution[]): number {
  if (contributions.length === 0) return 0;
  const latest = Math.max(...contributions.map((c) => c.mergedYear * 12 + c.mergedMonth));
  const newest = Math.max(...contributions.map((c) => c.mergedYear * 12 + c.mergedMonth));
  // Relative to the most recent contribution in the set (clock-free).
  return latest === newest ? 1 : 0.5;
}

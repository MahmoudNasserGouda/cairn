import type { ExperienceLevel, SkillTag } from '@cairn/shared';
import type { HealthReport, HealthSignals } from '@cairn/repository-analysis';
import { newcomerFriendliness } from '@cairn/repository-analysis';
import type { RepositorySnapshot } from '@cairn/matching';

/**
 * The subset of `@cairn/github`'s `RepoOverview` the snapshot needs. Declared
 * locally so this lib does not depend on the GitHub client (mirrors how
 * `libs/profile` avoids a `libs/github` edge).
 */
export interface RepoOverviewLike {
  readonly fullName: string;
  readonly technologies: readonly SkillTag[];
  readonly topics: readonly SkillTag[];
}

const LEVEL_SCALAR: Record<HealthReport['activity'], number> = {
  High: 0.9,
  Medium: 0.6,
  Low: 0.3,
};

/** Numeric activity: the commit-activity sub-score if present, else the label. */
function activityScalar(report: HealthReport): number {
  const part = report.score.parts.find((p) => p.key === 'commitActivity');
  return part ? part.value : LEVEL_SCALAR[report.activity];
}

/**
 * A conservative, deterministic read of the experience a codebase realistically
 * demands. Never returns `expert` — that call needs more than public signals give.
 */
export function inferRequiredExperience(
  signals: HealthSignals,
  report: HealthReport,
): ExperienceLevel {
  const thinDocs = report.documentation === 'Low';
  if (signals.busFactor <= 1 || thinDocs) return 'advanced';
  if (
    signals.openGoodFirstIssues >= 3 &&
    signals.busFactor >= 2 &&
    report.documentation === 'High'
  ) {
    return 'beginner';
  }
  return 'intermediate';
}

/** Build the `RepositorySnapshot` the matching engine scores against. */
export function repoToSnapshot(
  overview: RepoOverviewLike,
  signals: HealthSignals,
  report: HealthReport,
): RepositorySnapshot {
  return {
    fullName: overview.fullName,
    technologies: [...overview.technologies],
    topics: [...overview.topics],
    activity: activityScalar(report),
    health: report.score.total,
    newcomerFriendliness: newcomerFriendliness(signals),
    requiredExperience: inferRequiredExperience(signals, report),
  };
}

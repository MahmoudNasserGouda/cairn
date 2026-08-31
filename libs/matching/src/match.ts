import {
  weightedScore,
  type ScoreBreakdown,
  REPOSITORY_MATCH_WEIGHTS,
  ISSUE_MATCH_WEIGHTS,
  CONTRIBUTION_CONFIDENCE_WEIGHTS,
  repositoryWeightsFor,
  type WeightMap,
  type WeightPreset,
} from '@cairn/scoring';
import { DIFFICULTY_RANK, EXPERIENCE_RANK, type SkillTag } from '@cairn/shared';
import type { DeveloperSnapshot, RepositorySnapshot, IssueSnapshot } from './model';
import {
  experienceFit,
  jaccard,
  learningValue,
  missingSkills,
  skillCoverage,
} from './primitives';

export interface RepositoryMatchOptions {
  readonly preset?: WeightPreset;
  readonly weights?: WeightMap;
}

export function repositoryMatch(
  dev: DeveloperSnapshot,
  repo: RepositorySnapshot,
  opts: RepositoryMatchOptions = {},
): ScoreBreakdown {
  const weights = opts.weights ?? repositoryWeightsFor(opts.preset ?? 'balanced');
  const devTags = dev.skills.map((s) => s.tag);
  return weightedScore(
    {
      skill: {
        value: skillCoverage(dev, repo.technologies),
        note: `covers ${repo.technologies.length - missingSkills(dev, repo.technologies).length}/${repo.technologies.length} of the stack`,
      },
      technology: jaccard(devTags, [...repo.technologies, ...repo.topics]),
      experience: experienceFit(dev.experience, repo.requiredExperience),
      activity: repo.activity,
      learning: learningValue(dev, repo.technologies),
    },
    weights ?? REPOSITORY_MATCH_WEIGHTS,
  );
}

function difficultyFit(
  devContribs: number,
  difficulty: IssueSnapshot['difficulty'],
): number {
  const d = DIFFICULTY_RANK[difficulty]; // 1..5
  // Newcomers fit low-difficulty issues; experienced contributors tolerate more.
  const comfort = devContribs === 0 ? 2 : devContribs < 5 ? 3 : 4;
  const gap = Math.abs(d - comfort);
  return [1, 0.85, 0.6, 0.35, 0.15][Math.min(gap, 4)] ?? 0.15;
}

export function issueMatch(
  dev: DeveloperSnapshot,
  issue: IssueSnapshot,
  repoMatch01: number,
): ScoreBreakdown {
  return weightedScore(
    {
      skill: skillCoverage(dev, issue.requiredSkills),
      difficultyFit: difficultyFit(dev.priorContributions, issue.difficulty),
      repositoryMatch: repoMatch01,
      scopeClarity: issue.scopeClarity,
      mentorship: issue.mentorshipOffered ? 1 : 0.3,
    },
    ISSUE_MATCH_WEIGHTS,
  );
}

/**
 * Contribution Confidence (spec: hackathon core). How likely is a *successful first
 * contribution* here — distinct from "is this a good match".
 */
export function contributionConfidence(
  dev: DeveloperSnapshot,
  repo: RepositorySnapshot,
  issue: IssueSnapshot,
): ScoreBreakdown {
  return weightedScore(
    {
      skillMatch: skillCoverage(dev, issue.requiredSkills),
      difficultyFit: difficultyFit(dev.priorContributions, issue.difficulty),
      repositoryHealth: repo.health,
      newcomerFriendliness: repo.newcomerFriendliness,
      priorContributions: Math.min(dev.priorContributions / 10, 1),
    },
    CONTRIBUTION_CONFIDENCE_WEIGHTS,
  );
}

export interface SkillGap {
  readonly have: readonly SkillTag[];
  readonly missing: readonly SkillTag[];
  /** Fraction of the target's required skills the developer already has. */
  readonly coverage: number;
  /** Suggested order to learn the missing skills (most foundational first). */
  readonly recommendedOrder: readonly SkillTag[];
}

const FOUNDATION_ORDER: readonly SkillTag[] = [
  'git',
  'javascript',
  'typescript',
  'html',
  'css',
  'node',
];

export function skillGap(
  dev: DeveloperSnapshot,
  required: readonly SkillTag[],
): SkillGap {
  const haveSet = new Set(dev.skills.map((s) => s.tag));
  const have = required.filter((t) => haveSet.has(t));
  const missing = required.filter((t) => !haveSet.has(t));
  const recommendedOrder = [...missing].sort((a, b) => {
    const ia = FOUNDATION_ORDER.indexOf(a);
    const ib = FOUNDATION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return {
    have,
    missing,
    coverage: required.length === 0 ? 1 : have.length / required.length,
    recommendedOrder,
  };
}

/** Exposed for callers that want the default experience distance directly. */
export const experienceDistance = (
  a: DeveloperSnapshot['experience'],
  b: RepositorySnapshot['requiredExperience'],
): number => EXPERIENCE_RANK[a] - EXPERIENCE_RANK[b];

import type {
  ExperienceLevel,
  SkillProficiency,
  SkillTag,
  Difficulty,
} from '@cairn/shared';

export interface DeveloperSnapshot {
  readonly skills: readonly SkillProficiency[];
  readonly experience: ExperienceLevel;
  readonly interests: readonly SkillTag[];
  /** Count of merged PRs the user already has, across all of OSS. */
  readonly priorContributions: number;
}

export interface RepositorySnapshot {
  readonly fullName: string;
  readonly technologies: readonly SkillTag[];
  readonly topics: readonly SkillTag[];
  /** Health/activity in [0, 1] — usually supplied by @cairn/repository-analysis. */
  readonly activity: number;
  readonly health: number;
  readonly newcomerFriendliness: number;
  /** Experience level the codebase realistically demands. */
  readonly requiredExperience: ExperienceLevel;
}

export interface IssueSnapshot {
  readonly number: number;
  readonly difficulty: Difficulty;
  readonly requiredSkills: readonly SkillTag[];
  /** How clearly the issue is scoped, in [0, 1] (issue-analysis output). */
  readonly scopeClarity: number;
  /** Whether a maintainer offered mentoring / "good first issue". */
  readonly mentorshipOffered: boolean;
}

/** Domain vocabulary shared across libs. */

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export const EXPERIENCE_RANK: Record<ExperienceLevel, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
  expert: 4,
};

/** A normalised skill/technology token, e.g. "typescript", "angular", "docker". */
export type SkillTag = string;

export interface SkillProficiency {
  readonly tag: SkillTag;
  /** Self-assessed or derived proficiency in [0, 1]. */
  readonly level: number;
  readonly source: 'github' | 'cv' | 'manual' | 'linkedin';
}

/** Difficulty buckets for issues (ADR-0008 / issue-analysis). */
export type Difficulty = 'trivial' | 'easy' | 'moderate' | 'hard' | 'expert';

export const DIFFICULTY_RANK: Record<Difficulty, number> = {
  trivial: 1,
  easy: 2,
  moderate: 3,
  hard: 4,
  expert: 5,
};

/** Normalise a free-form technology string to a comparable tag. */
export function toSkillTag(raw: string): SkillTag {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9+#.-]/g, '');
}

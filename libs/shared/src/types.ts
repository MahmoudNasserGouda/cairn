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

/**
 * Where a claim about a person came from — the one vocabulary every side speaks.
 *
 * It lives here, beside the skills taxonomy, for the same reason that does: it had been
 * written out by hand in three places (`libs/profile`'s `ProfileSource`, this
 * interface, and `cn-tag`'s `TagSource`), and Phase 8 added three sources. Two of those
 * copies would have gone on compiling — rendering an unlabelled, uncoloured chip and
 * silently narrowing a type — with nothing to say they were stale.
 *
 * The split is deliberate: the **vocabulary** is here, and the **precedence** between
 * these sources is in `libs/profile`'s `provenance.ts`, where the argument for the
 * ordering lives (ADR-0031, ADR-0034/0035/0036).
 */
export const MEASURED_SOURCES = ['github', 'gitlab', 'stackexchange', 'devto'] as const;

/** Sources whose value the user stated, most direct first. */
export const REPORTED_SOURCES = ['manual', 'linkedin', 'cv'] as const;

export const PROFILE_SOURCES = [...REPORTED_SOURCES, ...MEASURED_SOURCES] as const;

export type ProfileSource = (typeof PROFILE_SOURCES)[number];

export interface SkillProficiency {
  readonly tag: SkillTag;
  /** Self-assessed or derived proficiency in [0, 1]. */
  readonly level: number;
  readonly source: ProfileSource;
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

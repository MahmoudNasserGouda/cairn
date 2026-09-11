import type { ExperienceLevel } from '@cairn/shared';

/**
 * "an intermediate", "a beginner". Experience levels are interpolated into copy the
 * user reads — both the lane rationales and the score notes — so the article has to
 * agree with the level rather than being hard-coded to "a".
 */
export function withArticle(level: ExperienceLevel): string {
  return `${/^[aeiou]/.test(level) ? 'an' : 'a'} ${level}`;
}

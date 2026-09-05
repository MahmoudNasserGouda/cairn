import { EXPERIENCE_RANK, type ExperienceLevel, type SkillTag } from '@cairn/shared';
import type { DeveloperSnapshot } from './model';

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Proficiency-weighted coverage of `required` by the developer's skills, in [0, 1].
 * A required skill the user knows well counts more than one they barely know.
 */
export function skillCoverage(
  dev: DeveloperSnapshot,
  required: readonly SkillTag[],
): number {
  if (required.length === 0) return 1;
  const byTag = new Map(dev.skills.map((s) => [s.tag, s.level]));
  const total = required.reduce((sum, tag) => sum + (byTag.get(tag) ?? 0), 0);
  return total / required.length;
}

/** Which required skills the developer is missing entirely. */
export function missingSkills(
  dev: DeveloperSnapshot,
  required: readonly SkillTag[],
): SkillTag[] {
  const have = new Set(dev.skills.map((s) => s.tag));
  return required.filter((tag) => !have.has(tag));
}

/**
 * Fit between the developer's experience and what a repo/issue demands, in [0, 1].
 * Being at or slightly above the required level scores highest; being far below
 * or far above scores lower.
 */
export function experienceFit(
  devLevel: ExperienceLevel,
  requiredLevel: ExperienceLevel,
): number {
  const diff = EXPERIENCE_RANK[devLevel] - EXPERIENCE_RANK[requiredLevel];
  if (diff === 0) return 1;
  if (diff === 1) return 0.9;
  if (diff === -1) return 0.6;
  if (diff >= 2) return 0.7; // over-qualified: fine, mildly less engaging
  return 0.25; // diff <= -2: under-qualified
}

/**
 * Directional technology fit: the share of a repo's stack (technologies + topics)
 * the developer already knows, in [0, 1]. Unlike `jaccard`, a broad generalist is
 * not penalised for knowing things the repo doesn't use.
 */
export function technologyCoverage(
  devTags: readonly string[],
  stack: readonly string[],
): number {
  const unique = new Set(stack);
  if (unique.size === 0) return 0;
  const have = new Set(devTags);
  let covered = 0;
  for (const t of unique) if (have.has(t)) covered++;
  return covered / unique.size;
}

/** Learning value: the share of a repo's stack that is new to the developer. */
export function learningValue(
  dev: DeveloperSnapshot,
  technologies: readonly SkillTag[],
): number {
  if (technologies.length === 0) return 0;
  const have = new Set(dev.skills.map((s) => s.tag));
  const novel = technologies.filter((t) => !have.has(t)).length;
  const ratio = novel / technologies.length;
  // A little novelty is ideal; all-novel is intimidating.
  return ratio <= 0.5 ? ratio * 2 * 0.8 + 0.1 : Math.max(0.2, 1 - (ratio - 0.5));
}

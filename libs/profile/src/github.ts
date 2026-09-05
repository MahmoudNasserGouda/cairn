import { clamp01, roundTo, type SkillProficiency, type SkillTag } from '@cairn/shared';
import { canonicalizeSkill } from './taxonomy';
import type { UnifiedProfile } from './model';
import { mergeProfile, emptyProfile } from './model';

/**
 * Structural view of what `collectGithubActivity` (@cairn/github) returns. Declared
 * locally so this module has no runtime dependency on the GitHub client — same
 * "data in, no network" contract as the CV parser (ADR-0005, ADR-0011).
 */
export interface GithubActivityInput {
  readonly user: {
    readonly login: string;
    readonly name: string | null;
    readonly createdAt: string;
  };
  readonly repos: readonly {
    readonly topics: readonly string[];
    readonly languages: Readonly<Record<string, number>>;
  }[];
  readonly mergedPrCount: number;
}

/** A used language never scores below this, so it still counts toward matches. */
const LEVEL_FLOOR = 0.3;

/**
 * Turn a GitHub activity snapshot into a profile fragment merged onto a base profile.
 * Skill levels are the share of a language's bytes against the user's most-used
 * language; topics become interests; account age drives the experience level via
 * `mergeProfile`'s own year estimation.
 */
export function githubToProfile(
  activity: GithubActivityInput,
  base: UnifiedProfile = emptyProfile(),
): UnifiedProfile {
  const bytes = new Map<SkillTag, number>();
  for (const repo of activity.repos) {
    for (const [lang, count] of Object.entries(repo.languages)) {
      const tag = canonicalizeSkill(lang);
      bytes.set(tag, (bytes.get(tag) ?? 0) + count);
    }
  }

  const maxBytes = Math.max(1, ...bytes.values());
  const skills: SkillProficiency[] = [...bytes.entries()].map(([tag, count]) => ({
    tag,
    level: roundTo(Math.max(LEVEL_FLOOR, clamp01(count / maxBytes)), 2),
    source: 'github',
  }));

  const interests = [
    ...new Set(activity.repos.flatMap((r) => r.topics).map((t) => canonicalizeSkill(t))),
  ].sort();

  const startYear = new Date(activity.user.createdAt).getUTCFullYear();
  const experience = Number.isNaN(startYear)
    ? []
    : [
        {
          title: 'Open-source contribution',
          startYear,
          endYear: 'present' as const,
          source: 'github' as const,
        },
      ];

  return mergeProfile(base, {
    identities: [
      {
        provider: 'github',
        displayName: activity.user.name ?? activity.user.login,
      },
    ],
    skills,
    interests,
    experience,
  });
}

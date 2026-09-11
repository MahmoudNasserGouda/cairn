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
    /** ISO timestamp of the last push; absent on older callers. */
    readonly pushedAt?: string;
  }[];
  readonly mergedPrCount: number;
}

/** A used language never scores below this, so it still counts toward matches. */
const LEVEL_FLOOR = 0.3;

function yearOf(iso: string): number | null {
  const year = new Date(iso).getUTCFullYear();
  return Number.isNaN(year) ? null : year;
}

/**
 * The one experience entry GitHub can honestly support: the span over which the
 * account shows public activity.
 *
 * It used to run from the account's creation year to `present`, which meant an
 * account opened in 2015 and untouched since read as a decade of experience and
 * pushed the whole profile to `advanced`. Two corrections:
 *
 * - a repo-less account contributes no entry at all, rather than years of nothing;
 * - the span ends at the most recent push we can see, not at today.
 *
 * It is still a proxy — GitHub cannot tell us when someone started programming —
 * but every year it claims is a year with visible work behind it.
 */
function githubExperience(activity: GithubActivityInput): readonly {
  readonly title: string;
  readonly startYear: number;
  readonly endYear: number;
  readonly source: 'github';
}[] {
  const startYear = yearOf(activity.user.createdAt);
  if (startYear === null || activity.repos.length === 0) return [];

  const pushYears = activity.repos
    .map((r) => (r.pushedAt !== undefined ? yearOf(r.pushedAt) : null))
    .filter((y): y is number => y !== null);
  const lastActive =
    pushYears.length > 0 ? Math.max(...pushYears) : new Date().getUTCFullYear();

  return [
    {
      title: 'Public GitHub activity',
      startYear,
      endYear: Math.max(startYear, lastActive),
      source: 'github',
    },
  ];
}

/**
 * Turn a GitHub activity snapshot into a profile fragment merged onto a base profile.
 * Skill levels are the share of a language's bytes against the user's most-used
 * language; topics become interests; the visible-activity span (see
 * `githubExperience`) drives the experience level via `mergeProfile`'s own year
 * estimation.
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

  const experience = githubExperience(activity);

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

import { clamp01, roundTo, type SkillTag } from '@cairn/shared';
import { canonicalizeSkill } from './taxonomy';
import type { IncomingSkill, ProfileFragment } from './merge';
import type { ExperienceEntry } from './model';
import { provenance, sourced } from './provenance';

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
  /** False when the merged-PR search was throttled rather than answered. */
  readonly mergedPrCountKnown?: boolean;
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
 * and it is stamped `source: 'github'`, the lowest precedence there is, so a CV or a
 * hand-typed role replaces it the moment one exists.
 */
function githubExperience(
  activity: GithubActivityInput,
  capturedAt: string,
): ExperienceEntry[] {
  const startYear = yearOf(activity.user.createdAt);
  if (startYear === null || activity.repos.length === 0) return [];

  const pushYears = activity.repos
    .map((r) => (r.pushedAt !== undefined ? yearOf(r.pushedAt) : null))
    .filter((y): y is number => y !== null);
  // With no push dates at all there is nothing to end the span on but the moment we
  // looked — which the caller supplies. The old code read `new Date()` here, a clock
  // inside a lib that is supposed to be deterministic; `capturedAt` is the same
  // answer, passed in, and testable.
  const lastActive =
    pushYears.length > 0 ? Math.max(...pushYears) : (yearOf(capturedAt) ?? startYear);

  return [
    {
      title: 'Public GitHub activity',
      organization: 'GitHub',
      startYear,
      endYear: Math.max(startYear, lastActive),
      highlights: [],
      // Low confidence on purpose: it is an inference from account metadata, and
      // saying so is what lets a better source win a tie rather than a coin toss.
      from: provenance('github', capturedAt, 0.3),
    },
  ];
}

function languageSkills(
  activity: GithubActivityInput,
  capturedAt: string,
): IncomingSkill[] {
  const bytes = new Map<SkillTag, number>();
  for (const repo of activity.repos) {
    for (const [lang, count] of Object.entries(repo.languages)) {
      const tag = canonicalizeSkill(lang);
      bytes.set(tag, (bytes.get(tag) ?? 0) + count);
    }
  }

  const total = [...bytes.values()].reduce((sum, n) => sum + n, 0);
  const maxBytes = Math.max(1, ...bytes.values());
  const from = provenance('github', capturedAt);

  return [...bytes.entries()].map(([tag, count]) => ({
    tag,
    level: roundTo(Math.max(LEVEL_FLOOR, clamp01(count / maxBytes)), 2),
    // Evidence a user can check, rather than a bare percentage: the share is of
    // their *own* pushed code, which is the only thing GitHub actually measured.
    note:
      total > 0
        ? `${Math.round((count / total) * 100)}% of your pushed code`
        : 'used in your repositories',
    from,
  }));
}

/**
 * Turn a GitHub activity snapshot into a profile fragment (ADR-0031).
 *
 * GitHub is last in precedence *on biography* — everything it says about who someone
 * is comes from account metadata. It is first, and alone, on what it actually
 * observes: language bytes, contribution counts, the repositories someone worked in.
 * Precedence never comes up for those, because no other source claims them.
 */
export function githubToFragment(
  activity: GithubActivityInput,
  capturedAt: string,
): ProfileFragment {
  const from = provenance('github', capturedAt);
  const displayName = activity.user.name ?? activity.user.login;

  return {
    identities: [{ provider: 'github', displayName }],
    contact: {
      name: sourced(displayName, provenance('github', capturedAt, 0.5)),
      emails: [],
    },
    links: [
      {
        kind: 'github',
        url: `https://github.com/${activity.user.login}`,
        from,
      },
    ],
    skills: languageSkills(activity, capturedAt),
    interests: [
      ...new Set(
        activity.repos.flatMap((r) => r.topics).map((t) => canonicalizeSkill(t)),
      ),
    ].sort(),
    experience: githubExperience(activity, capturedAt),
    contributions: {
      mergedPullRequests: activity.mergedPrCount,
      totalContributions: 0,
      repositoriesContributedTo: activity.repos.length,
      known: activity.mergedPrCountKnown ?? true,
      from,
    },
  };
}

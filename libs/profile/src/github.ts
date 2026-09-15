import { clamp01, roundTo, toKnownSkills, type SkillTag } from '@cairn/shared';
import { canonicalizeSkill } from './taxonomy';
import { SKILL_LEVEL_FLOOR, type IncomingSkill, type ProfileFragment } from './merge';
import type { ExperienceEntry, ProfileLink, ProjectEntry } from './model';
import { provenance, sourced, type Provenance } from './provenance';

/**
 * Structural view of what `collectViewerGraph` (@cairn/github) returns. Declared
 * locally so this module has no runtime dependency on the GitHub client — same
 * "data in, no network" contract as the CV parser (ADR-0005, ADR-0011).
 *
 * Everything is optional or nullable because a partial GraphQL response is normal
 * (ADR-0030): an organisation the token cannot see, a field behind a scope we did not
 * ask for. The client normalises those to neutral values; this tolerates them anyway.
 */
export interface GithubRepoRef {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly description: string | null;
  readonly primaryLanguage: string | null;
  readonly stargazers: number;
}

export interface GithubProfileInput {
  readonly login: string;
  readonly name?: string | null;
  readonly bio?: string | null;
  readonly company?: string | null;
  readonly location?: string | null;
  readonly websiteUrl?: string | null;
  readonly email?: string | null;
  readonly createdAt: string;
  readonly socialAccounts?: readonly {
    readonly provider: string;
    readonly url: string;
  }[];
  readonly organizations?: readonly string[];
  /** `null` when GitHub did not answer — distinct from a genuine zero. */
  readonly mergedPullRequests?: number | null;
  readonly pinned?: readonly GithubRepoRef[];
  readonly contributedTo?: readonly GithubRepoRef[];
  readonly contributedToCount?: number;
  readonly repos: readonly {
    readonly topics: readonly string[];
    readonly languages: Readonly<Record<string, number>>;
    /** ISO timestamp of the last push. */
    readonly pushedAt?: string | null;
  }[];
  readonly contributions?: {
    readonly commits: number;
    readonly issues: number;
    readonly pullRequests: number;
    readonly reviews: number;
    readonly total: number;
  };
}

/**
 * A used language never scores below this, so it still counts toward matches. Shared
 * with the merge, which rebuilds these levels when a second source also measures
 * (ADR-0034) — two different floors would make that rebuild visibly change numbers it
 * is supposed to leave alone.
 */
const LEVEL_FLOOR = SKILL_LEVEL_FLOOR;

/**
 * How far to trust GitHub about *who someone is*, as opposed to what they wrote.
 *
 * Everything biographical here is inference from account metadata, so it is stamped
 * low and loses a tie to any source that actually asked the user. What GitHub
 * measures directly — language bytes, contribution counts — carries full confidence,
 * because nothing else claims those and precedence never comes up.
 */
const BIOGRAPHY_CONFIDENCE = 0.5;
const ACTIVITY_SPAN_CONFIDENCE = 0.3;

function yearOf(iso: string): number | null {
  const year = new Date(iso).getUTCFullYear();
  return Number.isNaN(year) ? null : year;
}

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
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
 * It is still a proxy — GitHub cannot tell us when someone started programming — and
 * at the lowest precedence there is, so a CV or a hand-typed role replaces it the
 * moment one exists.
 */
function activitySpan(input: GithubProfileInput, capturedAt: string): ExperienceEntry[] {
  const startYear = yearOf(input.createdAt);
  if (startYear === null || input.repos.length === 0) return [];

  const pushYears = input.repos
    .map((r) => (r.pushedAt ? yearOf(r.pushedAt) : null))
    .filter((y): y is number => y !== null);
  // With no push dates at all there is nothing to end the span on but the moment we
  // looked — which the caller supplies. Reading a clock here would put one inside a
  // library that is supposed to be deterministic.
  const lastActive =
    pushYears.length > 0 ? Math.max(...pushYears) : (yearOf(capturedAt) ?? startYear);

  return [
    {
      title: 'Public GitHub activity',
      organization: 'GitHub',
      startYear,
      endYear: Math.max(startYear, lastActive),
      highlights: [],
      from: provenance('github', capturedAt, ACTIVITY_SPAN_CONFIDENCE),
    },
  ];
}

function languageSkills(input: GithubProfileInput, from: Provenance): IncomingSkill[] {
  const bytes = new Map<SkillTag, number>();
  for (const repo of input.repos) {
    for (const [lang, count] of Object.entries(repo.languages)) {
      const tag = canonicalizeSkill(lang);
      bytes.set(tag, (bytes.get(tag) ?? 0) + count);
    }
  }

  const total = [...bytes.values()].reduce((sum, n) => sum + n, 0);
  const maxBytes = Math.max(1, ...bytes.values());

  return [...bytes.entries()].map(([tag, count]) => ({
    tag,
    level: roundTo(Math.max(LEVEL_FLOOR, clamp01(count / maxBytes)), 2),
    // The raw byte count travels with the claim so the merge can add it to another
    // measured source's volume instead of choosing between two within-account shares
    // that were never on the same scale (ADR-0034).
    weight: count,
    // Evidence a user can check, rather than a bare percentage: the share is of
    // their *own* pushed code, which is the only thing GitHub actually measured.
    note:
      total > 0
        ? `${Math.round((count / total) * 100)}% of your pushed code`
        : 'used in your repositories',
    from,
  }));
}

/** Everything the user chose to publish about where else to find them. */
function links(input: GithubProfileInput, from: Provenance): ProfileLink[] {
  const out: ProfileLink[] = [
    { kind: 'github', url: `https://github.com/${input.login}`, from },
  ];

  const website = text(input.websiteUrl);
  if (website !== null) out.push({ kind: 'website', url: website, from });

  for (const account of input.socialAccounts ?? []) {
    const url = text(account.url);
    if (url === null) continue;
    const provider = account.provider.toLowerCase();
    const kind =
      provider === 'twitter' || provider === 'mastodon' || provider === 'linkedin'
        ? provider
        : 'other';
    out.push({ kind, url, from });
  }
  return out;
}

/**
 * Pinned repositories become projects.
 *
 * They are the one part of a GitHub profile the user curated by hand — "this is my
 * best work" — so calling them projects is a claim GitHub genuinely supports, unlike
 * most of what could be inferred from an account.
 */
function pinnedProjects(input: GithubProfileInput, from: Provenance): ProjectEntry[] {
  return (input.pinned ?? []).map((repo) => {
    const description = text(repo.description);
    return {
      name: repo.nameWithOwner,
      ...(description !== null ? { description } : {}),
      url: repo.url,
      technologies: toKnownSkills(
        repo.primaryLanguage !== null ? [repo.primaryLanguage] : [],
      ),
      from,
    };
  });
}

/**
 * Turn a GitHub profile graph into a profile fragment (ADR-0030, ADR-0031).
 *
 * GitHub is last in precedence *on biography* — everything it says about who someone
 * is comes from account metadata. It is first, and alone, on what it observes:
 * language bytes, contribution counts, the repositories someone worked in. Precedence
 * never comes up for those, because no other source claims them.
 *
 * Two things it knows are deliberately **not** mapped:
 *
 * - **Organisation membership is not employment.** GitHub cannot tell a job from a
 *   community, an alumni group or a hackathon team, so making one an experience entry
 *   would invent a role the user never claimed — and it would then sit in the profile
 *   looking authoritative. The field is read and carried for the UI to show as an
 *   affiliation; it does not become a job.
 * - **A bio is not a summary.** It is a one-line header, so it fills `headline`.
 *   `summary` waits for a source that actually carries prose.
 */
export function githubToFragment(
  input: GithubProfileInput,
  capturedAt: string,
): ProfileFragment {
  const measured = provenance('github', capturedAt);
  const inferred = provenance('github', capturedAt, BIOGRAPHY_CONFIDENCE);

  const displayName = text(input.name) ?? input.login;
  const headline = text(input.bio);
  const location = text(input.location);
  const email = text(input.email);

  return {
    identities: [{ provider: 'github', displayName }],
    contact: {
      name: sourced(displayName, inferred),
      ...(headline !== null ? { headline: sourced(headline, inferred) } : {}),
      ...(location !== null ? { location: sourced(location, inferred) } : {}),
      emails: email !== null ? [sourced(email, measured)] : [],
    },
    links: links(input, measured),
    skills: languageSkills(input, measured),
    interests: [
      ...new Set(input.repos.flatMap((r) => r.topics).map((t) => canonicalizeSkill(t))),
    ].sort(),
    experience: activitySpan(input, capturedAt),
    projects: pinnedProjects(input, measured),
    contributions: {
      mergedPullRequests: input.mergedPullRequests ?? 0,
      totalContributions: input.contributions?.total ?? 0,
      repositoriesContributedTo: input.contributedToCount ?? 0,
      // `pullRequests(states: MERGED)` is exact, so this is normally true — unlike the
      // Search API it replaced, whose 10-30-per-minute bucket left the count
      // regularly unknowable. But a partial GraphQL response can still null the field,
      // and a zero that means "we could not check" must not read as "no
      // contributions": that was the original bug, and it would simply have moved.
      known: typeof input.mergedPullRequests === 'number',
      from: measured,
    },
  };
}

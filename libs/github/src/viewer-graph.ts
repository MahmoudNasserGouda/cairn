import { CACHE_TTL_MS } from '@cairn/shared';
import type { GithubClient } from './client';

/**
 * The signed-in user, read in one GraphQL request (ADR-0030).
 *
 * This replaces a REST fan-out that cost **up to sixteen requests** per profile load —
 * `/user`, `/user/repos`, a merged-PR search, and `/repos/{full_name}/languages`
 * fifteen times over — and returned a fraction of what the same permission level
 * already allows. One request now carries the bio fields, social links, pinned work,
 * organisations, the contribution calendar, the repositories the user actually
 * contributed *to* rather than only owns, and every language breakdown.
 *
 * Two smaller wins fall out of the change. The merged-PR count comes from
 * `pullRequests(states: MERGED).totalCount`, which is exact, instead of the Search
 * API — whose 10-30-per-minute bucket meant the count was regularly unknowable and
 * had to be reported as "we could not check". And `repositoriesContributedTo` is the
 * first honest signal of open-source track record: someone's own repositories say
 * what they built, not what they contributed to.
 */

/** How many recently-pushed repositories to read languages and topics for. */
export const REPO_LIMIT = 30;
/** How many repositories the user contributed to, but does not own, to read. */
export const CONTRIBUTED_LIMIT = 25;

export const VIEWER_QUERY = `
query ViewerProfile($repos: Int!, $contributed: Int!) {
  viewer {
    login
    name
    bio
    company
    location
    websiteUrl
    avatarUrl
    createdAt
    email
    followers { totalCount }
    following { totalCount }
    gists(privacy: PUBLIC) { totalCount }
    socialAccounts(first: 10) { nodes { provider displayName url } }
    organizations(first: 20) { nodes { login name } }
    pullRequests(states: MERGED) { totalCount }
    pinnedItems(first: 6, types: [REPOSITORY]) {
      nodes {
        ... on Repository {
          nameWithOwner
          description
          url
          stargazerCount
          primaryLanguage { name }
        }
      }
    }
    repositoriesContributedTo(
      first: $contributed
      includeUserRepositories: false
      contributionTypes: [COMMIT, PULL_REQUEST, PULL_REQUEST_REVIEW, ISSUE]
      orderBy: { field: STARGAZERS, direction: DESC }
    ) {
      totalCount
      nodes { nameWithOwner url stargazerCount primaryLanguage { name } }
    }
    repositories(
      first: $repos
      isFork: false
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      nodes {
        nameWithOwner
        pushedAt
        stargazerCount
        repositoryTopics(first: 10) { nodes { topic { name } } }
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      contributionCalendar { totalContributions }
    }
  }
}`.trim();

// ---------------------------------------------------------------------------
// The shape GitHub sends back. Every field is optional on the way in: a partial
// response is normal (an organisation the token cannot see, a field behind a scope
// we did not ask for), and ADR-0030 says degrade to what arrived.
// ---------------------------------------------------------------------------

interface RawViewer {
  login?: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  email?: string | null;
  followers?: { totalCount?: number } | null;
  following?: { totalCount?: number } | null;
  gists?: { totalCount?: number } | null;
  socialAccounts?: {
    nodes?: ({ provider?: string; displayName?: string; url?: string } | null)[] | null;
  } | null;
  organizations?: {
    nodes?: ({ login?: string; name?: string | null } | null)[] | null;
  } | null;
  pullRequests?: { totalCount?: number } | null;
  pinnedItems?: { nodes?: (RawRepoSummary | null)[] | null } | null;
  repositoriesContributedTo?: {
    totalCount?: number;
    nodes?: (RawRepoSummary | null)[] | null;
  } | null;
  repositories?: { nodes?: (RawRepo | null)[] | null } | null;
  contributionsCollection?: {
    totalCommitContributions?: number;
    totalIssueContributions?: number;
    totalPullRequestContributions?: number;
    totalPullRequestReviewContributions?: number;
    contributionCalendar?: { totalContributions?: number } | null;
  } | null;
}

interface RawRepoSummary {
  nameWithOwner?: string;
  description?: string | null;
  url?: string;
  stargazerCount?: number;
  primaryLanguage?: { name?: string } | null;
}

interface RawRepo extends RawRepoSummary {
  pushedAt?: string | null;
  repositoryTopics?: { nodes?: ({ topic?: { name?: string } } | null)[] | null } | null;
  languages?: {
    edges?: ({ size?: number; node?: { name?: string } } | null)[] | null;
  } | null;
}

// ---------------------------------------------------------------------------
// What callers get. Flat, total, and free of nulls — the "did this field arrive"
// question is answered here, once, rather than at every use site.
// ---------------------------------------------------------------------------

export interface GithubRepoNode {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly stargazers: number;
  readonly primaryLanguage: string | null;
  readonly description: string | null;
}

export interface GithubOwnedRepo extends GithubRepoNode {
  readonly pushedAt: string | null;
  readonly topics: readonly string[];
  readonly languages: Readonly<Record<string, number>>;
}

export interface GithubSocialAccount {
  readonly provider: string;
  readonly url: string;
}

export interface GithubContributions {
  readonly commits: number;
  readonly issues: number;
  readonly pullRequests: number;
  readonly reviews: number;
  /** Everything on the calendar, over GitHub's default window of the last year. */
  readonly total: number;
}

export interface GithubViewerGraph {
  readonly login: string;
  readonly name: string | null;
  readonly bio: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly websiteUrl: string | null;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
  /** Empty without the `user:email` scope; GitHub returns `""` rather than erroring. */
  readonly email: string | null;
  readonly followers: number;
  readonly following: number;
  readonly publicGists: number;
  readonly socialAccounts: readonly GithubSocialAccount[];
  readonly organizations: readonly string[];
  /**
   * Exact, from `pullRequests(states: MERGED)` — no Search API in the path, so this
   * is a measurement rather than the guess it used to be.
   *
   * **`null` when GitHub did not answer**, which a partial GraphQL response can do.
   * Collapsing that to `0` would turn "we could not check" into "no contributions" —
   * the exact failure the Search API version had, and the reason this stays nullable.
   */
  readonly mergedPullRequests: number | null;
  readonly pinned: readonly GithubRepoNode[];
  readonly contributedTo: readonly GithubRepoNode[];
  readonly contributedToCount: number;
  readonly repos: readonly GithubOwnedRepo[];
  readonly contributions: GithubContributions;
}

function nodes<T>(list: readonly (T | null)[] | null | undefined): T[] {
  return (list ?? []).filter((n): n is T => n !== null && n !== undefined);
}

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function repoNode(raw: RawRepoSummary): GithubRepoNode | null {
  const nameWithOwner = text(raw.nameWithOwner);
  if (nameWithOwner === null) return null;
  return {
    nameWithOwner,
    url: raw.url ?? `https://github.com/${nameWithOwner}`,
    stargazers: raw.stargazerCount ?? 0,
    primaryLanguage: text(raw.primaryLanguage?.name),
    description: text(raw.description),
  };
}

/**
 * Normalise the response into something total.
 *
 * Every branch here answers "what if this field did not arrive", and every answer is
 * a neutral value rather than a throw. A profile that loads without the organisations
 * the token could not see is worth far more than one that fails because of them.
 */
export function toViewerGraph(raw: RawViewer): GithubViewerGraph {
  const contributions = raw.contributionsCollection;
  return {
    login: raw.login ?? '',
    name: text(raw.name),
    bio: text(raw.bio),
    company: text(raw.company),
    location: text(raw.location),
    websiteUrl: text(raw.websiteUrl),
    avatarUrl: text(raw.avatarUrl),
    createdAt: raw.createdAt ?? '',
    email: text(raw.email),
    followers: raw.followers?.totalCount ?? 0,
    following: raw.following?.totalCount ?? 0,
    publicGists: raw.gists?.totalCount ?? 0,
    socialAccounts: nodes(raw.socialAccounts?.nodes)
      .map((a) => ({ provider: (a.provider ?? '').toLowerCase(), url: a.url ?? '' }))
      .filter((a) => a.url.length > 0),
    organizations: nodes(raw.organizations?.nodes)
      .map((o) => o.login ?? '')
      .filter((login) => login.length > 0),
    mergedPullRequests: raw.pullRequests?.totalCount ?? null,
    pinned: nodes(raw.pinnedItems?.nodes)
      .map(repoNode)
      .filter((r): r is GithubRepoNode => r !== null),
    contributedTo: nodes(raw.repositoriesContributedTo?.nodes)
      .map(repoNode)
      .filter((r): r is GithubRepoNode => r !== null),
    contributedToCount: raw.repositoriesContributedTo?.totalCount ?? 0,
    repos: nodes(raw.repositories?.nodes)
      .map((repo): GithubOwnedRepo | null => {
        const base = repoNode(repo);
        if (base === null) return null;
        const languages: Record<string, number> = {};
        for (const edge of nodes(repo.languages?.edges)) {
          const name = text(edge.node?.name);
          if (name !== null) languages[name] = (languages[name] ?? 0) + (edge.size ?? 0);
        }
        return {
          ...base,
          pushedAt: text(repo.pushedAt),
          topics: nodes(repo.repositoryTopics?.nodes)
            .map((t) => text(t.topic?.name))
            .filter((n): n is string => n !== null),
          languages,
        };
      })
      .filter((r): r is GithubOwnedRepo => r !== null),
    contributions: {
      commits: contributions?.totalCommitContributions ?? 0,
      issues: contributions?.totalIssueContributions ?? 0,
      pullRequests: contributions?.totalPullRequestContributions ?? 0,
      reviews: contributions?.totalPullRequestReviewContributions ?? 0,
      total: contributions?.contributionCalendar?.totalContributions ?? 0,
    },
  };
}

/** Read the signed-in user's whole profile graph in one request. */
export async function collectViewerGraph(
  client: GithubClient,
): Promise<GithubViewerGraph> {
  const result = await client.graphql<{ viewer?: RawViewer | null }>(
    VIEWER_QUERY,
    { repos: REPO_LIMIT, contributed: CONTRIBUTED_LIMIT },
    { ttlMs: CACHE_TTL_MS.viewer },
  );
  return toViewerGraph(result.viewer ?? {});
}

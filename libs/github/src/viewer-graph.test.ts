/**
 * Reading the viewer in one request (ADR-0030).
 *
 * The normaliser is where "what if this field did not arrive" is answered, once.
 * GraphQL routinely returns a partial response — an organisation the token cannot
 * see, a field behind a scope we did not ask for — and a profile that loads without
 * those is worth far more than one that fails because of them. So most of what is
 * tested here is absence.
 */
import { describe, expect, it, vi } from 'vitest';
import { GithubClient } from './client';
import { MemoryStore } from '@cairn/shared';
import { collectViewerGraph, toViewerGraph, VIEWER_QUERY } from './viewer-graph';

const FULL = {
  login: 'octocat',
  name: 'The Octocat',
  bio: 'Building things',
  company: '@github',
  location: 'Lagos',
  websiteUrl: 'https://octo.dev',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  createdAt: '2015-01-01T00:00:00Z',
  email: 'octo@example.com',
  followers: { totalCount: 120 },
  following: { totalCount: 33 },
  gists: { totalCount: 4 },
  socialAccounts: {
    nodes: [
      { provider: 'MASTODON', displayName: '@octo', url: 'https://m.example/@octo' },
      { provider: 'TWITTER', displayName: '@octo', url: '' },
    ],
  },
  organizations: { nodes: [{ login: 'github', name: 'GitHub' }] },
  pullRequests: { totalCount: 42 },
  pinnedItems: {
    nodes: [
      {
        nameWithOwner: 'octocat/spoon-knife',
        description: 'A repo',
        url: 'https://github.com/octocat/spoon-knife',
        stargazerCount: 900,
        primaryLanguage: { name: 'HTML' },
      },
    ],
  },
  repositoriesContributedTo: {
    totalCount: 7,
    nodes: [
      {
        nameWithOwner: 'vercel/swr',
        url: 'https://github.com/vercel/swr',
        stargazerCount: 30000,
        primaryLanguage: { name: 'TypeScript' },
      },
    ],
  },
  repositories: {
    nodes: [
      {
        nameWithOwner: 'octocat/api',
        pushedAt: '2024-06-01T00:00:00Z',
        stargazerCount: 12,
        repositoryTopics: {
          nodes: [{ topic: { name: 'web' } }, { topic: { name: 'cli' } }],
        },
        languages: {
          edges: [
            { size: 9000, node: { name: 'TypeScript' } },
            { size: 1000, node: { name: 'CSS' } },
          ],
        },
      },
    ],
  },
  contributionsCollection: {
    totalCommitContributions: 300,
    totalIssueContributions: 20,
    totalPullRequestContributions: 45,
    totalPullRequestReviewContributions: 60,
    contributionCalendar: { totalContributions: 425 },
  },
};

describe('toViewerGraph', () => {
  it('flattens a complete response', () => {
    const g = toViewerGraph(FULL);

    expect(g.login).toBe('octocat');
    expect(g.name).toBe('The Octocat');
    expect(g.location).toBe('Lagos');
    expect(g.followers).toBe(120);
    expect(g.organizations).toEqual(['github']);
    expect(g.pinned[0]?.nameWithOwner).toBe('octocat/spoon-knife');
    expect(g.contributedTo[0]?.nameWithOwner).toBe('vercel/swr');
    expect(g.contributedToCount).toBe(7);
    expect(g.repos[0]?.topics).toEqual(['web', 'cli']);
    expect(g.repos[0]?.languages).toEqual({ TypeScript: 9000, CSS: 1000 });
    expect(g.contributions).toEqual({
      commits: 300,
      issues: 20,
      pullRequests: 45,
      reviews: 60,
      total: 425,
    });
  });

  /**
   * The merged-PR count used to come from the Search API, whose 10-30-per-minute
   * bucket meant it was regularly unknowable and had to be reported as "we could not
   * check". `pullRequests(states: MERGED).totalCount` is exact and costs nothing extra.
   */
  it('reads the merged-PR count exactly, with no Search API involved', () => {
    expect(toViewerGraph(FULL).mergedPullRequests).toBe(42);
  });

  /**
   * Not zero. A throttled Search API used to silently become "0 merged PRs", which
   * then scored as an empty track record; a partial GraphQL response must not
   * reintroduce that through the back door.
   */
  it('reports an unanswered merged-PR count as unknown, not as none', () => {
    expect(toViewerGraph({ ...FULL, pullRequests: null }).mergedPullRequests).toBeNull();
  });

  it('drops a social account with no URL rather than emitting an empty link', () => {
    const g = toViewerGraph(FULL);
    expect(g.socialAccounts).toEqual([
      { provider: 'mastodon', url: 'https://m.example/@octo' },
    ]);
  });

  it('survives a completely empty response', () => {
    const g = toViewerGraph({});

    expect(g.login).toBe('');
    expect(g.name).toBeNull();
    expect(g.repos).toEqual([]);
    expect(g.organizations).toEqual([]);
    expect(g.mergedPullRequests).toBeNull();
    expect(g.contributions.total).toBe(0);
  });

  /** The shape a partial GraphQL failure actually produces: nulls, not absent keys. */
  it('survives the fields a scope-limited token nulls out', () => {
    const g = toViewerGraph({
      ...FULL,
      email: null,
      organizations: null,
      repositoriesContributedTo: null,
      contributionsCollection: null,
    });

    expect(g.email).toBeNull();
    expect(g.organizations).toEqual([]);
    expect(g.contributedTo).toEqual([]);
    expect(g.contributedToCount).toBe(0);
    expect(g.contributions.commits).toBe(0);
    // Everything that *did* arrive is still there.
    expect(g.repos[0]?.languages).toEqual({ TypeScript: 9000, CSS: 1000 });
  });

  it('treats an empty email as absent — GitHub sends "" without user:email', () => {
    expect(toViewerGraph({ ...FULL, email: '' }).email).toBeNull();
  });

  it('skips a null node inside a list instead of crashing on it', () => {
    const g = toViewerGraph({
      ...FULL,
      repositories: { nodes: [null, { nameWithOwner: 'octocat/api' }] },
      pinnedItems: { nodes: [null] },
    });

    expect(g.repos).toHaveLength(1);
    expect(g.pinned).toEqual([]);
  });

  it('drops a repository with no name, which nothing downstream could key on', () => {
    const g = toViewerGraph({
      ...FULL,
      repositories: { nodes: [{ stargazerCount: 3 }] },
    });
    expect(g.repos).toEqual([]);
  });

  it('sums two edges that report the same language', () => {
    const g = toViewerGraph({
      ...FULL,
      repositories: {
        nodes: [
          {
            nameWithOwner: 'octocat/api',
            languages: {
              edges: [
                { size: 100, node: { name: 'Go' } },
                { size: 50, node: { name: 'Go' } },
              ],
            },
          },
        ],
      },
    });
    expect(g.repos[0]?.languages).toEqual({ Go: 150 });
  });
});

describe('collectViewerGraph', () => {
  function client(data: unknown) {
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-resource': 'graphql',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        }),
    );
    return {
      fetchImpl,
      client: new GithubClient({ fetchImpl, cache: new MemoryStore() }),
    };
  }

  /** The headline of ADR-0030: sixteen requests become one. */
  it('reads the whole profile in a single request', async () => {
    const { client: c, fetchImpl } = client({ data: { viewer: FULL } });
    const graph = await collectViewerGraph(c);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(graph.login).toBe('octocat');
    expect(graph.repos[0]?.languages).toEqual({ TypeScript: 9000, CSS: 1000 });
  });

  it('sends the query with its paging variables', async () => {
    const { client: c, fetchImpl } = client({ data: { viewer: FULL } });
    await collectViewerGraph(c);

    const body = JSON.parse(
      (fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as { query: string; variables: Record<string, number> };

    expect(body.query).toBe(VIEWER_QUERY);
    expect(body.variables.repos).toBeGreaterThan(0);
    expect(body.variables.contributed).toBeGreaterThan(0);
  });

  it('returns an empty graph rather than throwing when the viewer is null', async () => {
    const { client: c } = client({ data: { viewer: null } });
    await expect(collectViewerGraph(c)).resolves.toMatchObject({ login: '' });
  });
});

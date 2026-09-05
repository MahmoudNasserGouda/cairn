import { GithubClient } from './client';
import { collectGithubActivity, fetchViewerRepos, LANGUAGE_FETCH_LIMIT } from './user';
import { MemoryStore } from '@cairn/shared';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    },
  });
}

const USER = {
  login: 'octocat',
  name: 'The Octocat',
  created_at: '2015-01-01T00:00:00Z',
  avatar_url: 'https://example.com/a.png',
};

function repo(name: string, extra: Record<string, unknown> = {}) {
  return {
    full_name: `octocat/${name}`,
    language: 'TypeScript',
    topics: ['web', 'hooks'],
    fork: false,
    stargazers_count: 3,
    pushed_at: '2024-01-01T00:00:00Z',
    ...extra,
  };
}

function pathOf(url: string | URL | Request): string {
  const s = url instanceof Request ? url.url : url instanceof URL ? url.href : url;
  return new URL(s).pathname;
}

function router(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/user': USER,
    '/user/repos': [repo('a'), repo('b'), repo('fork-of-x', { fork: true })],
    '/search/issues': { total_count: 12 },
    '/repos/octocat/a/languages': { TypeScript: 8000, CSS: 2000 },
    '/repos/octocat/b/languages': { TypeScript: 1000, Python: 500 },
    ...overrides,
  };
  return vi.fn(async (url: string | URL | Request) => {
    const path = pathOf(url);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path === k || path.startsWith(`${k}/`));
    return json(key ? routes[key] : {});
  });
}

function client(fetchImpl: ReturnType<typeof router>) {
  return new GithubClient({ fetchImpl, cache: new MemoryStore() });
}

describe('fetchViewerRepos', () => {
  it('drops forks and maps to summaries', async () => {
    const repos = await fetchViewerRepos(client(router()));
    expect(repos.map((r) => r.fullName)).toEqual(['octocat/a', 'octocat/b']);
    expect(repos[0]).toMatchObject({ primaryLanguage: 'TypeScript', fork: false });
  });
});

describe('collectGithubActivity', () => {
  it('composes user, repos+languages and merged-PR count', async () => {
    const activity = await collectGithubActivity(client(router()));
    expect(activity.user.login).toBe('octocat');
    expect(activity.mergedPrCount).toBe(12);
    expect(activity.repos).toHaveLength(2);
    expect(activity.repos[0]?.languages).toEqual({ TypeScript: 8000, CSS: 2000 });
  });

  it('is deterministic', async () => {
    const a = await collectGithubActivity(client(router()));
    const b = await collectGithubActivity(client(router()));
    expect(a).toEqual(b);
  });

  it('tolerates a failing search endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (pathOf(url).startsWith('/search/issues')) {
        return new Response('nope', { status: 403 });
      }
      return router()(url);
    });
    const activity = await collectGithubActivity(
      new GithubClient({ fetchImpl, cache: new MemoryStore() }),
    );
    expect(activity.mergedPrCount).toBe(0);
  });

  it('only fetches languages for the newest LANGUAGE_FETCH_LIMIT repos', async () => {
    const many = Array.from({ length: LANGUAGE_FETCH_LIMIT + 5 }, (_, i) =>
      repo(`r${i}`),
    );
    const fetchImpl = router({ '/user/repos': many });
    await collectGithubActivity(client(fetchImpl));
    const langCalls = fetchImpl.mock.calls.filter((c) =>
      pathOf(c[0]).includes('/languages'),
    );
    expect(langCalls).toHaveLength(LANGUAGE_FETCH_LIMIT);
  });
});

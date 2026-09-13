import { GithubClient, RateLimitError } from './client';
import { MemoryStore } from '@cairn/shared';

function response(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
      ...init.headers,
    },
  });
}

describe('GithubClient', () => {
  it('caches within the TTL and does not refetch', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ full_name: 'a/b' }, { headers: { etag: 'W/"1"' } }));
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });
    await c.get('/repos/a/b', { ttlMs: 10_000 });
    await c.get('/repos/a/b', { ttlMs: 10_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent identical requests', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(
        () => new Promise((r) => setTimeout(() => r(response({ ok: 1 })), 5)),
      );
    const c = new GithubClient({ fetchImpl });
    await Promise.all([c.get('/x'), c.get('/x'), c.get('/x')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('revalidates with If-None-Match and serves cached data on 304', async () => {
    let now = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ v: 1 }, { headers: { etag: 'W/"abc"' } }))
      .mockResolvedValueOnce(response(null, { status: 304 }));
    const c = new GithubClient({ fetchImpl, now: () => now });
    const first = await c.get<{ v: number }>('/r', { ttlMs: 100 });
    now += 1_000; // now stale
    const second = await c.get<{ v: number }>('/r', { ttlMs: 100 });
    expect(second).toEqual(first);
    const secondCall = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect((secondCall.headers as Record<string, string>)['If-None-Match']).toBe(
      'W/"abc"',
    );
  });

  it('serves stale cache instead of calling when below the rate-limit floor', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response(
        { v: 1 },
        {
          headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': String(reset) },
        },
      ),
    );
    let now = Date.now();
    const c = new GithubClient({ fetchImpl, now: () => now, rateLimitFloor: 50 });
    await c.get('/r', { ttlMs: 1 });
    now += 10;
    const again = await c.get('/r', { ttlMs: 1 });
    expect(again).toEqual({ v: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws RateLimitError when throttled with no cache to fall back on', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const fetchImpl = vi.fn().mockResolvedValue(
      response(
        {},
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        },
      ),
    );
    const c = new GithubClient({ fetchImpl });
    await expect(c.get('/nope')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('does not let an exhausted search quota block a core-API call', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          { items: [] },
          {
            headers: {
              'x-ratelimit-resource': 'search',
              'x-ratelimit-limit': '10',
              'x-ratelimit-remaining': '3',
              'x-ratelimit-reset': String(reset),
            },
          },
        ),
      )
      .mockResolvedValueOnce(response({ v: 1 }));
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });
    await c.get('/search/repositories?q=x', { ttlMs: 1 });
    const core = await c.get('/repos/a/b', { ttlMs: 1 });
    expect(core).toEqual({ v: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('applies a quota-relative floor so a second search is throttled', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response(
        { items: [{ id: 1 }] },
        {
          headers: {
            'x-ratelimit-resource': 'search',
            'x-ratelimit-limit': '10',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
          },
        },
      ),
    );
    let now = Date.now();
    const c = new GithubClient({ fetchImpl, now: () => now, cache: new MemoryStore() });
    await c.get('/search/repositories?q=a', { ttlMs: 1 });
    now += 10;
    await expect(c.get('/search/repositories?q=b')).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never puts the token anywhere but the Authorization header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: 1 }));
    const c = new GithubClient({ fetchImpl, token: 'ghp_secrettoken' });
    await c.get('/user');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain('ghp_secrettoken');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer ghp_secrettoken',
    );
  });
});

describe('GithubClient resilience', () => {
  const stale = { full_name: 'a/b', note: 'cached' };

  /** Prime the cache, then let the TTL lapse so the next call must go out. */
  async function primed(next: () => Promise<Response>): Promise<GithubClient> {
    const store = new MemoryStore();
    const first = vi.fn().mockResolvedValue(response(stale));
    const warm = new GithubClient({ fetchImpl: first, cache: store });
    await warm.get('/repos/a/b', { ttlMs: 1 });

    await new Promise((r) => setTimeout(r, 5));
    return new GithubClient({ fetchImpl: vi.fn(next), cache: store });
  }

  it('serves the cache when the network throws', async () => {
    const c = await primed(() => Promise.reject(new Error('offline')));
    await expect(c.get('/repos/a/b', { ttlMs: 1 })).resolves.toEqual(stale);
  });

  it('serves the cache on a 500 rather than throwing it away', async () => {
    const c = await primed(async () => response({ message: 'boom' }, { status: 500 }));
    await expect(c.get('/repos/a/b', { ttlMs: 1 })).resolves.toEqual(stale);
  });

  it('still throws a 500 when there is nothing cached', async () => {
    const c = new GithubClient({
      fetchImpl: vi.fn(async () => response({}, { status: 500 })),
      cache: new MemoryStore(),
    });
    await expect(c.get('/repos/x/y')).rejects.toThrow(/GitHub 500/);
  });

  it('backs off on a 429 and does not call out again', async () => {
    const fetchImpl = vi.fn(async () =>
      response({}, { status: 429, headers: { 'retry-after': '60' } }),
    );
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });

    await expect(c.get('/repos/a/b')).rejects.toThrow(/slow down/);
    await expect(c.get('/repos/c/d')).rejects.toThrow(/slow down/);
    // Second call short-circuits on the stored backoff instead of hitting GitHub.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats a 403 that still has quota as a secondary limit, not a bare error', async () => {
    const fetchImpl = vi.fn(async () =>
      response(
        {},
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '4000', 'retry-after': '30' },
        },
      ),
    );
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });
    await expect(c.get('/repos/a/b')).rejects.toThrow(/slow down/);
  });

  it('keeps a forced revalidation separate from an in-flight plain read', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((r) => {
          calls++;
          setTimeout(() => r(response({ call: calls })), 5);
        }),
    );
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });
    await Promise.all([c.get('/x'), c.get('/x', { forceRevalidate: true })]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entries once the cache budget is exceeded', async () => {
    const store = new MemoryStore();
    const c = new GithubClient({
      fetchImpl: vi.fn(async () => response({ ok: 1 })),
      cache: store,
      maxCacheEntries: 10,
    });
    for (let i = 0; i < 200; i++) await c.get(`/repos/a/r${i}`);

    // Sweeps are periodic, so the guarantee is "bounded", not "never exceeds max":
    // at most one sweep interval of entries can accumulate past the budget.
    const cached = (await store.keys('gh:/repos/')).length;
    expect(cached).toBeGreaterThan(0);
    expect(cached).toBeLessThanOrEqual(10 + 50);
  });

  it('keeps the newest entries and drops the oldest', async () => {
    const store = new MemoryStore();
    const c = new GithubClient({
      fetchImpl: vi.fn(async () => response({ ok: 1 })),
      cache: store,
      maxCacheEntries: 5,
    });
    for (let i = 0; i < 100; i++) await c.get(`/repos/a/r${i}`);

    const keys = await store.keys('gh:/repos/');
    expect(keys).toContain('gh:/repos/a/r99');
    expect(keys).not.toContain('gh:/repos/a/r0');
  });
});

/**
 * GraphQL transport (ADR-0030).
 *
 * One query replaces the sixteen REST calls a profile load used to cost, so it has to
 * inherit the same protections rather than become a hole beside them: caching,
 * deduplication, rate-limit awareness, stale-on-error. Two things differ from `get`
 * and both are tested here — GraphQL is a POST so ETag revalidation does not apply,
 * and it reports failure as a 200 with an `errors` array rather than a status code.
 */
describe('GithubClient.graphql', () => {
  const QUERY = 'query Viewer { viewer { login } }';

  function gqlResponse(
    body: unknown,
    init: { status?: number; headers?: Record<string, string> } = {},
  ): Response {
    return response(body, {
      ...init,
      headers: { 'x-ratelimit-resource': 'graphql', ...init.headers },
    });
  }

  it('POSTs the query and variables to /graphql with the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(gqlResponse({ data: { viewer: {} } }));
    const c = new GithubClient({
      fetchImpl,
      token: 'gho_secret',
      cache: new MemoryStore(),
    });

    await c.graphql(QUERY, { login: 'octocat' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/graphql$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      query: QUERY,
      variables: { login: 'octocat' },
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer gho_secret',
    );
  });

  it('caches by query and variables together', async () => {
    // A fresh Response per call: a body can only be read once, and this test is the
    // only one here that expects more than one fetch to actually happen.
    const fetchImpl = vi.fn().mockImplementation(() => gqlResponse({ data: { n: 1 } }));
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });

    await c.graphql(QUERY, { a: 1 }, { ttlMs: 10_000 });
    await c.graphql(QUERY, { a: 1 }, { ttlMs: 10_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Same query, different variables, is a different question.
    await c.graphql(QUERY, { a: 2 }, { ttlMs: 10_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent identical queries', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(
        () => new Promise((r) => setTimeout(() => r(gqlResponse({ data: { n: 1 } })), 5)),
      );
    const c = new GithubClient({ fetchImpl });
    await Promise.all([c.graphql(QUERY), c.graphql(QUERY), c.graphql(QUERY)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /**
   * GraphQL answers 200 with both `data` and `errors` when part of a query fails —
   * an organisation the token cannot see, a field behind a scope we did not ask for.
   * ADR-0030: degrade to the fields that did arrive rather than failing the whole
   * profile load over one unreadable corner.
   */
  it('returns partial data when some fields errored', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      gqlResponse({
        data: { viewer: { login: 'octocat', organizations: null } },
        errors: [{ message: 'Resource not accessible by integration' }],
      }),
    );
    const c = new GithubClient({ fetchImpl });

    const data = await c.graphql<{ viewer: { login: string } }>(QUERY);
    expect(data.viewer.login).toBe('octocat');
  });

  it('throws when the query failed outright and no data came back', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        gqlResponse({ data: null, errors: [{ message: 'Bad credentials' }] }),
      );
    const c = new GithubClient({ fetchImpl });

    await expect(c.graphql(QUERY)).rejects.toThrow(/Bad credentials/);
  });

  it('does not cache a failed query', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(gqlResponse({ data: null, errors: [{ message: 'nope' }] }))
      .mockResolvedValue(gqlResponse({ data: { n: 1 } }));
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });

    await expect(c.graphql(QUERY, {}, { ttlMs: 10_000 })).rejects.toThrow();
    await c.graphql(QUERY, {}, { ttlMs: 10_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /**
   * GraphQL bills against its own budget of 5,000 *points* an hour, separate from
   * REST's request budget. Tracking it as a third resource is what stops a spent
   * GraphQL quota from blocking repository reads, the same way `search` was kept
   * apart from `core`.
   */
  it('tracks graphql quota separately from core', async () => {
    const exhausted = {
      'x-ratelimit-resource': 'graphql',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { n: 1 } }, { headers: exhausted }))
      .mockResolvedValue(response({ full_name: 'a/b' }));
    const c = new GithubClient({ fetchImpl, cache: new MemoryStore() });

    await c.graphql(QUERY);
    // GraphQL's floor is hit...
    await expect(c.graphql('query Other { viewer { id } }')).rejects.toThrow(
      RateLimitError,
    );
    // ...but a REST read is unaffected.
    await expect(c.get('/repos/a/b')).resolves.toEqual({ full_name: 'a/b' });
  });

  it('serves stale cache when the network fails', async () => {
    let now = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(gqlResponse({ data: { n: 1 } }))
      .mockRejectedValue(new Error('offline'));
    const c = new GithubClient({
      fetchImpl,
      cache: new MemoryStore(),
      now: () => now,
    });

    await c.graphql(QUERY, {}, { ttlMs: 100 });
    now += 1_000; // expire it
    await expect(c.graphql(QUERY, {}, { ttlMs: 100 })).resolves.toEqual({ n: 1 });
  });
});

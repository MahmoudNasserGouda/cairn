import { GithubClient, RateLimitError } from './client';
import { MemoryStore } from '@osc/shared';

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

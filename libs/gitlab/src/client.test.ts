import { describe, expect, it, vi } from 'vitest';
import { GitlabClient, GitlabError, GitlabRateLimitError } from './client';

/**
 * A deliberately small client (ADR-0034).
 *
 * `libs/github`'s client carries a cache, ETag revalidation, request dedupe and a
 * per-resource rate-limit floor, all shaped around GitHub's headers. Generalising it
 * was considered and deferred: GitLab's one call here is a single POST per import, so
 * nearly all of that machinery would be inert, and a shared abstraction built to serve
 * one real caller and one hypothetical one usually fits neither.
 *
 * What GitLab does need is different anyway — `RateLimit-*` headers rather than
 * `X-RateLimit-*`, and GraphQL's habit of answering `200` with an `errors` array.
 */

const ok = (body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('requests', () => {
  it('posts the query to the graphql endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn(async () => ok({ data: { currentUser: { username: 'a' } } }));
    const client = new GitlabClient({
      token: 'glpat-secret',
      fetchImpl,
    });

    await client.query<{ currentUser: { username: string } }>(
      'query { currentUser { username } }',
    );

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/graphql');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer glpat-secret');
  });

  it('returns the data, not the envelope', async () => {
    const client = new GitlabClient({
      token: 't',
      fetchImpl: async () => ok({ data: { currentUser: { username: 'amara' } } }),
    });
    const data = await client.query<{ currentUser: { username: string } }>('q');
    expect(data.currentUser.username).toBe('amara');
  });
});

describe('failures', () => {
  /**
   * The one that would otherwise pass silently. GraphQL answers `200` with an `errors`
   * array, so a client that only checks `res.ok` reports success and hands back
   * `undefined` — which surfaces much later as an empty profile rather than an error.
   */
  it('treats a 200 carrying errors as a failure', async () => {
    const client = new GitlabClient({
      token: 't',
      fetchImpl: async () => ok({ errors: [{ message: 'Field does not exist' }] }),
    });
    await expect(client.query('q')).rejects.toThrow(/Field does not exist/);
  });

  it('treats a 200 with neither data nor errors as a failure', async () => {
    const client = new GitlabClient({
      token: 't',
      fetchImpl: async () => ok({}),
    });
    await expect(client.query('q')).rejects.toThrow(GitlabError);
  });

  it('reports rate limiting distinctly, with the reset time when given', async () => {
    const client = new GitlabClient({
      token: 't',
      fetchImpl: async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'ratelimit-reset': '1789000000' },
        }),
    });
    await expect(client.query('q')).rejects.toThrow(GitlabRateLimitError);
  });

  it('never repeats the token in an error message', async () => {
    const client = new GitlabClient({
      token: 'glpat-the-secret',
      fetchImpl: async () => new Response('nope', { status: 401 }),
    });
    await expect(client.query('q')).rejects.not.toThrow(/glpat-the-secret/);
  });

  it('turns a network failure into a GitlabError rather than a raw TypeError', async () => {
    const client = new GitlabClient({
      token: 't',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(client.query('q')).rejects.toThrow(GitlabError);
  });
});

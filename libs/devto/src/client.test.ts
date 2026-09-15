import { describe, expect, it, vi } from 'vitest';
import { collectArticles, DevtoError, parseDevtoUsername } from './client';

/**
 * dev.to, the cheapest source available and the least valuable (ADR-0036).
 *
 * No key, no auth, one request. The ADR is unusually blunt about the trade: it is
 * accepted because it costs one origin and about thirty lines, not because it matters —
 * and if the CSP allowlist ever needs trimming, this is the first entry to go.
 */

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const article = (over: Record<string, unknown> = {}) => ({
  title: 'Why I stopped writing tests',
  description: 'a change of heart',
  url: 'https://dev.to/amara/why-i-stopped-writing-tests-1a2b',
  tag_list: ['rust', 'testing'],
  public_reactions_count: 42,
  comments_count: 7,
  published_at: '2026-08-01T00:00:00Z',
  ...over,
});

describe('reading a username', () => {
  it.each([
    ['amara', 'amara'],
    ['  amara  ', 'amara'],
    ['@amara', 'amara'],
    ['https://dev.to/amara', 'amara'],
    ['dev.to/amara', 'amara'],
    ['https://dev.to/amara/some-article-1a2b', 'amara'],
    ['amara_okonkwo', 'amara_okonkwo'],
  ])('reads %s', (input, expected) => {
    expect(parseDevtoUsername(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['https://example.com/amara'],
    ['not a username'],
    ['a'.repeat(60)],
  ])('refuses %s', (input) => {
    expect(parseDevtoUsername(input)).toBeNull();
  });
});

describe('reading articles', () => {
  it('asks for one username, anonymously, with no key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply([article()]));
    await collectArticles('amara', { fetchImpl });

    const url = fetchImpl.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://dev.to/api/articles?')).toBe(true);
    expect(url).toContain('username=amara');
    expect(/[?&](api_)?key=/.test(url)).toBe(false);
    // No `Authorization` either: this reads what is already published on the open web.
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  it('returns the articles and the counts it will not use', async () => {
    const result = await collectArticles('amara', {
      fetchImpl: (async () => reply([article()])) as unknown as typeof fetch,
    });

    expect(result.username).toBe('amara');
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      title: 'Why I stopped writing tests',
      url: 'https://dev.to/amara/why-i-stopped-writing-tests-1a2b',
      reactions: 42,
      comments: 7,
    });
    expect(result.articles[0]?.tags).toEqual(['rust', 'testing']);
  });

  /**
   * An unknown username answers `200` with an empty array rather than a 404, exactly as
   * a real account with no posts does. Neither is an error, and neither should read as
   * a finding — the caller is told there was nothing, not that the person writes nothing.
   */
  it('reports an empty result rather than failing', async () => {
    const result = await collectArticles('nobody', {
      fetchImpl: (async () => reply([])) as unknown as typeof fetch,
    });
    expect(result.articles).toEqual([]);
  });

  it('skips entries with no usable url or title', async () => {
    const result = await collectArticles('amara', {
      fetchImpl: (async () =>
        reply([
          article(),
          { title: 'no url' },
          article({ url: '' }),
        ])) as unknown as typeof fetch,
    });
    expect(result.articles).toHaveLength(1);
  });

  it('tolerates a missing tag list', async () => {
    const result = await collectArticles('amara', {
      fetchImpl: (async () =>
        reply([article({ tag_list: null })])) as unknown as typeof fetch,
    });
    expect(result.articles[0]?.tags).toEqual([]);
  });
});

describe('failures', () => {
  it('turns a refusal into a DevtoError', async () => {
    const fetchImpl = (async () =>
      reply({ error: 'nope' }, 503)) as unknown as typeof fetch;
    await expect(collectArticles('amara', { fetchImpl })).rejects.toThrow(DevtoError);
  });

  it('turns a network failure into one too', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(collectArticles('amara', { fetchImpl })).rejects.toThrow(DevtoError);
  });

  it('fails rather than guessing when the body is not a list', async () => {
    const fetchImpl = (async () => reply({ articles: [] })) as unknown as typeof fetch;
    await expect(collectArticles('amara', { fetchImpl })).rejects.toThrow(DevtoError);
  });
});

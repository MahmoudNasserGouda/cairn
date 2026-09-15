import { describe, expect, it, vi } from 'vitest';
import { collectAnswerTags, StackExchangeError, StackExchangeQuotaError } from './client';

const REF = { userId: 22656, site: 'stackoverflow' };

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const user = (over: Record<string, unknown> = {}) => ({
  user_id: 22656,
  display_name: 'Jon Skeet',
  link: 'https://stackoverflow.com/users/22656/jon-skeet',
  reputation: 1_529_680,
  ...over,
});

const tag = (name: string, score: number, count = 10) => ({
  tag_name: name,
  answer_count: count,
  answer_score: score,
  question_count: 0,
  question_score: 0,
});

/** Routes the two calls one import makes, in whatever order they are issued. */
const routed = (opts: { user?: unknown; tags?: unknown; quota?: number }) =>
  vi.fn<typeof fetch>(async (url) =>
    (url as string).includes('top-answer-tags')
      ? reply({
          items: opts.tags ?? [],
          quota_remaining: opts.quota ?? 296,
          quota_max: 300,
        })
      : reply({
          items: opts.user === null ? [] : [opts.user ?? user()],
          quota_remaining: opts.quota ?? 297,
          quota_max: 300,
        }),
  );

describe('reading a profile', () => {
  it('asks the right site and id, with no key', async () => {
    const fetchImpl = routed({ tags: [tag('python', 1240, 140)] });
    await collectAnswerTags(REF, { fetchImpl });

    const urls = fetchImpl.mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => u.startsWith('https://api.stackexchange.com/2.3/'))).toBe(
      true,
    );
    expect(urls.every((u) => u.includes('site=stackoverflow'))).toBe(true);
    expect(urls.every((u) => u.includes('/users/22656'))).toBe(true);
    // A key would be a service-level secret, and a static bundle cannot hold one
    // (SECURITY.md 8.4). 300 requests a day, anonymously, is the whole arrangement.
    expect(urls.some((u) => /[?&]key=/.test(u))).toBe(false);
  });

  it('returns the tags and the attribution the licence requires', async () => {
    const result = await collectAnswerTags(REF, {
      fetchImpl: routed({ tags: [tag('python', 1240, 140), tag('django', 90, 12)] }),
    });

    expect(result.displayName).toBe('Jon Skeet');
    // CC BY-SA is a condition, not a footnote: nothing renders without a link back.
    expect(result.profileUrl).toBe('https://stackoverflow.com/users/22656/jon-skeet');
    expect(result.tags.map((t) => t.tag)).toEqual(['python', 'django']);
    expect(result.tags[0]).toMatchObject({ answers: 140, score: 1240 });
  });

  it('costs two requests, not one per tag', async () => {
    const fetchImpl = routed({ tags: [tag('a', 1), tag('b', 2), tag('c', 3)] });
    await collectAnswerTags(REF, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('when there is nothing there', () => {
  /**
   * A valid-looking id that belongs to nobody answers `200` with an empty list, exactly
   * as a real user with no answers does. Both are "no data", and neither is an error —
   * but they must not be reported as a user with zero expertise either.
   */
  it('reports an unknown user as absent rather than as an error', async () => {
    const result = await collectAnswerTags(REF, { fetchImpl: routed({ user: null }) });
    expect(result.found).toBe(false);
    expect(result.tags).toEqual([]);
  });

  it('reports a real user with no answers as found, with no tags', async () => {
    const result = await collectAnswerTags(REF, { fetchImpl: routed({ tags: [] }) });
    expect(result.found).toBe(true);
    expect(result.tags).toEqual([]);
  });
});

describe('the quota', () => {
  /**
   * 300 requests a day is per **IP**, not per user, and a shared or NATed address is
   * entirely plausible in the markets this product names as its audience. An exhausted
   * quota means *we do not know*, and must never be rendered as "no expertise" — the
   * same discipline the merged-PR count already keeps.
   */
  it('is a distinct failure, so the UI can say unknown rather than none', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply(
        {
          error_id: 502,
          error_name: 'throttle_violation',
          error_message: 'too many requests',
        },
        400,
      ),
    );
    await expect(collectAnswerTags(REF, { fetchImpl })).rejects.toThrow(
      StackExchangeQuotaError,
    );
  });

  it('treats an exhausted allowance the same way, even on a 200', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply({ items: [], quota_remaining: 0, quota_max: 300 }),
    );
    await expect(collectAnswerTags(REF, { fetchImpl })).rejects.toThrow(
      StackExchangeQuotaError,
    );
  });

  it('carries the remaining allowance back so it can be shown', async () => {
    const result = await collectAnswerTags(REF, {
      fetchImpl: routed({ tags: [tag('python', 10)], quota: 12 }),
    });
    expect(result.quotaRemaining).toBe(12);
  });
});

describe('other failures', () => {
  it('turns a refusal into a StackExchangeError', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply({ error_message: 'ids' }, 400),
    );
    await expect(collectAnswerTags(REF, { fetchImpl })).rejects.toThrow(
      StackExchangeError,
    );
  });

  it('turns a network failure into one too', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(collectAnswerTags(REF, { fetchImpl })).rejects.toThrow(
      StackExchangeError,
    );
  });
});

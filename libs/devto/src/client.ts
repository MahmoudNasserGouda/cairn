/**
 * Reading someone's dev.to (Forem) articles (ADR-0036).
 *
 * The cheapest source in the product: public, key-free, one request, CORS-enabled.
 * ADR-0036 is unusually blunt that cheap is not the same as valuable — this feeds
 * `interests` and nothing else, because **writing about a technology is evidence of
 * interest, not of competence.** A tutorial on Kubernetes says its author wanted to
 * explain Kubernetes; it does not say they have run it in anger.
 *
 * Nothing is read that a stranger with a browser could not read.
 */

export const DEVTO_ORIGIN = 'https://dev.to';
/** Enough to characterise what someone writes about; beyond this is archaeology. */
const ARTICLE_LIMIT = 30;
/** Forem usernames are alphanumeric with underscores, and short. */
const USERNAME = /^[a-z0-9_]{1,40}$/i;

export class DevtoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevtoError';
  }
}

export interface DevtoArticle {
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly tags: readonly string[];
  /**
   * Read and **not used**. Popularity is not a signal this product scores on —
   * [ADR-0017](../../../docs/adr/0017-sponsorship-must-not-distort-scores.md) settled
   * the equivalent question for sponsorship. They are shown beside the article links and
   * go no further.
   */
  readonly reactions: number;
  readonly comments: number;
  readonly publishedAt: string | null;
}

export interface DevtoProfile {
  readonly username: string;
  readonly profileUrl: string;
  readonly articles: readonly DevtoArticle[];
}

export interface CollectOptions {
  readonly fetchImpl?: typeof fetch;
}

interface RawArticle {
  readonly title?: string;
  readonly description?: string;
  readonly url?: string;
  readonly tag_list?: readonly string[] | null;
  readonly public_reactions_count?: number;
  readonly comments_count?: number;
  readonly published_at?: string;
}

/**
 * Read a username out of whatever the person pasted.
 *
 * The user supplies it; it is never guessed from a GitHub login, for the reason
 * [ADR-0035](../../../docs/adr/0035-stack-exchange-as-evidence-of-expertise.md) gives —
 * a wrong match attributes a stranger's writing to someone's profile.
 */
export function parseDevtoUsername(input: string): string | null {
  const trimmed = input.trim().replace(/^@/, '');
  if (trimmed.length === 0) return null;
  if (USERNAME.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'dev.to') return null;

  // `/amara` and `/amara/some-article` both identify the same person.
  const first = url.pathname.split('/').filter((p) => p.length > 0)[0] ?? '';
  return USERNAME.test(first) ? first : null;
}

/** Everything this source reads, in one request. */
export async function collectArticles(
  username: string,
  options: CollectOptions = {},
): Promise<DevtoProfile> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${DEVTO_ORIGIN}/api/articles?username=${encodeURIComponent(
    username,
  )}&per_page=${ARTICLE_LIMIT}`;

  let res: Response;
  try {
    res = await doFetch(url);
  } catch {
    throw new DevtoError('could not reach dev.to');
  }
  if (!res.ok) {
    throw new DevtoError(`dev.to refused the request (${res.status})`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DevtoError('dev.to returned a response that could not be read');
  }
  if (!Array.isArray(body)) {
    // An unknown username returns `200` with an empty array, so a non-array here is a
    // shape change rather than an absent user, and guessing past it would be wrong.
    throw new DevtoError('dev.to returned something other than a list of articles');
  }

  return {
    username,
    profileUrl: `${DEVTO_ORIGIN}/${username}`,
    articles: (body as RawArticle[])
      .filter(
        (a): a is RawArticle =>
          typeof a?.title === 'string' &&
          a.title.length > 0 &&
          typeof a.url === 'string' &&
          a.url.length > 0,
      )
      .map((a) => ({
        title: a.title as string,
        description: a.description ?? null,
        url: a.url as string,
        tags: (a.tag_list ?? []).filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        ),
        reactions: a.public_reactions_count ?? 0,
        comments: a.comments_count ?? 0,
        publishedAt: a.published_at ?? null,
      })),
  };
}

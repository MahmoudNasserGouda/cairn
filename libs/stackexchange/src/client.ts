import type { StackExchangeUserRef } from './user-ref';

/**
 * Reading a Stack Exchange profile, anonymously (ADR-0035).
 *
 * Nothing here needs a key. The API allows 300 requests a day unauthenticated, which is
 * not a key-optional arrangement but genuinely none — and that matters, because a key is
 * a service-level secret and a static bundle cannot hold one (SECURITY.md §8.4). Asking
 * for one would have made the cheapest source the only one needing the Worker.
 *
 * Nothing is read that a stranger with a browser could not read.
 */

export const STACKEXCHANGE_ORIGIN = 'https://api.stackexchange.com';
const API = `${STACKEXCHANGE_ORIGIN}/2.3`;
/** Enough to describe someone; beyond this the tail is noise. */
const TAG_PAGE_SIZE = 30;

export class StackExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StackExchangeError';
  }
}

/**
 * Distinct from a generic failure, and the distinction is the point.
 *
 * The allowance is per **IP**, not per user, so a shared or NATed address can exhaust
 * it for everyone behind it. That means *we do not know*, and a caller must be able to
 * say so rather than render an empty skill list as "no expertise".
 */
export class StackExchangeQuotaError extends StackExchangeError {
  constructor(message: string) {
    super(message);
    this.name = 'StackExchangeQuotaError';
  }
}

export interface AnswerTag {
  readonly tag: string;
  readonly answers: number;
  /** Summed score of this person's answers in the tag — peer assessment, not volume. */
  readonly score: number;
}

export interface StackExchangeProfile {
  /** False when the id resolves to nobody. Distinct from a user with no answers. */
  readonly found: boolean;
  readonly userId: number;
  readonly site: string;
  readonly displayName: string | null;
  /** The link CC BY-SA requires beside anything rendered from this source. */
  readonly profileUrl: string | null;
  readonly reputation: number | null;
  readonly tags: readonly AnswerTag[];
  readonly quotaRemaining: number | null;
}

export interface CollectOptions {
  readonly fetchImpl?: typeof fetch;
}

interface Envelope<T> {
  readonly items?: readonly T[];
  readonly quota_remaining?: number;
  readonly error_id?: number;
  readonly error_name?: string;
  readonly error_message?: string;
  readonly backoff?: number;
}

interface RawUser {
  readonly user_id?: number;
  readonly display_name?: string;
  readonly link?: string;
  readonly reputation?: number;
}

interface RawTag {
  readonly tag_name?: string;
  readonly answer_count?: number;
  readonly answer_score?: number;
}

async function get<T>(
  path: string,
  site: string,
  doFetch: typeof fetch,
): Promise<Envelope<T>> {
  const url = `${API}${path}?site=${encodeURIComponent(site)}&pagesize=${TAG_PAGE_SIZE}`;
  let res: Response;
  try {
    res = await doFetch(url);
  } catch {
    throw new StackExchangeError('could not reach Stack Exchange');
  }

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new StackExchangeError(
      'Stack Exchange returned a response that could not be read',
    );
  }

  // `throttle_violation` arrives as a 400 with an error name, not as a 429.
  if (body.error_name === 'throttle_violation' || body.error_id === 502) {
    throw new StackExchangeQuotaError(
      'Stack Exchange is rate limiting this address; the result is unknown, not empty',
    );
  }
  if (!res.ok || body.error_message !== undefined) {
    throw new StackExchangeError(
      `Stack Exchange refused the request (${body.error_message ?? res.status})`,
    );
  }
  if (body.quota_remaining === 0) {
    // Reached the daily allowance mid-import. Treated as quota rather than as data, so
    // a half-read profile is never mistaken for a complete one.
    throw new StackExchangeQuotaError(
      "today's Stack Exchange allowance for this address is used up; try again tomorrow",
    );
  }
  return body;
}

/**
 * One profile, in two requests: the user (for the attribution link) and their
 * top answer tags.
 *
 * Two rather than one because the tags endpoint does not carry the display name or the
 * profile URL, and [ADR-0035](../../../docs/adr/0035-stack-exchange-as-evidence-of-expertise.md)
 * makes attribution a condition of shipping rather than a nicety. Against 300 a day,
 * two is not the constraint.
 */
export async function collectAnswerTags(
  ref: StackExchangeUserRef,
  options: CollectOptions = {},
): Promise<StackExchangeProfile> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const [profile, tags] = await Promise.all([
    get<RawUser>(`/users/${ref.userId}`, ref.site, doFetch),
    get<RawTag>(`/users/${ref.userId}/top-answer-tags`, ref.site, doFetch),
  ]);

  const who = profile.items?.[0];
  return {
    found: who !== undefined,
    userId: ref.userId,
    site: ref.site,
    displayName: who?.display_name ?? null,
    profileUrl: who?.link ?? null,
    reputation: who?.reputation ?? null,
    tags: (tags.items ?? [])
      .map((item) => ({
        tag: item.tag_name ?? '',
        answers: item.answer_count ?? 0,
        score: item.answer_score ?? 0,
      }))
      .filter((t) => t.tag.length > 0),
    quotaRemaining: tags.quota_remaining ?? profile.quota_remaining ?? null,
  };
}

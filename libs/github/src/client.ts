import {
  type KeyValueStore,
  CACHE_MAX_ENTRIES,
  MemoryStore,
  logger,
} from '@cairn/shared';

/**
 * Direct-from-browser GitHub client (ADR-0006). Responsibilities baked in here:
 * response caching with ETag revalidation, in-flight request deduplication,
 * and rate-limit awareness. No Cairn proxy — requests go straight to api.github.com
 * with the user's own token.
 */
export interface RateLimit {
  readonly limit: number;
  readonly remaining: number;
  readonly resetEpochMs: number;
}

export interface GithubClientOptions {
  /** OAuth access token. Kept in memory by the caller (ADR-0020); never logged. */
  readonly token?: string;
  readonly baseUrl?: string;
  readonly cache?: KeyValueStore;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  /**
   * Upper bound on the "stop making live calls" quota floor. The effective floor
   * is `min(this, 10% of that resource's quota)`, so it adapts to the Search API's
   * tiny quota (10/30) without starving the 5000/hr core API.
   */
  readonly rateLimitFloor?: number;
  /** Abort a request that has not responded in this many ms. */
  readonly timeoutMs?: number;
  /** Cached responses to keep before the oldest are evicted. */
  readonly maxCacheEntries?: number;
}

interface CacheEntry<T> {
  readonly data: T;
  readonly etag: string | null;
  readonly fetchedAtMs: number;
  readonly ttlMs: number;
}

export interface GetOptions {
  readonly ttlMs?: number;
  /** Force a revalidation even if the cached entry is still fresh. */
  readonly forceRevalidate?: boolean;
}

export class RateLimitError extends Error {
  constructor(public readonly rateLimit: RateLimit) {
    super('GitHub rate limit reached; serving cache only.');
    this.name = 'RateLimitError';
  }
}

/**
 * GitHub's *secondary* rate limit (abuse detection). It arrives as 403 or 429 with
 * `retry-after` and, unlike the primary limit, does not zero `x-ratelimit-remaining`
 * — so it has to be recognised separately or it surfaces as a bare `GitHub 403`.
 */
export class SecondaryRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('GitHub asked us to slow down; retry shortly.');
    this.name = 'SecondaryRateLimitError';
  }
}

const DEFAULT_TTL = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Cache writes between eviction sweeps. A sweep costs one extra store read. */
const SWEEP_INTERVAL = 50;
/** Key of the `key -> fetchedAtMs` index the eviction sweep reads instead of
 *  loading every cached response back out of the store. */
const INDEX_KEY = 'gh:__index';

/** GitHub reports quota per resource; `/search/*` has its own (tiny) bucket. */
function resourceForPath(path: string): string {
  return path.startsWith('/search/') ? 'search' : 'core';
}

/**
 * How long GitHub asked us to wait, in ms, from `retry-after` (delta seconds) or
 * `x-ratelimit-reset` (epoch seconds). Null when the response names neither, which
 * is how a plain 403 (bad token, private repo) is told apart from a throttle.
 */
function retryAfterFrom(res: Response, nowMs: number): number | null {
  const retryAfter = Number(res.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const delta = reset * 1000 - nowMs;
    if (delta > 0) return delta;
  }
  return null;
}

export class GithubClient {
  private readonly baseUrl: string;
  private readonly cache: KeyValueStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly floor: number;
  private readonly timeoutMs: number;
  private readonly maxCacheEntries: number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  /** Most recent rate-limit snapshot per GitHub resource (`core`, `search`, …). */
  private readonly rateLimits = new Map<string, RateLimit>();
  /** Epoch ms before which a resource must not be called again (secondary limit). */
  private readonly backoffUntil = new Map<string, number>();
  private writesSinceSweep = 0;

  constructor(private readonly opts: GithubClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.github.com';
    this.cache = opts.cache ?? new MemoryStore();
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.floor = opts.rateLimitFloor ?? 50;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxCacheEntries = opts.maxCacheEntries ?? CACHE_MAX_ENTRIES;
  }

  get rateLimit(): RateLimit | null {
    return this.rateLimits.get('core') ?? null;
  }

  /** Effective floor for a resource: capped at 10% of its known quota. */
  private floorFor(rl: RateLimit): number {
    return rl.limit > 0
      ? Math.min(this.floor, Math.max(1, Math.ceil(rl.limit * 0.1)))
      : this.floor;
  }

  /** GET a JSON resource, using the cache and deduplicating concurrent calls. */
  async get<T>(path: string, options: GetOptions = {}): Promise<T> {
    const key = `gh:${path}`;
    // A forced revalidation must not be answered by an in-flight plain read, or the
    // caller asking for fresh data silently gets the stale copy it was avoiding.
    const flightKey = options.forceRevalidate ? `${key}#revalidate` : key;
    const existing = this.inFlight.get(flightKey);
    if (existing) return existing as Promise<T>;

    const p = this.getUncached<T>(key, path, options).finally(() => {
      this.inFlight.delete(flightKey);
    });
    this.inFlight.set(flightKey, p);
    return p;
  }

  private async getUncached<T>(
    key: string,
    path: string,
    options: GetOptions,
  ): Promise<T> {
    const cached = (await this.cache.get<CacheEntry<T>>(key)) ?? null;
    const age = cached ? this.now() - cached.fetchedAtMs : Infinity;
    const fresh = cached && age < cached.ttlMs && !options.forceRevalidate;
    if (fresh) return cached.data;

    const resource = resourceForPath(path);

    const backoff = this.backoffUntil.get(resource);
    if (backoff !== undefined && this.now() < backoff) {
      if (cached) {
        logger.warn('github: backing off, serving stale cache', { path });
        return cached.data;
      }
      throw new SecondaryRateLimitError(backoff - this.now());
    }

    const rl = this.rateLimits.get(resource) ?? null;
    if (rl && rl.remaining < this.floorFor(rl) && this.now() < rl.resetEpochMs) {
      if (cached) {
        logger.warn('github: rate-limit floor hit, serving stale cache', { path });
        return cached.data;
      }
      throw new RateLimitError(rl);
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    const signal = this.abortSignal();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers,
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      // Offline, DNS failure, or our own timeout. A local-first client should not
      // lose a perfectly good cached answer to a transient network fault.
      if (cached) {
        logger.warn('github: request failed, serving stale cache', { path });
        return cached.data;
      }
      throw e;
    }
    const captured = this.captureRateLimit(res, resource);

    if (res.status === 304 && cached) {
      const refreshed: CacheEntry<T> = { ...cached, fetchedAtMs: this.now() };
      await this.writeEntry(key, refreshed);
      return cached.data;
    }

    if (res.status === 403 && captured?.remaining === 0) {
      if (cached) return cached.data;
      throw new RateLimitError(captured);
    }

    // Secondary ("abuse") limit: 429 always, 403 when quota is *not* exhausted.
    if (res.status === 429 || (res.status === 403 && captured?.remaining !== 0)) {
      const retryAfterMs = retryAfterFrom(res, this.now());
      if (retryAfterMs !== null) {
        this.backoffUntil.set(resource, this.now() + retryAfterMs);
        if (cached) {
          logger.warn('github: secondary rate limit, serving stale cache', { path });
          return cached.data;
        }
        throw new SecondaryRateLimitError(retryAfterMs);
      }
    }

    if (!res.ok) {
      if (cached) {
        logger.warn('github: upstream error, serving stale cache', {
          path,
          status: res.status,
        });
        return cached.data;
      }
      throw new Error(`GitHub ${res.status} for ${path}`);
    }

    this.backoffUntil.delete(resource);

    if (res.status === 202) {
      // GitHub answers 202 from `/stats/*` (and `/contributors` on large repos)
      // while it computes the series, with a placeholder body — `{}`, not the
      // eventual array. Callers normalise the shape; what matters here is that the
      // placeholder must NOT be cached, or a repository whose statistics happened to
      // be cold once would read as having no activity for the resource's whole TTL.
      return (await res.json().catch(() => null)) as T;
    }

    const data = (await res.json()) as T;
    const entry: CacheEntry<T> = {
      data,
      etag: res.headers.get('etag'),
      fetchedAtMs: this.now(),
      ttlMs: options.ttlMs ?? DEFAULT_TTL,
    };
    await this.writeEntry(key, entry);
    return data;
  }

  /** An abort signal for one request, when the runtime offers timers for it. */
  private abortSignal(): AbortSignal | undefined {
    const timeout = (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout;
    return typeof timeout === 'function' ? timeout(this.timeoutMs) : undefined;
  }

  /**
   * Write a cache entry and keep the store inside its entry budget.
   *
   * Eviction reads a single `key -> fetchedAtMs` index rather than every cached
   * response, so a sweep stays cheap even at the 2000-entry cap. Without this the
   * cache grew forever — a search-heavy session could fill IndexedDB unbounded.
   *
   * Sweeps are periodic, so the bound is `maxCacheEntries + SWEEP_INTERVAL`, not a
   * hard ceiling on every write.
   */
  private async writeEntry<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    await this.cache.set(key, entry);
    let index: Record<string, number>;
    try {
      index = (await this.cache.get<Record<string, number>>(INDEX_KEY)) ?? {};
    } catch {
      return;
    }
    index[key] = entry.fetchedAtMs;

    if (++this.writesSinceSweep >= SWEEP_INTERVAL) {
      this.writesSinceSweep = 0;
      const excess = Object.keys(index).length - this.maxCacheEntries;
      if (excess > 0) {
        const oldest = Object.entries(index)
          .sort((a, b) => a[1] - b[1])
          .slice(0, excess);
        for (const [staleKey] of oldest) {
          delete index[staleKey];
          try {
            await this.cache.delete(staleKey);
          } catch {
            /* a key that will not delete is not worth failing the request over */
          }
        }
      }
    }
    try {
      await this.cache.set(INDEX_KEY, index);
    } catch {
      /* the index is an optimisation; losing it only delays eviction */
    }
  }

  private captureRateLimit(res: Response, fallbackResource: string): RateLimit | null {
    const limit = Number(res.headers.get('x-ratelimit-limit'));
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (Number.isNaN(remaining) || Number.isNaN(reset)) return null;
    const resource = res.headers.get('x-ratelimit-resource') ?? fallbackResource;
    const rl: RateLimit = {
      limit: Number.isNaN(limit) ? 0 : limit,
      remaining,
      resetEpochMs: reset * 1000,
    };
    this.rateLimits.set(resource, rl);
    return rl;
  }
}

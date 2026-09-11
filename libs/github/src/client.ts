import { type KeyValueStore, MemoryStore, logger } from '@cairn/shared';

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

const DEFAULT_TTL = 60 * 60 * 1000;

/** GitHub reports quota per resource; `/search/*` has its own (tiny) bucket. */
function resourceForPath(path: string): string {
  return path.startsWith('/search/') ? 'search' : 'core';
}

export class GithubClient {
  private readonly baseUrl: string;
  private readonly cache: KeyValueStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly floor: number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  /** Most recent rate-limit snapshot per GitHub resource (`core`, `search`, …). */
  private readonly rateLimits = new Map<string, RateLimit>();

  constructor(private readonly opts: GithubClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.github.com';
    this.cache = opts.cache ?? new MemoryStore();
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.floor = opts.rateLimitFloor ?? 50;
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
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const p = this.getUncached<T>(key, path, options).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, p);
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

    const rl = this.rateLimits.get(resourceForPath(path)) ?? null;
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

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers });
    const captured = this.captureRateLimit(res, resourceForPath(path));

    if (res.status === 304 && cached) {
      const refreshed: CacheEntry<T> = { ...cached, fetchedAtMs: this.now() };
      await this.cache.set(key, refreshed);
      return cached.data;
    }

    if (res.status === 403 && captured?.remaining === 0) {
      if (cached) return cached.data;
      throw new RateLimitError(captured);
    }

    if (!res.ok) {
      throw new Error(`GitHub ${res.status} for ${path}`);
    }

    const data = (await res.json()) as T;
    const entry: CacheEntry<T> = {
      data,
      etag: res.headers.get('etag'),
      fetchedAtMs: this.now(),
      ttlMs: options.ttlMs ?? DEFAULT_TTL,
    };
    await this.cache.set(key, entry);
    return data;
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

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GithubClient, RateLimitError } from '@cairn/github';
import type { UnifiedProfile } from '@cairn/profile';
import { DiscoveryService } from './discovery.service';
import { ProfileService } from '../profile/profile.service';
import { GithubClientService } from '../github-client';
import { IndexedDbStore } from '../indexeddb-store';

const PRESET_KEY = 'discovery:preset:v1';

class FakeStore {
  readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

function profile(skills: UnifiedProfile['skills']): UnifiedProfile {
  return {
    identities: [],
    skills,
    experienceLevel: 'intermediate',
    totalYears: 3,
    interests: ['react'],
    experience: [],
    education: [],
  } as unknown as UnifiedProfile;
}

const TS_PROFILE = profile([
  { tag: 'typescript', level: 0.9, source: 'github' },
  { tag: 'python', level: 0.5, source: 'github' },
]);

function searchItem(name: string, extra: Record<string, unknown> = {}) {
  return {
    full_name: name,
    description: 'a project',
    language: 'TypeScript',
    stargazers_count: 1600,
    forks_count: 50,
    open_issues_count: 20,
    topics: ['react'],
    pushed_at: new Date().toISOString(),
    archived: false,
    fork: false,
    html_url: `https://github.com/${name}`,
    ...extra,
  };
}

/** A client whose `get` is driven by a per-test handler over the search path. */
function fakeClient(handler: (path: string) => unknown): GithubClient {
  return {
    get(path: string) {
      const out = handler(path);
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    },
  } as unknown as GithubClient;
}

function makeService(
  store: FakeStore,
  client: GithubClient,
  prof: UnifiedProfile | null = TS_PROFILE,
): DiscoveryService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IndexedDbStore, useValue: store },
      { provide: GithubClientService, useValue: { get: () => client } },
      {
        provide: ProfileService,
        useValue: {
          profile: () => prof,
          priorContributions: () => 2,
          hasCv: () => false,
        },
      },
    ],
  });
  return TestBed.inject(DiscoveryService);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('running discovery', () => {
  it('spends one search per planned lane and no per-repository calls', async () => {
    // The whole design rests on this: a run costs a handful of search requests,
    // never one per candidate. If a health call ever creeps in, this fails.
    const paths: string[] = [];
    const svc = makeService(
      new FakeStore(),
      fakeClient((path) => {
        paths.push(path);
        return { items: [searchItem('acme/thing')] };
      }),
    );
    await settle();
    await svc.run();

    expect(paths.length).toBe(svc.plan().length);
    expect(paths.every((p) => p.startsWith('/search/repositories'))).toBe(true);
    expect(paths.some((p) => p.includes('/stats/') || p.includes('/community/'))).toBe(
      false,
    );
  });

  it('de-duplicates a repository returned by several lanes', async () => {
    const svc = makeService(
      new FakeStore(),
      fakeClient(() => ({ items: [searchItem('acme/thing')] })),
    );
    await settle();
    await svc.run();

    expect(svc.recommendations()).toHaveLength(1);
    expect(svc.recommendations()[0]?.candidate.foundBy.length).toBeGreaterThan(1);
  });

  it('refuses to run against a profile with no programming language', async () => {
    const svc = makeService(
      new FakeStore(),
      fakeClient(() => ({ items: [] })),
      profile([{ tag: 'docker', level: 0.8, source: 'cv' }]),
    );
    await settle();

    expect(svc.canRun()).toBe(false);
    await svc.run();
    expect(svc.error()).toMatch(/does not name a programming language/i);
    expect(svc.recommendations()).toEqual([]);
  });

  it('says so rather than scoring nothing when there is no profile at all', async () => {
    const svc = makeService(
      new FakeStore(),
      fakeClient(() => ({ items: [] })),
      null,
    );
    await settle();
    await svc.run();

    expect(svc.canRun()).toBe(false);
    expect(svc.error()).toMatch(/connect github or import a cv/i);
  });

  it('keeps the results it already has when the search quota runs out', async () => {
    let calls = 0;
    const svc = makeService(
      new FakeStore(),
      fakeClient(() => {
        calls++;
        if (calls > 1) {
          return new RateLimitError({ limit: 10, remaining: 0, resetEpochMs: 0 });
        }
        return { items: [searchItem('acme/first')] };
      }),
    );
    await settle();
    await svc.run();

    // Partial results beat an error banner and an empty page.
    expect(svc.recommendations()).toHaveLength(1);
    expect(svc.throttled()).toBe(true);
    expect(svc.error()).toBeNull();
  });

  it('explains the quota when it runs out before any lane returns', async () => {
    const svc = makeService(
      new FakeStore(),
      fakeClient(() => new RateLimitError({ limit: 10, remaining: 0, resetEpochMs: 0 })),
    );
    await settle();
    await svc.run();

    expect(svc.recommendations()).toEqual([]);
    expect(svc.error()).toMatch(/search quota/i);
    expect(svc.hasRun()).toBe(true);
  });

  it('surfaces a non-quota failure instead of reporting an empty result set', async () => {
    const svc = makeService(
      new FakeStore(),
      fakeClient(() => new Error('GitHub 500 for /search/repositories')),
    );
    await settle();
    await svc.run();

    expect(svc.error()).toMatch(/500/);
    expect(svc.recommendations()).toEqual([]);
  });
});

describe('presets', () => {
  it('re-ranks without touching the network', async () => {
    let calls = 0;
    const svc = makeService(
      new FakeStore(),
      fakeClient(() => {
        calls++;
        return {
          items: [
            searchItem('a/familiar', { topics: ['react'] }),
            searchItem('b/novel', { topics: ['rust', 'wasm'], language: 'Rust' }),
          ],
        };
      }),
    );
    await settle();
    await svc.run();
    const afterRun = calls;

    await svc.setPreset('learning');

    expect(calls).toBe(afterRun);
    expect(svc.result()?.preset).toBe('learning');
    expect(svc.recommendations().length).toBe(2);
  });

  it('remembers the preset across a reload', async () => {
    const store = new FakeStore();
    store.map.set(PRESET_KEY, 'quick-win');

    const svc = makeService(
      store,
      fakeClient(() => ({ items: [] })),
    );
    await settle();

    expect(svc.preset()).toBe('quick-win');
  });

  it('ignores a stored value that is not a preset', async () => {
    const store = new FakeStore();
    store.map.set(PRESET_KEY, 'whatever-the-user-put-there');

    const svc = makeService(
      store,
      fakeClient(() => ({ items: [] })),
    );
    await settle();

    expect(svc.preset()).toBe('balanced');
  });
});

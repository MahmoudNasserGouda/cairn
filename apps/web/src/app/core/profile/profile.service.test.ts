import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { GithubClient } from '@cairn/github';
import type { ParsedCv } from '@cairn/profile';
import { ProfileService, profileToSnapshot } from './profile.service';
import { AuthService } from '../auth/auth.service';
import { GithubClientService } from '../github-client';
import { IndexedDbStore } from '../indexeddb-store';

const CV_KEY = 'profile:cv:v1';

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

/** `searchOk: false` makes the merged-PR search fail, as a throttle would. */
function fakeClient(searchOk = true): GithubClient {
  return {
    async get(path: string) {
      if (path.startsWith('/search/issues')) {
        if (!searchOk) throw new Error('rate limited');
        return { total_count: 12 };
      }
      if (path === '/user')
        return {
          login: 'octo',
          name: 'The Octocat',
          created_at: '2018-01-01T00:00:00Z',
          avatar_url: null,
        };
      if (path.startsWith('/user/repos'))
        return [
          {
            full_name: 'octo/a',
            language: 'TypeScript',
            topics: ['react'],
            fork: false,
            stargazers_count: 1,
            pushed_at: '2024-06-01T00:00:00Z',
          },
        ];
      if (path.includes('/languages')) return { TypeScript: 5000 };
      return [];
    },
  } as unknown as GithubClient;
}

function makeService(opts: {
  store?: FakeStore;
  signedIn?: boolean;
  searchOk?: boolean;
}): { svc: ProfileService; store: FakeStore } {
  const store = opts.store ?? new FakeStore();
  const signedIn = opts.signedIn ?? true;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IndexedDbStore, useValue: store },
      {
        provide: GithubClientService,
        useValue: { get: () => fakeClient(opts.searchOk ?? true) },
      },
      {
        provide: AuthService,
        useValue: {
          hasIdentity: (p: string) => signedIn && p === 'github',
          githubToken: signedIn ? 'tok' : null,
        },
      },
    ],
  });
  return { svc: TestBed.inject(ProfileService), store };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const CV: ParsedCv = {
  name: 'Octo',
  skills: ['python', 'docker'],
  experience: [{ title: 'Dev', startYear: 2020, endYear: 2023, source: 'cv' }],
  sections: ['skills'],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GitHub half of the profile', () => {
  it('builds a profile from the shared client', async () => {
    const { svc } = makeService({});
    await settle();

    expect(svc.profile()?.skills.map((s) => s.tag)).toContain('typescript');
    expect(svc.priorContributions()).toBe(12);
    expect(svc.priorContributionsKnown()).toBe(true);
    expect(svc.error()).toBeNull();
  });

  it('flags an unknown merged-PR count instead of reporting zero contributions', async () => {
    // A throttled Search API used to silently become "0 merged PRs", which then
    // scored as an empty track record.
    const { svc } = makeService({ searchOk: false });
    await settle();

    expect(svc.priorContributions()).toBe(0);
    expect(svc.priorContributionsKnown()).toBe(false);
  });

  it('has no profile at all when GitHub is not connected', async () => {
    const { svc } = makeService({ signedIn: false });
    await settle();

    expect(svc.profile()).toBeNull();
  });
});

describe('CV half of the profile', () => {
  it('merges a reviewed CV onto the GitHub profile and persists it', async () => {
    const { svc, store } = makeService({});
    await settle();
    await svc.setCv(CV);

    const tags = svc.profile()?.skills.map((s) => s.tag) ?? [];
    expect(tags).toContain('typescript'); // from GitHub
    expect(tags).toContain('docker'); // from the CV
    expect(svc.hasCv()).toBe(true);
    expect(store.map.get(CV_KEY)).toEqual(CV);
  });

  it('restores a previously reviewed CV', async () => {
    const store = new FakeStore();
    store.map.set(CV_KEY, CV);

    const { svc } = makeService({ store, signedIn: false });
    await settle();

    expect(svc.hasCv()).toBe(true);
    expect(svc.profile()?.skills.map((s) => s.tag)).toContain('docker');
  });

  it('does not double-count years when the same CV is committed twice', async () => {
    const { svc } = makeService({ signedIn: false });
    await settle();

    await svc.setCv(CV);
    const once = svc.profile()?.totalYears;
    await svc.setCv(CV);

    expect(svc.profile()?.totalYears).toBe(once);
  });

  it('removing the CV leaves the GitHub half intact', async () => {
    const { svc, store } = makeService({});
    await settle();
    await svc.setCv(CV);
    await svc.clearCv();

    expect(svc.hasCv()).toBe(false);
    expect(store.map.has(CV_KEY)).toBe(false);
    expect(svc.profile()?.skills.map((s) => s.tag)).toContain('typescript');
  });

  it('works with a CV and no GitHub connection', async () => {
    const { svc } = makeService({ signedIn: false });
    await settle();
    await svc.setCv(CV);

    expect(svc.profile()).not.toBeNull();
    expect(svc.profile()?.skills.map((s) => s.tag)).toEqual(
      expect.arrayContaining(['python', 'docker']),
    );
  });
});

describe('profileToSnapshot', () => {
  it('carries the fields the matching engine scores on', async () => {
    const { svc } = makeService({});
    await settle();
    const snapshot = profileToSnapshot(svc.profile()!, svc.priorContributions());

    expect(snapshot.priorContributions).toBe(12);
    expect(snapshot.skills.length).toBeGreaterThan(0);
    expect(snapshot.experience).toBeDefined();
  });
});

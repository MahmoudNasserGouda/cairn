import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GithubClient } from '@cairn/github';
import { TargetService } from './target.service';
import { GithubClientService } from '../github-client';
import { IndexedDbStore } from '../indexeddb-store';

const TARGET_KEY = 'dashboard:target:v1';

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

/**
 * A client that answers the three calls `selectRepo` makes. `issues` decides which
 * issue numbers are still open.
 */
function fakeClient(issueNumbers: number[]): GithubClient {
  return {
    async get(path: string) {
      if (path.startsWith('/search/issues')) return { total_count: 2 };
      if (path.includes('/languages')) return { TypeScript: 100 };
      if (path.includes('/community/profile'))
        return {
          health_percentage: 80,
          files: { readme: {}, contributing: {}, code_of_conduct: {} },
        };
      if (path.includes('/stats/commit_activity'))
        return Array.from({ length: 52 }, () => ({ total: 4, week: 0 }));
      if (path.includes('/contributors'))
        return [
          { login: 'x', contributions: 10 },
          { login: 'y', contributions: 8 },
          { login: 'z', contributions: 6 },
        ];
      if (path.includes('/pulls')) return [];
      if (path.includes('/releases')) return [];
      if (path.includes('/issues'))
        return issueNumbers.map((n) => ({
          number: n,
          title: `issue ${n}`,
          body: 'body',
          labels: [],
          comments: 0,
          html_url: 'u',
        }));
      if (/\/repos\/[^/]+\/[^/]+$/.test(path))
        return {
          full_name: 'a/b',
          description: 'd',
          topics: ['typescript', 'hacktoberfest'],
          language: 'TypeScript',
          pushed_at: new Date().toISOString(),
          open_issues_count: 3,
        };
      return [];
    },
  } as unknown as GithubClient;
}

function makeService(store: FakeStore, client: GithubClient): TargetService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IndexedDbStore, useValue: store },
      { provide: GithubClientService, useValue: { get: () => client } },
    ],
  });
  return TestBed.inject(TargetService);
}

/** The service restores in its constructor; give those promises a turn to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('restoring a saved target', () => {
  it('brings back both the repository and the saved issue', async () => {
    const store = new FakeStore();
    store.map.set(TARGET_KEY, { repoSlug: 'a/b', issueNumber: 7 });

    const svc = makeService(store, fakeClient([5, 7, 9]));
    await settle();

    expect(svc.error()).toBeNull();
    expect(svc.repoName()).toBe('a/b');
    expect(svc.issueNumber()).toBe(7);
    expect(svc.issueSnapshot()).not.toBeNull();
  });

  it('KEEPS a saved issue that is missing from the fetched page', async () => {
    // Regression: restore() called selectRepo(), which persisted `issueNumber: null`
    // before the issue could be reselected. An issue that is simply further down a
    // long list — not closed — was then erased from storage for good.
    const store = new FakeStore();
    store.map.set(TARGET_KEY, { repoSlug: 'a/b', issueNumber: 7 });

    const svc = makeService(store, fakeClient([1, 2, 3]));
    await settle();

    expect(svc.repoName()).toBe('a/b');
    expect(svc.issueNumber()).toBeNull();
    expect(svc.error()).toMatch(/#7/);
    // The stored choice survives for the next load.
    expect(store.map.get(TARGET_KEY)).toEqual({ repoSlug: 'a/b', issueNumber: 7 });
  });

  it('replaces the kept issue as soon as the user picks another', async () => {
    const store = new FakeStore();
    store.map.set(TARGET_KEY, { repoSlug: 'a/b', issueNumber: 7 });

    const svc = makeService(store, fakeClient([1, 2, 3]));
    await settle();
    svc.selectIssue(2);
    await settle();

    expect(store.map.get(TARGET_KEY)).toEqual({ repoSlug: 'a/b', issueNumber: 2 });
  });

  it('still remembers the repository after a restore', async () => {
    const store = new FakeStore();
    store.map.set(TARGET_KEY, { repoSlug: 'a/b', issueNumber: null });

    makeService(store, fakeClient([1]));
    await settle();

    expect(store.map.get(TARGET_KEY)).toMatchObject({ repoSlug: 'a/b' });
  });
});

describe('scoring target', () => {
  it('filters free-text topics out of the repository stack', async () => {
    const svc = makeService(new FakeStore(), fakeClient([1]));
    await settle();
    await svc.selectRepo('a/b');

    // `hacktoberfest` is a topic on the fixture but is not a technology.
    expect(svc.repoSnapshot()?.technologies).toContain('typescript');
    expect(svc.repoSnapshot()?.technologies).not.toContain('hacktoberfest');
  });

  it('rejects a slug that is not owner/repo', async () => {
    const svc = makeService(new FakeStore(), fakeClient([1]));
    await settle();
    await svc.selectRepo('not-a-slug');

    expect(svc.error()).toMatch(/valid owner\/repo/);
    expect(svc.repoName()).toBeNull();
  });

  it('clears the persisted choice', async () => {
    const store = new FakeStore();
    const svc = makeService(store, fakeClient([1]));
    await settle();
    await svc.selectRepo('a/b');
    expect(store.map.has(TARGET_KEY)).toBe(true);

    svc.clear();
    await settle();

    expect(svc.repoName()).toBeNull();
    expect(store.map.has(TARGET_KEY)).toBe(false);
  });
});

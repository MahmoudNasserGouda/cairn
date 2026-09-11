import { Injectable, computed, inject, signal } from '@angular/core';
import {
  collectHealthSignals,
  fetchRepoOverview,
  listOpenIssues,
  searchRepositories,
  toIssueInput,
  type IssueListItem,
  type RepoOverview,
  type RepoSearchResult,
} from '@cairn/github';
import { healthScore } from '@cairn/repository-analysis';
import { analyzeIssue } from '@cairn/issue-analysis';
import { repoToSnapshot, issueToSnapshot } from '@cairn/targets';
import type { RepositorySnapshot, IssueSnapshot } from '@cairn/matching';
import { GithubClientService } from '../github-client';
import { IndexedDbStore } from '../indexeddb-store';

const TARGET_KEY = 'dashboard:target:v1';
const SLUG_RE = /^([\w.-]+)\/([\w.-]+)$/;

interface TargetSelection {
  readonly repoSlug: string;
  readonly issueNumber: number | null;
}

interface LoadedRepo {
  readonly overview: RepoOverview;
  readonly snapshot: RepositorySnapshot;
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Owns the dashboard's scoring target: search for a repository, pick one, pick an
 * open issue, and expose the `RepositorySnapshot` / `IssueSnapshot` the matching
 * engine needs. The choice (repo slug + issue number) is persisted so it survives
 * a reload. All repo/issue text is rendered by the template as interpolation only
 * — it is untrusted external content (SECURITY.md).
 */
@Injectable({ providedIn: 'root' })
export class TargetService {
  private readonly gh = inject(GithubClientService);
  private readonly store = inject(IndexedDbStore);

  private readonly _results = signal<readonly RepoSearchResult[]>([]);
  private readonly _searching = signal(false);
  private readonly _repo = signal<LoadedRepo | null>(null);
  private readonly _issues = signal<readonly IssueListItem[]>([]);
  private readonly _issueSnapshot = signal<IssueSnapshot | null>(null);
  private readonly _issueNumber = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly results = this._results.asReadonly();
  readonly searching = this._searching.asReadonly();
  readonly issues = this._issues.asReadonly();
  readonly issueSnapshot = this._issueSnapshot.asReadonly();
  readonly issueNumber = this._issueNumber.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly repoName = computed(() => this._repo()?.overview.fullName ?? null);
  readonly repoSnapshot = computed(() => this._repo()?.snapshot ?? null);
  readonly hasTarget = computed(() => this._repo() !== null);

  constructor() {
    void this.restore();
  }

  async search(query: string): Promise<void> {
    const q = query.trim();
    if (!q) {
      this._results.set([]);
      return;
    }
    this._searching.set(true);
    this._error.set(null);
    try {
      this._results.set(await searchRepositories(this.gh.get(), q));
    } catch (e) {
      this._error.set(message(e, 'repository search failed'));
    } finally {
      this._searching.set(false);
    }
  }

  async selectRepo(slug: string): Promise<void> {
    const m = SLUG_RE.exec(slug.trim());
    if (!m) {
      this._error.set('Not a valid owner/repo.');
      return;
    }
    const id = { owner: m[1]!, repo: m[2]! };
    this._loading.set(true);
    this._error.set(null);
    try {
      const client = this.gh.get();
      const [overview, signals, issues] = await Promise.all([
        fetchRepoOverview(client, id),
        collectHealthSignals(client, id),
        listOpenIssues(client, id, { perPage: 30 }),
      ]);
      this._repo.set({
        overview,
        snapshot: repoToSnapshot(overview, signals, healthScore(signals)),
      });
      this._issues.set(issues);
      this._results.set([]);
      this._issueSnapshot.set(null);
      this._issueNumber.set(null);
      await this.persist();
    } catch (e) {
      this._error.set(message(e, 'could not load that repository'));
    } finally {
      this._loading.set(false);
    }
  }

  selectIssue(issueNumber: number): void {
    const item = this._issues().find((i) => i.number === issueNumber);
    if (!item) return;
    this._issueSnapshot.set(issueToSnapshot(item, analyzeIssue(toIssueInput(item))));
    this._issueNumber.set(issueNumber);
    void this.persist();
  }

  clear(): void {
    this._repo.set(null);
    this._issues.set([]);
    this._issueSnapshot.set(null);
    this._issueNumber.set(null);
    this._results.set([]);
    this._error.set(null);
    void this.store.delete(TARGET_KEY);
  }

  private async persist(issueNumber = this._issueNumber()): Promise<void> {
    const repo = this._repo();
    if (!repo) return;
    try {
      await this.store.set<TargetSelection>(TARGET_KEY, {
        repoSlug: repo.overview.fullName,
        issueNumber,
      });
    } catch {
      // A target that cannot be remembered is not worth an error banner.
    }
  }

  private async restore(): Promise<void> {
    let saved: TargetSelection | undefined;
    try {
      saved = await this.store.get<TargetSelection>(TARGET_KEY);
    } catch {
      return;
    }
    if (!saved?.repoSlug) return;
    await this.selectRepo(saved.repoSlug);
    if (this._repo() === null) return;

    if (saved.issueNumber === null) {
      await this.persist(null);
      return;
    }

    this.selectIssue(saved.issueNumber);
    if (this._issueNumber() !== null) return; // selectIssue already persisted it

    // The issue is not in the page we fetched. That does not mean it is closed — it
    // may simply be further down a long list — so the choice is *kept* rather than
    // overwritten with null. Picking another issue replaces it; until then a stale
    // number costs nothing and a still-open issue is not silently forgotten.
    this._error.set(
      `Couldn't find issue #${saved.issueNumber} in this repository's open issues — ` +
        `it may be closed, or further down the list. Pick another to re-score.`,
    );
    await this.persist(saved.issueNumber);
  }
}

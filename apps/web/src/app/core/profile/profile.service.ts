import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { collectViewerGraph } from '@cairn/github';
import { collectGitlabViewer, GitlabClient } from '@cairn/gitlab';
import {
  applyEdit,
  cvToFragment,
  emptyProfile,
  forgetSource,
  githubToFragment,
  gitlabToFragment,
  hasSource,
  linkedinToFragment,
  mergeProfile,
  readStoredProfile,
  type LinkedinArchiveInput,
  type ProfileEdit,
  type ProfileSource,
  type ParsedCv,
  type ProfileFragment,
  type UnifiedProfile,
} from '@cairn/profile';
import type { DeveloperSnapshot } from '@cairn/matching';
import { AuthService } from '../auth/auth.service';
import { GithubClientService } from '../github-client';
import { IndexedDbStore } from '../indexeddb-store';

/** The merged profile, including every hand edit. The source of truth. */
const PROFILE_KEY = 'profile:v2';
/** Pre-v2: the reviewed `ParsedCv`. Read once to migrate, then left alone. */
const LEGACY_CV_KEY = 'profile:cv:v1';

/**
 * The one profile, merged from every source the app has (ADR-0031).
 *
 * **What changed in v2, and why it matters here.** The profile used to be recomputed
 * on every load: GitHub was fetched, the stored `ParsedCv` was layered on, and the
 * result was thrown away at the end of the session. That was not a caching choice —
 * it was a workaround for a merge that concatenated experience entries, so rebuilding
 * from the GitHub base each time was the only thing stopping a re-import from
 * doubling someone's years.
 *
 * The merge is idempotent now, so the profile can be *stored* instead of rebuilt —
 * which is what makes hand edits possible at all. A manual edit has nowhere to live
 * in a profile that is regenerated from its sources on every page load.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly auth = inject(AuthService);
  private readonly gh = inject(GithubClientService);
  private readonly store = inject(IndexedDbStore);

  private readonly _profile = signal<UnifiedProfile | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /**
   * Set when a stored profile could not be read. ADR-0031: a profile that fails to
   * migrate is preserved untouched and reported, never silently discarded.
   */
  private readonly _unreadable = signal(false);

  readonly profile = this._profile.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly unreadable = this._unreadable.asReadonly();

  readonly hasCv = computed(() => {
    const profile = this._profile();
    return profile !== null && hasSource(profile, 'cv');
  });

  /**
   * True when the LinkedIn archive is contributing something.
   *
   * Distinct from `auth.hasIdentity('linkedin')`, which is about signing in. A user
   * can have one without the other in both directions, and conflating them would put
   * "imported" next to an account that was only ever used to log in (ADR-0029).
   */
  readonly hasLinkedinArchive = computed(() => {
    const profile = this._profile();
    return profile !== null && hasSource(profile, 'linkedin');
  });

  readonly priorContributions = computed(
    () => this._profile()?.contributions?.mergedPullRequests ?? 0,
  );

  /**
   * False when GitHub's Search API would not answer the merged-PR query (its bucket
   * is 10-30 requests a minute). The count is then 0 as a placeholder, and anything
   * scoring or displaying it has to say the number is unavailable rather than report
   * a track record of none.
   */
  readonly priorContributionsKnown = computed(
    () => this._profile()?.contributions?.known ?? true,
  );

  /**
   * The token each connection was last read with, so a re-render does not re-fetch and
   * a token change does. Keyed by source since GitLab arrived (ADR-0034) — it used to
   * be one string, which is a shape that only works while GitHub is the only
   * connection.
   */
  private readonly loadedFor = new Map<ProfileSource, string>();
  private restored: Promise<void>;

  constructor() {
    this.restored = this.restore();

    this.watch('github', (token) => this.load(token));
    this.watch('gitlab', (token) => this.loadGitlab(token));
  }

  /**
   * Keep one data connection in step with the profile: read it when it connects or its
   * token changes, and demote it when it goes away.
   *
   * Identical for both providers, which is the point — the asymmetry that used to be
   * here was GitHub's alone, not a property of data connections.
   */
  private watch(
    source: 'github' | 'gitlab',
    read: (token: string) => Promise<void>,
  ): void {
    effect(() => {
      if (!this.auth.hasIdentity(source)) {
        void this.forget(source);
        return;
      }
      const token = this.auth.tokenFor(source);
      if (token && this.loadedFor.get(source) !== token) {
        this.loadedFor.set(source, token);
        void read(token);
      }
    });
  }

  /** Commit a reviewed CV. It proposes; the merge decides (ADR-0031). */
  async setCv(parsed: ParsedCv): Promise<void> {
    await this.apply(cvToFragment(parsed, today()));
  }

  /**
   * Take the CV back out.
   *
   * No longer a delete: the CV is merged in, so this demotes every field it won and
   * lets the remaining sources show through. A field the user edited by hand stays,
   * because at that point it is theirs and not the importer's.
   */
  async clearCv(): Promise<void> {
    await this.forget('cv');
  }

  /** Commit a reviewed LinkedIn archive (ADR-0029). It proposes; the merge decides. */
  async setLinkedin(archive: LinkedinArchiveInput): Promise<void> {
    await this.apply(linkedinToFragment(archive, today()));
  }

  /** Take the archive back out, demoting every field it won. */
  async clearLinkedin(): Promise<void> {
    await this.forget('linkedin');
  }

  /** Merge a fragment into the profile and persist the result. */
  async apply(fragment: ProfileFragment): Promise<void> {
    await this.restored;
    const base = this._profile() ?? emptyProfile();
    const next = mergeProfile(base, fragment, { currentYear: currentYear() });
    this._profile.set(next);
    await this.persist(next);
  }

  /** Replace the whole profile — used by the editing UI, which owns manual edits. */
  async replace(profile: UnifiedProfile): Promise<void> {
    this._profile.set(profile);
    await this.persist(profile);
  }

  /**
   * Apply one hand edit (ADR-0031, ADR-0032).
   *
   * `manual` is the highest-precedence source in the system and, until the profile
   * hub, nothing could produce it — the whole top of the precedence ladder was
   * unreachable. This is the one path that produces it, and every decision about
   * *what* the edit means lives in `applyEdit`, which is pure and takes the date as
   * an argument. All this does is supply the clock and persist the result.
   */
  async edit(edit: ProfileEdit): Promise<void> {
    await this.restored;
    const base = this._profile() ?? emptyProfile();
    const next = applyEdit(base, edit, {
      currentYear: currentYear(),
      capturedAt: today(),
    });
    this._profile.set(next);
    await this.persist(next);
  }

  private async forget(source: ProfileSource): Promise<void> {
    await this.restored;
    const current = this._profile();
    if (!current || !hasSource(current, source)) {
      this.loadedFor.delete(source);
      return;
    }
    const next = forgetSource(current, source, { currentYear: currentYear() });
    this.loadedFor.delete(source);
    if (source === 'github' || source === 'gitlab') {
      this._error.set(null);
      this._loading.set(false);
    }
    this._profile.set(next);
    await this.persist(next);
  }

  private async restore(): Promise<void> {
    try {
      const stored = await this.store.get<unknown>(PROFILE_KEY);
      if (stored !== undefined && stored !== null) {
        const profile = readStoredProfile(stored);
        if (profile) {
          this._profile.set(profile);
        } else {
          // Preserved, not overwritten: the stored value stays exactly where it is
          // and the user is told, rather than losing a profile to a bad read.
          this._unreadable.set(true);
        }
        return;
      }
      await this.migrateLegacyCv();
    } catch {
      // A profile that cannot be restored is not worth an error banner on load; the
      // user can still connect GitHub or re-import.
    }
  }

  /**
   * First run after v2: fold a `ParsedCv` the user already reviewed into a profile.
   *
   * The legacy record is left in place rather than deleted — if this ships broken,
   * the CV the user confirmed is still there to migrate again.
   */
  private async migrateLegacyCv(): Promise<void> {
    const legacy = await this.store.get<ParsedCv>(LEGACY_CV_KEY);
    if (!legacy) return;
    const migrated = mergeProfile(emptyProfile(), cvToFragment(legacy, today()), {
      currentYear: currentYear(),
    });
    this._profile.set(migrated);
    await this.persist(migrated);
  }

  private async persist(profile: UnifiedProfile): Promise<void> {
    try {
      await this.store.set(PROFILE_KEY, profile);
    } catch {
      // Storage failure must not lose the in-memory profile the user is looking at.
    }
  }

  private async load(token: string): Promise<void> {
    await this.restored;
    this._loading.set(true);
    this._error.set(null);
    try {
      // The one shared client (`GithubClientService`), not a second instance: a
      // private client would keep its own rate-limit and in-flight state, so the
      // GraphQL budget this spends would be invisible to the dashboard's repository
      // search and vice versa.
      //
      // One request, where this used to cost up to sixteen (ADR-0030).
      const graph = await collectViewerGraph(this.gh.get());
      // A token change mid-flight wins; ignore this stale result.
      if (this.loadedFor.get('github') !== token) return;
      await this.apply(githubToFragment(graph, today()));
    } catch (e) {
      this._error.set(
        e instanceof Error ? e.message : 'could not load your GitHub profile',
      );
    } finally {
      if (this.loadedFor.get('github') === token) this._loading.set(false);
    }
  }

  /**
   * Read the GitLab profile (ADR-0034).
   *
   * One GraphQL request, and a client built here rather than injected: it holds no
   * cache, no ETag state and no rate-limit budget, so a shared instance would carry
   * nothing worth sharing. GitHub's client is injected precisely because it does.
   */
  private async loadGitlab(token: string): Promise<void> {
    await this.restored;
    this._loading.set(true);
    this._error.set(null);
    try {
      const graph = await collectGitlabViewer(new GitlabClient({ token }));
      if (this.loadedFor.get('gitlab') !== token) return;
      await this.apply(gitlabToFragment(graph, today()));
    } catch (e) {
      this._error.set(
        e instanceof Error ? e.message : 'could not load your GitLab profile',
      );
    } finally {
      if (this.loadedFor.get('gitlab') === token) this._loading.set(false);
    }
  }
}

/**
 * The clock lives here, at the edge, and never inside `libs/profile` — every merge
 * takes the date as an input so it stays deterministic and snapshot-testable.
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentYear(): number {
  return new Date().getUTCFullYear();
}

/** Adapt a UnifiedProfile into the shape the matching engine scores against. */
export function profileToSnapshot(
  profile: UnifiedProfile,
  priorContributions: number,
): DeveloperSnapshot {
  return {
    skills: profile.skills.map((s) => ({
      tag: s.tag,
      level: s.level,
      source: s.from.source,
    })),
    experience: profile.experienceLevel.value,
    interests: profile.interests,
    priorContributions,
  };
}

import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { GithubClient, collectGithubActivity } from '@cairn/github';
import {
  cvToProfile,
  githubToProfile,
  emptyProfile,
  type ParsedCv,
  type UnifiedProfile,
} from '@cairn/profile';
import type { DeveloperSnapshot } from '@cairn/matching';
import { AuthService } from '../auth/auth.service';
import { IndexedDbStore } from '../indexeddb-store';

/** The reviewed CV fields, kept so the merged profile survives a reload. */
const CV_KEY = 'profile:cv:v1';

/**
 * Builds a UnifiedProfile from the two sources the app has: the signed-in user's
 * GitHub data (repos, languages, merged PRs, account age) and an imported CV
 * (ADR-0011). Either alone is enough; with both, the CV is merged onto the GitHub
 * profile via `cvToProfile`. Users with neither get `profile() === null` and the
 * dashboard falls back to its demo fixtures.
 *
 * The stored CV is the *reviewed* `ParsedCv`, not raw text or file bytes —
 * SECURITY.md keeps CV contents transient. Storing it as one replaceable record
 * also keeps the merge idempotent: `mergeProfile` concatenates experience
 * entries, so rebuilding from the GitHub base each time is what stops a
 * re-import from double-counting years.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly auth = inject(AuthService);
  private readonly store = inject(IndexedDbStore);

  private readonly _githubProfile = signal<UnifiedProfile | null>(null);
  private readonly _cv = signal<ParsedCv | null>(null);
  private readonly _priorContributions = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly cv = this._cv.asReadonly();
  readonly priorContributions = this._priorContributions.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly profile = computed<UnifiedProfile | null>(() => {
    const github = this._githubProfile();
    const cv = this._cv();
    if (!cv) return github;
    return cvToProfile(cv, github ?? emptyProfile());
  });

  /** True when a CV is contributing to the profile. */
  readonly hasCv = computed(() => this._cv() !== null);

  private loadedFor: string | null = null;

  constructor() {
    void this.restoreCv();

    effect(() => {
      const hasGithub = this.auth.hasIdentity('github');
      if (!hasGithub) {
        this.reset();
        return;
      }
      const token = this.auth.githubToken;
      if (token && this.loadedFor !== token) {
        this.loadedFor = token;
        void this.load(token);
      }
    });
  }

  /** Commit a reviewed CV to the profile and remember it across sessions. */
  async setCv(parsed: ParsedCv): Promise<void> {
    this._cv.set(parsed);
    await this.store.set(CV_KEY, parsed);
  }

  /** Drop the imported CV; the GitHub half of the profile is untouched. */
  async clearCv(): Promise<void> {
    this._cv.set(null);
    await this.store.delete(CV_KEY);
  }

  private async restoreCv(): Promise<void> {
    try {
      const stored = await this.store.get<ParsedCv>(CV_KEY);
      if (stored) this._cv.set(stored);
    } catch {
      // A profile that cannot be restored is not worth an error banner; the user
      // still has the GitHub half and can re-import.
    }
  }

  /** Signing out of GitHub clears the GitHub half only — the CV is not its data. */
  private reset(): void {
    this.loadedFor = null;
    this._githubProfile.set(null);
    this._priorContributions.set(0);
    this._error.set(null);
    this._loading.set(false);
  }

  private async load(token: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const client = new GithubClient({ token, cache: this.store });
      const activity = await collectGithubActivity(client);
      // A token change mid-flight wins; ignore this stale result.
      if (this.loadedFor !== token) return;
      this._githubProfile.set(githubToProfile(activity));
      this._priorContributions.set(activity.mergedPrCount);
    } catch (e) {
      this._error.set(
        e instanceof Error ? e.message : 'could not load your GitHub profile',
      );
    } finally {
      if (this.loadedFor === token) this._loading.set(false);
    }
  }
}

/** Adapt a UnifiedProfile into the shape the matching engine scores against. */
export function profileToSnapshot(
  profile: UnifiedProfile,
  priorContributions: number,
): DeveloperSnapshot {
  return {
    skills: profile.skills,
    experience: profile.experienceLevel,
    interests: profile.interests,
    priorContributions,
  };
}

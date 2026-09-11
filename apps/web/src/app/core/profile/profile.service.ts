import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { collectGithubActivity } from '@cairn/github';
import {
  cvToProfile,
  githubToProfile,
  emptyProfile,
  type ParsedCv,
  type UnifiedProfile,
} from '@cairn/profile';
import type { DeveloperSnapshot } from '@cairn/matching';
import { AuthService } from '../auth/auth.service';
import { GithubClientService } from '../github-client';
import { IndexedDbStore } from '../indexeddb-store';

/** The reviewed CV fields, kept so the merged profile survives a reload. */
const CV_KEY = 'profile:cv:v1';

/**
 * Builds a UnifiedProfile from the two sources the app has: the signed-in user's
 * GitHub data (repos, languages, merged PRs, account age) and an imported CV
 * (ADR-0011). Either alone is enough; with both, the CV is merged onto the GitHub
 * profile via `cvToProfile`. Users with neither get `profile() === null`, and the
 * dashboard shows an empty state — there is no demo profile to fall back to, because
 * scoring a stranger against fictional skills and labelling it as theirs is worse
 * than showing nothing.
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
  private readonly gh = inject(GithubClientService);
  private readonly store = inject(IndexedDbStore);

  private readonly _githubProfile = signal<UnifiedProfile | null>(null);
  private readonly _cv = signal<ParsedCv | null>(null);
  private readonly _priorContributions = signal(0);
  private readonly _priorContributionsKnown = signal(true);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly cv = this._cv.asReadonly();
  readonly priorContributions = this._priorContributions.asReadonly();
  /**
   * False when GitHub's Search API would not answer the merged-PR query (its bucket
   * is 10-30 requests a minute). `priorContributions` is then 0 as a placeholder, and
   * anything scoring or displaying it has to say the number is unavailable rather
   * than report a track record of none.
   */
  readonly priorContributionsKnown = this._priorContributionsKnown.asReadonly();
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
    this._priorContributionsKnown.set(true);
    this._error.set(null);
    this._loading.set(false);
  }

  private async load(token: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      // The one shared client (`GithubClientService`), not a second instance: a
      // private client would keep its own rate-limit and in-flight state, so the
      // Search API quota this burns on the merged-PR count would be invisible to the
      // dashboard's repository search and vice versa.
      const activity = await collectGithubActivity(this.gh.get());
      // A token change mid-flight wins; ignore this stale result.
      if (this.loadedFor !== token) return;
      this._githubProfile.set(githubToProfile(activity));
      this._priorContributions.set(activity.mergedPrCount);
      this._priorContributionsKnown.set(activity.mergedPrCountKnown);
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

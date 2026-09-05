import { Injectable, effect, inject, signal } from '@angular/core';
import { GithubClient, collectGithubActivity } from '@cairn/github';
import { githubToProfile, type UnifiedProfile } from '@cairn/profile';
import type { DeveloperSnapshot } from '@cairn/matching';
import { AuthService } from '../auth/auth.service';
import { IndexedDbStore } from '../indexeddb-store';

/**
 * Builds a real UnifiedProfile from the signed-in user's GitHub data (repos,
 * languages, merged PRs, account age) and exposes it as signals. Anonymous users —
 * and users who only connected LinkedIn/Google — get `profile() === null`, and the
 * dashboard falls back to its demo fixtures.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly auth = inject(AuthService);
  private readonly store = inject(IndexedDbStore);

  private readonly _profile = signal<UnifiedProfile | null>(null);
  private readonly _priorContributions = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly profile = this._profile.asReadonly();
  readonly priorContributions = this._priorContributions.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  private loadedFor: string | null = null;

  constructor() {
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

  private reset(): void {
    this.loadedFor = null;
    this._profile.set(null);
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
      this._profile.set(githubToProfile(activity));
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

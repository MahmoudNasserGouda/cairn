import { Injectable, computed, inject, signal } from '@angular/core';
import {
  searchRepositories,
  RateLimitError,
  SecondaryRateLimitError,
} from '@cairn/github';
import {
  mergeLaneResults,
  planQueries,
  rankRepositories,
  type Candidate,
  type CandidateFacts,
  type DiscoveryResult,
  type LaneId,
  type PlannedQuery,
} from '@cairn/discovery';
import type { WeightPreset } from '@cairn/scoring';
import { ProfileService, profileToSnapshot } from '../profile/profile.service';
import { GithubClientService } from '../github-client';
import { IndexedDbStore } from '../indexeddb-store';

const PRESET_KEY = 'discovery:preset:v1';
/** Results per lane. Four lanes × 15 is plenty to rank a top 12 from. */
const PER_LANE = 15;

/** The presets a user can pick between, with copy explaining the trade. */
export const DISCOVERY_PRESETS: readonly {
  readonly id: WeightPreset;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Weighs what you know against what you would learn',
  },
  {
    id: 'quick-win',
    label: 'Quick win',
    hint: 'Familiar stacks with beginner-labelled work',
  },
  {
    id: 'learning',
    label: 'Stretch',
    hint: 'Rewards an unfamiliar stack over a comfortable one',
  },
];

function isPreset(value: unknown): value is WeightPreset {
  return value === 'balanced' || value === 'quick-win' || value === 'learning';
}

/**
 * Repository discovery: turn the user's profile into a handful of GitHub searches,
 * merge the results, and rank them deterministically (ADR-0027).
 *
 * Nothing here scores a repository beyond what a *search response* carries. That is
 * the whole point of the design: a run costs four requests total rather than four
 * per candidate, which is the only way it fits GitHub's Search API quota (10/min
 * unauthenticated, 30 signed in). A repository the user then picks goes through the
 * full health + match path in `TargetService`, which does spend the requests.
 *
 * All repository text reaches the template as interpolation only — it is untrusted
 * external content (SECURITY.md).
 */
@Injectable({ providedIn: 'root' })
export class DiscoveryService {
  private readonly gh = inject(GithubClientService);
  private readonly profileSvc = inject(ProfileService);
  private readonly store = inject(IndexedDbStore);

  private readonly _result = signal<DiscoveryResult | null>(null);
  private readonly _plan = signal<readonly PlannedQuery[]>([]);
  private readonly _running = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _throttled = signal(false);
  private readonly _preset = signal<WeightPreset>('balanced');
  private readonly _ran = signal(false);

  readonly result = this._result.asReadonly();
  readonly plan = this._plan.asReadonly();
  readonly running = this._running.asReadonly();
  readonly error = this._error.asReadonly();
  /** True when GitHub's search quota cut a run short; results may be partial. */
  readonly throttled = this._throttled.asReadonly();
  readonly preset = this._preset.asReadonly();
  /** False until the first run, so the page can tell "empty" from "not asked yet". */
  readonly hasRun = this._ran.asReadonly();

  readonly recommendations = computed(() => this._result()?.recommendations ?? []);

  /**
   * Whether discovery can run at all: it needs a profile that names at least one
   * programming language, because every lane searches `language:`.
   */
  readonly canRun = computed(() => {
    const profile = this.profileSvc.profile();
    if (!profile) return false;
    return planQueries(profileToSnapshot(profile, 0)).length > 0;
  });

  constructor() {
    void this.restorePreset();
  }

  /** Change the ranking preset. Re-ranks in place — no new API calls. */
  async setPreset(preset: WeightPreset): Promise<void> {
    if (preset === this._preset()) return;
    this._preset.set(preset);
    const current = this._result();
    if (current) this.rank(this.candidates, preset);
    try {
      await this.store.set(PRESET_KEY, preset);
    } catch {
      // A preference that will not persist is not worth an error banner.
    }
  }

  /** The merged candidate set from the last run, kept so a preset change is free. */
  private candidates: readonly Candidate[] = [];

  async run(): Promise<void> {
    const profile = this.profileSvc.profile();
    if (!profile) {
      this._error.set(
        'Connect GitHub or import a CV first — discovery ranks repositories against your profile.',
      );
      return;
    }
    const dev = profileToSnapshot(profile, this.profileSvc.priorContributions());
    const plan = planQueries(dev);
    this._plan.set(plan);

    if (plan.length === 0) {
      this._error.set(
        'Your profile does not name a programming language yet, so there is nothing to search for. Connect GitHub or import a CV with your languages.',
      );
      return;
    }

    this._running.set(true);
    this._error.set(null);
    this._throttled.set(false);

    const client = this.gh.get();
    // `RepoSearchResult` satisfies `CandidateFacts` structurally, which is what
    // keeps `libs/discovery` free of a dependency on the GitHub client.
    const lanes: { lane: LaneId; results: readonly CandidateFacts[] }[] = [];
    let throttled = false;

    // Sequential on purpose: four parallel search calls are exactly the shape
    // GitHub's secondary rate limiter treats as abuse, and stopping after the
    // first refusal keeps the remaining quota for the rest of the app.
    for (const planned of plan) {
      try {
        const results = await searchRepositories(client, planned.query, {
          perPage: PER_LANE,
          // Sorting by stars inside the window instead of by relevance: a
          // qualifier-only query has no text to be relevant to.
          sort: 'stars',
        });
        lanes.push({ lane: planned.lane, results });
      } catch (e) {
        if (e instanceof RateLimitError || e instanceof SecondaryRateLimitError) {
          throttled = true;
          break;
        }
        this._error.set(e instanceof Error ? e.message : 'Repository search failed.');
        this._running.set(false);
        this._ran.set(true);
        return;
      }
    }

    this._throttled.set(throttled);
    if (throttled && lanes.length === 0) {
      this._error.set(
        "GitHub's search quota is exhausted (10 searches a minute when signed out). Sign in with GitHub for a higher limit, or try again shortly.",
      );
      this._running.set(false);
      this._ran.set(true);
      return;
    }

    this.candidates = mergeLaneResults(lanes);
    this.rank(this.candidates, this._preset());
    this._running.set(false);
    this._ran.set(true);
  }

  clear(): void {
    this.candidates = [];
    this._result.set(null);
    this._plan.set([]);
    this._error.set(null);
    this._throttled.set(false);
    this._ran.set(false);
  }

  private rank(candidates: readonly Candidate[], preset: WeightPreset): void {
    const profile = this.profileSvc.profile();
    if (!profile) return;
    const dev = profileToSnapshot(profile, this.profileSvc.priorContributions());
    this._result.set(rankRepositories(dev, candidates, { preset }));
  }

  private async restorePreset(): Promise<void> {
    try {
      const saved = await this.store.get<WeightPreset>(PRESET_KEY);
      if (isPreset(saved)) this._preset.set(saved);
    } catch {
      // Falls back to 'balanced'.
    }
  }
}

import type { SkillTag } from '@cairn/shared';
import type { ScoreBreakdown, WeightPreset } from '@cairn/scoring';

/**
 * Which planned query surfaced a candidate. Provenance is a *signal*, not just
 * bookkeeping: a repository returned by the `newcomer` lane was matched by
 * GitHub's own `good-first-issues:>=N` qualifier, which is the only way to know a
 * repo has beginner-labelled work without spending a request per repository.
 */
export type LaneId = 'core-skill' | 'secondary-skill' | 'interests' | 'newcomer';

/** One planned repository search: the intent, plus the query string to run. */
export interface PlannedQuery {
  readonly lane: LaneId;
  /** GitHub repository-search query string (qualifiers only, no free text). */
  readonly query: string;
  /** Short, user-facing explanation of why this search is being run. */
  readonly rationale: string;
}

/**
 * The facts a repository *search* response carries. Deliberately a subset of
 * `@cairn/github`'s `RepoSearchResult` declared locally, so this lib stays free of
 * any API dependency (the same reason `libs/targets` declares `RepoOverviewLike`).
 */
export interface CandidateFacts {
  readonly fullName: string;
  readonly owner: string;
  readonly repo: string;
  readonly description: string;
  readonly stars: number;
  readonly forks: number;
  readonly openIssues: number;
  readonly primaryLanguage: SkillTag | null;
  /** Topics that name a technology in the shared taxonomy. */
  readonly topics: readonly SkillTag[];
  /** Every topic, canonicalised — carries the newcomer markers `topics` drops. */
  readonly allTopics: readonly SkillTag[];
  readonly pushedAt: string | null;
  readonly archived: boolean;
  readonly isFork: boolean;
  readonly htmlUrl: string;
}

/** A candidate plus the lanes that found it. */
export interface Candidate extends CandidateFacts {
  readonly foundBy: readonly LaneId[];
}

/** Why a candidate was dropped before scoring. Surfaced so the UI can say so. */
export type RejectionReason = 'archived' | 'fork' | 'no-declared-stack';

export interface Recommendation {
  readonly candidate: Candidate;
  readonly score: ScoreBreakdown;
  /** The repo's declared stack: primary language + taxonomy-known topics. */
  readonly stack: readonly SkillTag[];
  /** Stack entries the developer already has. */
  readonly known: readonly SkillTag[];
  /** Stack entries the developer does not have yet. */
  readonly newToYou: readonly SkillTag[];
  /**
   * Plain-language reasons, most important first. Every entry is generated from
   * named signals — there is no free text from GitHub in here except canonicalised
   * technology tags (SECURITY.md: repository content is untrusted).
   */
  readonly reasons: readonly string[];
}

export interface RankOptions {
  readonly preset?: WeightPreset;
  /** How many recommendations to return. Default 12. */
  readonly limit?: number;
  /** Injected clock, so "pushed N days ago" stays deterministic in tests. */
  readonly now?: number;
}

export interface DiscoveryResult {
  readonly recommendations: readonly Recommendation[];
  /** Candidates considered after de-duplication, before filtering. */
  readonly considered: number;
  readonly rejected: Readonly<Record<RejectionReason, number>>;
  readonly preset: WeightPreset;
}

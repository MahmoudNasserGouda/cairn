import {
  label,
  weightedScore,
  READINESS_WEIGHTS,
  type ScoreBreakdown,
  type ScorePart,
} from '@cairn/scoring';
import { EXPERIENCE_RANK, roundTo } from '@cairn/shared';
import type { UnifiedProfile } from './model';

/**
 * Contribution readiness: how prepared this developer is to make a successful
 * open-source contribution, scored from the merged profile alone (ADR-0007).
 *
 * Deliberately target-free. Every other score in the app answers "how well do you fit
 * *this* repository"; readiness answers "are you ready, and what should you do next",
 * which is the only honest number we can show before repository discovery exists. Pure:
 * no IO, no clock, no random — every input is already in memory.
 */

/** Everything readiness needs. `hasCv` is not on the profile — a CV contributes skills
 * and experience entries but leaves no marker of its own (see `cvToProfile`). */
export interface ReadinessInput {
  readonly profile: UnifiedProfile;
  readonly priorContributions: number;
  readonly hasCv: boolean;
}

export interface CompletenessReport {
  /** Fraction of the four profile sources that are present, in [0, 1]. */
  readonly value: number;
  readonly have: readonly string[];
  readonly missing: readonly string[];
}

export interface NextStep {
  /** The `ScorePart.key` this step would raise. */
  readonly key: string;
  readonly label: string;
  /** Percentage points the total would gain if this part reached 1. */
  readonly impact: number;
}

export interface ReadinessReport {
  readonly score: ScoreBreakdown;
  readonly band: 'High' | 'Medium' | 'Low';
  readonly completeness: CompletenessReport;
  /** Highest-impact first, capped at three. */
  readonly nextSteps: readonly NextStep[];
}

/** Skills counted before breadth saturates. Eight distinct technologies is a broad
 * profile; more adds nothing to *readiness*, only to matching. */
const BREADTH_TARGET = 8;
/** Skills averaged for depth. Matches the "top three languages" a reader expects. */
const DEPTH_SAMPLE = 3;
/** Merged PRs before a track record counts as established — the same convention
 * `contributionConfidence` uses for `priorContributions`. */
const TRACK_TARGET = 10;

const MAX_NEXT_STEPS = 3;

const SOURCE_LABELS = {
  github: 'GitHub connected',
  cv: 'CV imported',
  interests: 'Interests set',
  experience: 'Experience listed',
} as const;

/**
 * Copy for the steps a user can actually act on. `experience` is deliberately absent:
 * years of experience is a fact about someone, not something they can go and do.
 */
const STEP_LABELS: Readonly<Record<string, string>> = {
  skillDepth: 'Go deeper in one language',
  skillBreadth: 'Broaden your technologies',
  track: 'Contribute to an open-source project',
  completeness: 'Complete your profile',
};

/** Which of the four profile sources are present. Exported so the UI can render the
 * checklist without recomputing the whole score. */
export function profileCompleteness(input: ReadinessInput): CompletenessReport {
  const { profile, hasCv } = input;
  const present: Record<keyof typeof SOURCE_LABELS, boolean> = {
    github: profile.identities.some((i) => i.provider === 'github'),
    cv: hasCv,
    interests: profile.interests.length > 0,
    experience: profile.experience.length > 0,
  };
  const keys = Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[];
  const have = keys.filter((k) => present[k]).map((k) => SOURCE_LABELS[k]);
  const missing = keys.filter((k) => !present[k]).map((k) => SOURCE_LABELS[k]);
  return { value: roundTo(have.length / keys.length, 4), have, missing };
}

/**
 * Mean level of the strongest `DEPTH_SAMPLE` skills, always divided by the full
 * sample size so a single 90% skill does not read as a deep profile.
 */
function skillDepth(profile: UnifiedProfile): number {
  const top = [...profile.skills]
    .sort((a, b) => b.level - a.level)
    .slice(0, DEPTH_SAMPLE);
  const sum = top.reduce((s, skill) => s + skill.level, 0);
  return sum / DEPTH_SAMPLE;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function contributionReadiness(input: ReadinessInput): ReadinessReport {
  const { profile, priorContributions } = input;
  const completeness = profileCompleteness(input);
  const strong = profile.skills.filter((s) => s.level >= 0.6).length;
  const contributions = Math.max(0, priorContributions);

  const score = weightedScore(
    {
      skillDepth: {
        value: skillDepth(profile),
        note: strong ? `${plural(strong, 'skill')} above 60%` : 'no skill above 60% yet',
      },
      skillBreadth: {
        value: profile.skills.length / BREADTH_TARGET,
        note: plural(profile.skills.length, 'technology', 'technologies'),
      },
      experience: {
        value: (EXPERIENCE_RANK[profile.experienceLevel] - 1) / 3,
        note: `${profile.experienceLevel} · ~${profile.totalYears} yrs`,
      },
      track: {
        value: contributions / TRACK_TARGET,
        note: plural(contributions, 'merged PR'),
      },
      completeness: {
        value: completeness.value,
        note: `${completeness.have.length} of ${
          completeness.have.length + completeness.missing.length
        } connected`,
      },
    },
    READINESS_WEIGHTS,
  );

  return {
    score,
    band: label(score.total),
    completeness,
    nextSteps: nextSteps(score.parts),
  };
}

/**
 * The steps with the most points left on the table. Derived from the breakdown rather
 * than hand-written, so what the user is told is worth doing really is what moves the
 * score the most.
 */
function nextSteps(parts: readonly ScorePart[]): NextStep[] {
  return parts
    .filter((p) => p.key in STEP_LABELS)
    .map((p) => ({
      key: p.key,
      label: STEP_LABELS[p.key] as string,
      impact: Math.round(p.weight * (1 - p.value) * 100),
    }))
    .filter((s) => s.impact > 0)
    .sort((a, b) => b.impact - a.impact || a.key.localeCompare(b.key))
    .slice(0, MAX_NEXT_STEPS);
}

import type { ExperienceLevel } from '@cairn/shared';

/**
 * The repository size, as log10(stars), where a contributor at each level can expect
 * both a living review process and a reachable maintainer.
 *
 * This is the one number that decides what discovery shows. `starApproachability`
 * peaks here, and `STAR_WINDOW` — the band actually searched — is derived from it, so
 * the two cannot drift apart.
 *
 * They did drift, once, and it is worth recording why: the search window's ceiling
 * was set independently (20k stars for an intermediate) while the curve peaked at
 * ~1.6k. Because each lane asks GitHub for the *most-starred* repositories in the
 * window, every result arrived pinned to that ceiling — so the ranker only ever saw
 * repositories its own scoring considered too big, and the approachability term had
 * nothing left to choose between.
 */
export const STAR_PEAK_LOG: Readonly<Record<ExperienceLevel, number>> = {
  beginner: 2.7, // ~500 stars
  intermediate: 3.2, // ~1.6k
  advanced: 3.7, // ~5k
  expert: 4.2, // ~16k
};

/** How far below the peak the search floor sits, in decades. */
const FLOOR_DECADES = 1;
/**
 * How far above it the ceiling sits. Deliberately tighter than the floor: results
 * come back most-starred-first, so the ceiling is where the list actually lands.
 */
const CEILING_DECADES = 0.5;

function round(stars: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(stars) - 1);
  return Math.round(stars / magnitude) * magnitude;
}

function windowFor(level: ExperienceLevel): readonly [number, number] {
  const peak = STAR_PEAK_LOG[level];
  return [round(10 ** (peak - FLOOR_DECADES)), round(10 ** (peak + CEILING_DECADES))];
}

/**
 * The star band searched for each experience level, derived from `STAR_PEAK_LOG`.
 *
 * The floor keeps out repositories with nobody left to review a pull request; the
 * ceiling keeps out the megaprojects that would otherwise fill every result page for
 * every developer who writes the language, and where a first contribution queues
 * behind a hundred others.
 */
export const STAR_WINDOW: Readonly<Record<ExperienceLevel, readonly [number, number]>> = {
  beginner: windowFor('beginner'),
  intermediate: windowFor('intermediate'),
  advanced: windowFor('advanced'),
  expert: windowFor('expert'),
};

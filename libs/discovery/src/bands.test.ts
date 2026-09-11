import type { ExperienceLevel } from '@cairn/shared';
import { STAR_PEAK_LOG, STAR_WINDOW } from './bands';
import { starApproachability } from './rank';
import { withArticle } from './labels';

const LEVELS: readonly ExperienceLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
  'expert',
];

describe('star bands', () => {
  it('brackets the approachability peak for every level', () => {
    for (const level of LEVELS) {
      const [min, max] = STAR_WINDOW[level];
      const peak = 10 ** STAR_PEAK_LOG[level];
      expect(min).toBeLessThan(peak);
      expect(max).toBeGreaterThan(peak);
    }
  });

  it('keeps the ceiling approachable, because results arrive most-starred-first', () => {
    // The regression this guards: an intermediate window of 200..20000 against a
    // ~1.6k peak meant every result came back pinned to the ceiling, scoring badly
    // on the very signal that chose the band. A repo at the ceiling must still be a
    // reasonable place to contribute.
    for (const level of LEVELS) {
      const [, max] = STAR_WINDOW[level];
      expect(starApproachability(max, STAR_PEAK_LOG[level])).toBeGreaterThan(0.6);
    }
  });

  it('rises with experience without gaps between the levels', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      const lower = STAR_WINDOW[LEVELS[i - 1]!];
      const upper = STAR_WINDOW[LEVELS[i]!];
      expect(upper[0]).toBeGreaterThan(lower[0]);
      expect(upper[1]).toBeGreaterThan(lower[1]);
      // Overlapping bands: a developer near a boundary sees a similar shortlist
      // either side of it.
      expect(upper[0]).toBeLessThan(lower[1]);
    }
  });
});

describe('withArticle', () => {
  it('agrees with the level, so copy does not read "a intermediate"', () => {
    expect(withArticle('beginner')).toBe('a beginner');
    expect(withArticle('intermediate')).toBe('an intermediate');
    expect(withArticle('advanced')).toBe('an advanced');
    expect(withArticle('expert')).toBe('an expert');
  });
});

import type { ExperienceLevel } from '@cairn/shared';
import { mergeProfile, type IncomingSkill, type ProfileFragment } from '../merge';
import { emptyProfile, type ExperienceEntry, type UnifiedProfile } from '../model';
import {
  provenance,
  sourced,
  type ProfileSource,
  type Provenance,
  type Sourced,
} from '../provenance';

/**
 * Building a v2 profile in a test without writing provenance out by hand.
 *
 * Every field in Profile v2 carries a source, a confidence and a capture date
 * (ADR-0031), which is right for the model and tedious in a fixture — and a test that
 * is tedious to write is a test people stop writing. These builders supply the
 * boilerplate and leave the parts a test is actually about.
 *
 * Dates are fixed, never `new Date()`: the merge takes time as an input precisely so
 * that a profile built from the same inputs is the same profile on any day.
 */

export const FIXTURE_DAY = '2026-09-13';
export const FIXTURE_YEAR = 2026;

export function from(source: ProfileSource, confidence = 1): Provenance {
  return provenance(source, FIXTURE_DAY, confidence);
}

export function testSkill(
  tag: string,
  level: number,
  source: ProfileSource = 'github',
): IncomingSkill {
  return { tag, level, from: from(source) };
}

export function testRole(
  title: string,
  over: Partial<ExperienceEntry> = {},
  source: ProfileSource = 'cv',
): ExperienceEntry {
  return {
    title,
    organization: 'Acme',
    startYear: 2022,
    endYear: 2024,
    highlights: [],
    from: from(source),
    ...over,
  };
}

export function testLevel(
  level: ExperienceLevel,
  source: ProfileSource = 'manual',
): Sourced<ExperienceLevel> {
  return sourced(level, from(source));
}

/** Merge fragments into a profile with a fixed clock. */
export function buildProfile(...fragments: readonly ProfileFragment[]): UnifiedProfile {
  return fragments.reduce(
    (acc, fragment) => mergeProfile(acc, fragment, { currentYear: FIXTURE_YEAR }),
    emptyProfile(),
  );
}

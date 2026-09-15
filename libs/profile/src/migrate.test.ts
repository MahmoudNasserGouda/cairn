/**
 * Reading what a previous version of the app left behind (ADR-0031).
 *
 * The honest finding here corrected the ADR: **no `UnifiedProfile` was ever
 * persisted.** `ProfileService` stored the reviewed `ParsedCv` under
 * `profile:cv:v1` and rebuilt the profile from GitHub on every load. So the
 * migration that matters is not "v1 profile → v2 profile" but "the CV you already
 * confirmed → a provenance-tagged fragment", plus refusing to guess at anything
 * else.
 */
import { describe, expect, it } from 'vitest';
import { parsedCvToFragment, readStoredProfile, type LegacyParsedCv } from './migrate';
import { mergeProfile } from './merge';
import { emptyProfile, PROFILE_SCHEMA_VERSION } from './model';
import { buildProfile, testSkill } from './__fixtures__/build';

const ctx = { currentYear: 2026 };
const DAY = '2026-09-13';

const STORED_CV: LegacyParsedCv = {
  name: 'Amara Okonkwo',
  email: 'amara@example.com',
  skills: ['python', 'docker'],
  experience: [
    {
      title: 'Backend Engineer',
      organization: 'Paystack',
      startYear: 2021,
      endYear: 'present',
      source: 'cv',
    },
  ],
  sections: ['experience', 'skills'],
};

describe('parsedCvToFragment', () => {
  it('tags everything it produces as coming from the CV', () => {
    const fragment = parsedCvToFragment(STORED_CV, DAY);

    expect(fragment.contact?.name?.from.source).toBe('cv');
    expect(fragment.contact?.emails?.[0]?.from.source).toBe('cv');
    expect(fragment.skills?.every((s) => s.from.source === 'cv')).toBe(true);
    expect(fragment.experience?.every((e) => e.from.source === 'cv')).toBe(true);
  });

  it('carries the capture date through instead of reading a clock', () => {
    const fragment = parsedCvToFragment(STORED_CV, '2020-01-01');
    expect(fragment.contact?.name?.from.capturedAt).toBe('2020-01-01');
  });

  it('produces a profile a user can recognise as their own', () => {
    const profile = mergeProfile(emptyProfile(), parsedCvToFragment(STORED_CV, DAY), ctx);

    expect(profile.contact.name?.value).toBe('Amara Okonkwo');
    expect(profile.contact.emails.map((e) => e.value)).toEqual(['amara@example.com']);
    expect(profile.technologies).toEqual(['docker', 'python']);
    expect(profile.experience).toHaveLength(1);
    expect(profile.totalYears).toBe(5);
  });

  /**
   * The old `ParsedCv` had no bullets and no `highlights` field. Migrating must not
   * invent them, and must not leave the field undefined either — every consumer
   * reads it as an array.
   */
  it('gives a migrated role an empty highlight list, not a missing one', () => {
    const fragment = parsedCvToFragment(STORED_CV, DAY);
    expect(fragment.experience?.[0]?.highlights).toEqual([]);
  });

  it('survives a CV that only matched a couple of skills', () => {
    const fragment = parsedCvToFragment(
      { skills: ['go'], experience: [], sections: [] },
      DAY,
    );
    const profile = mergeProfile(emptyProfile(), fragment, ctx);

    expect(profile.contact.name).toBeUndefined();
    expect(profile.contact.emails).toEqual([]);
    expect(profile.skills).toHaveLength(1);
  });

  /**
   * A CV states a skill; it does not measure it. GitHub measures one, from byte
   * counts. So a CV claim lands mid-scale and says so, rather than pretending to a
   * precision it cannot have.
   */
  it('gives CV skills a stated-not-measured level', () => {
    const fragment = parsedCvToFragment(STORED_CV, DAY);
    for (const skill of fragment.skills ?? []) {
      expect(skill.level).toBe(0.5);
      expect(skill.note).toMatch(/listed on your cv/i);
    }
  });
});

describe('readStoredProfile', () => {
  it('accepts a profile it wrote itself', () => {
    const original = mergeProfile(
      emptyProfile(),
      parsedCvToFragment(STORED_CV, DAY),
      ctx,
    );
    const roundTripped = readStoredProfile(JSON.parse(JSON.stringify(original)));

    expect(roundTripped).toEqual(original);
  });

  /**
   * Refuse rather than guess. A shape we do not recognise is returned as `null` so
   * the caller can preserve the stored value untouched and tell the user — ADR-0031
   * is explicit that a profile which fails to migrate is never silently discarded.
   */
  it.each([
    ['null', null],
    ['a string', 'not a profile'],
    ['an empty object', {}],
    ['a future schema', { schemaVersion: 99, identities: [] }],
    ['a v1 profile that never existed on disk', { schemaVersion: 1, skills: [] }],
  ])('returns null for %s', (_label, value) => {
    expect(readStoredProfile(value)).toBeNull();
  });

  /**
   * Phase 8 widened `ProfileSource` and bumped the schema (ADR-0034/0035/0036). Nothing
   * about a stored profile's *shape* changed — a v2 profile is a valid v3 one — so the
   * migration is a version stamp and nothing else.
   *
   * It still has to exist. `readStoredProfile` accepts only the current version, so
   * without this every profile written before Phase 8 would read as unreadable and the
   * user would be told their profile could not be loaded. A no-op migration is still a
   * migration.
   */
  it('upgrades a profile written before the new sources existed', () => {
    const v2 = {
      ...buildProfile({ skills: [testSkill('typescript', 0.9)] }),
      schemaVersion: 2,
    };

    const loaded = readStoredProfile(v2);

    expect(loaded).not.toBeNull();
    expect(loaded?.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(loaded?.skills[0]?.tag).toBe('typescript');
  });

  it('refuses a version from the future rather than guessing at it', () => {
    const later = { ...buildProfile({}), schemaVersion: PROFILE_SCHEMA_VERSION + 1 };

    expect(readStoredProfile(later)).toBeNull();
  });

  it('rejects a v2 profile whose collections are the wrong type', () => {
    const broken = {
      ...mergeProfile(emptyProfile(), parsedCvToFragment(STORED_CV, DAY), ctx),
      experience: 'nope',
    };
    expect(readStoredProfile(broken)).toBeNull();
  });
});

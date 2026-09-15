import { toKnownSkills, type SkillTag } from '@cairn/shared';
import type { ProfileFragment } from './merge';
import {
  PROFILE_SCHEMA_VERSION,
  type ExperienceEntry,
  type UnifiedProfile,
} from './model';
import { provenance, sourced } from './provenance';

/**
 * Reading what an earlier version of the app left in storage (ADR-0031).
 *
 * A correction to that ADR, found by looking: **no `UnifiedProfile` was ever
 * persisted.** `ProfileService` stored only the reviewed `ParsedCv` under
 * `profile:cv:v1` and rebuilt the profile from GitHub on every load — which is also
 * why the old merge could get away with concatenating experience entries. So the
 * migration that matters is the CV the user already confirmed, and everything else is
 * refused rather than guessed at.
 */

/** The `ParsedCv` shape as it was persisted before Profile v2. */
export interface LegacyParsedCv {
  readonly name?: string;
  readonly email?: string;
  readonly skills: readonly string[];
  readonly experience: readonly {
    readonly title: string;
    readonly organization?: string;
    readonly startYear?: number;
    readonly endYear?: number | 'present';
    readonly source?: string;
  }[];
  readonly sections: readonly string[];
}

/**
 * A CV *states* a skill; it does not measure one. GitHub measures, from language
 * byte counts, which is why its levels vary. A CV claim therefore lands mid-scale and
 * says so, instead of pretending to a precision the document cannot carry.
 */
const CV_SKILL_LEVEL = 0.5;

/** Turn a stored (or freshly parsed) CV into a provenance-tagged fragment. */
export function parsedCvToFragment(
  parsed: LegacyParsedCv,
  capturedAt: string,
): ProfileFragment {
  const from = provenance('cv', capturedAt);

  const experience: ExperienceEntry[] = parsed.experience.map((entry) => ({
    title: entry.title,
    ...(entry.organization !== undefined ? { organization: entry.organization } : {}),
    ...(entry.startYear !== undefined ? { startYear: entry.startYear } : {}),
    ...(entry.endYear !== undefined ? { endYear: entry.endYear } : {}),
    // The old parser had no notion of bullets. Migrating must not invent them, and
    // must not leave the field missing either — every consumer reads it as an array.
    highlights: [],
    from,
  }));

  return {
    contact: {
      ...(parsed.name !== undefined ? { name: sourced(parsed.name, from) } : {}),
      emails: parsed.email !== undefined ? [sourced(parsed.email, from)] : [],
    },
    skills: toKnownSkills([...parsed.skills]).map((tag: SkillTag) => ({
      tag,
      level: CV_SKILL_LEVEL,
      note: 'listed on your CV',
      from,
    })),
    experience,
  };
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a stored profile, or refuse.
 *
 * Only the current schema is accepted, and only when its collections are the shape
 * the rest of the code will index into — a stored value that has been hand-edited,
 * half-written, or produced by a future version must not be half-loaded. `null` means
 * "I will not guess": ADR-0031 requires the caller to preserve the stored value
 * untouched and tell the user, never to discard it silently.
 */
export function readStoredProfile(value: unknown): UnifiedProfile | null {
  if (!isRecord(value)) return null;

  /**
   * Versions this build knows how to read, oldest first.
   *
   * v2 → v3 (Phase 8) changed no stored shape at all: `ProfileSource` widened to carry
   * GitLab, Stack Exchange and dev.to, and every v2 profile is already a valid v3 one.
   * The upgrade is a version stamp — but skipping it was never an option, because this
   * function accepts only the current version and every profile written before Phase 8
   * would otherwise have read as unreadable.
   *
   * A version *above* the current one is still refused. An older build cannot know what
   * a newer one added, and half-reading a profile is worse than declining it.
   */
  const stored = value['schemaVersion'];
  if (stored !== PROFILE_SCHEMA_VERSION && stored !== 2) return null;

  const collections = [
    'identities',
    'links',
    'skills',
    'technologies',
    'interests',
    'experience',
    'education',
    'projects',
    'certifications',
    'languages',
    'dismissed',
  ];
  if (!collections.every((key) => isArray(value[key]))) return null;
  if (!isRecord(value['contact']) || !isArray(value['contact']['emails'])) return null;
  if (!isRecord(value['experienceLevel'])) return null;
  if (typeof value['totalYears'] !== 'number') return null;

  // Stamped rather than returned as-is, so what the caller persists next is current.
  return { ...value, schemaVersion: PROFILE_SCHEMA_VERSION } as unknown as UnifiedProfile;
}

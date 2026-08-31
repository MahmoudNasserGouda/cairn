import type { ExperienceLevel, SkillProficiency, SkillTag } from '@osc/shared';

export type IdentityProvider = 'github' | 'linkedin' | 'google';

export interface LinkedIdentity {
  readonly provider: IdentityProvider;
  readonly displayName: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

export interface ExperienceEntry {
  readonly title: string;
  readonly organization?: string;
  readonly startYear?: number;
  readonly endYear?: number | 'present';
  readonly source: SkillProficiency['source'];
}

export interface UnifiedProfile {
  readonly schemaVersion: number;
  readonly identities: readonly LinkedIdentity[];
  readonly skills: readonly SkillProficiency[];
  readonly technologies: readonly SkillTag[];
  readonly experienceLevel: ExperienceLevel;
  readonly interests: readonly SkillTag[];
  readonly experience: readonly ExperienceEntry[];
  /** Years of professional experience, derived from experience entries. */
  readonly totalYears: number;
}

export const PROFILE_SCHEMA_VERSION = 1;

export function emptyProfile(): UnifiedProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identities: [],
    skills: [],
    technologies: [],
    experienceLevel: 'beginner',
    interests: [],
    experience: [],
    totalYears: 0,
  };
}

function levelFromYears(years: number): ExperienceLevel {
  if (years >= 8) return 'expert';
  if (years >= 4) return 'advanced';
  if (years >= 1.5) return 'intermediate';
  return 'beginner';
}

/**
 * Merge partial profile fragments (from GitHub, LinkedIn, CV, manual entry) into
 * one profile. Deterministic; last-writer-wins per skill with the highest level kept.
 */
export function mergeProfile(
  base: UnifiedProfile,
  fragment: Partial<UnifiedProfile>,
): UnifiedProfile {
  const skillMap = new Map<SkillTag, SkillProficiency>();
  for (const s of [...base.skills, ...(fragment.skills ?? [])]) {
    const prev = skillMap.get(s.tag);
    if (!prev || s.level > prev.level) skillMap.set(s.tag, s);
  }
  const skills = [...skillMap.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  const experience = [...base.experience, ...(fragment.experience ?? [])];
  const totalYears = estimateYears(experience) || fragment.totalYears || base.totalYears;

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identities: dedupeIdentities([...base.identities, ...(fragment.identities ?? [])]),
    skills,
    technologies: [
      ...new Set([...skills.map((s) => s.tag), ...(fragment.technologies ?? [])]),
    ].sort(),
    experienceLevel: fragment.experienceLevel ?? levelFromYears(totalYears),
    interests: [...new Set([...base.interests, ...(fragment.interests ?? [])])].sort(),
    experience,
    totalYears,
  };
}

function dedupeIdentities(list: readonly LinkedIdentity[]): LinkedIdentity[] {
  const m = new Map<IdentityProvider, LinkedIdentity>();
  for (const i of list) m.set(i.provider, i);
  return [...m.values()];
}

export function estimateYears(entries: readonly ExperienceEntry[]): number {
  const now = new Date().getUTCFullYear();
  let months = 0;
  for (const e of entries) {
    if (!e.startYear) continue;
    const end = e.endYear === 'present' || e.endYear === undefined ? now : e.endYear;
    months += Math.max(0, (end - e.startYear) * 12);
  }
  return Math.round((months / 12) * 10) / 10;
}

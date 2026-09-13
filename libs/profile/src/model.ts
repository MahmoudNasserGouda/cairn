import type { ExperienceLevel, SkillTag } from '@cairn/shared';
import type { ProfileSource, Provenance, Sourced } from './provenance';
import { provenance, sourced } from './provenance';

export type IdentityProvider = 'github' | 'linkedin' | 'google';

export interface LinkedIdentity {
  readonly provider: IdentityProvider;
  readonly displayName: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

// ---------------------------------------------------------------------------
// Entities
//
// Everything a source can claim more than one of. Each carries its own provenance
// and each has a stable identity key, because merging them by *identity* rather
// than by concatenation is what makes a re-import idempotent (ADR-0031).
// ---------------------------------------------------------------------------

export type EmploymentType =
  'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance' | 'volunteer';

export interface ExperienceEntry {
  readonly title: string;
  readonly organization?: string;
  readonly location?: string;
  readonly employmentType?: EmploymentType;
  readonly startYear?: number;
  readonly endYear?: number | 'present';
  /** The role's bullet points, in the order the document gave them. */
  readonly highlights: readonly string[];
  readonly from: Provenance;
}

export interface EducationEntry {
  readonly institution: string;
  readonly degree?: string;
  readonly field?: string;
  readonly startYear?: number;
  readonly endYear?: number | 'present';
  readonly from: Provenance;
}

export interface ProjectEntry {
  readonly name: string;
  readonly description?: string;
  readonly url?: string;
  readonly technologies: readonly SkillTag[];
  readonly from: Provenance;
}

export interface CertificationEntry {
  readonly name: string;
  readonly issuer?: string;
  readonly year?: number;
  readonly url?: string;
  readonly from: Provenance;
}

export interface SpokenLanguage {
  readonly name: string;
  /** As the source phrased it — "Native", "Professional working", "B2". */
  readonly proficiency?: string;
  readonly from: Provenance;
}

export type LinkKind =
  'website' | 'github' | 'linkedin' | 'twitter' | 'mastodon' | 'other';

export interface ProfileLink {
  readonly kind: LinkKind;
  readonly url: string;
  readonly from: Provenance;
}

/**
 * One source's claim about one skill, kept even when another source's claim wins.
 *
 * Keeping the losers is the point: "TypeScript 90%" is a number, "90% because 42% of
 * your pushed bytes are TypeScript *and* your CV lists it" is an explanation. The UI
 * shows the explanation, and the user can see which source to go and correct.
 */
export interface SkillEvidence {
  readonly source: ProfileSource;
  readonly level: number;
  /** Plain-language reason, e.g. "38% of your GitHub language bytes". */
  readonly note?: string;
  readonly capturedAt: string;
}

export interface ProfileSkill {
  readonly tag: SkillTag;
  /** The reconciled level in [0, 1] — the winning source's. */
  readonly level: number;
  readonly from: Provenance;
  readonly evidence: readonly SkillEvidence[];
}

/** What GitHub observes directly and no other source can claim. */
export interface ContributionStats {
  readonly mergedPullRequests: number;
  readonly totalContributions: number;
  readonly repositoriesContributedTo: number;
  /**
   * False when a figure could not be measured — GitHub's Search API bucket is 10-30
   * requests a minute. A throttle must read as "we could not check", never as a
   * track record of none.
   */
  readonly known: boolean;
  readonly from: Provenance;
}

export interface ProfileContact {
  readonly name?: Sourced<string>;
  readonly headline?: Sourced<string>;
  readonly summary?: Sourced<string>;
  readonly location?: Sourced<string>;
  readonly emails: readonly Sourced<string>[];
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

export interface UnifiedProfile {
  readonly schemaVersion: number;
  readonly identities: readonly LinkedIdentity[];
  readonly contact: ProfileContact;
  readonly links: readonly ProfileLink[];
  readonly skills: readonly ProfileSkill[];
  /** Derived from `skills`; kept for the matching engine's convenience. */
  readonly technologies: readonly SkillTag[];
  /** A union of tag sets. No slot, so no conflict, so no provenance. */
  readonly interests: readonly SkillTag[];
  readonly experienceLevel: Sourced<ExperienceLevel>;
  readonly experience: readonly ExperienceEntry[];
  readonly education: readonly EducationEntry[];
  readonly projects: readonly ProjectEntry[];
  readonly certifications: readonly CertificationEntry[];
  readonly languages: readonly SpokenLanguage[];
  readonly contributions?: ContributionStats;
  /** Derived from `experience`. */
  readonly totalYears: number;
  /**
   * Identity keys of entries the user removed by hand.
   *
   * Without these a deletion would not survive: the merge cannot tell "the user threw
   * this role away" from "the merge has never seen this role", so the next import
   * would put it back and the user would delete it again forever. A tombstone is the
   * only thing that makes a removal as durable as an edit.
   */
  readonly dismissed: readonly string[];
}

export const PROFILE_SCHEMA_VERSION = 2;

export function emptyProfile(): UnifiedProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identities: [],
    contact: { emails: [] },
    links: [],
    skills: [],
    technologies: [],
    interests: [],
    experienceLevel: sourced('beginner', provenance('github', '1970-01-01', 0)),
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    languages: [],
    totalYears: 0,
    dismissed: [],
  };
}

// ---------------------------------------------------------------------------
// Identity keys
//
// Two entries are "the same entry" when these match. Deliberately coarse — a CV
// writing "Backend Engineer" and LinkedIn writing "Backend Engineer " with a
// trailing space are one role, and treating them as two is exactly the duplication
// this replaces.
// ---------------------------------------------------------------------------

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A role is identified by **where and when**, not by what it was called.
 *
 * The title is the field a CV and a LinkedIn export are most likely to word
 * differently ("Backend Engineer" / "Software Engineer, Backend"), and the one a user
 * is most likely to retype. Keying on it made every typo fix a *second* role: the
 * corrected entry got a new key, the original stayed, and the next import put the
 * misspelling back. Organisation and start year are stable across all of that.
 *
 * The accepted cost is that two genuinely different roles at the same employer
 * starting the same year merge into one. That is rare, it is usually a promotion
 * recorded twice, and it is a far better failure than a profile that accumulates a
 * duplicate every time someone fixes a letter.
 */
export function experienceKey(entry: ExperienceEntry): string {
  const organization = norm(entry.organization);
  const start = entry.startYear ?? '';
  if (organization !== '' || start !== '') return `exp:${organization}|${start}`;
  // Nothing to locate it by, so fall back to the title — otherwise every undated,
  // employerless role would collapse into a single entry.
  return `exp:?|${norm(entry.title)}`;
}

/** Institution and start year, for the same reason: the degree gets reworded. */
export function educationKey(entry: EducationEntry): string {
  return `edu:${norm(entry.institution)}|${entry.startYear ?? ''}`;
}

export function projectKey(entry: ProjectEntry): string {
  return `prj:${norm(entry.name)}`;
}

export function certificationKey(entry: CertificationEntry): string {
  return `crt:${norm(entry.name)}|${norm(entry.issuer)}`;
}

export function languageKey(entry: SpokenLanguage): string {
  return `lng:${norm(entry.name)}`;
}

export function linkKey(entry: ProfileLink): string {
  // Scheme and a trailing slash are noise; the same profile linked as
  // `http://x.dev` and `https://x.dev/` is one link.
  return `lnk:${norm(entry.url)
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')}`;
}

/** Years of professional experience implied by a set of dated entries. */
export function estimateYears(
  entries: readonly ExperienceEntry[],
  /** Current year, passed in — `estimateYears` never reads a clock. */
  currentYear: number,
): number {
  let months = 0;
  for (const entry of entries) {
    if (entry.startYear === undefined) continue;
    const end =
      entry.endYear === 'present' || entry.endYear === undefined
        ? currentYear
        : entry.endYear;
    months += Math.max(0, (end - entry.startYear) * 12);
  }
  return Math.round((months / 12) * 10) / 10;
}

export function levelFromYears(years: number): ExperienceLevel {
  if (years >= 8) return 'expert';
  if (years >= 4) return 'advanced';
  if (years >= 1.5) return 'intermediate';
  return 'beginner';
}

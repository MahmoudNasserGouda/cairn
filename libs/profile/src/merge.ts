import type { ExperienceLevel, SkillTag } from '@cairn/shared';
import {
  certificationKey,
  educationKey,
  estimateYears,
  experienceKey,
  languageKey,
  levelFromYears,
  linkKey,
  projectKey,
  PROFILE_SCHEMA_VERSION,
  type CertificationEntry,
  type ContributionStats,
  type EducationEntry,
  type ExperienceEntry,
  type LinkedIdentity,
  type ProfileContact,
  type ProfileLink,
  type ProfileSkill,
  type ProjectEntry,
  type SkillEvidence,
  type SpokenLanguage,
  type UnifiedProfile,
} from './model';
import {
  compareProvenance,
  demoteSourced,
  outranks,
  type ProfileSource,
  pickSourced,
  provenance,
  sourced,
  type Provenance,
  type Sourced,
} from './provenance';

/**
 * Merging profile fragments into one profile (ADR-0031).
 *
 * The old `mergeProfile` concatenated experience entries, so importing the same CV
 * twice doubled the years — which is why `ProfileService` rebuilt the whole profile
 * from the GitHub base on every change. That workaround held only while there were
 * exactly two sources. This merges by identity instead, so it is idempotent, and
 * every value carries its provenance, so a hand edit is never overwritten.
 *
 * Pure: no IO, no randomness, and **no clock** — the current year arrives in the
 * context, the same discipline the scoring engines keep.
 */

/** One source's claim about one skill, before reconciliation. */
export interface IncomingSkill {
  readonly tag: SkillTag;
  readonly level: number;
  /** Plain-language reason, shown as evidence. */
  readonly note?: string;
  readonly from: Provenance;
}

export interface ProfileFragment {
  readonly identities?: readonly LinkedIdentity[];
  readonly contact?: Partial<ProfileContact>;
  readonly links?: readonly ProfileLink[];
  readonly skills?: readonly IncomingSkill[];
  readonly interests?: readonly SkillTag[];
  readonly experienceLevel?: Sourced<ExperienceLevel>;
  readonly experience?: readonly ExperienceEntry[];
  readonly education?: readonly EducationEntry[];
  readonly projects?: readonly ProjectEntry[];
  readonly certifications?: readonly CertificationEntry[];
  readonly languages?: readonly SpokenLanguage[];
  readonly contributions?: ContributionStats;
}

export interface MergeContext {
  /** Used to close an open-ended date range. Passed in; never read from a clock. */
  readonly currentYear: number;
}

/** Anything with provenance and a stable identity. */
interface Keyed {
  readonly from: Provenance;
}

/**
 * Merge one source's entities into what the profile already holds.
 *
 * Two rules, and the second is the one that is easy to get wrong:
 *
 * - a higher-precedence claim replaces a lower one (`outranks`);
 * - **a source may replace its own entries**, so a second CV import updates the roles
 *   the first one produced instead of being ignored. Without that, re-import would
 *   silently do nothing and the profile could never be refreshed.
 *
 * Anything else keeps what is already there, which is what makes an unchanged
 * re-import a genuine no-op rather than a reshuffle.
 */
function mergeEntities<T extends Keyed>(
  current: readonly T[],
  incoming: readonly T[],
  keyOf: (entry: T) => string,
  dismissed: ReadonlySet<string>,
): T[] {
  const byKey = new Map<string, T>();
  for (const entry of current) byKey.set(keyOf(entry), entry);

  for (const entry of incoming) {
    const key = keyOf(entry);
    // A tombstone only blocks an *import*. A manual re-add is the user changing
    // their mind, and `dismissEntry`'s counterpart lifts the tombstone for it.
    if (dismissed.has(key) && entry.from.source !== 'manual') continue;

    const held = byKey.get(key);
    if (
      !held ||
      outranks(entry.from, held.from) ||
      entry.from.source === held.from.source
    ) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

/**
 * Reconcile one skill across sources.
 *
 * The winning source sets the level; every other claim is kept as evidence, because
 * "TypeScript 90%" is a number and "90%, because 42% of your pushed bytes are
 * TypeScript and your CV lists it" is an explanation. A source re-stating a skill
 * replaces its own evidence rather than stacking another copy.
 */
function mergeSkills(
  current: readonly ProfileSkill[],
  incoming: readonly IncomingSkill[],
): ProfileSkill[] {
  const byTag = new Map<SkillTag, ProfileSkill>();
  for (const skill of current) byTag.set(skill.tag, skill);

  for (const claim of incoming) {
    const held = byTag.get(claim.tag);
    const evidence: SkillEvidence = {
      source: claim.from.source,
      level: claim.level,
      ...(claim.note !== undefined ? { note: claim.note } : {}),
      capturedAt: claim.from.capturedAt,
    };

    if (!held) {
      byTag.set(claim.tag, {
        tag: claim.tag,
        level: claim.level,
        from: claim.from,
        evidence: [evidence],
      });
      continue;
    }

    const kept = held.evidence.filter((e) => e.source !== claim.from.source);
    const merged = [...kept, evidence].sort((a, b) => a.source.localeCompare(b.source));
    const takeover =
      outranks(claim.from, held.from) || claim.from.source === held.from.source;

    byTag.set(claim.tag, {
      tag: claim.tag,
      level: takeover ? claim.level : held.level,
      from: takeover ? claim.from : held.from,
      evidence: merged,
    });
  }

  return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/** One entry per provider; a later claim replaces an earlier one. */
function mergeIdentities(
  current: readonly LinkedIdentity[],
  incoming: readonly LinkedIdentity[],
): LinkedIdentity[] {
  const byProvider = new Map(current.map((i) => [i.provider, i]));
  for (const identity of incoming) byProvider.set(identity.provider, identity);
  return [...byProvider.values()];
}

/** Addresses are a set keyed case-insensitively; each keeps its strongest claim. */
function mergeEmails(
  current: readonly Sourced<string>[],
  incoming: readonly Sourced<string>[],
): Sourced<string>[] {
  const byAddress = new Map<string, Sourced<string>>();
  for (const email of [...current, ...incoming]) {
    const key = email.value.trim().toLowerCase();
    const held = byAddress.get(key);
    if (!held || compareProvenance(email.from, held.from) > 0) {
      byAddress.set(key, email);
    }
  }
  return [...byAddress.values()];
}

function mergeContact(
  current: ProfileContact,
  incoming: Partial<ProfileContact> | undefined,
): ProfileContact {
  const name = pickSourced(current.name, incoming?.name);
  const headline = pickSourced(current.headline, incoming?.headline);
  const summary = pickSourced(current.summary, incoming?.summary);
  const location = pickSourced(current.location, incoming?.location);
  return {
    ...(name ? { name } : {}),
    ...(headline ? { headline } : {}),
    ...(summary ? { summary } : {}),
    ...(location ? { location } : {}),
    emails: mergeEmails(current.emails, incoming?.emails ?? []),
  };
}

export function mergeProfile(
  base: UnifiedProfile,
  fragment: ProfileFragment,
  context: MergeContext,
): UnifiedProfile {
  const dismissed = new Set(base.dismissed);
  // A manual re-add lifts its own tombstone — see `mergeEntities`.
  for (const entry of fragment.experience ?? []) {
    if (entry.from.source === 'manual') dismissed.delete(experienceKey(entry));
  }

  const experience = mergeEntities(
    base.experience,
    fragment.experience ?? [],
    experienceKey,
    dismissed,
  );
  const skills = mergeSkills(base.skills, fragment.skills ?? []);
  const totalYears = estimateYears(experience, context.currentYear);

  // The level is *derived* unless a source claimed it outright, and a manual claim
  // outranks the derivation — which is the only way a user can say "I have been
  // doing this longer than my visible history shows".
  const derived = sourced(
    levelFromYears(totalYears),
    provenance('github', base.experienceLevel.from.capturedAt, 0),
  );
  const claimed = pickSourced(base.experienceLevel, fragment.experienceLevel);
  const experienceLevel = claimed && claimed.from.source !== 'github' ? claimed : derived;

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identities: mergeIdentities(base.identities, fragment.identities ?? []),
    contact: mergeContact(base.contact, fragment.contact),
    links: mergeEntities(base.links, fragment.links ?? [], linkKey, dismissed),
    skills,
    technologies: skills.map((s) => s.tag).sort(),
    interests: [...new Set([...base.interests, ...(fragment.interests ?? [])])].sort(),
    experienceLevel,
    experience,
    education: mergeEntities(
      base.education,
      fragment.education ?? [],
      educationKey,
      dismissed,
    ),
    projects: mergeEntities(
      base.projects,
      fragment.projects ?? [],
      projectKey,
      dismissed,
    ),
    certifications: mergeEntities(
      base.certifications,
      fragment.certifications ?? [],
      certificationKey,
      dismissed,
    ),
    languages: mergeEntities(
      base.languages,
      fragment.languages ?? [],
      languageKey,
      dismissed,
    ),
    ...((fragment.contributions ?? base.contributions)
      ? { contributions: fragment.contributions ?? base.contributions }
      : {}),
    totalYears,
    dismissed: [...dismissed].sort(),
  };
}

/**
 * Remove an entry and remember that it was removed.
 *
 * The tombstone is the point. Without it the merge cannot tell "the user threw this
 * away" from "the merge has never seen this", so the next import would put it back
 * and the user would delete it again forever.
 */
export function dismissEntry(profile: UnifiedProfile, key: string): UnifiedProfile {
  const keep = <T>(entries: readonly T[], keyOf: (e: T) => string): T[] =>
    entries.filter((e) => keyOf(e) !== key);

  return {
    ...profile,
    experience: keep(profile.experience, experienceKey),
    education: keep(profile.education, educationKey),
    projects: keep(profile.projects, projectKey),
    certifications: keep(profile.certifications, certificationKey),
    languages: keep(profile.languages, languageKey),
    links: keep(profile.links, linkKey),
    dismissed: [...new Set([...profile.dismissed, key])].sort(),
  };
}

/**
 * Take back everything one source contributed — "remove my imported CV",
 * "disconnect GitHub".
 *
 * In v1 this was a delete, because the CV lived in its own stored record. Now every
 * source is merged into one profile, so removal means *demotion*: a field whose
 * winning claim came from this source falls back to what the other sources still
 * say, and only disappears when nothing is left behind it. Which is why skills keep
 * every claim as evidence — without it, dropping a CV would also throw away the
 * GitHub measurement the CV happened to outrank.
 *
 * A hand edit is never touched, even when the entry it corrects arrived from this
 * source. The moment a user edits something it is theirs, not the importer's.
 */
export function forgetSource(
  profile: UnifiedProfile,
  source: ProfileSource,
  context: MergeContext = { currentYear: 0 },
): UnifiedProfile {
  const survives = <T extends Keyed>(entry: T): boolean => entry.from.source !== source;
  const keepSourced = <T>(value: Sourced<T> | undefined): Sourced<T> | undefined =>
    demoteSourced(value, source);

  const skills = profile.skills
    .map((skill) => demoteSkill(skill, source))
    .filter((skill): skill is ProfileSkill => skill !== null);

  const experience = profile.experience.filter(survives);
  const name = keepSourced(profile.contact.name);
  const headline = keepSourced(profile.contact.headline);
  const summary = keepSourced(profile.contact.summary);
  const location = keepSourced(profile.contact.location);

  const next: UnifiedProfile = {
    ...profile,
    contact: {
      ...(name ? { name } : {}),
      ...(headline ? { headline } : {}),
      ...(summary ? { summary } : {}),
      ...(location ? { location } : {}),
      emails: profile.contact.emails.filter((e) => e.from.source !== source),
    },
    links: profile.links.filter(survives),
    skills,
    technologies: skills.map((s) => s.tag).sort(),
    experience,
    education: profile.education.filter(survives),
    projects: profile.projects.filter(survives),
    certifications: profile.certifications.filter(survives),
    languages: profile.languages.filter(survives),
    totalYears: estimateYears(experience, context.currentYear),
  };

  // `contributions` is optional, and under `exactOptionalPropertyTypes` "absent" and
  // "present but undefined" are different types — so it is deleted rather than set.
  if (profile.contributions && profile.contributions.from.source === source) {
    delete (next as { contributions?: ContributionStats }).contributions;
  }
  return next;
}

/**
 * Drop one source's claim on a skill, promoting the strongest remaining evidence.
 * Returns `null` when that source was the only one that ever claimed it.
 */
function demoteSkill(skill: ProfileSkill, source: ProfileSource): ProfileSkill | null {
  const evidence = skill.evidence.filter((e) => e.source !== source);
  if (evidence.length === 0) return null;
  if (skill.from.source !== source) return { ...skill, evidence };

  const best = evidence.reduce((winner, candidate) =>
    compareProvenance(
      provenance(candidate.source, candidate.capturedAt),
      provenance(winner.source, winner.capturedAt),
    ) > 0
      ? candidate
      : winner,
  );
  return {
    tag: skill.tag,
    level: best.level,
    from: provenance(best.source, best.capturedAt),
    evidence,
  };
}

/** True when a source is currently contributing anything to the profile. */
export function hasSource(profile: UnifiedProfile, source: ProfileSource): boolean {
  const claims: readonly { readonly from: Provenance }[] = [
    ...profile.experience,
    ...profile.education,
    ...profile.projects,
    ...profile.certifications,
    ...profile.languages,
    ...profile.links,
    ...profile.contact.emails,
    ...(profile.contact.name ? [profile.contact.name] : []),
  ];
  return (
    claims.some((c) => c.from.source === source) ||
    profile.skills.some((s) => s.evidence.some((e) => e.source === source))
  );
}

import { clamp01, roundTo, type ExperienceLevel, type SkillTag } from '@cairn/shared';
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
  isMeasured,
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

/**
 * One source's claim on one interest.
 *
 * Interests never conflict — they are a union, not a slot — so this provenance is not
 * for ranking. It exists so the claim can be withdrawn when the source is disconnected.
 */
export interface IncomingInterest {
  readonly tag: SkillTag;
  readonly from: Provenance;
}

/** One source's claim about one skill, before reconciliation. */
export interface IncomingSkill {
  readonly tag: SkillTag;
  readonly level: number;
  /** Plain-language reason, shown as evidence. */
  readonly note?: string;
  /**
   * The raw volume behind a **measured** claim, in whatever unit the source counts:
   * GitHub's language bytes, GitLab's share of a repository's size (ADR-0034).
   *
   * `level` is already normalised *within one account*, which makes two accounts'
   * levels incommensurable — 90% of a toy project and 90% of a decade's work are the
   * same number and not the same fact. The weight is what lets two measured sources be
   * added rather than one of them being picked. Sources that assert rather than measure
   * have no weight, and are not combined.
   */
  readonly weight?: number;
  readonly from: Provenance;
}

export interface ProfileFragment {
  readonly identities?: readonly LinkedIdentity[];
  readonly contact?: Partial<ProfileContact>;
  readonly links?: readonly ProfileLink[];
  readonly skills?: readonly IncomingSkill[];
  readonly interests?: readonly IncomingInterest[];
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
      ...(claim.weight !== undefined ? { weight: claim.weight } : {}),
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

/**
 * Union the incoming tags into the interest list, and record who claimed each.
 *
 * Returns both fields together because they have to stay in step: a tag in the list
 * with nobody recorded against it can never be removed, and a source recorded against a
 * tag that is not in the list is a claim on nothing.
 */
function mergeInterests(
  base: UnifiedProfile,
  incoming: readonly IncomingInterest[],
): Pick<UnifiedProfile, 'interests' | 'interestSources'> {
  const claims = new Map<string, Set<ProfileSource>>(
    Object.entries(base.interestSources ?? {}).map(([tag, sources]) => [
      tag,
      new Set(sources),
    ]),
  );
  for (const claim of incoming) {
    const held = claims.get(claim.tag) ?? new Set<ProfileSource>();
    held.add(claim.from.source);
    claims.set(claim.tag, held);
  }

  const interests = [
    ...new Set([...base.interests, ...incoming.map((i) => i.tag)]),
  ].sort();

  return {
    interests,
    interestSources: Object.fromEntries(
      [...claims.entries()]
        .map(([tag, sources]) => [tag, [...sources].sort()] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

/** A used language never scores below this, so it still counts toward matches. */
export const SKILL_LEVEL_FLOOR = 0.3;

/**
 * Confidence carried by a language level derived from counting code — GitHub's bytes,
 * GitLab's share of a repository.
 *
 * Below 1 deliberately, and this is the number that makes the measured tier's tiebreak
 * mean something. **A byte count says what someone wrote, not how well.** It is a proxy,
 * and a proxy should not carry certainty — which is what 1 would say, leaving no room
 * for a source that measures the same underlying thing better to ever be preferred.
 *
 * In practice it is the threshold Stack Exchange has to clear: a tag with roughly thirty
 * points of peer-assessed answers outranks a byte count, and a thinner one stays as
 * evidence (ADR-0035). Nothing else changes, because two volume-counting sources both
 * carry this value and therefore still tie — which is what `combineMeasured` is for.
 */
export const MEASURED_VOLUME_CONFIDENCE = 0.7;

/**
 * Recompute levels for tags that **more than one measured source** weighed (ADR-0034).
 *
 * Every measured source normalises within its own account: GitHub divides a language's
 * bytes by the biggest language it can see, GitLab does the same over its projects. Two
 * such numbers cannot be compared, let alone chosen between — 90% of one toy repository
 * and 90% of a decade of work are the same number and not the same fact. Left alone,
 * `mergeSkills` finds the two claims tied (same rung, same confidence, same day), keeps
 * whichever arrived first, and reports the smaller account when that is the one the user
 * happened to connect first.
 *
 * So the volumes are added and the ladder is rebuilt from the total. Three properties
 * this has to keep, each of which has a test:
 *
 * - **With one measured source it is a no-op.** `total / peak` over a single source is
 *   exactly what that source already computed, so connecting GitLab and disconnecting it
 *   again leaves the numbers where they started.
 * - **It never routes around the ladder.** A tag whose winner is `manual`, `cv` or
 *   `linkedin` is untouched; combining breaks a tie *within* the measured tier and is
 *   not a way for measurement to outrank a person.
 * - **Provenance follows volume, not arrival.** The dominant account gets the `from`,
 *   so the answer does not depend on connection order.
 */
function combineMeasured(skills: readonly ProfileSkill[]): ProfileSkill[] {
  const totals = new Map<SkillTag, number>();
  for (const skill of skills) {
    const weighed = skill.evidence.filter(
      (e) => isMeasured(e.source) && typeof e.weight === 'number',
    );
    if (weighed.length === 0) continue;
    totals.set(
      skill.tag,
      weighed.reduce((sum, e) => sum + (e.weight ?? 0), 0),
    );
  }
  // Normalise across every weighed tag, not only the contested ones: a tag both sources
  // claim would otherwise be divided by a larger number than one only GitHub claims,
  // and the two would no longer be on the same scale.
  const peak = Math.max(0, ...totals.values());
  if (peak <= 0) return [...skills];

  return skills.map((skill) => {
    const weighed = skill.evidence.filter(
      (e) => isMeasured(e.source) && typeof e.weight === 'number',
    );
    // Every *weighed-held* tag is rebuilt, not only the contested ones. Combining two
    // accounts' Ruby moves the peak the whole ladder is measured against, so a tag only
    // GitHub weighed would otherwise keep a level computed against a scale that no
    // longer exists — reported as half the user's work when it is now a tenth.
    //
    // The holder's *own* weight is what qualifies it, not merely being measured. Not
    // every measured source measures the same thing: Stack Exchange counts
    // peer-assessed answers (ADR-0035), which is not a volume of code and carries no
    // weight. Rebuilding its level from another source's byte count would be arithmetic
    // across two different units, and would quietly hand the tag back to the source that
    // lost it — leaving a plausible-looking number as the only symptom.
    const holdsWeight = weighed.some((e) => e.source === skill.from.source);
    if (!holdsWeight || !isMeasured(skill.from.source)) return skill;

    const total = totals.get(skill.tag) ?? 0;
    // Deterministic: by weight, then by name, so no tie depends on evidence order.
    const dominant = [...weighed].sort(
      (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.source.localeCompare(b.source),
    )[0];
    const holder =
      dominant !== undefined && dominant.source !== skill.from.source
        ? provenance(dominant.source, skill.from.capturedAt, skill.from.confidence)
        : skill.from;

    return {
      ...skill,
      level: roundTo(Math.max(SKILL_LEVEL_FLOOR, clamp01(total / peak)), 2),
      from: holder,
    };
  });
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
  const skills = combineMeasured(mergeSkills(base.skills, fragment.skills ?? []));
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
    ...mergeInterests(base, fragment.interests ?? []),
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
    ...forgetInterests(profile, source),
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
 * Withdraw one source's interest claims.
 *
 * A tag survives while any other source still names it — two sources naming the same
 * interest is ordinary, and one leaving does not unmake the other's claim. A tag with
 * **no** recorded source is unattributable, from a profile stored before claims were
 * kept, and is left alone: deleting something we cannot account for is the worse
 * failure, since the user would watch interests vanish on an unrelated action. Those
 * correct themselves on the next import.
 */
function forgetInterests(
  profile: UnifiedProfile,
  source: ProfileSource,
): Pick<UnifiedProfile, 'interests' | 'interestSources'> {
  const claims = profile.interestSources ?? {};
  const remaining = Object.fromEntries(
    Object.entries(claims)
      .map(([tag, sources]) => [tag, sources.filter((s) => s !== source)] as const)
      .filter(([, sources]) => sources.length > 0),
  );

  return {
    interests: profile.interests.filter((tag) => {
      const claimed = claims[tag];
      return claimed === undefined || remaining[tag] !== undefined;
    }),
    interestSources: remaining,
  };
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

import type { ExperienceLevel, SkillTag } from '@cairn/shared';
import {
  dismissEntry,
  mergeProfile,
  type MergeContext,
  type ProfileFragment,
} from './merge';
import {
  certificationKey,
  educationKey,
  experienceKey,
  languageKey,
  linkKey,
  projectKey,
  type CertificationEntry,
  type EducationEntry,
  type ExperienceEntry,
  type ProfileLink,
  type ProjectEntry,
  type SpokenLanguage,
  type UnifiedProfile,
} from './model';
import { provenance, sourced } from './provenance';

/**
 * Hand edits (ADR-0031, ADR-0032).
 *
 * `manual` provenance has existed since Profile v2 and nothing could produce it —
 * there was no UI, so the highest-precedence source in the system was unreachable.
 * This is what the profile hub calls, and it is pure: a profile and an edit in, a
 * profile out, no clock and no storage.
 *
 * ## Why an edit is not a merge
 *
 * Importing is a merge: two sources describe the same career and the higher
 * precedence wins per field. Editing is a **replacement**, and the difference is not
 * academic. A role is identified by organisation and start year
 * ([`model.ts`](model.ts)), so correcting a misspelt employer *changes its identity* —
 * merging the corrected entry would add a second role rather than fix the first. That
 * is the same duplication that keying on job title caused, moved one field over.
 *
 * So `replaces` carries the identity being edited, the old entry is removed, and when
 * the identity actually changed the old key is **tombstoned** — otherwise the next
 * import re-adds the misspelling alongside the correction and the user fixes the same
 * typo forever.
 */

export type ContactField = 'name' | 'headline' | 'summary' | 'location';

/** An entry as the form holds it: no provenance, because the edit supplies it. */
type Draft<T extends { readonly from: unknown }> = Omit<T, 'from'>;

export type ProfileEdit =
  | { readonly kind: 'contact'; readonly field: ContactField; readonly value: string }
  | { readonly kind: 'email'; readonly value: string }
  | { readonly kind: 'experience-level'; readonly value: ExperienceLevel }
  | { readonly kind: 'skill'; readonly tag: SkillTag; readonly level: number }
  | { readonly kind: 'remove-skill'; readonly tag: SkillTag }
  | {
      readonly kind: 'experience';
      readonly replaces?: string;
      readonly entry: Draft<ExperienceEntry>;
    }
  | {
      readonly kind: 'education';
      readonly replaces?: string;
      readonly entry: Draft<EducationEntry>;
    }
  | {
      readonly kind: 'project';
      readonly replaces?: string;
      readonly entry: Draft<ProjectEntry>;
    }
  | {
      readonly kind: 'certification';
      readonly replaces?: string;
      readonly entry: Draft<CertificationEntry>;
    }
  | {
      readonly kind: 'language';
      readonly replaces?: string;
      readonly entry: Draft<SpokenLanguage>;
    }
  | {
      readonly kind: 'link';
      readonly replaces?: string;
      readonly entry: Draft<ProfileLink>;
    }
  | { readonly kind: 'remove'; readonly key: string };

export interface EditContext extends MergeContext {
  /** ISO date the edit was made. Supplied, never read from a clock. */
  readonly capturedAt: string;
}

/** Apply one hand edit. Pure: no IO, no randomness, no clock. */
export function applyEdit(
  profile: UnifiedProfile,
  edit: ProfileEdit,
  context: EditContext,
): UnifiedProfile {
  const from = provenance('manual', context.capturedAt);
  const merge = (base: UnifiedProfile, fragment: ProfileFragment): UnifiedProfile =>
    mergeProfile(base, fragment, context);

  switch (edit.kind) {
    case 'contact': {
      const value = edit.value.trim();
      // An emptied field is a deletion, not an empty string sitting in the profile
      // looking like a value. `forgetSource('manual')` would be wrong — it would undo
      // every other hand edit — so the field is dropped and rebuilt from what remains.
      if (value === '') return clearContactField(profile, edit.field);
      return merge(profile, { contact: { [edit.field]: sourced(value, from) } });
    }

    case 'email': {
      const value = edit.value.trim();
      if (value === '') return profile;
      return merge(profile, { contact: { emails: [sourced(value, from)] } });
    }

    case 'experience-level':
      return merge(profile, { experienceLevel: sourced(edit.value, from) });

    case 'skill':
      return merge(profile, {
        skills: [{ tag: edit.tag, level: edit.level, note: 'you set this', from }],
      });

    case 'remove-skill': {
      const skills = profile.skills.filter((s) => s.tag !== edit.tag);
      return {
        ...profile,
        skills,
        technologies: skills.map((s) => s.tag).sort(),
      };
    }

    case 'experience':
      return replace(
        profile,
        edit.replaces,
        experienceKey,
        { ...edit.entry, from },
        (e) => merge(e.base, { experience: [e.entry] }),
      );

    case 'education':
      return replace(profile, edit.replaces, educationKey, { ...edit.entry, from }, (e) =>
        merge(e.base, { education: [e.entry] }),
      );

    case 'project':
      return replace(profile, edit.replaces, projectKey, { ...edit.entry, from }, (e) =>
        merge(e.base, { projects: [e.entry] }),
      );

    case 'certification':
      return replace(
        profile,
        edit.replaces,
        certificationKey,
        { ...edit.entry, from },
        (e) => merge(e.base, { certifications: [e.entry] }),
      );

    case 'language':
      return replace(profile, edit.replaces, languageKey, { ...edit.entry, from }, (e) =>
        merge(e.base, { languages: [e.entry] }),
      );

    case 'link':
      return replace(profile, edit.replaces, linkKey, { ...edit.entry, from }, (e) =>
        merge(e.base, { links: [e.entry] }),
      );

    case 'remove':
      return withYears(dismissEntry(profile, edit.key), context);
  }
}

/**
 * Remove what is being replaced, then hand the caller a base to merge the new entry
 * into.
 *
 * The tombstone is conditional, and the condition is the whole design:
 *
 * - **Identity changed** ("Paystak" → "Paystack"): tombstone the old key. Without it
 *   the next import re-adds the misspelling as a separate role.
 * - **Identity unchanged** (a retitle): no tombstone. It is still the same entry, and
 *   blocking its key would stop a later import contributing a bullet or a location to
 *   a role the user only reworded. `manual` precedence already protects what they
 *   typed.
 */
function replace<T extends { readonly from: unknown }>(
  profile: UnifiedProfile,
  replaces: string | undefined,
  keyOf: (entry: T) => string,
  entry: T,
  insert: (e: { base: UnifiedProfile; entry: T }) => UnifiedProfile,
): UnifiedProfile {
  if (replaces === undefined) return insert({ base: profile, entry });

  const identityChanged = keyOf(entry) !== replaces;
  const base = identityChanged
    ? dismissEntry(profile, replaces)
    : removeWithoutTombstone(profile, replaces);

  return insert({ base, entry });
}

/**
 * Drop the entry at `key` from every collection, leaving `dismissed` alone.
 *
 * Deliberately blunt: every key is namespaced by its own prefix (`exp:`, `edu:`, …),
 * so filtering all six collections cannot cross-match. The alternative is threading a
 * collection name through the whole call chain to say something the key already says.
 */
function removeWithoutTombstone(profile: UnifiedProfile, key: string): UnifiedProfile {
  const drop = <E>(entries: readonly E[], of: (e: E) => string): E[] =>
    entries.filter((e) => of(e) !== key);

  return {
    ...profile,
    experience: drop(profile.experience, experienceKey),
    education: drop(profile.education, educationKey),
    projects: drop(profile.projects, projectKey),
    certifications: drop(profile.certifications, certificationKey),
    languages: drop(profile.languages, languageKey),
    links: drop(profile.links, linkKey),
  };
}

/** Drop one contact field and let the remaining sources show through. */
function clearContactField(profile: UnifiedProfile, field: ContactField): UnifiedProfile {
  const contact = { ...profile.contact };
  delete contact[field];
  return { ...profile, contact };
}

/** `dismissEntry` does not know the year, so a removal's effect on it is applied here. */
function withYears(profile: UnifiedProfile, context: MergeContext): UnifiedProfile {
  return mergeProfile(profile, {}, context);
}

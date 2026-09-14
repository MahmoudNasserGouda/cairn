import { toKnownSkills } from '@cairn/shared';
import { extractSkills } from './taxonomy';
import type { IncomingSkill, ProfileFragment } from './merge';
import type {
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
  LinkKind,
  ProfileLink,
  ProjectEntry,
  SpokenLanguage,
} from './model';
import { provenance, sourced, type Provenance } from './provenance';

/**
 * Structural view of what `readLinkedinArchive` (@cairn/linkedin-archive) returns.
 *
 * Declared locally, exactly as `githubToFragment` declares its GitHub input: this
 * module has no runtime dependency on the reader, so "what the archive says" and
 * "what that means for a profile" stay independently testable and a parser change
 * cannot quietly alter merge behaviour. `linkedin.test.ts` runs a real archive
 * through both, which is what stops the two shapes drifting apart.
 */
export interface LinkedinIdentityInput {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly headline?: string;
  readonly summary?: string;
  readonly location?: string;
  readonly industry?: string;
  readonly websites: readonly string[];
  readonly twitterHandles: readonly string[];
}

export interface LinkedinArchiveInput {
  readonly identity?: LinkedinIdentityInput;
  readonly positions: readonly {
    readonly title: string;
    readonly organization?: string;
    readonly location?: string;
    readonly startYear?: number;
    readonly endYear?: number | 'present';
    readonly highlights: readonly string[];
  }[];
  readonly education: readonly {
    readonly institution: string;
    readonly degree?: string;
    readonly startYear?: number;
    readonly endYear?: number;
  }[];
  readonly skills: readonly string[];
  readonly certifications: readonly {
    readonly name: string;
    readonly issuer?: string;
    readonly year?: number;
    readonly url?: string;
  }[];
  readonly projects: readonly {
    readonly name: string;
    readonly description?: string;
    readonly url?: string;
  }[];
  readonly languages: readonly {
    readonly name: string;
    readonly proficiency?: string;
  }[];
  readonly emails: readonly string[];
}

/**
 * A LinkedIn skill is *stated*, not measured — the export carries no endorsement
 * count, no level, nothing but a name. So it lands mid-scale, the same place a CV's
 * claim lands, and says so rather than pretending to a precision the file cannot
 * carry. Precedence, not level, is what makes the archive outrank the CV.
 */
const LINKEDIN_SKILL_LEVEL = 0.5;

/** Twitter's own rule: letters, digits and underscore, at most fifteen. */
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Turn a LinkedIn data-export archive into a profile fragment (ADR-0029, ADR-0031).
 *
 * The archive sits above the CV and below a hand edit
 * ([`provenance.ts`](provenance.ts)): both are the user's own account of their career,
 * but the archive is structured data straight out of a form they filled in, while a
 * CV is prose we parsed. It sits above GitHub on everything biographical, and claims
 * nothing GitHub measures.
 *
 * Two things it could claim and deliberately does not:
 *
 * - **It does not add a linked identity.** Identities come from signing in
 *   ([ADR-0025](../../../docs/adr/0025-multi-provider-identity.md)). A file the user
 *   downloaded is evidence about a career, not proof of an account, and stamping one
 *   here would make "connected to LinkedIn" true for someone who connected nothing.
 * - **It does not claim an experience level.** The level is derived from the dated
 *   roles, which the archive supplies in full; asserting one on top would be a second,
 *   worse answer to a question the merge already answers.
 */
export function linkedinToFragment(
  archive: LinkedinArchiveInput,
  capturedAt: string,
): ProfileFragment {
  const from = provenance('linkedin', capturedAt);
  const identity = archive.identity;

  const name = [identity?.firstName, identity?.lastName]
    .filter((part): part is string => (part ?? '').trim() !== '')
    .join(' ')
    .trim();

  return {
    contact: {
      ...(name !== '' ? { name: sourced(name, from) } : {}),
      ...(identity?.headline ? { headline: sourced(identity.headline, from) } : {}),
      // GitHub leaves `summary` alone on purpose — a bio is a one-line header, not
      // prose. The archive is the first source that carries the real thing.
      ...(identity?.summary ? { summary: sourced(identity.summary, from) } : {}),
      ...(identity?.location ? { location: sourced(identity.location, from) } : {}),
      emails: archive.emails.map((address) => sourced(address, from)),
    },
    links: links(identity, from),
    skills: skills(archive.skills, from),
    experience: experience(archive, from),
    education: education(archive, from),
    projects: projects(archive, from),
    certifications: certifications(archive, from),
    languages: languages(archive, from),
  };
}

function links(
  identity: LinkedinIdentityInput | undefined,
  from: Provenance,
): ProfileLink[] {
  if (!identity) return [];

  const out: ProfileLink[] = identity.websites.map((url) => ({
    kind: linkKindFor(url),
    url,
    from,
  }));

  for (const handle of identity.twitterHandles) {
    // The field is free text in a file the user was emailed. Anything that is not a
    // plausible handle is dropped rather than interpolated into a URL — a dropped
    // link costs a line on a profile page; a fabricated one is a link to somewhere
    // nobody chose.
    if (!HANDLE.test(handle)) continue;
    // `x.com`, not `twitter.com`: the archive stores a bare handle, so the host is
    // ours to pick, and picking the one that has been canonical since the rename
    // avoids a link that reads as stale the day it is added. The kind stays
    // `twitter` because that is what LinkedIn's column is called and what the rest
    // of the model already understands — `linkKindFor` maps both hosts to it.
    out.push({ kind: 'twitter', url: `https://x.com/${handle}`, from });
  }
  return out;
}

/** Host tells us what a link is; the archive does not label them usefully. */
function linkKindFor(url: string): LinkKind {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  const at = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

  if (at('github.com')) return 'github';
  if (at('linkedin.com')) return 'linkedin';
  if (at('twitter.com') || at('x.com')) return 'twitter';
  return 'website';
}

/**
 * Skills the taxonomy knows, and only those.
 *
 * LinkedIn skill lists mix technologies with things like "Leadership" and
 * "Stakeholder Management". Those are real, and this profile has nowhere to put them:
 * `skills` is typed to the matching taxonomy, so a tag nothing can ever match against
 * would look like data while doing nothing. They are dropped rather than smuggled in
 * as technologies.
 */
function skills(raw: readonly string[], from: Provenance): IncomingSkill[] {
  return toKnownSkills([...raw]).map((tag) => ({
    tag,
    level: LINKEDIN_SKILL_LEVEL,
    note: 'listed on your LinkedIn profile',
    from,
  }));
}

function experience(archive: LinkedinArchiveInput, from: Provenance): ExperienceEntry[] {
  return archive.positions.map((position) => ({
    title: position.title,
    ...(position.organization !== undefined
      ? { organization: position.organization }
      : {}),
    ...(position.location !== undefined ? { location: position.location } : {}),
    ...(position.startYear !== undefined ? { startYear: position.startYear } : {}),
    ...(position.endYear !== undefined ? { endYear: position.endYear } : {}),
    highlights: [...position.highlights],
    from,
  }));
}

function education(archive: LinkedinArchiveInput, from: Provenance): EducationEntry[] {
  return archive.education.map((entry) => ({
    institution: entry.institution,
    ...(entry.degree !== undefined ? { degree: entry.degree } : {}),
    ...(entry.startYear !== undefined ? { startYear: entry.startYear } : {}),
    ...(entry.endYear !== undefined ? { endYear: entry.endYear } : {}),
    from,
  }));
}

function projects(archive: LinkedinArchiveInput, from: Provenance): ProjectEntry[] {
  return archive.projects.map((project) => ({
    name: project.name,
    ...(project.description !== undefined ? { description: project.description } : {}),
    ...(project.url !== undefined ? { url: project.url } : {}),
    // The archive has no technology field, so the only evidence is what the user
    // wrote. `extractSkills` is deliberately conservative about words that are also
    // English — this will under-report rather than claim a project used Go because
    // the description said "go live".
    technologies: extractSkills(`${project.name} ${project.description ?? ''}`),
    from,
  }));
}

function certifications(
  archive: LinkedinArchiveInput,
  from: Provenance,
): CertificationEntry[] {
  return archive.certifications.map((entry) => ({
    name: entry.name,
    ...(entry.issuer !== undefined ? { issuer: entry.issuer } : {}),
    ...(entry.year !== undefined ? { year: entry.year } : {}),
    ...(entry.url !== undefined ? { url: entry.url } : {}),
    from,
  }));
}

function languages(archive: LinkedinArchiveInput, from: Provenance): SpokenLanguage[] {
  return archive.languages.map((entry) => ({
    name: entry.name,
    ...(entry.proficiency !== undefined ? { proficiency: entry.proficiency } : {}),
    from,
  }));
}

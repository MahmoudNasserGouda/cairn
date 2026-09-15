import { clamp01, roundTo, toKnownSkills, type SkillTag } from '@cairn/shared';
import { canonicalizeSkill } from './taxonomy';
import {
  MEASURED_VOLUME_CONFIDENCE,
  SKILL_LEVEL_FLOOR,
  type IncomingSkill,
  type ProfileFragment,
} from './merge';
import type { ProfileLink, ProjectEntry } from './model';
import { provenance, sourced, type Provenance } from './provenance';

/**
 * GitLab into a profile fragment (ADR-0034, ADR-0031).
 *
 * Structural view of what `collectGitlabViewer` (@cairn/gitlab) returns, declared
 * locally so this module has no runtime dependency on the client — the same "data in,
 * no network" contract the CV parser and the GitHub mapper keep.
 */
export interface GitlabProjectInput {
  readonly fullPath: string;
  readonly name: string;
  readonly description: string | null;
  readonly webUrl: string;
  readonly visibility: string;
  readonly lastActivityAt: string | null;
  readonly topics: readonly string[];
  readonly starCount: number;
  /** Bytes, or `null` when the user's access does not include statistics. */
  readonly repositorySize: number | null;
  readonly languages: readonly { readonly name: string; readonly share: number }[];
}

export interface GitlabProfileInput {
  readonly username: string;
  readonly name: string | null;
  readonly webUrl: string | null;
  readonly avatarUrl: string | null;
  readonly publicEmail: string | null;
  readonly groups: readonly string[];
  readonly projects: readonly GitlabProjectInput[];
}

/** Projects shown as portfolio entries, most-starred first. */
const PROJECT_ENTRIES = 6;

/**
 * Turn per-project language *shares* into something that can be added.
 *
 * This is the one genuinely new problem GitLab brings. GitHub reports language bytes,
 * which are a volume and therefore sum. GitLab reports a percentage of each repository,
 * which is not: 80% Ruby describes a weekend script and a decade of work identically.
 * Multiplying by the repository's size recovers a byte-equivalent, and byte-equivalents
 * are what let the merge add GitLab's Ruby to GitHub's instead of choosing between two
 * numbers that were never on the same scale.
 *
 * **It is an approximation and is labelled as one.** `repositorySize` counts everything
 * git is storing — history, binaries, LFS pointers — not lines of source. It is a good
 * proxy for "how much work is here" and a poor one for "how many bytes of Ruby", which
 * is why it decides *relative* weight and never appears as a figure a user is shown.
 *
 * When GitLab will not report a size — `statistics` needs Reporter access, so a project
 * where the user is a Guest returns null — no weight is emitted for what that project
 * contributes. Inventing one would let a toy project outweigh a monorepo silently,
 * which is the exact failure this function exists to prevent.
 */
function languageSkills(input: GitlabProfileInput, from: Provenance): IncomingSkill[] {
  // Same reasoning as GitHub's: counted code is a proxy, not a certainty.
  const counted = provenance('gitlab', from.capturedAt, MEASURED_VOLUME_CONFIDENCE);
  const weighed = new Map<SkillTag, number>();
  const unweighed = new Map<SkillTag, number>();

  for (const project of input.projects) {
    const size = project.repositorySize;
    for (const language of project.languages) {
      const tag = canonicalizeSkill(language.name);
      if (size !== null) {
        weighed.set(tag, (weighed.get(tag) ?? 0) + (language.share / 100) * size);
      } else {
        unweighed.set(tag, (unweighed.get(tag) ?? 0) + 1);
      }
    }
  }

  const peak = Math.max(1, ...weighed.values());
  const total = [...weighed.values()].reduce((sum, n) => sum + n, 0);
  const skills: IncomingSkill[] = [];

  for (const [tag, weight] of weighed) {
    skills.push({
      tag,
      level: roundTo(Math.max(SKILL_LEVEL_FLOOR, clamp01(weight / peak)), 2),
      // Rounded, because the underlying number is an estimate from repository size and
      // a decimal place would imply a precision it does not have.
      note:
        total > 0
          ? `about ${Math.round((weight / total) * 100)}% of the code in your GitLab projects`
          : 'used in your GitLab projects',
      weight: Math.round(weight),
      from: counted,
    });
  }

  for (const [tag, projects] of unweighed) {
    if (weighed.has(tag)) continue;
    skills.push({
      tag,
      // The floor, and no higher: the language is real, but nothing here establishes
      // how much of it there is. Saying what we do not know, rather than guessing.
      level: SKILL_LEVEL_FLOOR,
      note:
        projects === 1
          ? 'used in a GitLab project we cannot size'
          : `used in ${projects} GitLab projects we cannot size`,
      from: counted,
    });
  }

  return skills.sort((a, b) => a.tag.localeCompare(b.tag));
}

function links(input: GitlabProfileInput, from: Provenance): ProfileLink[] {
  return [
    {
      kind: 'gitlab',
      url: input.webUrl ?? `https://gitlab.com/${input.username}`,
      from,
    },
  ];
}

function projects(input: GitlabProfileInput, from: Provenance): ProjectEntry[] {
  return [...input.projects]
    .sort((a, b) => b.starCount - a.starCount || a.fullPath.localeCompare(b.fullPath))
    .slice(0, PROJECT_ENTRIES)
    .map((project) => ({
      name: project.fullPath,
      ...(project.description !== null && project.description.length > 0
        ? { description: project.description }
        : {}),
      url: project.webUrl,
      technologies: toKnownSkills(project.languages.map((l) => l.name)),
      from,
    }));
}

/**
 * GitLab is a **measured** source and claims nothing it did not observe.
 *
 * Two omissions are deliberate, both matching the GitHub mapper's reasoning:
 *
 * - **No experience level and no experience entry.** Nothing in the response dates the
 *   account, and inferring a career length from project activity would invent a number
 *   the user never gave. GitHub can bound it because it returns `createdAt`; GitLab's
 *   `currentUser` does not.
 * - **Group membership is not employment.** A GitLab group is as likely to be a
 *   community or a course as an employer, so it is carried as an affiliation and never
 *   becomes a job.
 *
 * Topics become interests rather than skills, for the reason
 * [ADR-0036](../../../docs/adr/0036-dev-to-as-interests-not-skills.md) gives about
 * dev.to tags: what a project is about is not evidence that its author is good at it.
 */
export function gitlabToFragment(
  input: GitlabProfileInput,
  capturedAt: string,
): ProfileFragment {
  const measured = provenance('gitlab', capturedAt);
  const displayName =
    input.name !== null && input.name.length > 0 ? input.name : input.username;
  const email = input.publicEmail;

  return {
    identities: [{ provider: 'gitlab', displayName }],
    contact: {
      name: sourced(displayName, measured),
      emails: email !== null && email.length > 0 ? [sourced(email, measured)] : [],
    },
    links: links(input, measured),
    skills: languageSkills(input, measured),
    interests: [
      ...new Set(
        input.projects.flatMap((p) => p.topics).map((t) => canonicalizeSkill(t)),
      ),
    ].sort(),
    projects: projects(input, measured),
  };
}

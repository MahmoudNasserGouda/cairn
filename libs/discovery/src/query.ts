import { isLanguageSkill, type SkillTag } from '@cairn/shared';
import type { DeveloperSnapshot } from '@cairn/matching';
import type { LaneId, PlannedQuery } from './model';
import { STAR_WINDOW } from './bands';
import { withArticle } from './labels';

/** A repository search expressed as intent, before it becomes GitHub syntax. */
export interface RepoSearchSpec {
  readonly language?: SkillTag;
  readonly topics?: readonly SkillTag[];
  readonly minStars?: number;
  readonly maxStars?: number;
  readonly pushedWithinDays?: number;
  readonly minGoodFirstIssues?: number;
  /** Both default to true: archived and forked repos are not contribution targets. */
  readonly excludeArchived?: boolean;
  readonly excludeForks?: boolean;
}

/**
 * Canonical tag -> the name GitHub's `language:` qualifier actually knows. Only the
 * disagreements are listed; everything else matches linguist case-insensitively.
 */
const GITHUB_LANGUAGE: Readonly<Record<string, string>> = {
  bash: 'shell',
};

/** Canonical tag -> the conventional GitHub *topic* slug for it. */
const GITHUB_TOPIC: Readonly<Record<string, string>> = {
  'c#': 'csharp',
  'c++': 'cpp',
  node: 'nodejs',
};

/** GitHub needs quoting once a value leaves `[a-z0-9-]`, e.g. `language:"c#"`. */
function qualifier(name: string, value: string): string {
  return /^[a-z0-9-]+$/.test(value) ? `${name}:${value}` : `${name}:"${value}"`;
}

function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Render a spec as a GitHub repository-search query string.
 *
 * Pure and syntax-only: it neither knows nor calls the API. `@cairn/github`'s
 * `searchRepositories` takes the string this produces, which is what lets discovery
 * plan queries without depending on the client (ADR-0027).
 */
export function buildRepoSearchQuery(
  spec: RepoSearchSpec,
  now: number = Date.now(),
): string {
  const parts: string[] = [];

  if (spec.language) {
    const lang = GITHUB_LANGUAGE[spec.language] ?? spec.language;
    parts.push(qualifier('language', lang));
  }
  for (const topic of spec.topics ?? []) {
    parts.push(qualifier('topic', GITHUB_TOPIC[topic] ?? topic));
  }

  const { minStars, maxStars } = spec;
  if (minStars !== undefined && maxStars !== undefined) {
    parts.push(`stars:${minStars}..${maxStars}`);
  } else if (minStars !== undefined) {
    parts.push(`stars:>=${minStars}`);
  } else if (maxStars !== undefined) {
    parts.push(`stars:<=${maxStars}`);
  }

  if (spec.pushedWithinDays !== undefined) {
    parts.push(`pushed:>=${isoDay(now - spec.pushedWithinDays * 86_400_000)}`);
  }
  if (spec.minGoodFirstIssues !== undefined) {
    parts.push(`good-first-issues:>=${spec.minGoodFirstIssues}`);
  }
  if (spec.excludeArchived !== false) parts.push('archived:false');
  if (spec.excludeForks !== false) parts.push('fork:false');

  return parts.join(' ');
}

/** Repositories quiet for longer than this are not worth recommending. */
const ACTIVE_WITHIN_DAYS = 180;
/** The newcomer lane insists on fresher activity — issue labels go stale fast. */
const NEWCOMER_ACTIVE_WITHIN_DAYS = 90;
const MIN_GOOD_FIRST_ISSUES = 3;
/** A repo that labels beginner work earns a look below the experience floor. */
const NEWCOMER_STAR_FLOOR = 50;

function languagesByProficiency(dev: DeveloperSnapshot): SkillTag[] {
  return [...dev.skills]
    .filter((s) => isLanguageSkill(s.tag))
    .sort((a, b) => b.level - a.level)
    .map((s) => s.tag);
}

/**
 * Interests worth a `topic:` search: things the developer works with that are not
 * languages — a `topic:python` search is strictly worse than `language:python`.
 * Declared interests come first, then the non-language skills by proficiency.
 */
function topicInterests(dev: DeveloperSnapshot): SkillTag[] {
  const fromSkills = [...dev.skills]
    .sort((a, b) => b.level - a.level)
    .map((s) => s.tag)
    .filter((t) => !isLanguageSkill(t));
  return [
    ...new Set([...dev.interests.filter((t) => !isLanguageSkill(t)), ...fromSkills]),
  ];
}

export interface PlanOptions {
  readonly now?: number;
}

/**
 * Turn a developer profile into at most four repository searches (ADR-0027).
 *
 * Four is a budget, not a coincidence: GitHub's Search API allows 10 requests a
 * minute unauthenticated and 30 signed in, so a discovery run has to fit several
 * times over into the smaller of those and still leave the rest of the app room.
 *
 * Returns an empty plan when the profile names no programming language — there is
 * nothing honest to search for, and the caller has to say so rather than guess.
 */
export function planQueries(
  dev: DeveloperSnapshot,
  opts: PlanOptions = {},
): PlannedQuery[] {
  const now = opts.now ?? Date.now();
  const languages = languagesByProficiency(dev);
  const primary = languages[0];
  if (!primary) return [];

  const [minStars, maxStars] = STAR_WINDOW[dev.experience];
  const plan: { lane: LaneId; spec: RepoSearchSpec; rationale: string }[] = [
    {
      lane: 'core-skill',
      spec: {
        language: primary,
        minStars,
        maxStars,
        pushedWithinDays: ACTIVE_WITHIN_DAYS,
      },
      rationale: `Active ${primary} projects sized for ${withArticle(dev.experience)} contributor`,
    },
    {
      lane: 'newcomer',
      spec: {
        language: primary,
        minStars: Math.min(minStars, NEWCOMER_STAR_FLOOR),
        maxStars,
        pushedWithinDays: NEWCOMER_ACTIVE_WITHIN_DAYS,
        minGoodFirstIssues: MIN_GOOD_FIRST_ISSUES,
      },
      rationale:
        `${primary} projects with at least ${MIN_GOOD_FIRST_ISSUES} open ` +
        `"good first issue" tickets`,
    },
  ];

  const secondary = languages[1];
  if (secondary) {
    plan.push({
      lane: 'secondary-skill',
      spec: {
        language: secondary,
        minStars,
        maxStars,
        pushedWithinDays: ACTIVE_WITHIN_DAYS,
      },
      rationale: `Your second language, ${secondary}`,
    });
  }

  const interest = topicInterests(dev)[0];
  if (interest) {
    plan.push({
      lane: 'interests',
      spec: {
        topics: [interest],
        minStars,
        maxStars,
        pushedWithinDays: ACTIVE_WITHIN_DAYS,
      },
      rationale: `Tagged ${interest}, which your profile says you work with`,
    });
  }

  return plan.map(({ lane, spec, rationale }) => ({
    lane,
    query: buildRepoSearchQuery(spec, now),
    rationale,
  }));
}

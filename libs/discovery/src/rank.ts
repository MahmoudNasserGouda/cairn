import { clamp01, type SkillTag } from '@cairn/shared';
import { weightedScore, discoveryWeightsFor, type WeightPreset } from '@cairn/scoring';
import {
  learningValue,
  skillCoverage,
  technologyCoverage,
  type DeveloperSnapshot,
} from '@cairn/matching';
import { STAR_PEAK_LOG } from './bands';
import { withArticle } from './labels';
import type {
  Candidate,
  CandidateFacts,
  DiscoveryResult,
  LaneId,
  Recommendation,
  RankOptions,
  RejectionReason,
} from './model';

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 12;

/**
 * Free-text topics that mark a project as deliberately newcomer-facing. These are
 * *not* technologies, so `toKnownSkills` strips them from `topics` — they survive on
 * `allTopics`, which is the only reason that field is carried through.
 */
const NEWCOMER_TOPICS: readonly string[] = [
  'good-first-issue',
  'good-first-issues',
  'beginner-friendly',
  'beginner',
  'first-timers-only',
  'hacktoberfest',
  'up-for-grabs',
];

/**
 * Merge the results of every planned lane into one candidate list, remembering which
 * lanes found each repository. Pure, so the caller can run the searches however it
 * likes (in parallel, sequentially, or from a cache) and still get a stable merge.
 *
 * Order is the order of first appearance; ranking re-sorts anyway, but a stable input
 * keeps ties deterministic.
 */
export function mergeLaneResults(
  lanes: readonly {
    readonly lane: LaneId;
    readonly results: readonly CandidateFacts[];
  }[],
): Candidate[] {
  const byName = new Map<string, { facts: CandidateFacts; foundBy: LaneId[] }>();
  for (const { lane, results } of lanes) {
    for (const facts of results) {
      const existing = byName.get(facts.fullName);
      if (existing) {
        if (!existing.foundBy.includes(lane)) existing.foundBy.push(lane);
      } else {
        byName.set(facts.fullName, { facts, foundBy: [lane] });
      }
    }
  }
  return [...byName.values()].map(({ facts, foundBy }) => ({ ...facts, foundBy }));
}

/** The stack a contributor would actually need: primary language + known topics. */
export function declaredStack(c: CandidateFacts): SkillTag[] {
  const tags = c.primaryLanguage ? [c.primaryLanguage, ...c.topics] : [...c.topics];
  return [...new Set(tags)];
}

/**
 * Activity from push recency alone. Discovery cannot afford the health engine's
 * per-repository requests (ADR-0027), and a search response carries exactly one
 * temporal signal, so this is it: full marks for the last fortnight, decaying to
 * nothing at a year.
 */
export function pushRecency(pushedAt: string | null, now: number): number {
  if (!pushedAt) return 0;
  const pushed = Date.parse(pushedAt);
  if (Number.isNaN(pushed)) return 0;
  const days = (now - pushed) / DAY_MS;
  if (days <= 14) return 1;
  if (days >= 365) return 0;
  return clamp01(1 - (days - 14) / (365 - 14));
}

/**
 * How approachable a repository's size is for this developer, in [0, 1].
 *
 * A triangular window over log10(stars), peaked where a contributor at that level
 * can expect both a living review process and a reachable maintainer. Deliberately
 * *not* "more stars is better": popularity is the single most misleading signal for
 * someone trying to land a first contribution.
 */
export function starApproachability(stars: number, peakLog: number): number {
  if (stars <= 0) return 0;
  const distance = Math.abs(Math.log10(stars) - peakLog);
  // One decade either side of the peak still scores; beyond 1.5, nothing.
  return clamp01(1 - distance / 1.5);
}

/**
 * Whether this project looks like it welcomes newcomers.
 *
 * The dominant term is provenance: a candidate returned by the `newcomer` lane was
 * matched by GitHub's own `good-first-issues:>=N` qualifier, which is a far stronger
 * claim than anything the repository says about itself — and it costs no extra
 * request, unlike `collectHealthSignals`.
 */
export function newcomerSignal(c: Candidate): number {
  const labelledWork = c.foundBy.includes('newcomer') ? 1 : 0;
  const selfDeclared = c.allTopics.some((t) => NEWCOMER_TOPICS.includes(t)) ? 1 : 0;
  // Open issues include PRs, so this is "there is work in flight", not an issue
  // count. Saturates fast: 20 open items says as much as 200.
  const workAvailable = clamp01(c.openIssues / 20);
  return clamp01(0.6 * labelledWork + 0.25 * selfDeclared + 0.15 * workAvailable);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** Compact star counts: 1200 -> "1.2k". Keeps the reason lines short. */
function formatStars(stars: number): string {
  if (stars < 1000) return String(stars);
  const k = stars / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
}

function daysAgo(pushedAt: string | null, now: number): number | null {
  if (!pushedAt) return null;
  const pushed = Date.parse(pushedAt);
  if (Number.isNaN(pushed)) return null;
  return Math.max(0, Math.floor((now - pushed) / DAY_MS));
}

/**
 * The user-facing "why". Built only from named signals and canonicalised technology
 * tags — never from a repository's description or raw topics, which are untrusted
 * external text (SECURITY.md).
 */
function buildReasons(
  c: Candidate,
  known: readonly SkillTag[],
  newToYou: readonly SkillTag[],
  stack: readonly SkillTag[],
  now: number,
): string[] {
  const reasons: string[] = [];

  if (c.foundBy.includes('newcomer')) {
    reasons.push('Has open issues labelled "good first issue"');
  }
  if (known.length > 0) {
    reasons.push(
      `You already know ${known.join(', ')} — ${known.length} of ${stack.length} ` +
        `${plural(stack.length, 'technology', 'technologies')} here`,
    );
  } else {
    reasons.push(`New stack for you: ${stack.join(', ')}`);
  }

  const days = daysAgo(c.pushedAt, now);
  if (days !== null) {
    reasons.push(
      days === 0 ? 'Pushed to today' : `Last push ${days} ${plural(days, 'day')} ago`,
    );
  }

  // "issues and PRs" because GitHub's `open_issues_count` counts both.
  reasons.push(
    `${formatStars(c.stars)} ${plural(c.stars, 'star')} · ` +
      `${c.openIssues} open ${plural(c.openIssues, 'issue', 'issues')} and PRs`,
  );

  if (newToYou.length > 0 && known.length > 0) {
    reasons.push(`You'd pick up ${newToYou.join(', ')}`);
  }
  if (c.foundBy.includes('interests')) {
    reasons.push('Matches a topic from your profile');
  }
  return reasons;
}

/**
 * Score and order candidate repositories for one developer (ADR-0027).
 *
 * Every input is a field of a search response — nothing here spends an extra API
 * request, which is what makes a discovery run cost four requests instead of four
 * per repository. The trade is real and deliberate: these scores are *coarser* than
 * `repositoryMatch`, which is why the UI sends a chosen repository through the full
 * health + match path rather than reusing this number.
 *
 * Candidates that are archived, forks, or declare no stack at all are dropped before
 * scoring — a repository whose technologies are unknown cannot be honestly compared
 * against a developer's skills, and scoring it as a neutral 1 would float it to the
 * top of the list (the same trap `SkillGap.analysed` exists to avoid).
 */
export function rankRepositories(
  dev: DeveloperSnapshot,
  candidates: readonly Candidate[],
  opts: RankOptions = {},
): DiscoveryResult {
  const now = opts.now ?? Date.now();
  const preset: WeightPreset = opts.preset ?? 'balanced';
  const weights = discoveryWeightsFor(preset);
  const limit = Math.max(opts.limit ?? DEFAULT_LIMIT, 1);
  const devTags = dev.skills.map((s) => s.tag);
  const have = new Set(devTags);
  const peakLog = STAR_PEAK_LOG[dev.experience];

  const rejected: Record<RejectionReason, number> = {
    archived: 0,
    fork: 0,
    'no-declared-stack': 0,
  };

  const scored: Recommendation[] = [];
  for (const c of candidates) {
    if (c.archived) {
      rejected.archived++;
      continue;
    }
    if (c.isFork) {
      rejected.fork++;
      continue;
    }
    const stack = declaredStack(c);
    if (stack.length === 0) {
      rejected['no-declared-stack']++;
      continue;
    }

    const known = stack.filter((t) => have.has(t));
    const newToYou = stack.filter((t) => !have.has(t));

    const score = weightedScore(
      {
        skillFit: {
          value: skillCoverage(dev, stack),
          note: `${known.length}/${stack.length} of the stack, weighted by how well you know it`,
        },
        technologyFit: {
          value: technologyCoverage(devTags, stack),
          note: `knows ${known.length}/${stack.length} of the declared stack`,
        },
        newcomerSignal: {
          value: newcomerSignal(c),
          note: c.foundBy.includes('newcomer')
            ? 'has good-first-issue labelled work'
            : 'no beginner-labelled work found',
        },
        activity: {
          value: pushRecency(c.pushedAt, now),
          note: 'how recently the default branch was pushed',
        },
        approachability: {
          value: starApproachability(c.stars, peakLog),
          note: `${formatStars(c.stars)} stars against the band for ${withArticle(dev.experience)}`,
        },
        learning: {
          value: learningValue(dev, stack),
          note: `${newToYou.length} of ${stack.length} technologies would be new`,
        },
      },
      weights,
    );

    scored.push({
      candidate: c,
      score,
      stack,
      known,
      newToYou,
      reasons: buildReasons(c, known, newToYou, stack, now),
    });
  }

  // Ties broken by name so a run is reproducible rather than insertion-ordered.
  scored.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      a.candidate.fullName.localeCompare(b.candidate.fullName),
  );

  return {
    recommendations: scored.slice(0, limit),
    considered: candidates.length,
    rejected,
    preset,
  };
}

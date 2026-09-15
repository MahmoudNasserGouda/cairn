import { clamp01, roundTo, type SkillTag } from '@cairn/shared';
import { canonicalizeSkill, isKnownSkill } from './taxonomy';
import { SKILL_LEVEL_FLOOR, type IncomingSkill, type ProfileFragment } from './merge';
import type { ProfileLink } from './model';
import { provenance, type Provenance } from './provenance';

/**
 * Stack Exchange into a profile fragment (ADR-0035).
 *
 * Structural view of what `collectAnswerTags` (@cairn/stackexchange) returns, declared
 * locally so this module has no runtime dependency on the client.
 *
 * This is the only source in the product that reports an **external judgement**. The CV,
 * the LinkedIn archive and manual entry are the user's own claims; GitHub and GitLab
 * count their output. A tag score is what other practitioners in that tag made of their
 * answers, which is the closest thing to an audit of a skills list that exists for free.
 */
export interface StackExchangeAnswerTag {
  readonly tag: string;
  readonly answers: number;
  /** Summed score of this person's answers in the tag. Unbounded, long-tailed. */
  readonly score: number;
}

export interface StackExchangeInput {
  readonly userId: number;
  readonly site: string;
  readonly displayName: string | null;
  /** The link CC BY-SA requires beside anything rendered from this source. */
  readonly profileUrl: string | null;
  readonly reputation: number | null;
  readonly tags: readonly StackExchangeAnswerTag[];
}

/**
 * The score at which confidence approaches its ceiling.
 *
 * Chosen rather than derived, and worth saying so. A tag with around a hundred points of
 * peer-assessed answers is someone the community has repeatedly found useful in it;
 * below that the sample is thin enough that the number is mostly noise. It is a judgement
 * about evidence, not a measurement, and it is one number in one place so it can be
 * argued with.
 */
const SOLID_SCORE = 100;
/** Never certainty: a peer score is still a proxy, and proxies do not get 1. */
const MAX_CONFIDENCE = 0.95;
/** Never nothing either: one upvoted answer is weak evidence, not absence of evidence. */
const MIN_CONFIDENCE = 0.2;

/**
 * How much to believe a tag, from the absolute peer score behind it.
 *
 * Logarithmic because the interesting differences are at the bottom: 5 points versus 50
 * separates "asked once" from "relied on", while 5,000 versus 50,000 separates two
 * people who are both unambiguously expert. A linear map spends all its resolution at
 * the top, where none is needed.
 *
 * This is the number that decides whether Stack Exchange outranks a language byte count,
 * since both sit on the measured rung and confidence is the tiebreak there.
 */
function confidenceFromScore(score: number): number {
  if (score <= 0) return MIN_CONFIDENCE;
  const scaled = Math.log10(1 + score) / Math.log10(1 + SOLID_SCORE);
  return roundTo(
    Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, scaled * MAX_CONFIDENCE)),
    2,
  );
}

/**
 * Turn top answer tags into skill claims.
 *
 * **The level is relative to the person's own strongest tag**, not to the site.
 * `answer_score` has no ceiling and an extreme tail — the top C# answerer is at 269,885
 * — so any absolute mapping makes almost everyone a beginner, which is the objection
 * ADR-0035 raised against a linear scale. Ranking within the person's own answers is
 * the same shape GitHub's `bytes / maxBytes` already has, and says the same kind of
 * thing: *this is where this tag sits in your work*.
 *
 * The absolute question — is any of this substantial? — is carried by confidence
 * instead, which is also what the merge uses to break ties inside the measured tier.
 * Splitting the two is what stops one upvoted answer becoming a 1.0 that outranks a
 * decade of pushed code.
 *
 * **No weight is emitted.** A weight is a volume of code that the merge adds across
 * measured sources; an answer score is not that, and summing the two would be arithmetic
 * on different units.
 */
function tagSkills(input: StackExchangeInput, capturedAt: string): IncomingSkill[] {
  const strongest = new Map<SkillTag, StackExchangeAnswerTag>();
  for (const raw of input.tags) {
    const tag = canonicalizeSkill(raw.tag);
    // The long tail of `homework`, `beginner` and site-specific meta tags is not
    // technologies. The taxonomy already refuses them, which is why no extra list lives
    // here — the same rule the LinkedIn archive's skills follow.
    if (!isKnownSkill(tag)) continue;

    // Stack Exchange's tags are not disjoint, and this is not a rare edge: `c#` and
    // `.net` both canonicalise to `c#`, and a strong C# answerer carries a large score
    // on each. One claim per *raw* tag meant the second quietly replaced the first, so
    // the profile reported the smaller number and looked entirely plausible doing it.
    //
    // The strongest wins rather than the sum, because the same answer is usually tagged
    // with both and adding them would count it twice.
    const held = strongest.get(tag);
    if (held === undefined || raw.score > held.score) {
      strongest.set(tag, { ...raw, tag });
    }
  }

  const known = [...strongest.values()];
  const peak = Math.max(1, ...known.map((t) => t.score));

  return known.map((t) => ({
    tag: t.tag,
    level: roundTo(Math.max(SKILL_LEVEL_FLOOR, clamp01(t.score / peak)), 2),
    // Evidence a person can check against their own profile, which is the point of
    // showing it at all.
    note: `${t.answers.toLocaleString('en')} answers scoring ${t.score.toLocaleString('en')}`,
    from: provenance('stackexchange', capturedAt, confidenceFromScore(t.score)),
  }));
}

function links(input: StackExchangeInput, from: Provenance): ProfileLink[] {
  const url =
    input.profileUrl ?? `https://${input.site}.stackexchange.com/users/${input.userId}`;
  return [{ kind: 'stackexchange', url, from }];
}

/**
 * Stack Exchange contributes skill evidence and a link, and nothing else.
 *
 * Deliberately not mapped, each for a reason ADR-0035 gives:
 *
 * - **No reputation anywhere.** Total reputation is one number with no skill attached,
 *   which is the shape Phase 3 spent its time getting away from. Per-tag scores are the
 *   part that says something.
 * - **No contact details and no name.** A display name is a handle, not an identity, and
 *   this source is read anonymously from a public profile — it has no business
 *   overwriting what a person entered about themselves.
 * - **Nothing subtracts.** Most developers have no meaningful Stack Exchange presence
 *   and the network's demographics are not this product's audience. A user without an
 *   account is not less proven, so this never lowers a level another source set.
 *
 * The link is emitted even when no tag survives the taxonomy: attribution is a condition
 * of using the API at all, not a label on the skills that happened to map.
 */
export function stackexchangeToFragment(
  input: StackExchangeInput,
  capturedAt: string,
): ProfileFragment {
  return {
    links: links(input, provenance('stackexchange', capturedAt, MAX_CONFIDENCE)),
    skills: tagSkills(input, capturedAt),
  };
}

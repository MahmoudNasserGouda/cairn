/**
 * Where a profile field came from, and which source wins when two disagree
 * (ADR-0031).
 *
 * Provenance is data, not decoration. It drives the merge, it is rendered so a user
 * can see why the profile claims what it claims, and it is what makes "re-import
 * safely" and "edit anything" compatible instead of mutually exclusive.
 */

/**
 * The source vocabulary is defined once, in `libs/shared`, beside the skills taxonomy —
 * it had been hand-written in three places and Phase 8 added three members. Re-exported
 * here because `provenance` is where callers expect to find it, and because this file
 * owns the thing that vocabulary is *for*: the precedence below.
 */
export {
  MEASURED_SOURCES,
  PROFILE_SOURCES,
  REPORTED_SOURCES,
  type ProfileSource,
} from '@cairn/shared';
import type { ProfileSource } from '@cairn/shared';

export interface Provenance {
  readonly source: ProfileSource;
  /** How well the source's own shape supports this value, in [0, 1]. */
  readonly confidence: number;
  /**
   * ISO date the value was captured.
   *
   * Supplied by the caller, never read from a clock — the same rule
   * [ADR-0007](../../../docs/adr/0007-deterministic-explainable-matching-engine.md)
   * imposes on scoring, and for the same reason: a merge that reads the wall clock
   * cannot be snapshot-tested.
   */
  readonly capturedAt: string;
}

/** One source's claim about one field. */
export interface Claim<T> {
  readonly value: T;
  readonly from: Provenance;
}

/**
 * A value that knows where it came from — and what it beat.
 *
 * `also` is not bookkeeping. Without it, "remove my imported CV" would blank a name
 * the CV happened to outrank rather than falling back to the one GitHub still
 * reports, because the losing claim had already been thrown away. Skills solved this
 * with `evidence`; this is the same idea for a single-valued field, and it is what
 * makes `forgetSource` total rather than lossy.
 */
export interface Sourced<T> extends Claim<T> {
  readonly also?: readonly Claim<T>[];
}

/**
 * Precedence, as a ladder of **tiers**: manual > linkedin > cv > everything measured.
 *
 * `manual` is absolute because it is the only source that is *stated* rather than
 * *inferred* — everything else is a guess, however good. LinkedIn's archive and a CV
 * are both the user's own account of their career, but the archive is structured data
 * and the CV is parsed prose, so the archive is trusted first on the fields both carry.
 *
 * ## Why the bottom rung is shared
 *
 * It used to hold one source. Phase 8 added three more that observe rather than ask
 * (ADR-0034, ADR-0035, ADR-0036), and that raised a question the four-source ladder
 * never had to answer: **what happens when two sources both measure?** GitHub counts
 * pushed bytes and so does GitLab. Neither has a claim to outrank the other, and
 * inventing an order between them would be a number with no argument behind it.
 *
 * So they share a rung, and `compareProvenance` falls through to **confidence** — which
 * each source sets for itself. That is where "peer-assessed depth is a stronger claim
 * than raw volume" gets said, and it is a claim a source can make about its own data
 * without asserting anything about a different tier.
 *
 * It is also what keeps [ADR-0035](../../../docs/adr/0035-stack-exchange-as-evidence-of-expertise.md)
 * honest. That ADR recorded the Stack-Exchange-versus-CV question as **undecided**, and
 * a shared measured rung does not decide it: a CV still wins, because nothing has
 * established that it should not.
 *
 * Being on the bottom rung does not make a source weak. Each is the *only* source for
 * what it observes — language bytes, contribution history, answer scores — and no other
 * source claims those, so precedence never comes up for them at all.
 */
export const SOURCE_PRECEDENCE: Readonly<Record<ProfileSource, number>> = {
  manual: 3,
  linkedin: 2,
  cv: 1,
  github: 0,
  gitlab: 0,
  stackexchange: 0,
  devto: 0,
};

export function precedenceOf(source: ProfileSource): number {
  return SOURCE_PRECEDENCE[source];
}

export function provenance(
  source: ProfileSource,
  capturedAt: string,
  confidence = 1,
): Provenance {
  return { source, confidence, capturedAt };
}

export function sourced<T>(value: T, from: Provenance): Sourced<T> {
  return { value, from };
}

/**
 * Order two provenances by authority. Positive means `a` wins.
 *
 * Source precedence first, then confidence, then recency. Every tiebreak is a total
 * order on data already in hand, so the result does not depend on argument order or
 * on when the merge ran.
 */
export function compareProvenance(a: Provenance, b: Provenance): number {
  const bySource = precedenceOf(a.source) - precedenceOf(b.source);
  if (bySource !== 0) return bySource;
  const byConfidence = a.confidence - b.confidence;
  if (byConfidence !== 0) return byConfidence;
  return a.capturedAt.localeCompare(b.capturedAt);
}

/**
 * The winner of two claims on the same field, keeping the loser as a fallback.
 *
 * Ties keep `current`, so **re-importing a source cannot reorder a profile**: an
 * import that says exactly what the profile already says is a no-op, which is half of
 * what makes re-import safe to offer.
 */
export function pickSourced<T>(
  current: Sourced<T> | undefined,
  incoming: Sourced<T> | undefined,
): Sourced<T> | undefined {
  if (!incoming) return current;
  if (!current) return incoming;

  const claims = new Map<ProfileSource, Claim<T>>();
  for (const claim of [
    ...(current.also ?? []),
    { value: current.value, from: current.from },
    ...(incoming.also ?? []),
    { value: incoming.value, from: incoming.from },
  ]) {
    const held = claims.get(claim.from.source);
    // A source restating itself replaces its own claim rather than stacking one.
    if (!held || compareProvenance(claim.from, held.from) >= 0) {
      claims.set(claim.from.source, claim);
    }
  }
  return promote([...claims.values()]);
}

/** Rebuild a `Sourced` from a claim list, strongest first. */
function promote<T>(claims: readonly Claim<T>[]): Sourced<T> | undefined {
  if (claims.length === 0) return undefined;
  const ranked = [...claims].sort((a, b) => compareProvenance(b.from, a.from));
  const [winner, ...rest] = ranked as [Claim<T>, ...Claim<T>[]];
  return {
    value: winner.value,
    from: winner.from,
    ...(rest.length > 0 ? { also: rest } : {}),
  };
}

/**
 * Drop one source's claim on a field and promote the strongest survivor.
 *
 * `undefined` means that source was the only one that ever claimed it.
 */
export function demoteSourced<T>(
  value: Sourced<T> | undefined,
  source: ProfileSource,
): Sourced<T> | undefined {
  if (!value) return undefined;
  const claims = [{ value: value.value, from: value.from }, ...(value.also ?? [])];
  return promote(claims.filter((c) => c.from.source !== source));
}

/** True when `incoming` may overwrite what `current` holds. */
export function outranks(incoming: Provenance, current: Provenance): boolean {
  return compareProvenance(incoming, current) > 0;
}

/**
 * True when a source may replace an entry that source itself contributed.
 *
 * Distinct from `outranks`: a second CV import must be able to update the roles the
 * first one produced, which is a *replacement by the same authority* rather than a
 * win over a different one. Without this a re-import would be ignored, and the
 * profile could never be refreshed.
 */
export function isSameSource(incoming: Provenance, current: Provenance): boolean {
  return incoming.source === current.source;
}

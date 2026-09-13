/**
 * Where a profile field came from, and which source wins when two disagree
 * (ADR-0031).
 *
 * Provenance is data, not decoration. It drives the merge, it is rendered so a user
 * can see why the profile claims what it claims, and it is what makes "re-import
 * safely" and "edit anything" compatible instead of mutually exclusive.
 */

export type ProfileSource = 'github' | 'linkedin' | 'cv' | 'manual';

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
 * Precedence, highest first: **manual > linkedin > cv > github**.
 *
 * `manual` is absolute because it is the only source that is *stated* rather than
 * *inferred* — everything else is a guess, however good. LinkedIn's archive and a CV
 * are both the user's own account of their career, but the archive is structured data
 * and the CV is parsed prose, so the archive is trusted first on the fields both
 * carry. GitHub is last **on biography**, because everything it offers there is
 * inference from account age and repository metadata.
 *
 * GitHub being last does not make it weak. It is the *only* source for the things it
 * observes directly — language bytes, contribution history, repositories contributed
 * to — and no other source claims those, so precedence never comes up for them.
 */
export const SOURCE_PRECEDENCE: Readonly<Record<ProfileSource, number>> = {
  manual: 3,
  linkedin: 2,
  cv: 1,
  github: 0,
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

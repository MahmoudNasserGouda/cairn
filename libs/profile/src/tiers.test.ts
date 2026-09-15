import { describe, expect, it } from 'vitest';
import {
  MEASURED_SOURCES,
  PROFILE_SOURCES,
  SOURCE_PRECEDENCE,
  compareProvenance,
  precedenceOf,
  provenance,
  type ProfileSource,
} from './provenance';

const DAY = '2026-09-15';
const at = (source: ProfileSource, confidence = 1) => provenance(source, DAY, confidence);

/**
 * The tier model (ADR-0034, ADR-0035, ADR-0036).
 *
 * Phase 8 added three sources and, with them, a question the four-source ladder never
 * had to answer: what happens when **two sources both measure**? GitHub and GitLab
 * both count bytes; neither has a claim to outrank the other, and inventing an order
 * between them would be a number with no argument behind it.
 *
 * So precedence is now a ladder of **tiers**, and within the measured tier the
 * existing confidence tiebreak does the work.
 */

describe('the ladder', () => {
  it('ranks stated above self-reported above measured', () => {
    expect(precedenceOf('manual')).toBeGreaterThan(precedenceOf('linkedin'));
    expect(precedenceOf('linkedin')).toBeGreaterThan(precedenceOf('cv'));
    expect(precedenceOf('cv')).toBeGreaterThan(precedenceOf('github'));
  });

  /**
   * The point of the tier. GitHub and GitLab both measure pushed bytes; Stack Exchange
   * measures peer-assessed answers. All three observe rather than ask, and ordering
   * them against each other would be asserting something no ADR establishes.
   */
  it('puts every measured source on one rung', () => {
    const ranks = MEASURED_SOURCES.map(precedenceOf);
    expect(new Set(ranks).size).toBe(1);
  });

  it('covers every source, with no source left unranked', () => {
    for (const source of PROFILE_SOURCES) {
      expect(SOURCE_PRECEDENCE[source], source).toBeTypeOf('number');
    }
    expect(Object.keys(SOURCE_PRECEDENCE).sort()).toEqual([...PROFILE_SOURCES].sort());
  });
});

describe('within the measured tier', () => {
  /**
   * ADR-0035 left Stack Exchange's rank against a CV **undecided**, and this keeps
   * that honest: it does not beat a CV, because nothing has established that it should.
   * What it does beat is a byte count, and that is expressed through confidence rather
   * than through a rung of its own.
   */
  it('does not let a measured source outrank a self-reported one', () => {
    expect(compareProvenance(at('stackexchange'), at('cv'))).toBeLessThan(0);
    expect(compareProvenance(at('gitlab'), at('cv'))).toBeLessThan(0);
  });

  it('breaks a measured-versus-measured tie by confidence, not by source', () => {
    // Peer-assessed depth is a stronger claim than volume, and this is where that
    // gets said — in a number each source chooses for itself, not in the ladder.
    const peerAssessed = at('stackexchange', 0.9);
    const byteCount = at('github', 0.5);

    expect(compareProvenance(peerAssessed, byteCount)).toBeGreaterThan(0);
    expect(compareProvenance(byteCount, peerAssessed)).toBeLessThan(0);
  });

  it('leaves two equally-confident measured sources to the capture date', () => {
    const older = provenance('github', '2026-01-01', 0.7);
    const newer = provenance('gitlab', '2026-09-15', 0.7);

    expect(compareProvenance(newer, older)).toBeGreaterThan(0);
  });

  /**
   * Equal source, equal confidence, equal date must compare as equal — `pickSourced`
   * keeps `current` on a tie, and that is what makes re-importing a source a genuine
   * no-op rather than a reshuffle.
   */
  it('compares identical provenance as a tie', () => {
    expect(compareProvenance(at('gitlab'), at('gitlab'))).toBe(0);
  });
});

describe('manual still wins everything', () => {
  it.each(PROFILE_SOURCES.filter((s) => s !== 'manual'))('beats %s', (source) => {
    expect(compareProvenance(at('manual'), at(source, 1))).toBeGreaterThan(0);
  });
});

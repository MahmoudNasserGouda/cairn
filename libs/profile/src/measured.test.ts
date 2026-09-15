import { describe, expect, it } from 'vitest';
import { emptyProfile } from './model';
import { mergeProfile } from './merge';
import { provenance } from './provenance';
import type { IncomingSkill } from './merge';

/**
 * Two measured sources, one language (ADR-0034's open question).
 *
 * The four-source ladder never had to answer this. GitHub and GitLab both measure
 * pushed code, sit on the same rung ([`tiers.test.ts`](tiers.test.ts)), and so tie —
 * and `pickSourced` keeps `current` on a tie, which means **whichever was imported
 * first keeps the level and the other becomes a footnote**. For a developer whose real
 * estate is on GitLab and who happens to connect GitHub first, that reports the wrong
 * number from the smaller account.
 *
 * Summing is not optional either: two sources each claiming "Ruby is 90% of my code"
 * must not add up to 180%.
 *
 * So a measured claim may carry a `weight` — the raw volume behind it, in whatever unit
 * the source counts (GitHub's language bytes; GitLab's share of a repository's size).
 * When two measured sources both weigh a tag, the level is recomputed from the combined
 * weight, and provenance goes to the larger of the two rather than to the earlier.
 */

const DAY = '2026-09-15';
const CTX = { currentYear: 2026 };

const skill = (
  tag: IncomingSkill['tag'],
  level: number,
  source: 'github' | 'gitlab' | 'cv' | 'manual',
  weight?: number,
): IncomingSkill => ({
  tag,
  level,
  from: provenance(source, DAY, 1),
  ...(weight !== undefined ? { weight } : {}),
});

const merge = (...fragments: { skills: IncomingSkill[] }[]) =>
  fragments.reduce((profile, f) => mergeProfile(profile, f, CTX), emptyProfile());

const levelOf = (profile: ReturnType<typeof merge>, tag: IncomingSkill['tag']) =>
  profile.skills.find((s) => s.tag === tag);

describe('two measured sources claiming the same language', () => {
  it('adds their volume instead of picking one', () => {
    // A small GitHub account and a large GitLab one, both mostly Ruby. Ruby is the
    // user's dominant language across the two, and that is what should be reported.
    const profile = merge(
      { skills: [skill('ruby', 1, 'github', 10_000), skill('go', 0.5, 'github', 5_000)] },
      { skills: [skill('ruby', 1, 'gitlab', 90_000)] },
    );

    expect(levelOf(profile, 'ruby')?.level).toBe(1);
    // Go is 5k against Ruby's combined 100k — a tenth, not the half it looked like
    // when GitHub was the only source being measured.
    expect(levelOf(profile, 'go')?.level).toBeCloseTo(0.3, 2); // the floor
  });

  it('never exceeds 1, however much is added', () => {
    const profile = merge(
      { skills: [skill('ruby', 1, 'github', 500_000)] },
      { skills: [skill('ruby', 1, 'gitlab', 500_000)] },
    );
    expect(levelOf(profile, 'ruby')?.level).toBeLessThanOrEqual(1);
  });

  it('gives provenance to the larger account, not the earlier import', () => {
    const githubFirst = merge(
      { skills: [skill('ruby', 1, 'github', 10_000)] },
      { skills: [skill('ruby', 1, 'gitlab', 90_000)] },
    );
    const gitlabFirst = merge(
      { skills: [skill('ruby', 1, 'gitlab', 90_000)] },
      { skills: [skill('ruby', 1, 'github', 10_000)] },
    );

    expect(levelOf(githubFirst, 'ruby')?.from.source).toBe('gitlab');
    // Import order must not change the answer. Today it does, which is the bug.
    expect(levelOf(gitlabFirst, 'ruby')?.from.source).toBe('gitlab');
    expect(levelOf(gitlabFirst, 'ruby')?.level).toBe(levelOf(githubFirst, 'ruby')?.level);
  });

  it('keeps each source-s own claim as evidence a person can check', () => {
    const profile = merge(
      { skills: [skill('ruby', 0.4, 'github', 10_000)] },
      { skills: [skill('ruby', 0.9, 'gitlab', 90_000)] },
    );
    const ruby = levelOf(profile, 'ruby');

    expect(ruby?.evidence.map((e) => e.source).sort()).toEqual(['github', 'gitlab']);
    // The per-source numbers are untouched: each remains that account's own share.
    expect(ruby?.evidence.find((e) => e.source === 'github')?.level).toBe(0.4);
    expect(ruby?.evidence.find((e) => e.source === 'gitlab')?.level).toBe(0.9);
  });
});

describe('what combining must not disturb', () => {
  /**
   * With one measured source the recomputation has to be a no-op, or connecting GitLab
   * and then disconnecting it would leave different numbers than never connecting it.
   */
  it('changes nothing when only one source measures', () => {
    const profile = merge({
      skills: [skill('ruby', 1, 'github', 10_000), skill('go', 0.5, 'github', 5_000)],
    });
    expect(levelOf(profile, 'ruby')?.level).toBe(1);
    expect(levelOf(profile, 'go')?.level).toBe(0.5);
  });

  it('leaves a stated level alone, however much code disagrees', () => {
    // `manual` outranks every measured source, and combining is a tiebreak *within*
    // the measured tier — not a route around the ladder.
    const profile = merge(
      { skills: [skill('ruby', 0.2, 'manual')] },
      { skills: [skill('ruby', 1, 'github', 90_000)] },
      { skills: [skill('ruby', 1, 'gitlab', 90_000)] },
    );
    expect(levelOf(profile, 'ruby')?.level).toBe(0.2);
    expect(levelOf(profile, 'ruby')?.from.source).toBe('manual');
  });

  it('does not combine a weightless claim, and does not crash on one', () => {
    // A CV says "Ruby" with no volume behind it; there is nothing to add.
    const profile = merge(
      { skills: [skill('ruby', 0.7, 'cv')] },
      { skills: [skill('ruby', 1, 'github', 10_000)] },
    );
    expect(levelOf(profile, 'ruby')?.from.source).toBe('cv');
    expect(levelOf(profile, 'ruby')?.level).toBe(0.7);
  });

  it('is idempotent — re-importing a source does not inflate it', () => {
    const once = merge(
      { skills: [skill('ruby', 1, 'github', 10_000)] },
      { skills: [skill('ruby', 1, 'gitlab', 90_000)] },
    );
    const twice = merge(
      { skills: [skill('ruby', 1, 'github', 10_000)] },
      { skills: [skill('ruby', 1, 'gitlab', 90_000)] },
      { skills: [skill('ruby', 1, 'gitlab', 90_000)] },
    );
    expect(twice.skills).toEqual(once.skills);
  });
});

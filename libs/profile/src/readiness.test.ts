import { emptyProfile, mergeProfile, type UnifiedProfile } from './model';
import {
  contributionReadiness,
  profileCompleteness,
  type ReadinessInput,
} from './readiness';

/** Fixed years only — `estimateYears` reads the clock for `endYear: 'present'`. */
function profile(over: Partial<UnifiedProfile> = {}): UnifiedProfile {
  return mergeProfile(emptyProfile(), {
    identities: [{ provider: 'github', displayName: 'Dev' }],
    skills: [
      { tag: 'typescript', level: 0.9, source: 'github' },
      { tag: 'javascript', level: 0.7, source: 'github' },
      { tag: 'git', level: 0.5, source: 'cv' },
      { tag: 'css', level: 0.4, source: 'github' },
    ],
    interests: ['web'],
    experience: [
      { title: 'Junior developer', startYear: 2022, endYear: 2024, source: 'cv' },
    ],
    ...over,
  });
}

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return { profile: profile(), priorContributions: 4, hasCv: true, ...over };
}

const maxed: ReadinessInput = {
  profile: mergeProfile(emptyProfile(), {
    identities: [{ provider: 'github', displayName: 'Dev' }],
    skills: Array.from({ length: 8 }, (_, i) => ({
      tag: `skill-${i}`,
      level: 1,
      source: 'github' as const,
    })),
    interests: ['web'],
    experience: [
      { title: 'Staff engineer', startYear: 2008, endYear: 2024, source: 'cv' },
    ],
  }),
  priorContributions: 12,
  hasCv: true,
};

describe('profileCompleteness', () => {
  it('partitions the four sources into have and missing', () => {
    const c = profileCompleteness(input({ hasCv: false }));
    expect(c.have).toEqual(['GitHub connected', 'Interests set', 'Experience listed']);
    expect(c.missing).toEqual(['CV imported']);
    expect(c.value).toBe(0.75);
  });

  it('scores 1 when every source is present and 0 for an empty profile', () => {
    expect(profileCompleteness(input()).value).toBe(1);
    const bare = profileCompleteness({
      profile: emptyProfile(),
      priorContributions: 0,
      hasCv: false,
    });
    expect(bare.value).toBe(0);
    expect(bare.have).toEqual([]);
    expect(bare.missing).toHaveLength(4);
  });
});

describe('contributionReadiness', () => {
  it('is deterministic', () => {
    expect(contributionReadiness(input())).toEqual(contributionReadiness(input()));
  });

  it('scores an empty profile at zero and bands it Low', () => {
    const r = contributionReadiness({
      profile: emptyProfile(),
      priorContributions: 0,
      hasCv: false,
    });
    expect(r.score.percent).toBe(0);
    expect(r.band).toBe('Low');
    expect(r.completeness.value).toBe(0);
  });

  it('bands a complete, experienced profile High', () => {
    const r = contributionReadiness(maxed);
    expect(r.score.percent).toBe(100);
    expect(r.band).toBe('High');
  });

  it('never drops when a merged PR is added', () => {
    const before = contributionReadiness(input({ priorContributions: 4 }));
    const after = contributionReadiness(input({ priorContributions: 5 }));
    expect(after.score.total).toBeGreaterThanOrEqual(before.score.total);
  });

  it('never drops when a skill is added', () => {
    const before = contributionReadiness(input());
    const after = contributionReadiness(
      input({
        profile: profile({
          skills: [
            { tag: 'typescript', level: 0.9, source: 'github' },
            { tag: 'javascript', level: 0.7, source: 'github' },
            { tag: 'git', level: 0.5, source: 'cv' },
            { tag: 'css', level: 0.4, source: 'github' },
            { tag: 'python', level: 0.4, source: 'cv' },
          ],
        }),
      }),
    );
    expect(after.score.total).toBeGreaterThanOrEqual(before.score.total);
  });

  it('carries a readable note on every part', () => {
    const r = contributionReadiness(input());
    expect(r.score.parts.map((p) => p.key)).toEqual([
      'skillDepth',
      'skillBreadth',
      'experience',
      'track',
      'completeness',
    ]);
    for (const p of r.score.parts) expect(p.note).toBeTruthy();
    const depth = r.score.parts.find((p) => p.key === 'skillDepth');
    expect(depth?.note).toBe('2 skills above 60%');
  });

  it('ranks next steps by the points each would recover, capped at three', () => {
    const r = contributionReadiness(input());
    expect(r.nextSteps.length).toBeLessThanOrEqual(3);
    const impacts = r.nextSteps.map((s) => s.impact);
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts);
    expect(r.nextSteps.every((s) => s.impact > 0)).toBe(true);
    expect(r.nextSteps[0]?.key).toBe('track');
  });

  it('never suggests experience, which is not something a user can go and do', () => {
    const bare = contributionReadiness({
      profile: emptyProfile(),
      priorContributions: 0,
      hasCv: false,
    });
    expect(bare.nextSteps.map((s) => s.key)).not.toContain('experience');
    expect(bare.nextSteps.map((s) => s.key)).toEqual([
      'skillDepth',
      'skillBreadth',
      'track',
    ]);
  });

  it('offers no next steps once nothing is left to gain', () => {
    expect(contributionReadiness(maxed).nextSteps).toEqual([]);
  });

  it('locks the score for a representative profile', () => {
    // change only deliberately
    expect(contributionReadiness(input()).score.percent).toMatchInlineSnapshot(`57`);
  });
});

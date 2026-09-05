import { repositoryMatch, issueMatch, contributionConfidence, skillGap } from './match';
import { jaccard, experienceFit, skillCoverage, technologyCoverage } from './primitives';
import { juniorDev, angularRepo, goodFirstIssue } from './__fixtures__/snapshots';

describe('primitives', () => {
  it('jaccard is symmetric and bounded', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(jaccard([], [])).toBe(0);
    expect(jaccard(['a'], ['a'])).toBe(1);
  });

  it('experienceFit rewards being at or just above the required level', () => {
    expect(experienceFit('intermediate', 'intermediate')).toBe(1);
    expect(experienceFit('advanced', 'intermediate')).toBe(0.9);
    expect(experienceFit('beginner', 'advanced')).toBe(0.25);
  });

  it('skillCoverage is proficiency-weighted', () => {
    expect(skillCoverage(juniorDev, ['typescript', 'html'])).toBeCloseTo((0.4 + 0.7) / 2);
    expect(skillCoverage(juniorDev, [])).toBe(1);
  });

  it('technologyCoverage is directional — no penalty for extra skills', () => {
    // dev knows a superset of the stack -> full coverage
    expect(technologyCoverage(['ts', 'js', 'go', 'rust'], ['ts', 'js'])).toBe(1);
    // half the stack known
    expect(technologyCoverage(['ts'], ['ts', 'rxjs'])).toBe(0.5);
    expect(technologyCoverage(['ts'], [])).toBe(0);
  });
});

describe('repositoryMatch', () => {
  it('is deterministic across runs', () => {
    const a = repositoryMatch(juniorDev, angularRepo);
    const b = repositoryMatch(juniorDev, angularRepo);
    expect(a).toEqual(b);
  });

  it('returns an explainable breakdown that sums to the total', () => {
    const m = repositoryMatch(juniorDev, angularRepo);
    const sum = m.parts.reduce((s, p) => s + p.contribution, 0);
    expect(Math.round(sum * 100)).toBe(m.percent);
    expect(m.parts.map((p) => p.key)).toEqual([
      'skill',
      'technology',
      'experience',
      'activity',
      'learning',
    ]);
  });

  it('honours weight presets', () => {
    const balanced = repositoryMatch(juniorDev, angularRepo, { preset: 'balanced' });
    const learning = repositoryMatch(juniorDev, angularRepo, { preset: 'learning' });
    expect(learning.percent).not.toBe(balanced.percent);
  });

  it('locks the fixture score (snapshot — change only deliberately)', () => {
    expect(repositoryMatch(juniorDev, angularRepo).percent).toMatchInlineSnapshot(`53`);
  });
});

describe('issueMatch / contributionConfidence', () => {
  it('a scoped good-first-issue with mentorship scores well for a newcomer', () => {
    const repoScore = repositoryMatch(juniorDev, angularRepo).total;
    const im = issueMatch(juniorDev, goodFirstIssue, repoScore);
    expect(im.percent).toBeGreaterThan(55);
  });

  it('confidence drops for a hard issue', () => {
    const easy = contributionConfidence(juniorDev, angularRepo, goodFirstIssue);
    const hard = contributionConfidence(juniorDev, angularRepo, {
      ...goodFirstIssue,
      difficulty: 'expert',
      requiredSkills: ['rust', 'compilers'],
    });
    expect(hard.percent).toBeLessThan(easy.percent);
  });
});

describe('skillGap', () => {
  it('splits have / missing and orders foundations first', () => {
    const gap = skillGap(juniorDev, ['git', 'typescript', 'rxjs', 'docker']);
    expect(gap.have).toEqual(['git', 'typescript']);
    expect([...gap.missing].sort()).toEqual(['docker', 'rxjs']);
    expect(gap.coverage).toBe(0.5);
  });
});

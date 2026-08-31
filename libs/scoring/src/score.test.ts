import { weightedScore, explain } from './score';
import { REPOSITORY_MATCH_WEIGHTS, label, repositoryWeightsFor } from './weights';

describe('weightedScore', () => {
  it('is deterministic and matches the ADR-0007 worked example', () => {
    const b = weightedScore(
      { skill: 1, technology: 1, experience: 1, activity: 0.4, learning: 0.6 },
      REPOSITORY_MATCH_WEIGHTS,
    );
    // 0.40 + 0.25 + 0.15 + 0.04 + 0.06 = 0.90
    expect(b.percent).toBe(90);
    expect(b.weightsVersion).toBe(1);
  });

  it('normalises weights that do not sum to 1', () => {
    const b = weightedScore({ a: 1, b: 1 }, { a: 2, b: 2 });
    expect(b.total).toBe(1);
  });

  it('clamps out-of-range sub-scores', () => {
    const b = weightedScore({ a: 5, b: -3 }, { a: 0.5, b: 0.5 });
    expect(b.total).toBe(0.5);
  });

  it('carries notes through for the explanation UI', () => {
    const b = weightedScore(
      { a: { value: 0.5, note: 'partial skill overlap' }, b: 1 },
      { a: 0.5, b: 0.5 },
    );
    expect(b.parts.find((p) => p.key === 'a')?.note).toBe('partial skill overlap');
  });

  it('produces a stable text explanation', () => {
    const b = weightedScore(
      { skill: 0.8, technology: 0.6 },
      { skill: 0.6, technology: 0.4 },
    );
    expect(explain(b, 'Repository Match')).toMatchInlineSnapshot(`
      "Repository Match: 72%
        skill               80%  (w 60%)
        technology          60%  (w 40%)"
    `);
  });
});

describe('label / presets', () => {
  it('buckets scores', () => {
    expect(label(0.9)).toBe('High');
    expect(label(0.5)).toBe('Medium');
    expect(label(0.2)).toBe('Low');
  });
  it('exposes weight presets', () => {
    expect(repositoryWeightsFor('quick-win').learning).toBe(0);
    expect(repositoryWeightsFor('learning').learning).toBeGreaterThan(0.3);
  });
});

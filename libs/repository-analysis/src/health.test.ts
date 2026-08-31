import { healthScore, newcomerFriendliness, type HealthSignals } from './health';
import { readingOrder, describeDir } from './architecture';

const healthy: HealthSignals = {
  commitsLast30d: 45,
  daysSinceLastCommit: 1,
  activeMaintainersLast90d: 4,
  medianIssueResponseHours: 8,
  issueCloseRatioLast90d: 0.8,
  medianPrReviewHours: 12,
  mergedPrRatioLast90d: 0.75,
  contributorCount: 40,
  busFactor: 4,
  hasReadme: true,
  hasContributing: true,
  hasCodeOfConduct: true,
  hasDocsFolder: true,
  openGoodFirstIssues: 12,
};

const abandoned: HealthSignals = {
  commitsLast30d: 0,
  daysSinceLastCommit: 400,
  activeMaintainersLast90d: 0,
  medianIssueResponseHours: 24 * 30,
  issueCloseRatioLast90d: 0.05,
  medianPrReviewHours: 24 * 60,
  mergedPrRatioLast90d: 0.1,
  contributorCount: 2,
  busFactor: 1,
  hasReadme: true,
  hasContributing: false,
  hasCodeOfConduct: false,
  hasDocsFolder: false,
  openGoodFirstIssues: 0,
};

describe('healthScore', () => {
  it('is deterministic', () => {
    expect(healthScore(healthy)).toEqual(healthScore(healthy));
  });

  it('rates a well-maintained repo High and an abandoned one Low', () => {
    const h = healthScore(healthy);
    expect(h.headline).toBeGreaterThanOrEqual(75);
    expect(h.maintenance).toBe('High');
    expect(h.documentation).toBe('High');

    const a = healthScore(abandoned);
    expect(a.headline).toBeLessThan(35);
    expect(a.maintenance).toBe('Low');
  });

  it('exposes an explainable breakdown', () => {
    const h = healthScore(healthy);
    expect(h.score.parts.map((p) => p.key)).toContain('issueResponsiveness');
    const sum = h.score.parts.reduce((s, p) => s + p.contribution, 0);
    expect(Math.round(sum * 100)).toBe(h.score.percent);
  });

  it('newcomerFriendliness rewards good-first-issues + CONTRIBUTING', () => {
    expect(newcomerFriendliness(healthy)).toBeGreaterThan(
      newcomerFriendliness(abandoned),
    );
  });
});

describe('architecture helpers', () => {
  it('orders docs and entry points before tests and build output', () => {
    const order = readingOrder([
      'src/app.ts',
      'README.md',
      'src/util.test.ts',
      'dist/app.min.js',
      'package.json',
    ]);
    expect(order[0]).toBe('README.md');
    expect(order.at(-1)).toBe('dist/app.min.js');
  });
  it('describes known directories', () => {
    expect(describeDir('.github')).toMatch(/CI\/CD/);
    expect(describeDir('mystery')).toBe('Project directory');
  });
});

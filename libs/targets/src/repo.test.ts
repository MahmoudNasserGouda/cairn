import { healthScore, type HealthSignals } from '@cairn/repository-analysis';
import { repoToSnapshot, inferRequiredExperience } from './repo';

const HEALTHY: HealthSignals = {
  commitsLast30d: 40,
  daysSinceLastCommit: 3,
  activeMaintainersLast90d: 4,
  medianIssueResponseHours: 12,
  issueCloseRatioLast90d: 0.8,
  medianPrReviewHours: 24,
  mergedPrRatioLast90d: 0.7,
  contributorCount: 40,
  busFactor: 4,
  hasReadme: true,
  hasContributing: true,
  hasCodeOfConduct: true,
  hasDocsFolder: true,
  openGoodFirstIssues: 8,
};

const NEGLECTED: HealthSignals = {
  commitsLast30d: 0,
  daysSinceLastCommit: 300,
  activeMaintainersLast90d: 1,
  medianIssueResponseHours: 24 * 20,
  issueCloseRatioLast90d: 0.1,
  medianPrReviewHours: 24 * 30,
  mergedPrRatioLast90d: 0.1,
  contributorCount: 2,
  busFactor: 1,
  hasReadme: true,
  hasContributing: false,
  hasCodeOfConduct: false,
  hasDocsFolder: false,
  openGoodFirstIssues: 0,
};

const overview = {
  fullName: 'acme/widgets',
  technologies: ['typescript', 'react'],
  topics: ['web'],
};

describe('repoToSnapshot', () => {
  it('maps overview + health into a RepositorySnapshot in range', () => {
    const snap = repoToSnapshot(overview, HEALTHY, healthScore(HEALTHY));
    expect(snap.fullName).toBe('acme/widgets');
    expect(snap.technologies).toEqual(['typescript', 'react']);
    expect(snap.topics).toEqual(['web']);
    for (const n of [snap.activity, snap.health, snap.newcomerFriendliness]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const a = repoToSnapshot(overview, HEALTHY, healthScore(HEALTHY));
    const b = repoToSnapshot(overview, HEALTHY, healthScore(HEALTHY));
    expect(a).toEqual(b);
  });

  it('locks a representative snapshot', () => {
    expect(repoToSnapshot(overview, HEALTHY, healthScore(HEALTHY)))
      .toMatchInlineSnapshot(`
      {
        "activity": 0.7867,
        "fullName": "acme/widgets",
        "health": 0.8794,
        "newcomerFriendliness": 0.7470738522954092,
        "requiredExperience": "beginner",
        "technologies": [
          "typescript",
          "react",
        ],
        "topics": [
          "web",
        ],
      }
    `);
  });
});

describe('inferRequiredExperience', () => {
  it('is beginner for a well-documented repo with good first issues', () => {
    expect(inferRequiredExperience(HEALTHY, healthScore(HEALTHY))).toBe('beginner');
  });

  it('is advanced for a low-bus-factor / thin-docs repo', () => {
    expect(inferRequiredExperience(NEGLECTED, healthScore(NEGLECTED))).toBe('advanced');
  });

  it('is intermediate in between', () => {
    const midSignals: HealthSignals = { ...HEALTHY, openGoodFirstIssues: 0 };
    expect(inferRequiredExperience(midSignals, healthScore(midSignals))).toBe(
      'intermediate',
    );
  });

  it('never returns expert', () => {
    for (const s of [HEALTHY, NEGLECTED]) {
      expect(inferRequiredExperience(s, healthScore(s))).not.toBe('expert');
    }
  });
});

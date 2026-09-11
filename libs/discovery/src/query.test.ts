import type { DeveloperSnapshot } from '@cairn/matching';
import { buildRepoSearchQuery, planQueries } from './query';
import { STAR_WINDOW } from './bands';

/** 2026-09-11T00:00:00Z — every date assertion below is relative to this. */
const NOW = Date.parse('2026-09-11T00:00:00Z');

function dev(overrides: Partial<DeveloperSnapshot> = {}): DeveloperSnapshot {
  return {
    skills: [
      { tag: 'typescript', level: 0.9, source: 'github' },
      { tag: 'python', level: 0.5, source: 'github' },
      { tag: 'angular', level: 0.7, source: 'cv' },
    ],
    experience: 'intermediate',
    interests: [],
    priorContributions: 2,
    ...overrides,
  };
}

describe('buildRepoSearchQuery', () => {
  it('excludes archived repos and forks unless told otherwise', () => {
    expect(buildRepoSearchQuery({}, NOW)).toBe('archived:false fork:false');
    expect(
      buildRepoSearchQuery({ excludeArchived: false, excludeForks: false }, NOW),
    ).toBe('');
  });

  it('quotes a language GitHub cannot read bare', () => {
    // `language:c#` truncates at the `#`; `language:"c#"` does not.
    expect(buildRepoSearchQuery({ language: 'c#' }, NOW)).toContain('language:"c#"');
    expect(buildRepoSearchQuery({ language: 'c++' }, NOW)).toContain('language:"c++"');
    expect(buildRepoSearchQuery({ language: 'typescript' }, NOW)).toContain(
      'language:typescript',
    );
  });

  it('translates tags GitHub names differently', () => {
    // Our taxonomy says `bash`; linguist says `Shell`, and `language:bash` finds
    // nothing at all rather than erroring.
    expect(buildRepoSearchQuery({ language: 'bash' }, NOW)).toContain('language:shell');
    expect(buildRepoSearchQuery({ topics: ['node'] }, NOW)).toContain('topic:nodejs');
    expect(buildRepoSearchQuery({ topics: ['c#'] }, NOW)).toContain('topic:csharp');
  });

  it('renders a star window as a range and a bare bound as a comparison', () => {
    expect(buildRepoSearchQuery({ minStars: 100, maxStars: 5000 }, NOW)).toContain(
      'stars:100..5000',
    );
    expect(buildRepoSearchQuery({ minStars: 100 }, NOW)).toContain('stars:>=100');
    expect(buildRepoSearchQuery({ maxStars: 5000 }, NOW)).toContain('stars:<=5000');
  });

  it('turns a relative push window into an absolute date', () => {
    expect(buildRepoSearchQuery({ pushedWithinDays: 90 }, NOW)).toContain(
      'pushed:>=2026-06-13',
    );
  });

  it('emits the good-first-issues qualifier only when asked', () => {
    expect(buildRepoSearchQuery({ minGoodFirstIssues: 3 }, NOW)).toContain(
      'good-first-issues:>=3',
    );
    expect(buildRepoSearchQuery({}, NOW)).not.toContain('good-first-issues');
  });
});

describe('planQueries', () => {
  it('stays inside the four-request budget', () => {
    // The Search API allows 10 requests a minute unauthenticated; a run that used
    // one per skill would exhaust it on the first click.
    const plan = planQueries(dev(), { now: NOW });
    expect(plan.length).toBeLessThanOrEqual(4);
  });

  it('plans nothing when the profile names no programming language', () => {
    // `angular` and `docker` are skills but not languages: there is no honest
    // `language:` search to run, and guessing one would be worse than saying so.
    const plan = planQueries(
      dev({
        skills: [
          { tag: 'angular', level: 0.8, source: 'cv' },
          { tag: 'docker', level: 0.6, source: 'cv' },
        ],
      }),
      { now: NOW },
    );
    expect(plan).toEqual([]);
  });

  it('leads with the strongest language, not the first one listed', () => {
    const plan = planQueries(dev(), { now: NOW });
    expect(plan[0]?.lane).toBe('core-skill');
    expect(plan[0]?.query).toContain('language:typescript');
  });

  it('always includes a good-first-issue lane for the primary language', () => {
    const newcomer = planQueries(dev(), { now: NOW }).find((q) => q.lane === 'newcomer');
    expect(newcomer?.query).toContain('good-first-issues:>=3');
    expect(newcomer?.query).toContain('language:typescript');
  });

  it('drops the newcomer star floor below the experience window', () => {
    // An advanced developer's floor is 500 stars, but a small repo that labels
    // beginner work still deserves a look.
    const plan = planQueries(dev({ experience: 'advanced' }), { now: NOW });
    expect(plan.find((q) => q.lane === 'core-skill')?.query).toContain('stars:500..');
    expect(plan.find((q) => q.lane === 'newcomer')?.query).toContain('stars:50..');
  });

  it('sizes the star window by experience', () => {
    for (const level of ['beginner', 'intermediate', 'advanced', 'expert'] as const) {
      const [min, max] = STAR_WINDOW[level];
      const core = planQueries(dev({ experience: level }), { now: NOW })[0];
      expect(core?.query).toContain(`stars:${min}..${max}`);
    }
  });

  it('adds a second-language lane only when there is a second language', () => {
    expect(planQueries(dev(), { now: NOW }).map((q) => q.lane)).toContain(
      'secondary-skill',
    );
    const oneLanguage = planQueries(
      dev({ skills: [{ tag: 'typescript', level: 0.9, source: 'github' }] }),
      { now: NOW },
    );
    expect(oneLanguage.map((q) => q.lane)).not.toContain('secondary-skill');
  });

  it('searches interests as topics, never as languages', () => {
    const plan = planQueries(dev({ interests: ['react', 'python'] }), { now: NOW });
    const interests = plan.find((q) => q.lane === 'interests');
    // `python` is a language and is skipped here — `language:python` already covers
    // it far better than `topic:python` would.
    expect(interests?.query).toContain('topic:react');
    expect(interests?.query).not.toContain('topic:python');
  });

  it('falls back to a non-language skill when no interests are declared', () => {
    const interests = planQueries(dev(), { now: NOW }).find(
      (q) => q.lane === 'interests',
    );
    expect(interests?.query).toContain('topic:angular');
  });

  it('gives every lane a rationale the UI can show', () => {
    for (const q of planQueries(dev(), { now: NOW })) {
      expect(q.rationale.length).toBeGreaterThan(0);
    }
  });
});

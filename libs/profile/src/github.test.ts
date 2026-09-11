import { githubToProfile, type GithubActivityInput } from './github';

function activity(over: Partial<GithubActivityInput> = {}): GithubActivityInput {
  return {
    user: { login: 'octocat', name: 'The Octocat', createdAt: '2015-01-01T00:00:00Z' },
    repos: [
      { topics: ['web', 'hooks'], languages: { TypeScript: 9000, CSS: 1000 } },
      { topics: ['cli'], languages: { TypeScript: 1000, Python: 3000 } },
    ],
    mergedPrCount: 7,
    ...over,
  };
}

describe('githubToProfile', () => {
  it('maps language bytes to canonical skills with levels in [0,1]', () => {
    const p = githubToProfile(activity());
    const ts = p.skills.find((s) => s.tag === 'typescript');
    const py = p.skills.find((s) => s.tag === 'python');
    expect(ts?.level).toBe(1); // most bytes -> top
    expect(py).toBeDefined();
    for (const s of p.skills) {
      expect(s.level).toBeGreaterThanOrEqual(0);
      expect(s.level).toBeLessThanOrEqual(1);
      expect(s.source).toBe('github');
    }
    // less-used language still clears the floor
    expect(py!.level).toBeGreaterThanOrEqual(0.3);
  });

  it('higher byte share never scores below a lower one', () => {
    const p = githubToProfile(activity());
    const ts = p.skills.find((s) => s.tag === 'typescript')!.level;
    const css = p.skills.find((s) => s.tag === 'css')!.level;
    expect(ts).toBeGreaterThanOrEqual(css);
  });

  it('derives interests from topics and an identity from the user', () => {
    const p = githubToProfile(activity());
    expect(p.interests).toEqual(['cli', 'hooks', 'web']);
    expect(p.identities).toEqual([{ provider: 'github', displayName: 'The Octocat' }]);
  });

  it('turns account age into a non-beginner experience level', () => {
    const p = githubToProfile(activity());
    expect(p.experienceLevel).not.toBe('beginner');
    expect(p.totalYears).toBeGreaterThan(1.5);
  });

  it('falls back to login when the user has no name', () => {
    const p = githubToProfile(
      activity({
        user: { login: 'ghost', name: null, createdAt: '2020-01-01T00:00:00Z' },
      }),
    );
    expect(p.identities[0]?.displayName).toBe('ghost');
  });

  it('is deterministic', () => {
    expect(githubToProfile(activity())).toEqual(githubToProfile(activity()));
  });
});

describe('experience from GitHub activity', () => {
  it('ends the span at the last visible push, not today', () => {
    // An account opened in 2015 and last pushed in 2018 is 3 years of visible work,
    // not the ~11 that counting to `present` used to produce.
    const p = githubToProfile(
      activity({
        user: { login: 'o', name: null, createdAt: '2015-01-01T00:00:00Z' },
        repos: [
          { topics: [], languages: { Go: 100 }, pushedAt: '2017-06-01T00:00:00Z' },
          { topics: [], languages: { Go: 100 }, pushedAt: '2018-06-01T00:00:00Z' },
        ],
      }),
    );
    expect(p.experience[0]?.startYear).toBe(2015);
    expect(p.experience[0]?.endYear).toBe(2018);
    expect(p.totalYears).toBe(3);
  });

  it('claims no experience at all for an account with no repos', () => {
    const p = githubToProfile(
      activity({
        user: { login: 'o', name: null, createdAt: '2010-01-01T00:00:00Z' },
        repos: [],
      }),
    );
    expect(p.experience).toEqual([]);
    expect(p.totalYears).toBe(0);
    expect(p.experienceLevel).toBe('beginner');
  });

  it('does not let a dormant old account read as advanced', () => {
    const p = githubToProfile(
      activity({
        user: { login: 'o', name: null, createdAt: '2012-01-01T00:00:00Z' },
        repos: [{ topics: [], languages: { Go: 10 }, pushedAt: '2012-03-01T00:00:00Z' }],
      }),
    );
    expect(p.totalYears).toBe(0);
    expect(p.experienceLevel).toBe('beginner');
  });

  it('never produces a negative span when a push predates the account year', () => {
    const p = githubToProfile(
      activity({
        user: { login: 'o', name: null, createdAt: '2020-01-01T00:00:00Z' },
        repos: [{ topics: [], languages: { Go: 10 }, pushedAt: '2019-01-01T00:00:00Z' }],
      }),
    );
    expect(p.totalYears).toBeGreaterThanOrEqual(0);
  });
});

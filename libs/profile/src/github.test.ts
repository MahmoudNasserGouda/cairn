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

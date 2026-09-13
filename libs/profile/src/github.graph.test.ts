/**
 * What the deep GitHub read contributes to the profile (ADR-0030, ADR-0031).
 *
 * The interesting cases are the ones where GitHub knows something and we decline to
 * claim it — an organisation membership is not a job, and a bio is not a CV summary.
 */
import { describe, expect, it } from 'vitest';
import { githubToFragment, type GithubProfileInput } from './github';
import { mergeProfile } from './merge';
import { emptyProfile } from './model';

const DAY = '2026-09-13';
const ctx = { currentYear: 2026 };

function graph(over: Partial<GithubProfileInput> = {}): GithubProfileInput {
  return {
    login: 'octocat',
    name: 'The Octocat',
    bio: 'Backend engineer, mostly Go',
    company: '@github',
    location: 'Lagos',
    websiteUrl: 'https://octo.dev',
    email: 'octo@example.com',
    createdAt: '2015-01-01T00:00:00Z',
    socialAccounts: [{ provider: 'mastodon', url: 'https://m.example/@octo' }],
    organizations: ['github'],
    mergedPullRequests: 42,
    pinned: [
      {
        nameWithOwner: 'octocat/spoon-knife',
        url: 'https://github.com/octocat/spoon-knife',
        description: 'A demo repo',
        primaryLanguage: 'TypeScript',
        stargazers: 900,
      },
    ],
    contributedTo: [
      {
        nameWithOwner: 'vercel/swr',
        url: 'https://github.com/vercel/swr',
        description: null,
        primaryLanguage: 'TypeScript',
        stargazers: 30000,
      },
    ],
    contributedToCount: 7,
    repos: [
      {
        topics: ['web', 'cli'],
        languages: { TypeScript: 9000, CSS: 1000 },
        pushedAt: '2024-06-01T00:00:00Z',
      },
    ],
    contributions: {
      commits: 300,
      issues: 20,
      pullRequests: 45,
      reviews: 60,
      total: 425,
    },
    ...over,
  };
}

function profile(over: Partial<GithubProfileInput> = {}) {
  return mergeProfile(emptyProfile(), githubToFragment(graph(over), DAY), ctx);
}

describe('what GitHub contributes', () => {
  it('fills the profile header it used to leave blank', () => {
    const p = profile();

    expect(p.contact.name?.value).toBe('The Octocat');
    expect(p.contact.headline?.value).toBe('Backend engineer, mostly Go');
    expect(p.contact.location?.value).toBe('Lagos');
    expect(p.contact.emails.map((e) => e.value)).toEqual(['octo@example.com']);
  });

  it('collects the links the user chose to publish', () => {
    const urls = profile().links.map((l) => l.url);

    expect(urls).toContain('https://github.com/octocat');
    expect(urls).toContain('https://octo.dev');
    expect(urls).toContain('https://m.example/@octo');
  });

  /**
   * Pinned repositories are the one thing on a GitHub profile the user curated by
   * hand — "this is my best work". That is a project, and mapping it to one is a
   * claim GitHub genuinely supports.
   */
  it('turns pinned repositories into projects', () => {
    const projects = profile().projects;

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: 'octocat/spoon-knife',
      description: 'A demo repo',
      url: 'https://github.com/octocat/spoon-knife',
      technologies: ['typescript'],
    });
  });

  it('records the contribution figures, including the exact merged-PR count', () => {
    const c = profile().contributions;

    expect(c?.mergedPullRequests).toBe(42);
    expect(c?.repositoriesContributedTo).toBe(7);
    expect(c?.totalContributions).toBe(425);
    // No Search API in the path any more, so this is never a guess.
    expect(c?.known).toBe(true);
  });

  it('still derives skills from language bytes and interests from topics', () => {
    const p = profile();

    expect(p.skills.map((s) => s.tag)).toEqual(['css', 'typescript']);
    expect(p.skills.find((s) => s.tag === 'typescript')?.level).toBe(1);
    expect(p.interests).toEqual(['cli', 'web']);
  });

  it('explains a skill level in terms the user can check', () => {
    const ts = profile().skills.find((s) => s.tag === 'typescript');
    expect(ts?.evidence[0]?.note).toMatch(/90% of your pushed code/);
  });
});

describe('what GitHub declines to claim', () => {
  /**
   * An organisation membership is not employment. GitHub cannot tell a job from a
   * community, an alumni group or a hackathon team, so turning one into an experience
   * entry would be inventing a role the user never claimed — and it would then
   * outrank nothing and sit there looking authoritative. The data is read and carried
   * for the UI; it does not become a job.
   */
  it('does not turn an organisation membership into a job', () => {
    const titles = profile().experience.map((e) => e.title);
    expect(titles).not.toContain('github');
    expect(titles).toEqual(['Public GitHub activity']);
  });

  /**
   * A GitHub bio is a one-line header, not a professional summary. It fills
   * `headline`; `summary` stays empty until a source that actually carries prose —
   * a CV or the user — provides one.
   */
  it('does not pass a bio off as a CV summary', () => {
    expect(profile().contact.summary).toBeUndefined();
  });

  it('keeps its own claims low-confidence so a real source wins a tie', () => {
    const p = profile();
    expect(p.contact.name?.from.confidence).toBeLessThan(1);
    expect(p.experience[0]?.from.confidence).toBeLessThan(1);
  });

  it('claims no experience at all for an account with no repositories', () => {
    const p = profile({ repos: [] });
    expect(p.experience).toEqual([]);
    expect(p.totalYears).toBe(0);
  });
});

describe('missing fields', () => {
  it('omits what did not arrive instead of emitting empty values', () => {
    const p = profile({
      name: null,
      bio: null,
      location: null,
      email: null,
      websiteUrl: null,
      socialAccounts: [],
      pinned: [],
    });

    expect(p.contact.name?.value).toBe('octocat'); // falls back to the login
    expect(p.contact.headline).toBeUndefined();
    expect(p.contact.location).toBeUndefined();
    expect(p.contact.emails).toEqual([]);
    expect(p.projects).toEqual([]);
    expect(p.links.map((l) => l.url)).toEqual(['https://github.com/octocat']);
  });

  it('is deterministic', () => {
    expect(githubToFragment(graph(), DAY)).toEqual(githubToFragment(graph(), DAY));
  });
});

/**
 * The activity span, in detail. These moved here from `github.test.ts` when the REST
 * fan-out was replaced; the edge cases they pin are older than this phase and none of
 * them are about GraphQL — they are about not overstating what an account proves.
 */
describe('the public-activity span', () => {
  const account = (createdAt: string, pushes: readonly (string | null)[]) =>
    profile({
      login: 'o',
      name: null,
      createdAt,
      repos: pushes.map((pushedAt) => ({
        topics: [],
        languages: { Go: 100 },
        ...(pushedAt !== null ? { pushedAt } : {}),
      })),
    });

  it('ends at the last visible push, not today', () => {
    // An account opened in 2015 and last pushed in 2018 is 3 years of visible work,
    // not the ~11 that counting to `present` used to produce.
    const p = account('2015-01-01T00:00:00Z', [
      '2017-06-01T00:00:00Z',
      '2018-06-01T00:00:00Z',
    ]);

    expect(p.experience[0]?.startYear).toBe(2015);
    expect(p.experience[0]?.endYear).toBe(2018);
    expect(p.totalYears).toBe(3);
  });

  it('does not let a dormant old account read as advanced', () => {
    const p = account('2012-01-01T00:00:00Z', ['2012-03-01T00:00:00Z']);
    expect(p.totalYears).toBe(0);
    expect(p.experienceLevel.value).toBe('beginner');
  });

  it('never produces a negative span when a push predates the account year', () => {
    const p = account('2020-01-01T00:00:00Z', ['2019-01-01T00:00:00Z']);
    expect(p.totalYears).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the captured date when no repository reports a push', () => {
    const p = account('2015-01-01T00:00:00Z', [null]);
    expect(p.experience[0]?.endYear).toBe(2026); // DAY, not a clock read
  });
});

describe('skill levels', () => {
  it('never scores a higher byte share below a lower one', () => {
    const p = profile({
      repos: [{ topics: [], languages: { TypeScript: 9000, CSS: 1000 }, pushedAt: null }],
    });
    const ts = p.skills.find((s) => s.tag === 'typescript')?.level ?? 0;
    const css = p.skills.find((s) => s.tag === 'css')?.level ?? 0;

    expect(ts).toBeGreaterThanOrEqual(css);
    // A used language still clears the floor, so it counts toward a match.
    expect(css).toBeGreaterThanOrEqual(0.3);
  });
});

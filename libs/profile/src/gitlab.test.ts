import { describe, expect, it } from 'vitest';
import { gitlabToFragment, type GitlabProfileInput } from './gitlab';

/**
 * GitLab into a profile fragment (ADR-0034).
 *
 * The interesting part is the weighting. GitHub hands over language **bytes**; GitLab
 * hands over a language's **share of a repository**, which is a percentage and says
 * nothing about size. 80% Ruby is the same number for a weekend script and for a
 * decade of work, so a share alone cannot be added to anything — the repository size is
 * what turns it back into a volume.
 */

const DAY = '2026-09-15';

const input = (over: Partial<GitlabProfileInput> = {}): GitlabProfileInput => ({
  username: 'amara',
  name: 'Amara Okonkwo',
  webUrl: 'https://gitlab.com/amara',
  avatarUrl: null,
  publicEmail: null,
  groups: [],
  projects: [
    {
      fullPath: 'amara/api',
      name: 'api',
      description: 'the api',
      webUrl: 'https://gitlab.com/amara/api',
      visibility: 'private',
      lastActivityAt: '2026-09-01T00:00:00Z',
      topics: [],
      starCount: 0,
      repositorySize: 1_000_000,
      languages: [{ name: 'Ruby', share: 100 }],
    },
  ],
  ...over,
});

const skill = (fragment: ReturnType<typeof gitlabToFragment>, tag: string) =>
  fragment.skills?.find((s) => s.tag === tag);

describe('language weighting', () => {
  it('turns share and size into a byte-equivalent the merge can add', () => {
    const fragment = gitlabToFragment(
      input({
        projects: [
          {
            ...input().projects[0]!,
            repositorySize: 1_000_000,
            languages: [
              { name: 'Ruby', share: 75 },
              { name: 'JavaScript', share: 25 },
            ],
          },
        ],
      }),
      DAY,
    );

    expect(skill(fragment, 'ruby')?.weight).toBe(750_000);
    expect(skill(fragment, 'javascript')?.weight).toBe(250_000);
    expect(skill(fragment, 'ruby')?.level).toBe(1);
  });

  it('adds a language up across projects rather than taking the last one', () => {
    const one = { ...input().projects[0]!, fullPath: 'a', repositorySize: 100_000 };
    const fragment = gitlabToFragment(
      input({
        projects: [
          { ...one, languages: [{ name: 'Ruby', share: 50 }] },
          { ...one, fullPath: 'b', languages: [{ name: 'Ruby', share: 50 }] },
        ],
      }),
      DAY,
    );
    expect(skill(fragment, 'ruby')?.weight).toBe(100_000);
  });

  /**
   * A big project must not be outvoted by a small one. This is the whole reason size is
   * fetched: on shares alone these two would tie at 50% each.
   */
  it('lets a large project outweigh a small one with the opposite mix', () => {
    const fragment = gitlabToFragment(
      input({
        projects: [
          {
            ...input().projects[0]!,
            fullPath: 'monorepo',
            repositorySize: 10_000_000,
            languages: [{ name: 'Ruby', share: 100 }],
          },
          {
            ...input().projects[0]!,
            fullPath: 'toy',
            repositorySize: 10_000,
            languages: [{ name: 'Elixir', share: 100 }],
          },
        ],
      }),
      DAY,
    );
    expect(skill(fragment, 'ruby')?.level).toBe(1);
    expect(skill(fragment, 'elixir')?.level).toBe(0.3); // the floor, not a tie at 1
  });
});

describe('when GitLab will not say how big a project is', () => {
  /**
   * `statistics` needs Reporter access. Without it there is no volume, and inventing
   * one would let a toy project outweigh a monorepo invisibly — so no weight is
   * emitted, the merge declines to combine, and the note stops claiming a percentage
   * it cannot support.
   */
  it('emits no weight and makes no percentage claim', () => {
    const fragment = gitlabToFragment(
      input({
        projects: [
          {
            ...input().projects[0]!,
            repositorySize: null,
            languages: [{ name: 'Ruby', share: 80 }],
          },
        ],
      }),
      DAY,
    );
    const ruby = skill(fragment, 'ruby');
    expect(ruby?.weight).toBeUndefined();
    expect(ruby?.note).not.toMatch(/%/);
    expect(ruby?.level).toBeGreaterThan(0);
  });

  it('still weighs the projects it can see', () => {
    const fragment = gitlabToFragment(
      input({
        projects: [
          {
            ...input().projects[0]!,
            fullPath: 'sized',
            repositorySize: 1_000_000,
            languages: [{ name: 'Ruby', share: 100 }],
          },
          {
            ...input().projects[0]!,
            fullPath: 'unsized',
            repositorySize: null,
            languages: [{ name: 'Go', share: 100 }],
          },
        ],
      }),
      DAY,
    );
    expect(skill(fragment, 'ruby')?.weight).toBe(1_000_000);
    // Go is real and is kept, but it cannot be put on the same scale.
    expect(skill(fragment, 'go')?.weight).toBeUndefined();
    expect(skill(fragment, 'go')).toBeDefined();
  });
});

describe('the rest of the fragment', () => {
  it('claims a gitlab identity and a link', () => {
    const fragment = gitlabToFragment(input(), DAY);
    expect(fragment.identities).toEqual([
      { provider: 'gitlab', displayName: 'Amara Okonkwo' },
    ]);
    expect(fragment.links?.some((l) => l.url === 'https://gitlab.com/amara')).toBe(true);
  });

  it('maps topics to interests, never to skills', () => {
    // The same rule ADR-0036 applies to dev.to: a topic is what a project is about,
    // not evidence that the person is good at it.
    const fragment = gitlabToFragment(
      input({
        projects: [{ ...input().projects[0]!, topics: ['rust', 'kubernetes'] }],
      }),
      DAY,
    );
    expect(fragment.interests?.map((i) => i.tag)).toContain('rust');
    expect(skill(fragment, 'rust')).toBeUndefined();
  });

  it('does not claim an experience level', () => {
    // Nothing GitLab returns dates the account, and guessing a career length from
    // project activity would invent a number the user never gave.
    expect(gitlabToFragment(input(), DAY).experienceLevel).toBeUndefined();
    expect(gitlabToFragment(input(), DAY).experience ?? []).toEqual([]);
  });

  it('carries an email only when the user made it public', () => {
    expect(gitlabToFragment(input(), DAY).contact?.emails).toEqual([]);
    const withEmail = gitlabToFragment(input({ publicEmail: 'a@example.test' }), DAY);
    expect(withEmail.contact?.emails?.[0]?.value).toBe('a@example.test');
  });

  it('is measured provenance throughout', () => {
    const fragment = gitlabToFragment(input(), DAY);
    expect(skill(fragment, 'ruby')?.from.source).toBe('gitlab');
    expect(skill(fragment, 'ruby')?.from.capturedAt).toBe(DAY);
  });
});

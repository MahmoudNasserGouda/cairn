import { describe, expect, it } from 'vitest';
import { devtoToFragment, type DevtoInput } from './devto';
import { emptyProfile } from './model';
import { forgetSource, mergeProfile } from './merge';

/**
 * dev.to into a profile fragment (ADR-0036).
 *
 * The entire decision in this source is *where the tags go*, and it is a decision about
 * what evidence means: **writing about a technology is evidence of interest, not of
 * competence.** A tutorial on Kubernetes says its author wanted to explain Kubernetes;
 * it does not say they have run it in anger.
 *
 * `interests` is where that belongs — it drives discovery and never touches a match
 * score — and the tests below are mostly about everything this source is not allowed to
 * reach.
 */

const DAY = '2026-09-15';
const CTX = { currentYear: 2026 };

const input = (tags: string[][]): DevtoInput => ({
  username: 'amara',
  profileUrl: 'https://dev.to/amara',
  articles: tags.map((tagList, i) => ({
    title: `post ${i}`,
    description: null,
    url: `https://dev.to/amara/post-${i}`,
    tags: tagList,
    reactions: 10,
    comments: 2,
    publishedAt: DAY,
  })),
});

describe('tags become interests', () => {
  it('maps article tags through the taxonomy', () => {
    const fragment = devtoToFragment(input([['rust', 'kubernetes']]), DAY);
    expect(fragment.interests?.map((i) => i.tag).sort()).toEqual(['kubernetes', 'rust']);
  });

  it('unions across articles without duplicating', () => {
    const fragment = devtoToFragment(input([['rust'], ['rust', 'go']]), DAY);
    expect(fragment.interests?.map((i) => i.tag).sort()).toEqual(['go', 'rust']);
  });

  /**
   * `discuss`, `watercooler` and `jokes` are real dev.to tags — the first article the
   * live API returned carried all three — and they are not technologies. The taxonomy
   * already refuses them, which is why ADR-0036 could say no new filtering was needed.
   */
  it('drops the tags that are not technologies', () => {
    const fragment = devtoToFragment(
      input([['discuss', 'watercooler', 'jokes', 'rust']]),
      DAY,
    );
    expect(fragment.interests?.map((i) => i.tag)).toEqual(['rust']);
  });

  it('carries provenance, so the source can be disconnected again', () => {
    const fragment = devtoToFragment(input([['rust']]), DAY);
    expect(fragment.interests?.[0]?.from.source).toBe('devto');

    const profile = mergeProfile(emptyProfile(), fragment, CTX);
    expect(profile.interests).toEqual(['rust']);
    expect(forgetSource(profile, 'devto', CTX).interests).toEqual([]);
  });
});

describe('what it may not reach', () => {
  it('never claims a skill', () => {
    // The distinction between interest and competence is the point of this source, not
    // a calibration detail. "Low confidence skills" is how a wrong signal gets in and
    // then gets averaged into a number somebody trusts.
    const fragment = devtoToFragment(input([['rust', 'kubernetes']]), DAY);
    expect(fragment.skills ?? []).toEqual([]);
  });

  it('never claims a project', () => {
    // A ProjectEntry means something built. Filling it with blog posts would turn every
    // project list into a reading list.
    const fragment = devtoToFragment(input([['rust']]), DAY);
    expect(fragment.projects ?? []).toEqual([]);
  });

  it('never claims an identity, a name or an experience level', () => {
    const fragment = devtoToFragment(input([['rust']]), DAY);
    expect(fragment.identities ?? []).toEqual([]);
    expect(fragment.contact).toBeUndefined();
    expect(fragment.experienceLevel).toBeUndefined();
    expect(fragment.experience ?? []).toEqual([]);
  });

  it('adds nothing at all when no tag survives', () => {
    const fragment = devtoToFragment(input([['discuss', 'jokes']]), DAY);
    expect(fragment.interests).toEqual([]);
    // The link still stands: it is what the user pointed us at.
    expect(fragment.links?.[0]?.kind).toBe('devto');
  });
});

describe('the profile link', () => {
  it('is emitted so the user can see what we read', () => {
    const fragment = devtoToFragment(input([['rust']]), DAY);
    expect(fragment.links).toContainEqual(
      expect.objectContaining({ kind: 'devto', url: 'https://dev.to/amara' }),
    );
  });

  it('goes away with the source', () => {
    const profile = mergeProfile(
      emptyProfile(),
      devtoToFragment(input([['rust']]), DAY),
      CTX,
    );
    expect(profile.links.some((l) => l.kind === 'devto')).toBe(true);
    expect(forgetSource(profile, 'devto', CTX).links).toEqual([]);
  });
});

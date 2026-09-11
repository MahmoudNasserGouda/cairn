import { describe, expect, it } from 'vitest';
import {
  KNOWN_SKILLS,
  SKILL_ALIASES,
  canonicalizeSkill,
  isKnownSkill,
  toKnownSkills,
} from './taxonomy';

describe('taxonomy integrity', () => {
  it('has no alias claimed by two canonical tags', () => {
    // ALIAS_LOOKUP is a Map, so a duplicate resolves silently by declaration order.
    // `javascript` and `node` both claimed `nodejs`, and `node` happened to win.
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const [canon, aliases] of Object.entries(SKILL_ALIASES)) {
      for (const alias of aliases) {
        const previous = owner.get(alias);
        if (previous !== undefined) clashes.push(`${alias}: ${previous} vs ${canon}`);
        owner.set(alias, canon);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('has no canonical tag that is also an alias of another tag', () => {
    const aliases = new Set(Object.values(SKILL_ALIASES).flat());
    const selfConflicting = Object.keys(SKILL_ALIASES).filter((k) => aliases.has(k));
    expect(selfConflicting).toEqual([]);
  });

  it('lists only canonical tags in KNOWN_SKILLS', () => {
    // `dotnet` sat here while also being an alias of `c#`, so nothing could carry it.
    const nonCanonical = KNOWN_SKILLS.filter((s) => canonicalizeSkill(s) !== s);
    expect(nonCanonical).toEqual([]);
  });
});

describe('canonicalizeSkill', () => {
  it('maps the Node aliases to node, not javascript', () => {
    expect(canonicalizeSkill('nodejs')).toBe('node');
    expect(canonicalizeSkill('Node.js')).toBe('node');
  });

  it('still maps the JavaScript aliases to javascript', () => {
    expect(canonicalizeSkill('JS')).toBe('javascript');
    expect(canonicalizeSkill('ECMAScript')).toBe('javascript');
  });

  it('passes unknown values through as normalised tags', () => {
    expect(canonicalizeSkill('Hacktoberfest')).toBe('hacktoberfest');
  });
});

describe('toKnownSkills', () => {
  it('drops GitHub topics that are not technologies', () => {
    expect(
      toKnownSkills(['hacktoberfest', 'react', 'awesome-list', 'typescript', 'oss']),
    ).toEqual(['react', 'typescript']);
  });

  it('canonicalises before filtering, so aliases survive', () => {
    expect(toKnownSkills(['nodejs', 'TS'])).toEqual(['node', 'typescript']);
  });

  it('de-duplicates, keeping the first mention', () => {
    expect(toKnownSkills(['node', 'nodejs', 'node.js'])).toEqual(['node']);
  });

  it('returns nothing for an all-junk topic list', () => {
    expect(toKnownSkills(['awesome', 'hacktoberfest'])).toEqual([]);
  });
});

describe('isKnownSkill', () => {
  it('accepts a known tag and its aliases', () => {
    expect(isKnownSkill('react')).toBe(true);
    expect(isKnownSkill('k8s')).toBe(true);
  });

  it('rejects a free-text topic', () => {
    expect(isKnownSkill('hacktoberfest')).toBe(false);
  });
});

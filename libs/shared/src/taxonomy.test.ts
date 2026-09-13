import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_SKILLS,
  KNOWN_SKILLS,
  SKILL_ALIASES,
  canonicalizeSkill,
  extractSkills,
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

describe('extractSkills', () => {
  it('matches on word boundaries, not bare substrings', () => {
    // `go` used to be reported for any text containing "logs", "django" or "category".
    expect(extractSkills('Redact sensitive parsed values in logs')).toEqual([]);
    expect(extractSkills('Group results by category')).toEqual([]);
    expect(extractSkills('Port the javascript helper')).toEqual(['javascript']);
  });

  it('ignores ambiguous tags used as ordinary English words', () => {
    expect(
      extractSkills('We should go ahead and fix the rest of it during spring cleanup'),
    ).toEqual([]);
    expect(
      extractSkills('This will express the intent; the parent node is null'),
    ).toEqual([]);
    expect(extractSkills('A swift fix, nothing more')).toEqual([]);
  });

  it('accepts an ambiguous tag in a qualified form', () => {
    expect(extractSkills('The REST API 500s from our Spring Boot service')).toEqual([
      'rest',
      'spring',
    ]);
    expect(extractSkills('Leaks in a goroutine; see go.mod')).toEqual(['go']);
    expect(extractSkills('Broken on node 20 and in the express middleware')).toEqual([
      'express',
      'node',
    ]);
    expect(extractSkills('Rewritten in Go with SwiftUI on the client')).toEqual([
      'go',
      'swift',
    ]);
  });

  it('accepts an ambiguous tag as a standalone list item, as CVs write them', () => {
    // The bare word is a real skill claim here, a shape prose does not produce.
    expect(extractSkills('Languages: Go, Rust, Python')).toEqual([
      'go',
      'python',
      'rust',
    ]);
    expect(extractSkills('Backend: Node | Express | REST')).toEqual([
      'express',
      'node',
      'rest',
    ]);
    expect(extractSkills('- Swift\n- Spring\n- Java')).toEqual([
      'java',
      'spring',
      'swift',
    ]);
  });

  it('still reads a comma-separated CV skills line', () => {
    expect(
      extractSkills('JavaScript, TypeScript, Angular, RxJS, Node.js, Docker, k8s'),
    ).toEqual(['angular', 'docker', 'javascript', 'kubernetes', 'node', 'typescript']);
  });

  it('lets unambiguous aliases match mid-sentence', () => {
    // Only the ambiguous *canonical* spellings are gated, never their aliases.
    expect(extractSkills('the golang build fails under nodejs')).toEqual(['go', 'node']);
  });

  it('gates only canonical tags the taxonomy actually knows', () => {
    for (const tag of Object.keys(AMBIGUOUS_SKILLS)) {
      expect(canonicalizeSkill(tag)).toBe(tag);
      expect(isKnownSkill(tag)).toBe(true);
    }
  });
});

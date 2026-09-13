/**
 * Identity keys — what makes two entries "the same entry" (ADR-0031).
 *
 * The merge is only idempotent if these are stable, so they are worth testing
 * directly rather than through the merge that happens to use them.
 */
import { describe, expect, it } from 'vitest';
import {
  certificationKey,
  educationKey,
  experienceKey,
  languageKey,
  linkKey,
  projectKey,
  type ExperienceEntry,
  type ProfileLink,
} from './model';
import { provenance } from './provenance';

const from = provenance('github', '2026-09-13');

function link(url: string): ProfileLink {
  return { kind: 'website', url, from };
}

function role(over: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    title: 'Backend Engineer',
    organization: 'Paystack',
    startYear: 2021,
    highlights: [],
    from,
    ...over,
  };
}

describe('linkKey', () => {
  it('treats the same profile as one link however it was written', () => {
    const canonical = linkKey(link('https://amara.dev'));
    for (const variant of [
      'http://amara.dev',
      'https://amara.dev/',
      'HTTPS://Amara.Dev',
      'https://amara.dev///',
      '  https://amara.dev/  ',
    ]) {
      expect(linkKey(link(variant))).toBe(canonical);
    }
  });

  it('keeps genuinely different links apart', () => {
    expect(linkKey(link('https://amara.dev/a'))).not.toBe(
      linkKey(link('https://amara.dev/b')),
    );
  });

  it('leaves a path intact — only the trailing slash is noise', () => {
    expect(linkKey(link('https://github.com/amara/'))).toBe('lnk:github.com/amara');
  });

  it('handles a URL that is nothing but slashes', () => {
    expect(linkKey(link('////'))).toBe('lnk:');
  });

  /**
   * Regression test for CodeQL `js/polynomial-redos` (high), which found
   * `.replace(/\/+$/, '')` here. A run of slashes followed by anything else makes that
   * pattern backtrack quadratically: the engine consumes the whole run, fails `$`,
   * gives a slash back, fails again, and repeats from every starting offset.
   *
   * URLs are short *today* — they come from a GitHub login. They will not stay that
   * way: ADR-0029 feeds LinkedIn archive URLs through here and the profile hub lets
   * people type their own. "In practice the input is small" is exactly the assumption
   * that ships a ReDoS.
   *
   * The bound is deliberately loose. Linear work on 200k characters is a couple of
   * milliseconds; quadratic is ~10^10 steps and would never finish. Anything in
   * between is not a regression this test needs to split hairs about.
   */
  it('normalises a hostile run of slashes in linear time', () => {
    const hostile = `https://x.dev/${'/'.repeat(200_000)}x`;
    const started = performance.now();
    const key = linkKey(link(hostile));
    const elapsed = performance.now() - started;

    expect(key.endsWith('x')).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('experienceKey', () => {
  it('ignores the title, so correcting one does not create a second role', () => {
    expect(experienceKey(role({ title: 'Backend Enginer' }))).toBe(
      experienceKey(role({ title: 'Backend Engineer' })),
    );
  });

  it('separates roles by employer and by start year', () => {
    expect(experienceKey(role({ organization: 'Andela' }))).not.toBe(
      experienceKey(role()),
    );
    expect(experienceKey(role({ startYear: 2018 }))).not.toBe(experienceKey(role()));
  });

  it('falls back to the title when there is nothing to locate the role by', () => {
    const bare = { title: 'Freelance', highlights: [], from };
    const other = { title: 'Volunteering', highlights: [], from };
    expect(experienceKey(bare)).not.toBe(experienceKey(other));
  });

  it('is insensitive to case and stray whitespace', () => {
    expect(experienceKey(role({ organization: '  PAYSTACK  ' }))).toBe(
      experienceKey(role()),
    );
  });
});

describe('the other keys', () => {
  it('identify education by institution and start year, not by degree wording', () => {
    const base = { institution: 'Andela', startYear: 2017, from };
    expect(educationKey({ ...base, degree: 'BSc' })).toBe(
      educationKey({ ...base, degree: 'B.Sc.' }),
    );
  });

  it('identify a project by name and a certification by name plus issuer', () => {
    expect(projectKey({ name: 'Rujoom', technologies: [], from })).toBe(
      projectKey({ name: '  rujoom  ', technologies: [], from }),
    );
    expect(certificationKey({ name: 'CKA', issuer: 'CNCF', from })).not.toBe(
      certificationKey({ name: 'CKA', issuer: 'Linux Foundation', from }),
    );
  });

  it('identify a spoken language by name alone, so proficiency can be corrected', () => {
    expect(languageKey({ name: 'Arabic', proficiency: 'Native', from })).toBe(
      languageKey({ name: 'arabic', proficiency: 'Bilingual', from }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { emptyProfile } from './model';
import { forgetSource, mergeProfile } from './merge';
import { provenance } from './provenance';
import type { SkillTag } from '@cairn/shared';

/**
 * Taking a source back out of `interests`.
 *
 * `interests` is the one field with no provenance, and deliberately so: it is a union
 * of tag sets, with no slot for two sources to disagree over
 * ([ADR-0031](../../../docs/adr/0031-profile-v2-provenance.md)). No conflict, no need to
 * rank anybody — which was true right up until a source needed to be **removed**.
 *
 * `forgetSource` rebuilt every other field and passed `interests` through untouched, so
 * disconnecting GitHub left its repository topics in the profile permanently. Nothing
 * made that visible while GitHub also contributed skills, links and experience: the
 * Sources row emptied, and a handful of stray topics looked like something the user had
 * set themselves.
 *
 * [ADR-0036](../../../docs/adr/0036-dev-to-as-interests-not-skills.md) makes it
 * impossible to miss, because interests are the **only** thing dev.to contributes —
 * "Remove dev.to" would have visibly done nothing at all.
 *
 * The fix keeps `interests` a flat tag list for every consumer (discovery, matching,
 * readiness and the dashboard all read it as one), and records which sources claimed
 * each tag alongside it.
 */

const DAY = '2026-09-15';
const CTX = { currentYear: 2026 };
const tags = (...names: string[]): SkillTag[] => names;

const from = (source: 'github' | 'gitlab' | 'devto' | 'cv', list: string[]) => ({
  interests: tags(...list).map((tag) => ({ tag, from: provenance(source, DAY) })),
});

const build = (...fragments: Parameters<typeof mergeProfile>[1][]) =>
  fragments.reduce((p, f) => mergeProfile(p, f, CTX), emptyProfile());

describe('removing a source', () => {
  it('takes its interests with it', () => {
    const profile = build(from('github', ['web', 'cli']), from('devto', ['rust']));
    expect(profile.interests).toEqual(tags('cli', 'rust', 'web'));

    const after = forgetSource(profile, 'devto', CTX);
    expect(after.interests).toEqual(tags('cli', 'web'));
  });

  /**
   * The case that makes a naive "delete every tag this source claimed" wrong: two
   * sources can name the same interest, and one leaving does not unmake the other's
   * claim.
   */
  it('keeps a tag another source also claimed', () => {
    const profile = build(
      from('github', ['rust']),
      from('devto', ['rust', 'kubernetes']),
    );

    const after = forgetSource(profile, 'devto', CTX);
    expect(after.interests).toEqual(tags('rust'));
  });

  it('leaves interests alone when the source claimed none', () => {
    const profile = build(from('github', ['web']), from('cv', []));
    expect(forgetSource(profile, 'cv', CTX).interests).toEqual(tags('web'));
  });

  it('is idempotent', () => {
    const profile = build(from('github', ['web']), from('devto', ['rust']));
    const once = forgetSource(profile, 'devto', CTX);
    expect(forgetSource(once, 'devto', CTX).interests).toEqual(once.interests);
  });

  /**
   * A profile stored before attribution existed has interests nobody can account for.
   * They are **kept**: deleting something we cannot attribute is a worse failure than
   * leaving it, since the user would watch tags they may have valued disappear on an
   * unrelated action. Re-importing the source attributes them, and GitHub re-imports on
   * every sign-in, so this corrects itself rather than needing a migration.
   */
  it('keeps interests it cannot attribute rather than guessing', () => {
    const legacy = { ...build(), interests: tags('web', 'cli') };

    // Unchanged, and in the order they were stored — a forget filters, it does not
    // reorder, so nothing about the list moves when an unrelated source is removed.
    expect(forgetSource(legacy, 'github', CTX).interests).toEqual(tags('web', 'cli'));
  });
});

describe('recording who claimed what', () => {
  it('remembers every source that named a tag, not just the last', () => {
    const profile = build(from('github', ['rust']), from('devto', ['rust']));
    expect([...(profile.interestSources?.['rust'] ?? [])].sort()).toEqual([
      'devto',
      'github',
    ]);
  });

  it('does not duplicate a source that re-imports', () => {
    const profile = build(from('devto', ['rust']), from('devto', ['rust']));
    expect(profile.interestSources?.['rust']).toEqual(['devto']);
  });

  it('leaves the tag list itself flat, which is what every consumer reads', () => {
    const profile = build(from('github', ['web', 'cli']));
    expect(profile.interests).toEqual(tags('cli', 'web'));
  });
});

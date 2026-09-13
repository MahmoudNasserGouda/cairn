/**
 * The merge rules from ADR-0031, which are the whole reason Profile v2 exists.
 *
 * Three properties have to hold together, and the old `mergeProfile` held none of
 * them: a hand edit survives any import, re-importing a source is a no-op rather
 * than a duplication, and every value can say where it came from.
 */
import { describe, expect, it } from 'vitest';
import type { SkillTag } from '@cairn/shared';
import {
  dismissEntry,
  forgetSource,
  mergeProfile,
  type ProfileFragment,
  type IncomingSkill,
} from './merge';
import {
  emptyProfile,
  experienceKey,
  type ExperienceEntry,
  type UnifiedProfile,
} from './model';
import { provenance, sourced, type ProfileSource } from './provenance';

const YEAR = 2026;
const ctx = { currentYear: YEAR };

function at(source: ProfileSource, day = '2026-09-13', confidence = 1) {
  return provenance(source, day, confidence);
}

function role(
  title: string,
  source: ProfileSource,
  extra: Partial<ExperienceEntry> = {},
): ExperienceEntry {
  return {
    title,
    organization: 'Paystack',
    startYear: 2021,
    endYear: 'present',
    highlights: [],
    from: at(source),
    ...extra,
  };
}

function skill(tag: string, level: number, source: ProfileSource): IncomingSkill {
  return { tag: tag, level, note: `from ${source}`, from: at(source) };
}

function merge(base: UnifiedProfile, ...fragments: ProfileFragment[]): UnifiedProfile {
  return fragments.reduce((acc, f) => mergeProfile(acc, f, ctx), base);
}

describe('precedence', () => {
  const cases: readonly {
    readonly first: ProfileSource;
    readonly second: ProfileSource;
    readonly winner: ProfileSource;
  }[] = [
    { first: 'github', second: 'cv', winner: 'cv' },
    { first: 'cv', second: 'github', winner: 'cv' },
    { first: 'cv', second: 'linkedin', winner: 'linkedin' },
    { first: 'linkedin', second: 'cv', winner: 'linkedin' },
    { first: 'linkedin', second: 'manual', winner: 'manual' },
    { first: 'manual', second: 'linkedin', winner: 'manual' },
    { first: 'manual', second: 'github', winner: 'manual' },
    { first: 'manual', second: 'cv', winner: 'manual' },
  ];

  for (const { first, second, winner } of cases) {
    it(`${first} then ${second} → ${winner} wins the name`, () => {
      const merged = merge(
        emptyProfile(),
        { contact: { name: sourced(`from ${first}`, at(first)) } },
        { contact: { name: sourced(`from ${second}`, at(second)) } },
      );
      expect(merged.contact.name?.value).toBe(`from ${winner}`);
      expect(merged.contact.name?.from.source).toBe(winner);
    });
  }

  it('breaks a same-source tie by confidence, then by capture date', () => {
    const merged = merge(
      emptyProfile(),
      { contact: { headline: sourced('unsure', at('cv', '2026-09-13', 0.3)) } },
      { contact: { headline: sourced('confident', at('cv', '2026-09-13', 0.9)) } },
    );
    expect(merged.contact.headline?.value).toBe('confident');

    const later = merge(
      emptyProfile(),
      { contact: { headline: sourced('older', at('cv', '2026-01-01')) } },
      { contact: { headline: sourced('newer', at('cv', '2026-09-13')) } },
    );
    expect(later.contact.headline?.value).toBe('newer');
  });

  it('keeps what it has when nothing outranks it', () => {
    const merged = merge(
      emptyProfile(),
      { contact: { name: sourced('Amara', at('manual')) } },
      { contact: { name: sourced('amara-okonkwo', at('github')) } },
      { contact: { name: sourced('Amara O.', at('linkedin')) } },
      { contact: { name: sourced('AMARA OKONKWO', at('cv')) } },
    );
    expect(merged.contact.name?.value).toBe('Amara');
  });
});

describe('a hand edit survives every import', () => {
  it('keeps a manually corrected role when the CV is re-imported', () => {
    const imported = merge(emptyProfile(), {
      experience: [role('Backend Enginer', 'cv')],
    });
    const corrected = merge(imported, {
      experience: [role('Backend Engineer', 'manual')],
    });
    const reimported = merge(corrected, {
      experience: [role('Backend Enginer', 'cv')],
    });

    const titles = reimported.experience.map((e) => e.title);
    expect(titles).toContain('Backend Engineer');
    expect(titles).not.toContain('Backend Enginer');
  });

  it('keeps a manual experience level against a GitHub inference', () => {
    const merged = merge(
      emptyProfile(),
      { experienceLevel: sourced('advanced', at('manual')) },
      { experienceLevel: sourced('beginner', at('github')) },
    );
    expect(merged.experienceLevel.value).toBe('advanced');
  });
});

describe('re-import is idempotent', () => {
  const fragment: ProfileFragment = {
    experience: [
      role('Backend Engineer', 'cv'),
      role('Data Analyst', 'cv', {
        organization: 'Andela',
        startYear: 2018,
        endYear: 2021,
      }),
    ],
    education: [
      {
        institution: 'Andela',
        degree: 'BSc',
        startYear: 2017,
        endYear: 2021,
        from: at('cv'),
      },
    ],
    skills: [skill('python', 0.7, 'cv')],
    interests: ['web'],
  };

  it('does not duplicate entries when the same source is imported twice', () => {
    const once = merge(emptyProfile(), fragment);
    const twice = merge(once, fragment);

    expect(once.experience).toHaveLength(2);
    expect(twice.experience).toHaveLength(2);
    expect(twice.education).toHaveLength(1);
    expect(twice.skills).toHaveLength(1);
  });

  it('does not inflate totalYears — the bug that forced the old rebuild workaround', () => {
    const once = merge(emptyProfile(), fragment);
    const thrice = merge(once, fragment, fragment);
    expect(thrice.totalYears).toBe(once.totalYears);
  });

  it('lets a source update the entries it contributed itself', () => {
    const first = merge(emptyProfile(), {
      experience: [role('Backend Engineer', 'cv')],
    });
    const second = merge(first, {
      experience: [role('Backend Engineer', 'cv', { location: 'Lagos' })],
    });

    expect(second.experience).toHaveLength(1);
    expect(second.experience[0]?.location).toBe('Lagos');
  });
});

describe('entities merge by identity, not by concatenation', () => {
  it('treats the same role from two sources as one entry', () => {
    const merged = merge(
      emptyProfile(),
      { experience: [role('Backend Engineer', 'cv')] },
      { experience: [role('  backend   ENGINEER  ', 'linkedin')] },
    );
    expect(merged.experience).toHaveLength(1);
    // LinkedIn outranks the CV, so its spelling is the one kept.
    expect(merged.experience[0]?.from.source).toBe('linkedin');
  });

  /**
   * The accepted cost of keying on where-and-when. Two roles at the same employer
   * starting the same year are usually a promotion recorded twice, and merging them
   * is a far better failure than gaining a duplicate every time someone fixes a
   * letter in a job title. Asserted so the trade-off stays a decision.
   */
  it('merges two roles at the same employer in the same year — by design', () => {
    const merged = merge(emptyProfile(), {
      experience: [role('Backend Engineer', 'cv'), role('Senior Backend Engineer', 'cv')],
    });
    expect(merged.experience).toHaveLength(1);
  });

  it('keeps genuinely different roles apart', () => {
    const merged = merge(emptyProfile(), {
      experience: [
        role('Backend Engineer', 'cv'),
        role('Backend Engineer', 'cv', { organization: 'Andela' }),
        role('Backend Engineer', 'cv', { startYear: 2018 }),
      ],
    });
    expect(merged.experience).toHaveLength(3);
  });

  it('normalises a link so one profile is not listed twice', () => {
    const merged = merge(
      emptyProfile(),
      { links: [{ kind: 'website', url: 'https://amara.dev/', from: at('github') }] },
      { links: [{ kind: 'website', url: 'http://amara.dev', from: at('linkedin') }] },
    );
    expect(merged.links).toHaveLength(1);
  });
});

describe('skills carry every source that claimed them', () => {
  it('reconciles the level to the winning source but keeps the rest as evidence', () => {
    const merged = merge(
      emptyProfile(),
      { skills: [skill('typescript', 0.9, 'github')] },
      { skills: [skill('typescript', 0.5, 'cv')] },
    );

    const ts = merged.skills.find((s) => s.tag === 'typescript');
    expect(ts?.level).toBe(0.5);
    expect(ts?.from.source).toBe('cv');
    expect(ts?.evidence.map((e) => e.source).sort()).toEqual(['cv', 'github']);
    expect(ts?.evidence.find((e) => e.source === 'github')?.level).toBe(0.9);
  });

  it('replaces a source evidence rather than stacking it on re-import', () => {
    const merged = merge(
      emptyProfile(),
      { skills: [skill('go', 0.4, 'github')] },
      { skills: [skill('go', 0.6, 'github')] },
    );
    const go = merged.skills.find((s) => s.tag === 'go');
    expect(go?.evidence).toHaveLength(1);
    expect(go?.level).toBe(0.6);
  });

  it('derives technologies from the reconciled skill set', () => {
    const merged = merge(emptyProfile(), {
      skills: [skill('python', 0.7, 'cv'), skill('docker', 0.4, 'cv')],
    });
    expect(merged.technologies).toEqual(['docker', 'python']);
  });
});

describe('derived fields', () => {
  it('recomputes totalYears and the experience level from the merged entries', () => {
    const merged = merge(emptyProfile(), {
      experience: [
        role('Backend Engineer', 'cv', { startYear: 2021, endYear: 'present' }),
        role('Data Analyst', 'cv', { startYear: 2018, endYear: 2021 }),
      ],
    });
    expect(merged.totalYears).toBe(8);
    expect(merged.experienceLevel.value).toBe('expert');
  });

  it('never reads a clock — the same inputs give the same profile', () => {
    const fragment: ProfileFragment = {
      experience: [role('Backend Engineer', 'cv', { endYear: 'present' })],
    };
    const a = mergeProfile(emptyProfile(), fragment, { currentYear: 2026 });
    const b = mergeProfile(emptyProfile(), fragment, { currentYear: 2030 });

    expect(a.totalYears).toBe(5);
    expect(b.totalYears).toBe(9);
  });

  it('unions interests without caring which source supplied them', () => {
    const merged = merge(
      emptyProfile(),
      { interests: ['web', 'cli'] as SkillTag[] },
      { interests: ['web', 'devops'] as SkillTag[] },
    );
    expect(merged.interests).toEqual(['cli', 'devops', 'web']);
  });
});

describe('a removal is as durable as an edit', () => {
  it('does not resurrect a dismissed entry on the next import', () => {
    const roles = [
      role('Backend Engineer', 'cv'),
      role('Data Analyst', 'cv', { organization: 'Andela', startYear: 2018 }),
    ];
    const imported = merge(emptyProfile(), { experience: roles });
    const key = experienceKey(imported.experience[0] as ExperienceEntry);
    const pruned = dismissEntry(imported, key);

    expect(pruned.experience).toHaveLength(1);

    const reimported = merge(pruned, { experience: roles });
    expect(reimported.experience).toHaveLength(1);
    expect(reimported.experience[0]?.title).toBe('Data Analyst');
  });

  it('lets the user add a dismissed entry back by hand', () => {
    const imported = merge(emptyProfile(), {
      experience: [role('Backend Engineer', 'cv')],
    });
    const key = experienceKey(imported.experience[0] as ExperienceEntry);
    const pruned = dismissEntry(imported, key);
    const readded = merge(pruned, { experience: [role('Backend Engineer', 'manual')] });

    expect(readded.experience).toHaveLength(1);
    expect(readded.dismissed).not.toContain(key);
  });
});

describe('identities', () => {
  it('keeps one identity per provider, latest wins', () => {
    const merged = merge(
      emptyProfile(),
      { identities: [{ provider: 'github', displayName: 'octo' }] },
      { identities: [{ provider: 'github', displayName: 'Octo Cat' }] },
      { identities: [{ provider: 'linkedin', displayName: 'Amara' }] },
    );
    expect(merged.identities).toHaveLength(2);
    expect(merged.identities.find((i) => i.provider === 'github')?.displayName).toBe(
      'Octo Cat',
    );
  });
});

describe('emails', () => {
  it('collects every address once, keeping the highest-precedence claim', () => {
    const merged = merge(
      emptyProfile(),
      { contact: { emails: [sourced('amara@example.com', at('github'))] } },
      { contact: { emails: [sourced('AMARA@example.com', at('manual'))] } },
      { contact: { emails: [sourced('other@example.com', at('cv'))] } },
    );
    expect(merged.contact.emails).toHaveLength(2);
    expect(
      merged.contact.emails.find((e) => e.value.toLowerCase().startsWith('amara'))?.from
        .source,
    ).toBe('manual');
  });
});

describe('forgetting a source', () => {
  const built = merge(
    emptyProfile(),
    {
      contact: {
        name: sourced('Octo', at('github')),
        emails: [sourced('octo@github.example', at('github'))],
      },
      skills: [skill('typescript', 0.9, 'github')],
      experience: [
        role('Public GitHub activity', 'github', {
          organization: 'GitHub',
          startYear: 2015,
          endYear: 2024,
        }),
      ],
      interests: ['web'],
    },
    {
      contact: {
        name: sourced('Amara Okonkwo', at('cv')),
        emails: [sourced('amara@example.com', at('cv'))],
      },
      skills: [skill('typescript', 0.5, 'cv'), skill('docker', 0.5, 'cv')],
      experience: [role('Backend Engineer', 'cv', { organization: 'Paystack' })],
    },
  );

  it('takes back everything that source contributed', () => {
    const without = forgetSource(built, 'cv');

    expect(without.contact.name?.value).toBe('Octo');
    expect(without.contact.emails.map((e) => e.value)).toEqual(['octo@github.example']);
    expect(without.experience.map((e) => e.title)).toEqual(['Public GitHub activity']);
    expect(without.skills.map((s) => s.tag)).toEqual(['typescript']);
  });

  /**
   * The point of keeping evidence. Dropping the CV must not drop the GitHub
   * measurement that the CV's claim happened to outrank — the skill falls back to
   * what the remaining sources say rather than disappearing with the source.
   */
  it('falls back to the next source rather than deleting a shared skill', () => {
    const without = forgetSource(built, 'cv');
    const ts = without.skills.find((s) => s.tag === 'typescript');

    expect(ts?.level).toBe(0.9);
    expect(ts?.from.source).toBe('github');
    expect(ts?.evidence.map((e) => e.source)).toEqual(['github']);
  });

  it('leaves a hand edit alone even when it started life in that source', () => {
    const corrected = merge(built, {
      experience: [role('Backend Engineer', 'manual', { organization: 'Paystack' })],
    });
    const without = forgetSource(corrected, 'cv');

    expect(without.experience.map((e) => e.title)).toContain('Backend Engineer');
  });

  it('recomputes the derived fields instead of leaving stale ones', () => {
    const without = forgetSource(built, 'cv', ctx);
    expect(without.technologies).toEqual(['typescript']);
    // Only the 2015-2024 GitHub span is left, so the years follow it down.
    expect(without.totalYears).toBe(9);
  });

  it('is a no-op for a source that contributed nothing', () => {
    expect(forgetSource(built, 'linkedin', ctx)).toEqual(built);
  });
});

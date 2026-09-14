import { describe, expect, it } from 'vitest';
import { applyEdit, type ProfileEdit } from './edit';
import { cvToFragment } from './cv';
import { mergeProfile } from './merge';
import { emptyProfile, experienceKey, type UnifiedProfile } from './model';

const DAY = '2026-09-14';
const ctx = { currentYear: 2026, capturedAt: DAY };

/** A profile as an import would leave it: one role, from a CV. */
function imported(): UnifiedProfile {
  return mergeProfile(
    emptyProfile(),
    cvToFragment(
      {
        name: 'Amara O.',
        skills: ['typescript'],
        sections: [],
        experience: [
          {
            title: 'Backend Eng.',
            organization: 'Paystak',
            startYear: 2021,
            endYear: 'present',
          },
        ],
      },
      DAY,
    ),
    { currentYear: 2026 },
  );
}

const edit = (profile: UnifiedProfile, e: ProfileEdit): UnifiedProfile =>
  applyEdit(profile, e, ctx);

describe('editing a contact field', () => {
  it('outranks the import it corrects', () => {
    const next = edit(imported(), {
      kind: 'contact',
      field: 'name',
      value: 'Amara Okonkwo',
    });

    expect(next.contact.name?.value).toBe('Amara Okonkwo');
    expect(next.contact.name?.from.source).toBe('manual');
  });

  /**
   * The point of the whole provenance design, exercised end to end: the user fixes a
   * field, re-imports the source that got it wrong, and their correction stands.
   */
  it('survives re-importing the source that got it wrong', () => {
    const edited = edit(imported(), {
      kind: 'contact',
      field: 'name',
      value: 'Amara Okonkwo',
    });
    const reimported = mergeProfile(
      edited,
      cvToFragment({ name: 'Amara O.', skills: [], sections: [], experience: [] }, DAY),
      { currentYear: 2026 },
    );

    expect(reimported.contact.name?.value).toBe('Amara Okonkwo');
  });

  it('clears a field when the value is emptied', () => {
    const withHeadline = edit(imported(), {
      kind: 'contact',
      field: 'headline',
      value: 'Backend engineer',
    });
    const cleared = edit(withHeadline, {
      kind: 'contact',
      field: 'headline',
      value: '  ',
    });

    expect(cleared.contact.headline).toBeUndefined();
  });
});

describe('editing an entry whose identity changes', () => {
  /**
   * The failure this exists to prevent.
   *
   * A role is identified by organisation and start year, so correcting a misspelt
   * employer *changes its identity*. Merging the corrected entry would add a second
   * role rather than fix the first — the exact bug that keying on title caused, moved
   * one field over. An edit is a replacement, not a merge.
   */
  it('replaces the entry rather than adding a second one', () => {
    const profile = imported();
    const old = experienceKey(profile.experience[0] as never);

    const next = edit(profile, {
      kind: 'experience',
      replaces: old,
      entry: {
        title: 'Backend Engineer',
        organization: 'Paystack',
        startYear: 2021,
        endYear: 'present',
        highlights: [],
      },
    });

    expect(next.experience).toHaveLength(1);
    expect(next.experience[0]).toMatchObject({
      title: 'Backend Engineer',
      organization: 'Paystack',
      from: { source: 'manual' },
    });
  });

  /**
   * And the correction has to *stay* corrected. Without a tombstone on the old
   * identity, the next CV import re-adds "Paystak" alongside "Paystack" and the user
   * fixes the same typo forever.
   */
  it('tombstones the identity it replaced, so a re-import cannot resurrect it', () => {
    const profile = imported();
    const old = experienceKey(profile.experience[0] as never);

    const corrected = edit(profile, {
      kind: 'experience',
      replaces: old,
      entry: {
        title: 'Backend Engineer',
        organization: 'Paystack',
        startYear: 2021,
        endYear: 'present',
        highlights: [],
      },
    });
    const reimported = mergeProfile(
      corrected,
      cvToFragment(
        {
          name: 'Amara O.',
          skills: [],
          sections: [],
          experience: [
            {
              title: 'Backend Eng.',
              organization: 'Paystak',
              startYear: 2021,
              endYear: 'present',
            },
          ],
        },
        DAY,
      ),
      { currentYear: 2026 },
    );

    expect(corrected.dismissed).toContain(old);
    expect(reimported.experience).toHaveLength(1);
    expect(reimported.experience[0]?.organization).toBe('Paystack');
  });

  /**
   * An edit that leaves the identity alone must not tombstone it. The entry is still
   * the same entry, and blocking its key would stop a later import contributing
   * anything the user did not type — a bullet, a location — to a role they only
   * retitled.
   */
  it('does not tombstone when only the wording changed', () => {
    const profile = imported();
    const key = experienceKey(profile.experience[0] as never);

    const next = edit(profile, {
      kind: 'experience',
      replaces: key,
      entry: {
        title: 'Senior Backend Engineer',
        organization: 'Paystak',
        startYear: 2021,
        endYear: 'present',
        highlights: [],
      },
    });

    expect(next.dismissed).toEqual([]);
    expect(next.experience[0]?.title).toBe('Senior Backend Engineer');
  });

  it('recomputes the years a changed date implies', () => {
    const profile = imported();
    const key = experienceKey(profile.experience[0] as never);

    const next = edit(profile, {
      kind: 'experience',
      replaces: key,
      entry: {
        title: 'Backend Engineer',
        organization: 'Paystak',
        startYear: 2016,
        endYear: 'present',
        highlights: [],
      },
    });

    expect(next.totalYears).toBe(10);
    expect(next.experienceLevel.value).toBe('expert');
  });
});

describe('adding by hand', () => {
  it('adds a role nothing imported', () => {
    const next = edit(emptyProfile(), {
      kind: 'experience',
      entry: {
        title: 'Volunteer maintainer',
        organization: 'A project',
        startYear: 2024,
        highlights: ['Triaged issues.'],
      },
    });

    expect(next.experience).toHaveLength(1);
    expect(next.experience[0]?.from.source).toBe('manual');
  });

  it('adds education, a project, a certification, a language and a link', () => {
    let profile = emptyProfile();
    const edits: ProfileEdit[] = [
      { kind: 'education', entry: { institution: 'University of Lagos', degree: 'BSc' } },
      { kind: 'project', entry: { name: 'ledger-cli', technologies: [] } },
      { kind: 'certification', entry: { name: 'AWS SA', issuer: 'Amazon' } },
      { kind: 'language', entry: { name: 'Igbo', proficiency: 'Native' } },
      { kind: 'link', entry: { kind: 'website', url: 'https://amara.dev' } },
    ];
    for (const e of edits) profile = edit(profile, e);

    expect(profile.education[0]?.institution).toBe('University of Lagos');
    expect(profile.projects[0]?.name).toBe('ledger-cli');
    expect(profile.certifications[0]?.name).toBe('AWS SA');
    expect(profile.languages[0]?.name).toBe('Igbo');
    expect(profile.links[0]?.url).toBe('https://amara.dev');
    for (const list of [
      profile.education,
      profile.projects,
      profile.certifications,
      profile.languages,
      profile.links,
    ]) {
      expect(list[0]?.from.source).toBe('manual');
    }
  });

  it('adds an email address without disturbing the imported ones', () => {
    const profile = edit(
      mergeProfile(
        emptyProfile(),
        cvToFragment(
          { email: 'from@cv.test', skills: [], sections: [], experience: [] },
          DAY,
        ),
        { currentYear: 2026 },
      ),
      { kind: 'email', value: 'typed@example.test' },
    );

    expect(profile.contact.emails.map((e) => e.value).sort()).toEqual([
      'from@cv.test',
      'typed@example.test',
    ]);
  });
});

describe('removing', () => {
  it('removes an entry and remembers that it was removed', () => {
    const profile = imported();
    const key = experienceKey(profile.experience[0] as never);

    const next = edit(profile, { kind: 'remove', key });

    expect(next.experience).toEqual([]);
    expect(next.dismissed).toContain(key);
  });

  /**
   * A removal has to be as durable as an edit, or the next import puts the entry back
   * and the user deletes it again forever.
   */
  it('keeps it removed across a re-import', () => {
    const profile = imported();
    const key = experienceKey(profile.experience[0] as never);
    const removed = edit(profile, { kind: 'remove', key });

    const reimported = mergeProfile(
      removed,
      cvToFragment(
        {
          skills: [],
          sections: [],
          experience: [
            {
              title: 'Backend Eng.',
              organization: 'Paystak',
              startYear: 2021,
              endYear: 'present',
            },
          ],
        },
        DAY,
      ),
      { currentYear: 2026 },
    );

    expect(reimported.experience).toEqual([]);
  });

  it('lets the user change their mind by adding it back', () => {
    const profile = imported();
    const key = experienceKey(profile.experience[0] as never);
    const removed = edit(profile, { kind: 'remove', key });

    const readded = edit(removed, {
      kind: 'experience',
      entry: {
        title: 'Backend Eng.',
        organization: 'Paystak',
        startYear: 2021,
        endYear: 'present',
        highlights: [],
      },
    });

    expect(readded.experience).toHaveLength(1);
    expect(readded.dismissed).not.toContain(key);
  });
});

describe('skills and level', () => {
  it('sets a skill by hand, keeping what other sources said as evidence', () => {
    const next = edit(imported(), { kind: 'skill', tag: 'typescript', level: 0.9 });
    const skill = next.skills.find((s) => s.tag === 'typescript');

    expect(skill?.level).toBe(0.9);
    expect(skill?.from.source).toBe('manual');
    expect(skill?.evidence.map((e) => e.source).sort()).toEqual(['cv', 'manual']);
  });

  it('removes a skill the user says they do not have', () => {
    const next = edit(imported(), { kind: 'remove-skill', tag: 'typescript' });

    expect(next.skills.find((s) => s.tag === 'typescript')).toBeUndefined();
    expect(next.technologies).not.toContain('typescript');
  });

  /**
   * The only way to say "I have been doing this longer than my visible history shows".
   * The level is otherwise derived from dated roles, and a career that started before
   * GitHub existed has none.
   */
  it('lets the user state a level the dates do not imply', () => {
    const next = edit(emptyProfile(), { kind: 'experience-level', value: 'expert' });

    expect(next.experienceLevel.value).toBe('expert');
    expect(next.experienceLevel.from.source).toBe('manual');
  });
});

describe('an edit is deterministic', () => {
  it('produces the same profile twice, and reads no clock', () => {
    const e: ProfileEdit = {
      kind: 'contact',
      field: 'summary',
      value: 'Ten years of it.',
    };

    expect(applyEdit(imported(), e, ctx)).toEqual(applyEdit(imported(), e, ctx));
  });
});

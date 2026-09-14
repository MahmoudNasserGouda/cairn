import { describe, expect, it } from 'vitest';
import { readLinkedinArchive } from '@cairn/linkedin-archive';
import { sampleLinkedinArchive } from '@cairn/linkedin-archive/testing';
import { linkedinToFragment, type LinkedinArchiveInput } from './linkedin';
import { cvToFragment } from './cv';
import { mergeProfile } from './merge';
import { emptyProfile } from './model';

const DAY = '2026-09-14';
const ctx = { currentYear: 2026 };

const empty: LinkedinArchiveInput = {
  positions: [],
  education: [],
  skills: [],
  certifications: [],
  projects: [],
  languages: [],
  emails: [],
};

describe('linkedinToFragment', () => {
  it('does not invent a linked identity', () => {
    // Identities come from signing in (ADR-0025). A file someone downloaded is
    // evidence about a career, not proof of an account, and stamping one here would
    // make "connected to LinkedIn" true for a user who never connected anything.
    const fragment = linkedinToFragment(
      {
        ...empty,
        identity: {
          firstName: 'Amara',
          lastName: 'Okonkwo',
          websites: [],
          twitterHandles: [],
        },
      },
      DAY,
    );

    expect(fragment.identities).toBeUndefined();
    expect(fragment.contact?.name?.value).toBe('Amara Okonkwo');
  });

  it('fills the summary GitHub deliberately leaves empty', () => {
    const fragment = linkedinToFragment(
      {
        ...empty,
        identity: {
          headline: 'Backend engineer',
          summary: 'Ten years of infrastructure.',
          websites: [],
          twitterHandles: [],
        },
      },
      DAY,
    );

    expect(fragment.contact?.headline?.value).toBe('Backend engineer');
    expect(fragment.contact?.summary?.value).toBe('Ten years of infrastructure.');
  });

  it('classifies links by host and turns a handle into a URL', () => {
    const fragment = linkedinToFragment(
      {
        ...empty,
        identity: {
          websites: ['https://amara.dev', 'https://github.com/amara'],
          twitterHandles: ['amaracodes'],
        },
      },
      DAY,
    );

    expect(fragment.links).toEqual([
      { kind: 'website', url: 'https://amara.dev', from: expect.anything() },
      { kind: 'github', url: 'https://github.com/amara', from: expect.anything() },
      { kind: 'twitter', url: 'https://x.com/amaracodes', from: expect.anything() },
    ]);
  });

  it('refuses a handle that is not a handle', () => {
    // The field is free text in a file the user was emailed. Anything that is not a
    // plausible handle is dropped rather than pasted into a URL.
    const fragment = linkedinToFragment(
      {
        ...empty,
        identity: { websites: [], twitterHandles: ['../../evil?x=1', 'ok_name'] },
      },
      DAY,
    );

    expect(fragment.links?.map((l) => l.url)).toEqual(['https://x.com/ok_name']);
  });

  it('keeps the skills the taxonomy knows and drops the ones it cannot use', () => {
    const fragment = linkedinToFragment(
      { ...empty, skills: ['Python', 'PostgreSQL', 'Leadership'] },
      DAY,
    );

    // "Leadership" is real, and this profile has nowhere to put it: `skills` is typed
    // to the matching taxonomy, and a tag nothing can match against would only look
    // like data. It is dropped rather than smuggled in as a technology.
    expect(fragment.skills?.map((s) => s.tag)).toEqual(['python', 'postgresql']);
    expect(fragment.skills?.[0]?.from.source).toBe('linkedin');
  });

  it('carries a position with its highlights', () => {
    const fragment = linkedinToFragment(
      {
        ...empty,
        positions: [
          {
            title: 'Backend Engineer',
            organization: 'Paystack',
            location: 'Lagos, Nigeria',
            startYear: 2021,
            endYear: 'present',
            highlights: ['Built payment reconciliation in Python.'],
          },
        ],
      },
      DAY,
    );

    expect(fragment.experience).toEqual([
      {
        title: 'Backend Engineer',
        organization: 'Paystack',
        location: 'Lagos, Nigeria',
        startYear: 2021,
        endYear: 'present',
        highlights: ['Built payment reconciliation in Python.'],
        from: { source: 'linkedin', confidence: 1, capturedAt: DAY },
      },
    ]);
  });
});

/**
 * The whole point of Profile v2, exercised across two real sources: the same role,
 * described twice, must be one role.
 */
describe('an archive alongside a CV', () => {
  const cv = cvToFragment(
    {
      name: 'Amara O.',
      skills: ['typescript'],
      sections: [],
      experience: [
        {
          title: 'Backend Eng.',
          organization: 'Paystack',
          startYear: 2021,
          endYear: 'present',
        },
      ],
    },
    DAY,
  );

  const linkedin = linkedinToFragment(
    {
      ...empty,
      identity: {
        firstName: 'Amara',
        lastName: 'Okonkwo',
        websites: [],
        twitterHandles: [],
      },
      positions: [
        {
          title: 'Backend Engineer',
          organization: 'Paystack',
          startYear: 2021,
          endYear: 'present',
          highlights: ['Built payment reconciliation in Python.'],
        },
      ],
    },
    DAY,
  );

  it('merges the same role into one entry, with the archive winning', () => {
    const profile = mergeProfile(mergeProfile(emptyProfile(), cv, ctx), linkedin, ctx);

    expect(profile.experience).toHaveLength(1);
    expect(profile.experience[0]).toMatchObject({
      title: 'Backend Engineer',
      from: { source: 'linkedin' },
    });
    expect(profile.contact.name?.value).toBe('Amara Okonkwo');
  });

  it('is the same profile whichever order the two are imported in', () => {
    const cvFirst = mergeProfile(mergeProfile(emptyProfile(), cv, ctx), linkedin, ctx);
    const linkedinFirst = mergeProfile(
      mergeProfile(emptyProfile(), linkedin, ctx),
      cv,
      ctx,
    );

    expect(linkedinFirst.experience).toEqual(cvFirst.experience);
    expect(linkedinFirst.contact.name?.value).toBe('Amara Okonkwo');
  });

  it('re-importing the same archive changes nothing', () => {
    const once = mergeProfile(emptyProfile(), linkedin, ctx);
    const twice = mergeProfile(once, linkedin, ctx);

    expect(twice).toEqual(once);
  });
});

/** Through the real reader, so the two packages' shapes cannot drift apart. */
describe('from a real archive', () => {
  it('produces a profile with the career the archive describes', async () => {
    const archive = await readLinkedinArchive(await sampleLinkedinArchive());
    const profile = mergeProfile(emptyProfile(), linkedinToFragment(archive, DAY), ctx);

    expect(profile.contact.name?.value).toBe('Amara Okonkwo');
    expect(profile.contact.summary?.value).toContain('boring');
    expect(profile.experience.map((e) => e.organization)).toEqual(['Paystack', 'Andela']);
    expect(profile.education[0]?.institution).toBe('University of Lagos');
    expect(profile.certifications[0]?.issuer).toBe('Amazon Web Services');
    expect(profile.projects[0]?.name).toBe('ledger-cli');
    expect(profile.languages.map((l) => l.name)).toEqual(['English', 'Igbo']);
    expect(profile.technologies).toContain('python');
    expect(profile.contact.emails[0]?.value).toBe('amara@example.test');
    // 2019-2021 and 2021-present, against a 2026 clock.
    expect(profile.totalYears).toBe(7);
    expect(profile.experienceLevel.value).toBe('advanced');
  });
});

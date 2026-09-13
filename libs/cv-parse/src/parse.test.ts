/**
 * Layout blocks -> a structured CV (ADR-0028).
 *
 * `libs/doc-layout` answers "what is on this page and in what order". This answers
 * "what does it mean" — which section a block belongs to, which lines are roles,
 * which dates belong to which role. That split is deliberate: geometry cannot tell a
 * date gutter from a sidebar, and meaning should not be guessing at coordinates.
 *
 * Driven end to end from the real PDF fixtures, because a parser tested only on
 * hand-built blocks is a parser tested against its author's assumptions.
 */
import { describe, expect, it } from 'vitest';
import { extractPdfLayout } from '@cairn/cv-extract';
import {
  buildPositionedPdf,
  bulletedRolesCv,
  dateGutterCv,
  singleColumnCv,
  twoColumnCv,
  type PdfRun,
} from '@cairn/cv-extract/testing';
import { layoutPage } from '@cairn/doc-layout';
import { parseCv, type ParsedCv } from './parse';

async function parse(runs: readonly PdfRun[]): Promise<ParsedCv> {
  const { pages } = await extractPdfLayout(buildPositionedPdf([runs]));
  const page = pages[0];
  if (!page) throw new Error('no page');
  return parseCv(layoutPage(page));
}

describe('a single-column CV', () => {
  it('finds the contact details at the top', async () => {
    const cv = await parse(singleColumnCv());

    expect(cv.name).toBe('Amara Okonkwo');
    expect(cv.email).toBe('amara.okonkwo@example.com');
  });

  it('recognises the sections by their headings', async () => {
    const cv = await parse(singleColumnCv());
    expect(cv.sections).toEqual(expect.arrayContaining(['experience', 'skills']));
  });

  it('reads the skills line into the taxonomy', async () => {
    const cv = await parse(singleColumnCv());
    expect(cv.skills).toEqual(
      expect.arrayContaining(['docker', 'kubernetes', 'postgresql', 'python']),
    );
  });

  it('finds the role with its employer and dates', async () => {
    const cv = await parse(singleColumnCv());

    expect(cv.experience).toHaveLength(1);
    expect(cv.experience[0]).toMatchObject({
      title: 'Backend Engineer',
      organization: 'Paystack',
      startYear: 2021,
      endYear: 'present',
    });
  });
});

describe('a CV with a date gutter', () => {
  /**
   * The pay-off for `libs/doc-layout` refusing to guess. It splits the dates into
   * their own column and keeps each on its role's baseline; pairing them back up is a
   * lookup by `y`, done here where "that looks like a date range" is a judgement the
   * code is allowed to make.
   */
  it('re-pairs each date range with the role on its baseline', async () => {
    const cv = await parse(dateGutterCv());

    expect(cv.experience).toHaveLength(2);
    expect(cv.experience[0]).toMatchObject({
      title: 'Backend Engineer',
      organization: 'Paystack',
      startYear: 2021,
      endYear: 'present',
    });
    expect(cv.experience[1]).toMatchObject({
      title: 'Data Analyst',
      organization: 'Andela',
      startYear: 2019,
      endYear: 2021,
    });
  });

  it('does not leave the dates lying around as a phantom role', async () => {
    const cv = await parse(dateGutterCv());
    expect(cv.experience.map((r) => r.title)).not.toContain('2021 - present');
  });
});

describe('a CV with bulleted roles', () => {
  /**
   * Flattened, every bullet was a peer of every role and nothing said which belonged
   * to which — so a CV's actual content, the part describing what someone did, was
   * simply lost. Here each role keeps its own.
   */
  it('attaches each role its own bullets', async () => {
    const cv = await parse(bulletedRolesCv());

    expect(cv.experience).toHaveLength(2);
    expect(cv.experience[0]?.highlights).toEqual([
      'Built payment reconciliation in Python.',
      'Cut nightly batch time by half.',
    ]);
    expect(cv.experience[1]?.highlights).toEqual(['Reporting over PostgreSQL.']);
  });

  it('reads skills out of the bullets as well as a skills line', async () => {
    const cv = await parse(bulletedRolesCv());
    expect(cv.skills).toEqual(expect.arrayContaining(['python', 'postgresql']));
  });
});

describe('a two-column CV', () => {
  it('reads the sidebar and the main column as one CV', async () => {
    const cv = await parse(twoColumnCv());

    expect(cv.name).toBe('Amara Okonkwo');
    expect(cv.skills).toEqual(
      expect.arrayContaining(['python', 'postgresql', 'docker', 'kubernetes']),
    );
    expect(cv.experience.map((r) => r.title)).toContain('Backend Engineer');
  });

  it('keeps education out of the experience list', async () => {
    const cv = await parse(twoColumnCv());

    expect(cv.education.map((e) => e.institution)).toContain('BSc Computer Science');
    expect(cv.experience.map((r) => r.title)).not.toContain('BSc Computer Science');
  });
});

describe('section headings', () => {
  it.each([
    ['EXPERIENCE', 'experience'],
    ['Work Experience', 'experience'],
    ['EMPLOYMENT HISTORY', 'experience'],
    ['Technical Skills', 'skills'],
    ['SKILLS & TOOLS', 'skills'],
    ['Education', 'education'],
    ['PROJECTS', 'projects'],
    ['Certifications', 'certifications'],
    ['Summary', 'summary'],
    ['Profile', 'summary'],
  ])('maps "%s" to %s', async (heading, expected) => {
    const cv = await parse([
      { text: 'Amara Okonkwo', x: 72, y: 700, size: 22, bold: true },
      { text: heading, x: 72, y: 660, size: 13, bold: true },
      { text: 'some content under it', x: 72, y: 640 },
    ]);
    expect(cv.sections).toContain(expected);
  });

  it('ignores a heading it does not recognise rather than guessing', async () => {
    const cv = await parse([
      { text: 'Amara Okonkwo', x: 72, y: 700, size: 22, bold: true },
      { text: 'REFEREES', x: 72, y: 660, size: 13, bold: true },
      { text: 'Available on request', x: 72, y: 640 },
    ]);
    expect(cv.sections).not.toContain('referees');
    expect(cv.experience).toEqual([]);
  });
});

describe('degenerate input', () => {
  it('returns an empty CV for an empty page', async () => {
    const cv = await parse([]);

    expect(cv.name).toBeUndefined();
    expect(cv.email).toBeUndefined();
    expect(cv.skills).toEqual([]);
    expect(cv.experience).toEqual([]);
  });

  it('does not invent a name from an email-only header', async () => {
    const cv = await parse([{ text: 'amara@example.com', x: 72, y: 700, size: 11 }]);
    expect(cv.name).toBeUndefined();
    expect(cv.email).toBe('amara@example.com');
  });

  it('is deterministic', async () => {
    expect(await parse(singleColumnCv())).toEqual(await parse(singleColumnCv()));
  });
});

/**
 * CodeQL `js/polynomial-redos` (high) on `splitTitle`'s separator — the sixth of this
 * shape in the codebase, and the second one in a PR whose description asserted the
 * property it was violating.
 */
describe('hostile input', () => {
  it('splits a title in linear time however much whitespace it carries', async () => {
    const line = `Engineer${' '.repeat(120_000)}x`;
    const started = performance.now();
    const cv = await parse([
      { text: 'Amara Okonkwo', x: 72, y: 700, size: 22, bold: true },
      { text: 'EXPERIENCE', x: 72, y: 660, size: 13, bold: true },
      { text: line, x: 72, y: 640, size: 12, bold: true },
      // Ordinary body text: a document that is *entirely* emphasis has no body face
      // to infer from, which is a property of a three-line fixture, not of real CVs.
      { text: 'Payment reconciliation services in Python.', x: 72, y: 624 },
    ]);
    const elapsed = performance.now() - started;

    expect(cv.experience).toHaveLength(1);
    // Linear is sub-millisecond; unbounded took 5.9s on 60k spaces alone.
    expect(elapsed).toBeLessThan(1000);
  });

  it('still splits the separators it is meant to', async () => {
    for (const [line, title, org] of [
      ['Backend Engineer, Paystack', 'Backend Engineer', 'Paystack'],
      ['Data Analyst · Andela', 'Data Analyst', 'Andela'],
      ['Engineer at Acme', 'Engineer', 'Acme'],
    ] as const) {
      const cv = await parse([
        { text: 'Amara Okonkwo', x: 72, y: 700, size: 22, bold: true },
        { text: 'EXPERIENCE', x: 72, y: 660, size: 13, bold: true },
        { text: line, x: 72, y: 640, size: 12, bold: true },
        { text: 'Payment reconciliation services in Python.', x: 72, y: 624 },
      ]);
      expect(cv.experience[0]).toMatchObject({ title, organization: org });
    }
  });
});

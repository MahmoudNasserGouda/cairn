import { describe, expect, it } from 'vitest';
import { ZipError } from '@cairn/zip';
import {
  ARCHIVE_FOLDER,
  buildLinkedinArchive,
  refusedArchiveFiles,
  sampleArchiveFiles,
  sampleLinkedinArchive,
} from './__fixtures__/build';
import { READ_FILES, readLinkedinArchive } from './archive';

describe('reading a plausible archive', () => {
  it('finds its files inside the wrapper folder', async () => {
    const archive = await readLinkedinArchive(await sampleLinkedinArchive());

    expect(archive.report.read).toHaveLength(READ_FILES.length);
    expect(archive.report.missing).toEqual([]);
  });

  it('reads the identity, including a quoted summary with an embedded newline', async () => {
    const { identity } = await readLinkedinArchive(await sampleLinkedinArchive());

    expect(identity).toMatchObject({
      firstName: 'Amara',
      lastName: 'Okonkwo',
      headline: 'Backend engineer, payments',
      summary: 'Ten years of "boring" infrastructure.\nMostly Python and Postgres.',
      location: 'Lagos, Nigeria',
      websites: ['https://amara.dev/'],
      twitterHandles: ['amaracodes'],
    });
  });

  it('reads positions, turning a description into highlights', async () => {
    const { positions } = await readLinkedinArchive(await sampleLinkedinArchive());

    expect(positions).toEqual([
      {
        title: 'Backend Engineer',
        organization: 'Paystack',
        location: 'Lagos, Nigeria',
        startYear: 2021,
        // A blank "Finished On" is how the export writes a current role.
        endYear: 'present',
        highlights: [
          'Built payment reconciliation in Python.',
          'Cut nightly batch time by half.',
        ],
      },
      {
        title: 'Data Analyst',
        organization: 'Andela',
        location: 'Lagos, Nigeria',
        startYear: 2019,
        endYear: 2021,
        highlights: ['Reporting pipeline in SQL.'],
      },
    ]);
  });

  it('reads education, skills, certifications, projects and languages', async () => {
    const archive = await readLinkedinArchive(await sampleLinkedinArchive());

    expect(archive.education).toEqual([
      {
        institution: 'University of Lagos',
        degree: 'BSc Computer Science',
        startYear: 2014,
        endYear: 2018,
      },
    ]);
    // Raw, not canonicalised: deciding what counts as a technology is the profile's
    // job, and "Leadership" is a real thing a person listed.
    expect(archive.skills).toEqual(['Python', 'PostgreSQL', 'Docker', 'Leadership']);
    expect(archive.certifications).toEqual([
      {
        name: 'AWS Certified Solutions Architect',
        issuer: 'Amazon Web Services',
        year: 2022,
        url: 'https://example.test/cert',
      },
    ]);
    expect(archive.projects).toEqual([
      {
        name: 'ledger-cli',
        description: 'A double-entry ledger in Go.',
        url: 'https://github.test/amara/ledger-cli',
      },
    ]);
    expect(archive.languages).toEqual([
      { name: 'English', proficiency: 'Native or bilingual proficiency' },
      { name: 'Igbo', proficiency: 'Native or bilingual proficiency' },
    ]);
  });

  it('puts the primary email address first', async () => {
    const { emails } = await readLinkedinArchive(await sampleLinkedinArchive());

    expect(emails).toEqual(['amara@example.test', 'amara.okonkwo@work.example.test']);
  });
});

/**
 * The heart of ADR-0029, and the reason this is a parser rule rather than a README
 * note. Every refused file in the fixture is a **zip bomb** — 600 kB declaring itself
 * as ten. A reader that opened one would blow the byte cap and fail the import, so
 * these tests observe the refusal rather than taking it on trust.
 */
describe('third-party data is never opened', () => {
  it('imports cleanly from an archive whose refused files are bombs', async () => {
    const archive = await readLinkedinArchive(await sampleLinkedinArchive());

    expect(archive.positions).toHaveLength(2);
  });

  it('names what it left alone', async () => {
    const { report } = await readLinkedinArchive(await sampleLinkedinArchive());

    for (const refused of refusedArchiveFiles()) {
      expect(report.skipped).toContain(`${ARCHIVE_FOLDER}${refused}`);
      expect(report.read).not.toContain(`${ARCHIVE_FOLDER}${refused}`);
    }
  });

  it('stays refused however deeply the archive nests it', async () => {
    // The rule is "the entry name ends in one of these", not "the entry sits at the
    // top level" — so burying the connection graph does not make it readable, and
    // burying a skills file does not make it unreadable.
    const bytes = await buildLinkedinArchive(
      {},
      {
        folder: '',
        extra: {
          'a/b/c/Connections.csv': 'First Name,Last Name\nSomeone,Else',
          'a/b/c/Skills.csv': 'Name\nPython',
        },
      },
    );
    const archive = await readLinkedinArchive(bytes);

    expect(archive.skills).toEqual(['Python']);
    expect(archive.report.read).toEqual(['a/b/c/Skills.csv']);
    expect(archive.report.skipped).toEqual(['a/b/c/Connections.csv']);
  });
});

describe('matching entry names', () => {
  it('matches case-insensitively, because archive vintages differ', async () => {
    const bytes = await buildLinkedinArchive({
      'POSITIONS.CSV': 'Company Name,Title\nX,Y',
    });

    expect((await readLinkedinArchive(bytes)).positions).toEqual([
      { title: 'Y', organization: 'X', highlights: [] },
    ]);
  });

  it('does not treat a longer name as a match', async () => {
    // `MyProfile.csv` is not `Profile.csv`; a suffix match without the separator
    // would have said otherwise.
    const bytes = await buildLinkedinArchive({
      'MyProfile.csv': 'First Name,Last Name\nMallory,Smith',
    });
    const archive = await readLinkedinArchive(bytes);

    expect(archive.identity).toBeUndefined();
    expect(archive.report.missing).toContain('Profile.csv');
  });

  it('reads an archive with no wrapper folder at all', async () => {
    const bytes = await buildLinkedinArchive(
      { 'Skills.csv': 'Name\nPython' },
      { folder: '' },
    );

    expect((await readLinkedinArchive(bytes)).skills).toEqual(['Python']);
  });
});

describe('failing honestly', () => {
  it('says which files were not in the archive rather than refusing it', async () => {
    const bytes = await buildLinkedinArchive({ 'Skills.csv': 'Name\nPython' });
    const { report } = await readLinkedinArchive(bytes);

    expect(report.read).toEqual([`${ARCHIVE_FOLDER}Skills.csv`]);
    expect(report.missing).toContain('Positions.csv');
    expect(report.missing).toContain('Profile.csv');
  });

  it('contributes nothing from a file whose columns it does not recognise', async () => {
    const bytes = await buildLinkedinArchive({
      'Positions.csv': 'Unternehmen,Bezeichnung\nPaystack,Ingenieur',
      'Skills.csv': 'Name\nPython',
    });
    const archive = await readLinkedinArchive(bytes);

    expect(archive.positions).toEqual([]);
    expect(archive.skills).toEqual(['Python']);
  });

  it('fails closed on a bomb hidden in a file it does read', async () => {
    // The refusal list protects the files we never open. An allowlisted file still
    // gets the container's caps, and a lying manifest there stops the whole import
    // rather than being partially believed.
    await expect(readLinkedinArchive(await bombArchive())).rejects.toThrow(ZipError);
  });

  it('refuses a file that is not a zip at all', async () => {
    await expect(
      readLinkedinArchive(new TextEncoder().encode('not an archive')),
    ).rejects.toThrow(ZipError);
  });

  it('is deterministic', async () => {
    const bytes = await sampleLinkedinArchive();

    expect(await readLinkedinArchive(bytes)).toEqual(await readLinkedinArchive(bytes));
  });
});

describe('URLs from an archive are not trusted', () => {
  it('keeps only http(s) links', async () => {
    const files = sampleArchiveFiles();
    files['Profile.csv'] = [
      'First Name,Last Name,Headline,Websites',
      'Amara,Okonkwo,Engineer,"[PERSONAL:javascript:alert(1),BLOG:https://amara.dev]"',
    ].join('\r\n');
    files['Projects.csv'] = [
      'Title,Description,Url',
      'evil,"a project","javascript:alert(1)"',
    ].join('\r\n');

    const archive = await readLinkedinArchive(await buildLinkedinArchive(files));

    expect(archive.identity?.websites).toEqual(['https://amara.dev']);
    expect(archive.projects[0]).not.toHaveProperty('url');
  });
});

/**
 * The messy middle. Archive vintages differ, columns go missing, and every one of these
 * was a `?? ''` or an `optional(...)` that nothing had ever exercised.
 */
describe('reading around what the export left out', () => {
  const read = async (files: Record<string, string>) =>
    readLinkedinArchive(await buildLinkedinArchive(files));

  it('reads a profile row with almost every column missing', async () => {
    const archive = await read({ 'Profile.csv': 'First Name,Headline\nAmara,Engineer' });

    expect(archive.identity).toEqual({
      firstName: 'Amara',
      headline: 'Engineer',
      websites: [],
      twitterHandles: [],
    });
  });

  it('strips a leading @ and drops blanks from a handle list', async () => {
    const archive = await read({
      'Profile.csv': 'First Name,Twitter Handles\nAmara,"@amara, , second"',
    });

    expect(archive.identity?.twitterHandles).toEqual(['amara', 'second']);
  });

  it('pulls several URLs out of one bracketed field, and trims the sentence off', async () => {
    const archive = await read({
      'Profile.csv':
        'First Name,Websites\nAmara,"[PERSONAL:https://amara.dev/,BLOG:http://blog.example.test.]"',
    });

    expect(archive.identity?.websites).toEqual([
      'https://amara.dev/',
      'http://blog.example.test',
    ]);
  });

  it('ignores a bare scheme with no address after it', async () => {
    const archive = await read({ 'Profile.csv': 'First Name,Websites\nAmara,https://' });

    expect(archive.identity?.websites).toEqual([]);
  });

  it('dates a certification by its award date, or its expiry if that is all there is', async () => {
    const archive = await read({
      'Certifications.csv': [
        'Name,Authority,Started On,Finished On',
        '"Awarded","Amazon","Jun 2022",',
        '"Only an expiry","Amazon",,"Jun 2027"',
      ].join('\n'),
    });

    expect(archive.certifications.map((c) => c.year)).toEqual([2022, 2027]);
  });

  it('keeps a position with a company but no title, named by the company', async () => {
    // The export does this for some volunteer and self-employed entries.
    const archive = await read({
      'Positions.csv': 'Company Name,Title,Started On\nPaystack,,2021',
    });

    expect(archive.positions[0]).toMatchObject({
      title: 'Paystack',
      organization: 'Paystack',
      startYear: 2021,
    });
  });

  it('leaves a position undated when the export gave no dates at all', async () => {
    const archive = await read({
      'Positions.csv': 'Company Name,Title\nPaystack,Engineer',
    });

    // No start, so no "present" either — a role with no dates is not a current one.
    expect(archive.positions[0]).toEqual({
      title: 'Engineer',
      organization: 'Paystack',
      highlights: [],
    });
  });

  it('strips bullet markers from a description and caps how many it keeps', async () => {
    const lines = ['• first', '- second', '* third', ...Array(30).fill('more')];
    const archive = await read({
      'Positions.csv': `Company Name,Title,Description\nX,Y,"${lines.join('\n')}"`,
    });

    const highlights = archive.positions[0]?.highlights ?? [];
    expect(highlights.slice(0, 3)).toEqual(['first', 'second', 'third']);
    expect(highlights).toHaveLength(20);
  });

  it('keeps every email when the export has no Primary column', async () => {
    const archive = await read({
      'Email Addresses.csv': 'Email Address\na@example.test\nb@example.test',
    });

    expect(archive.emails).toEqual(['a@example.test', 'b@example.test']);
  });

  it('matches an entry an archiver wrote with backslashes', async () => {
    const bytes = await buildLinkedinArchive(
      {},
      { folder: '', extra: { 'Export\\Skills.csv': 'Name\nPython' } },
    );

    expect((await readLinkedinArchive(bytes)).skills).toEqual(['Python']);
  });

  it('does not report directory entries as files it declined to open', async () => {
    const bytes = await buildLinkedinArchive(
      {},
      { folder: '', extra: { 'Export/': '', 'Export/Skills.csv': 'Name\nPython' } },
    );
    const { report } = await readLinkedinArchive(bytes);

    expect(report.skipped).toEqual([]);
  });

  it('skips an education row with no school name', async () => {
    const archive = await read({
      'Education.csv': 'School Name,Degree Name\n,BSc\nUnilag,BSc CS',
    });

    expect(archive.education.map((e) => e.institution)).toEqual(['Unilag']);
  });

  it('skips nameless projects, certifications and languages', async () => {
    const archive = await read({
      'Projects.csv': 'Title,Description\n,orphaned\nreal,a project',
      'Certifications.csv': 'Name,Authority\n,Amazon\nreal,Amazon',
      'Languages.csv': 'Name,Proficiency\n,Native\nIgbo,Native',
    });

    expect(archive.projects.map((p) => p.name)).toEqual(['real']);
    expect(archive.certifications.map((c) => c.name)).toEqual(['real']);
    expect(archive.languages.map((l) => l.name)).toEqual(['Igbo']);
  });
});

/** An archive whose `Skills.csv` understates itself by four orders of magnitude. */
async function bombArchive(): Promise<Uint8Array> {
  const { buildZip } = await import('@cairn/zip/testing');
  return buildZip([
    {
      name: `${ARCHIVE_FOLDER}Skills.csv`,
      data: new Uint8Array(600_000),
      declaredSize: 10,
    },
  ]);
}

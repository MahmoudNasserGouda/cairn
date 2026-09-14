/**
 * Synthetic LinkedIn data-export archives, built byte-for-byte.
 *
 * No real export is committed and no real person appears here — SECURITY.md keeps
 * imported document contents transient, and a fixture in the repository is the
 * opposite of transient. Amara Okonkwo is the same invented developer the CV fixtures
 * use, so a test can follow one person across two sources.
 *
 * The folder wrapper is deliberate: real archives arrive as
 * `Complete_LinkedInDataExport_<date>/Positions.csv`, and a reader that matches entry
 * names exactly would find nothing in one.
 */
import { buildZip, type ZipEntryInput } from '@cairn/zip/testing';

export const ARCHIVE_FOLDER = 'Complete_LinkedInDataExport_2026-09-14/';

/** The allowlisted files of a plausible export, as CSV text. */
export function sampleArchiveFiles(): Record<string, string> {
  return {
    'Profile.csv': [
      'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites',
      'Amara,Okonkwo,,,,"Backend engineer, payments","Ten years of ""boring"" infrastructure.\r\nMostly Python and Postgres.",Financial Services,,"Lagos, Nigeria",amaracodes,[PERSONAL:https://amara.dev/]',
    ].join('\r\n'),

    'Positions.csv': [
      'Company Name,Title,Description,Location,Started On,Finished On',
      '"Paystack","Backend Engineer","Built payment reconciliation in Python.\r\nCut nightly batch time by half.","Lagos, Nigeria","Mar 2021",',
      '"Andela","Data Analyst","Reporting pipeline in SQL.","Lagos, Nigeria","Jan 2019","Feb 2021"',
    ].join('\r\n'),

    'Education.csv': [
      'School Name,Start Date,End Date,Notes,Degree Name,Activities',
      '"University of Lagos","2014","2018",,"BSc Computer Science","Robotics club"',
    ].join('\r\n'),

    'Skills.csv': ['Name', 'Python', 'PostgreSQL', 'Docker', 'Leadership'].join('\r\n'),

    'Certifications.csv': [
      'Name,Url,Authority,Started On,Finished On,License Number',
      '"AWS Certified Solutions Architect","https://example.test/cert","Amazon Web Services","Jun 2022",,"ABC-123"',
    ].join('\r\n'),

    'Projects.csv': [
      'Title,Description,Url,Started On,Finished On',
      '"ledger-cli","A double-entry ledger in Go.","https://github.test/amara/ledger-cli","Jan 2023",',
    ].join('\r\n'),

    'Languages.csv': [
      'Name,Proficiency',
      'English,Native or bilingual proficiency',
      'Igbo,Native or bilingual proficiency',
    ].join('\r\n'),

    'Email Addresses.csv': [
      'Email Address,Confirmed,Primary,Updated On',
      'amara@example.test,Yes,Yes,"Jan 3, 2026"',
      'amara.okonkwo@work.example.test,Yes,No,"Jan 3, 2026"',
    ].join('\r\n'),
  };
}

/**
 * The third-party files ADR-0029 refuses to open.
 *
 * Their contents here are a **zip bomb**: 600 kB of zeroes declaring itself as ten,
 * which is past `ARCHIVE_ENTRY_MAX_BYTES` however the manifest is read. That turns
 * "we never read these" from a claim into something a test can observe — a reader
 * that opened one would blow its byte cap and fail the import.
 */
export function refusedArchiveFiles(): readonly string[] {
  return [
    'Connections.csv',
    'messages.csv',
    'Invitations.csv',
    'Contacts.csv',
    'Reactions.csv',
    'Comments.csv',
  ];
}

export interface ArchiveOptions {
  /** Prefix every entry with a wrapper folder, as a real export does. */
  readonly folder?: string;
  /** Add the refused third-party files, filled with a zip bomb. */
  readonly withRefusedFiles?: boolean;
  /** Extra entries, verbatim. */
  readonly extra?: Record<string, string>;
}

/** Assemble an archive from CSV text. */
export function buildLinkedinArchive(
  files: Record<string, string>,
  options: ArchiveOptions = {},
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const folder = options.folder ?? ARCHIVE_FOLDER;
  const entries: ZipEntryInput[] = Object.entries({
    ...files,
    ...(options.extra ?? {}),
  }).map(([name, text]) => ({ name: `${folder}${name}`, data: encoder.encode(text) }));

  if (options.withRefusedFiles) {
    for (const name of refusedArchiveFiles()) {
      entries.push({
        name: `${folder}${name}`,
        data: new Uint8Array(600_000),
        // A lying manifest, so the only thing that catches it is actually reading it.
        declaredSize: 10,
      });
    }
  }
  return buildZip(entries);
}

/** A complete, plausible archive: the eight read files plus the six refused ones. */
export function sampleLinkedinArchive(): Promise<Uint8Array> {
  return buildLinkedinArchive(sampleArchiveFiles(), { withRefusedFiles: true });
}

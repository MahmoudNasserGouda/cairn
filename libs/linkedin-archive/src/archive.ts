/**
 * Reading a LinkedIn data-export archive
 * ([ADR-0029](../../../docs/adr/0029-linkedin-data-export-archive-import.md)).
 *
 * Framework-free and offline: bytes in, a `LinkedinArchive` out. `apps/web` runs this
 * inside the same kind of sandboxed, terminate-on-timeout Web Worker a CV goes
 * through, and the result reaches the profile only after the user has reviewed it.
 *
 * ## The allowlist is the feature
 *
 * ADR-0029 refuses `Connections.csv`, `messages.csv`, `Invitations.csv`,
 * `Contacts.csv`, `Reactions.csv` and `Comments.csv` — other people's personal data,
 * in a product that builds a profile of one person. The refusal is structural rather
 * than a filter applied afterwards: `listZipEntries` says what the archive claims to
 * hold, the allowlist decides which of those names to open, and nothing else is ever
 * passed to `read`. There is no code path from a refused entry to an inflated buffer.
 *
 * That is why `libs/zip` grew an enumerate-then-read shape. "We listed the entries and
 * opened eight of them" is checkable; "we read everything and ignored most of it" is
 * not.
 */
import { openZip, type ZipArchive } from '@cairn/zip';
import { readCsvTable, type CsvRecord } from './csv';
import type {
  ArchiveReport,
  LinkedinArchive,
  LinkedinCertification,
  LinkedinEducation,
  LinkedinIdentity,
  LinkedinLanguage,
  LinkedinPosition,
  LinkedinProject,
} from './model';

/**
 * The files this reader opens, in the order it reports them.
 *
 * Names vary by archive vintage and locale, so they are matched case-insensitively
 * and by path suffix (`readLinkedinArchive`). A name that is absent produces an entry
 * in `report.missing`, never a failed import.
 */
export const READ_FILES = [
  'Profile.csv',
  'Positions.csv',
  'Education.csv',
  'Skills.csv',
  'Certifications.csv',
  'Projects.csv',
  'Languages.csv',
  'Email Addresses.csv',
] as const;

/**
 * Files this reader will not open, named so the refusal can be stated rather than
 * merely performed.
 *
 * Nothing in the code consults this list — an entry is skipped because it is not on
 * the allowlist, not because it is on this one. It exists so the UI can say what
 * Rujoom deliberately leaves alone, and so a reader of this file can see the intent
 * without reconstructing it from an absence.
 */
export const REFUSED_FILES = [
  'Connections.csv',
  'messages.csv',
  'Invitations.csv',
  'Contacts.csv',
  'Reactions.csv',
  'Comments.csv',
] as const;

/**
 * A real export contains dozens of files; some contain hundreds. The cap is a
 * sanity bound on a hostile manifest, not a limit anyone should reach.
 */
const MAX_ARCHIVE_ENTRIES = 4096;

/**
 * Per-file ceiling. The eight files above hold career facts, not media: a career of
 * several hundred roles is still tens of kilobytes. Half a megabyte is room to spare,
 * and it is what turns a lying manifest into a failed import rather than a hang.
 */
export const ARCHIVE_ENTRY_MAX_BYTES = 512 * 1024;

/** More than this from one file is not a career; it is an attempt to fill storage. */
const MAX_SECTION_ENTRIES = 200;
/** A role's description is a paragraph, not a document. */
const MAX_HIGHLIGHTS = 20;

const decoder = new TextDecoder('utf-8');

/**
 * Read the allowlisted files out of an archive.
 *
 * Throws `ZipError` when the container itself is malformed, over a limit, or lying
 * about an entry it was asked for — a hostile archive fails closed. A *missing* file
 * is not a failure and is reported in `report.missing`.
 */
export async function readLinkedinArchive(bytes: Uint8Array): Promise<LinkedinArchive> {
  const archive = openZip(bytes, { maxEntries: MAX_ARCHIVE_ENTRIES });

  // Decide what to open before opening anything.
  const chosen = new Map<string, string>();
  for (const wanted of READ_FILES) {
    const entry = archive.entries.find((e) => nameMatches(e.name, wanted));
    if (entry) chosen.set(wanted, entry.name);
  }
  const opened = new Set(chosen.values());

  const report: ArchiveReport = {
    read: READ_FILES.map((name) => chosen.get(name)).filter(
      (name): name is string => name !== undefined,
    ),
    missing: READ_FILES.filter((name) => !chosen.has(name)),
    skipped: archive.entries
      .map((e) => e.name)
      .filter((name) => !opened.has(name) && !isFolder(name)),
  };

  const text = async (file: (typeof READ_FILES)[number]): Promise<string> => {
    const entry = chosen.get(file);
    if (entry === undefined) return '';
    return readText(archive, entry);
  };

  const identity = readIdentity(await text('Profile.csv'));

  return {
    ...(identity ? { identity } : {}),
    positions: readPositions(await text('Positions.csv')),
    education: readEducation(await text('Education.csv')),
    skills: readSkills(await text('Skills.csv')),
    certifications: readCertifications(await text('Certifications.csv')),
    projects: readProjects(await text('Projects.csv')),
    languages: readLanguages(await text('Languages.csv')),
    emails: readEmails(await text('Email Addresses.csv')),
    report,
  };
}

async function readText(archive: ZipArchive, entry: string): Promise<string> {
  const bytes = await archive.read(entry, ARCHIVE_ENTRY_MAX_BYTES);
  // Non-fatal decoding: a stray byte degrades to U+FFFD rather than throwing away
  // an otherwise readable file.
  return bytes === undefined ? '' : decoder.decode(bytes);
}

/**
 * True when an entry is the allowlisted file, wherever the archive put it.
 *
 * Suffix-matched after a `/` — or at the root — so
 * `Complete_LinkedInDataExport_2026-09-14/Positions.csv` matches and
 * `MyPositions.csv` does not. Backslashes are folded to `/` because some archivers
 * write them.
 */
function nameMatches(entryName: string, allowed: string): boolean {
  const name = entryName.replaceAll('\\', '/').toLowerCase();
  const wanted = allowed.toLowerCase();
  return name === wanted || name.endsWith(`/${wanted}`);
}

/** Directory entries are zero-length markers, not files anyone declined to read. */
function isFolder(name: string): boolean {
  return name.endsWith('/');
}

// ---------------------------------------------------------------------------
// Per-file readers
// ---------------------------------------------------------------------------

function readIdentity(text: string): LinkedinIdentity | undefined {
  const [row] = readCsvTable(text, ['first name', 'last name', 'headline']);
  if (!row) return undefined;

  return {
    ...optional('firstName', row['first name']),
    ...optional('lastName', row['last name']),
    ...optional('headline', row['headline']),
    ...optional('summary', row['summary']),
    ...optional('location', row['geo location']),
    ...optional('industry', row['industry']),
    websites: httpUrls(row['websites'] ?? ''),
    twitterHandles: splitList(row['twitter handles'] ?? '').map((handle) =>
      handle.startsWith('@') ? handle.slice(1) : handle,
    ),
  };
}

function readPositions(text: string): LinkedinPosition[] {
  const rows = readCsvTable(text, ['company name', 'title', 'started on']);
  return capped(rows).flatMap((row): LinkedinPosition[] => {
    const title = row['title'] ?? '';
    const organization = row['company name'];
    if (title === '' && (organization ?? '') === '') return [];

    const startYear = yearFrom(row['started on']);
    const finished = yearFrom(row['finished on']);
    // LinkedIn leaves "Finished On" blank for a role you still hold. That is the
    // export's own convention, not a guess — and the review form is there for the
    // case where someone simply never filled it in.
    const endYear: number | 'present' | undefined =
      finished ?? (startYear !== undefined ? 'present' : undefined);

    return [
      {
        title: title === '' ? (organization ?? '') : title,
        ...optional('organization', organization),
        ...optional('location', row['location']),
        ...optional('startYear', startYear),
        ...optional('endYear', endYear),
        highlights: toHighlights(row['description'] ?? ''),
      },
    ];
  });
}

function readEducation(text: string): LinkedinEducation[] {
  const rows = readCsvTable(text, ['school name', 'degree name']);
  return capped(rows).flatMap((row): LinkedinEducation[] => {
    const institution = row['school name'] ?? '';
    if (institution === '') return [];
    return [
      {
        institution,
        ...optional('degree', row['degree name']),
        ...optional('startYear', yearFrom(row['start date'])),
        // A blank end date on a degree usually means "nobody filled it in", not
        // "still studying" — unlike a position, where blank is the convention for a
        // current role. Claiming `present` here would put "2014 – present" under
        // half the degrees in the world.
        ...optional('endYear', yearFrom(row['end date'])),
      },
    ];
  });
}

function readSkills(text: string): string[] {
  return capped(readCsvTable(text, ['name']))
    .map((row) => row['name'] ?? '')
    .filter((name) => name !== '');
}

function readCertifications(text: string): LinkedinCertification[] {
  const rows = readCsvTable(text, ['name', 'authority']);
  return capped(rows).flatMap((row): LinkedinCertification[] => {
    const name = row['name'] ?? '';
    if (name === '') return [];
    return [
      {
        name,
        ...optional('issuer', row['authority']),
        ...optional('year', yearFrom(row['started on'] ?? row['finished on'])),
        ...optional('url', httpUrls(row['url'] ?? '')[0]),
      },
    ];
  });
}

function readProjects(text: string): LinkedinProject[] {
  const rows = readCsvTable(text, ['title', 'description', 'url']);
  return capped(rows).flatMap((row): LinkedinProject[] => {
    const name = row['title'] ?? '';
    if (name === '') return [];
    return [
      {
        name,
        ...optional('description', row['description']),
        ...optional('url', httpUrls(row['url'] ?? '')[0]),
      },
    ];
  });
}

function readLanguages(text: string): LinkedinLanguage[] {
  const rows = readCsvTable(text, ['name', 'proficiency']);
  return capped(rows).flatMap((row): LinkedinLanguage[] => {
    const name = row['name'] ?? '';
    if (name === '') return [];
    return [{ name, ...optional('proficiency', row['proficiency']) }];
  });
}

function readEmails(text: string): string[] {
  const rows = capped(readCsvTable(text, ['email address']));
  const primary = (row: CsvRecord): boolean =>
    (row['primary'] ?? '').toLowerCase() === 'yes';

  return [...rows.filter(primary), ...rows.filter((row) => !primary(row))]
    .map((row) => row['email address'] ?? '')
    .filter((address) => address !== '');
}

// ---------------------------------------------------------------------------
// Field readers
//
// Every one of these is linear on its input. They read a file a stranger could have
// handed the user, and every ReDoS this project has shipped was on exactly that.
// ---------------------------------------------------------------------------

/** Fixed width, one alternation, nothing to backtrack into. */
const YEAR = /(?:19|20)\d{2}/;

/** The year in "Mar 2021", "2021", or "Jan 3, 2026". `undefined` when there is none. */
function yearFrom(value: string | undefined): number | undefined {
  const found = YEAR.exec(value ?? '');
  return found ? Number(found[0]) : undefined;
}

/** Markers a written list uses, stripped from the front of a line. */
const LEADING_MARKERS = new Set([' ', '\t', '•', '·', '◦', '–', '—', '-', '*']);

/**
 * A position's description, as the lines a CV would have called bullets.
 *
 * The markers are stripped with a character scan rather than `^[-*• ]+`. That
 * anchored form is in fact linear, but the project has shipped seven quadratic
 * regexes on document input, and a loop that obviously cannot backtrack costs
 * nothing to write.
 */
function toHighlights(description: string): string[] {
  const out: string[] = [];
  for (const line of description.split('\n')) {
    let at = 0;
    while (at < line.length && LEADING_MARKERS.has(line[at] as string)) at++;
    const text = line.slice(at).trim();
    if (text !== '') out.push(text);
    if (out.length === MAX_HIGHLIGHTS) break;
  }
  return out;
}

/** Where a URL stops: list punctuation, quoting, or whitespace. */
const URL_STOP = new Set([',', ']', '[', '"', "'", '<', '>', '|', ' ', '\t', '\n']);
/** Trailing punctuation that belongs to the sentence, not the address. */
const URL_TRIM = new Set(['.', ',', ';', ':', ')']);

/**
 * Every `http(s)` URL in a field, and nothing else.
 *
 * `Websites` arrives as `[PERSONAL:https://amara.dev/,BLOG:https://…]` — a label, a
 * colon, an address, in brackets. Rather than parse that shape (which varies), this
 * looks for the only thing worth keeping.
 *
 * Scheme-filtering here is the whole defence. These strings become `href`s, and an
 * archive is a file the user was emailed: `javascript:` in a `Websites` field is one
 * edit away in a text editor. Nothing downstream re-checks, so nothing else must
 * need to.
 */
function httpUrls(value: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (out.length < MAX_HIGHLIGHTS) {
    const start = firstScheme(value, at);
    if (start === -1) break;

    let end = start;
    while (end < value.length && !URL_STOP.has(value[end] as string)) end++;
    at = end;

    let stop = end;
    while (stop > start && URL_TRIM.has(value[stop - 1] as string)) stop--;
    const url = value.slice(start, stop);
    // "https://" on its own is a scheme, not an address.
    if (url.length > 'https://'.length) out.push(url);
  }
  return out;
}

function firstScheme(value: string, from: number): number {
  const http = value.indexOf('http://', from);
  const https = value.indexOf('https://', from);
  if (http === -1) return https;
  if (https === -1) return http;
  return Math.min(http, https);
}

/** A comma-separated field, trimmed and emptied of blanks. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .slice(0, MAX_SECTION_ENTRIES);
}

function capped(rows: readonly CsvRecord[]): readonly CsvRecord[] {
  return rows.slice(0, MAX_SECTION_ENTRIES);
}

/**
 * `{ key: value }` when there is a value, `{}` when there is not.
 *
 * `exactOptionalPropertyTypes` makes "absent" and "present but undefined" different
 * types, and the model means the first one.
 */
function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, V>);
}

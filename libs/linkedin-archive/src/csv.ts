/**
 * CSV reading for the LinkedIn data-export archive
 * ([ADR-0029](../../../docs/adr/0029-linkedin-data-export-archive-import.md)).
 *
 * Ours rather than a dependency, per
 * [ADR-0021](../../../docs/adr/0021-supply-chain-and-dependency-security.md): the
 * input is a file a stranger could have handed the user, and a parser for it is
 * small enough that owning it costs less than auditing someone else's.
 *
 * **Linear by construction.** The scanner is a single forward pass of `charCodeAt`
 * and `indexOf`, with no regular expression on it at all. The one pattern in the file
 * normalises line endings ahead of the scan and is `/\r\n?/g` — fixed width, one
 * optional character, nothing to backtrack into. Seven `js/polynomial-redos` findings
 * in this project have every one of them been on untrusted document input, and an
 * archive is untrusted document input.
 *
 * **These values never reach a spreadsheet.** ADR-0029's formula-injection rule bites
 * on the *export* side — a leading `=`, `+`, `-` or `@` is what a spreadsheet
 * evaluates, and Rujoom writes no CSV today. Stripping those characters on the way
 * *in* would be the wrong place for it: it would quietly rewrite "- Led the platform
 * team" into "Led the platform team" in someone's own career history, to defend
 * against a file format we do not emit. Values are carried through intact and reach
 * the DOM only through Angular interpolation, which escapes them.
 */

/** More rows than this in one file is not a career history. */
export const MAX_ROWS = 2000;
/** One field cannot become the whole profile. Generous for a LinkedIn description. */
export const MAX_FIELD_CHARS = 8192;

const QUOTE = 0x22; // "
const COMMA = 0x2c; // ,
const LF = 0x0a;
const BOM = 0xfeff;

/**
 * Split CSV text into rows of raw fields.
 *
 * Lenient on purpose. A truncated export — the file ends inside a quoted field — is
 * salvaged rather than refused, because a user whose archive lost its last row still
 * wants the other four hundred.
 */
export function parseCsv(text: string): string[][] {
  // Line endings are normalised once, up front, so the scanner has a single
  // terminator to reason about — inside a quoted field as well as between rows.
  const withoutBom = text.charCodeAt(0) === BOM ? text.slice(1) : text;
  const src = withoutBom.replace(/\r\n?/g, '\n');
  const length = src.length;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  /** A separator was consumed, so a field is owed even if the input ended. */
  let owed = false;

  while ((i < length || owed) && rows.length < MAX_ROWS) {
    owed = false;
    row.push(src.charCodeAt(i) === QUOTE ? readQuoted() : readBare());

    // Whatever ended the field: a separator, a line ending, or the end of input.
    const code = src.charCodeAt(i);
    if (code === COMMA) {
      i++;
      // `a,,` ends with an empty third field, not a second one. Without this the
      // last column of every trailing-comma row silently disappears.
      owed = true;
      continue;
    }
    if (code === LF) i++;
    rows.push(row);
    row = [];
  }
  // A field still in hand at the end of input is a row that had no line ending.
  if (row.length > 0 && rows.length < MAX_ROWS) rows.push(row);
  return rows;

  /** An unquoted field: everything up to the next comma or line ending. */
  function readBare(): string {
    const start = i;
    while (i < length) {
      const code = src.charCodeAt(i);
      if (code === COMMA || code === LF) break;
      i++;
    }
    return src.slice(start, Math.min(i, start + MAX_FIELD_CHARS));
  }

  /**
   * A quoted field: `""` is a literal quote, and a lone `"` closes it. Anything
   * between the closing quote and the next delimiter is discarded rather than
   * treated as more field, which is the only sane reading of `"a"x,b`.
   */
  function readQuoted(): string {
    i++;
    const parts: string[] = [];
    let taken = 0;
    let mark = i;

    const take = (chunk: string): void => {
      if (taken >= MAX_FIELD_CHARS) return;
      // Scanning continues past the cap; only the kept text stops growing, so a
      // 5 MB field costs one pass and not 5 MB of profile.
      parts.push(chunk.slice(0, MAX_FIELD_CHARS - taken));
      taken += chunk.length;
    };

    for (;;) {
      const at = src.indexOf('"', i);
      if (at === -1) {
        take(src.slice(mark));
        i = length;
        break;
      }
      if (src.charCodeAt(at + 1) === QUOTE) {
        // Keep one of the pair, skip the other.
        take(src.slice(mark, at + 1));
        i = at + 2;
        mark = i;
        continue;
      }
      take(src.slice(mark, at));
      i = at + 1;
      break;
    }

    while (i < length) {
      const code = src.charCodeAt(i);
      if (code === COMMA || code === LF) break;
      i++;
    }
    return parts.join('');
  }
}

/** One row, keyed by normalised column name. Every value is untrusted text. */
export type CsvRecord = Readonly<Record<string, string>>;

/**
 * Read a CSV into records keyed by column name.
 *
 * The header is found by looking for `expectedColumns` rather than by taking row one,
 * because some exports open with a note line. The obvious alternative — "a header is
 * a row with more than one cell" — is wrong for `Skills.csv`, which genuinely has one
 * column.
 *
 * A file whose columns we do not recognise contributes nothing. That is the honest
 * outcome for a translated or restructured export: guessing at a header would put
 * somebody's job description in the `degree` field.
 */
export function readCsvTable(
  text: string,
  expectedColumns: readonly string[],
): readonly CsvRecord[] {
  const rows = parseCsv(text);
  const wanted = new Set(expectedColumns.map(normalizeColumn));

  const headerAt = rows.findIndex((row) =>
    row.some((cell) => wanted.has(normalizeColumn(cell))),
  );
  if (headerAt === -1) return [];

  const columns = (rows[headerAt] ?? []).map(normalizeColumn);
  const records: CsvRecord[] = [];

  for (const row of rows.slice(headerAt + 1)) {
    if (row.every((cell) => cell.trim() === '')) continue;
    const record: Record<string, string> = {};
    for (const [at, column] of columns.entries()) {
      const value = (row[at] ?? '').trim();
      if (column !== '' && value !== '') record[column] = value;
    }
    if (Object.keys(record).length > 0) records.push(record);
  }
  return records;
}

function normalizeColumn(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

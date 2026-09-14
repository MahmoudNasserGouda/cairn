import { describe, expect, it } from 'vitest';
import { MAX_FIELD_CHARS, MAX_ROWS, parseCsv, readCsvTable } from './csv';

describe('parseCsv', () => {
  it('reads a plain table', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles CRLF, a BOM, and a trailing newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a quoted field containing commas, newlines and doubled quotes', () => {
    const rows = parseCsv('Title,Description\r\n"Eng","Built ""x"", then\r\ny, and z"');

    expect(rows[1]).toEqual(['Eng', 'Built "x", then\ny, and z']);
  });

  it('keeps empty fields rather than collapsing them', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('does not lose the last field when the file ends mid-quote', () => {
    // LinkedIn truncates the odd export. Salvaging the row beats refusing the file.
    expect(parseCsv('a,b\n"unterminated')).toEqual([['a', 'b'], ['unterminated']]);
  });

  it('caps a single field, so one entry cannot become the whole profile', () => {
    const rows = parseCsv(`h\n${'x'.repeat(MAX_FIELD_CHARS + 500)}`);

    expect(rows[1]?.[0]).toHaveLength(MAX_FIELD_CHARS);
  });

  it('caps the row count', () => {
    const rows = parseCsv(`h\n${'v\n'.repeat(MAX_ROWS + 100)}`);

    expect(rows).toHaveLength(MAX_ROWS);
  });

  /**
   * Character-by-character by construction, with no regex anywhere on the scanning
   * path. Seven `js/polynomial-redos` findings across this project have all been on
   * untrusted document input, and an archive is untrusted document input — so the
   * property is asserted rather than assumed.
   */
  it('stays linear on input built to be pathological', () => {
    const hostile = `h\n"${'"" '.repeat(60_000)}"`;
    const started = performance.now();
    const rows = parseCsv(hostile);
    const elapsed = performance.now() - started;

    expect(rows).toHaveLength(2);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('readCsvTable', () => {
  it('keys each row by its normalised column name', () => {
    const rows = readCsvTable('Company Name,Title\nPaystack,Engineer', ['company name']);

    expect(rows).toEqual([{ 'company name': 'Paystack', title: 'Engineer' }]);
  });

  /**
   * Some exports open with a note line above the header. Finding the header by the
   * columns we are looking for handles that without a "does this look like a header?"
   * guess — which would have broken `Skills.csv`, a genuinely single-column file.
   */
  it('skips a preamble note and finds the real header', () => {
    const text = [
      'Notes: "Your export is ready. Some fields may be blank."',
      'Company Name,Title',
      'Paystack,Engineer',
    ].join('\n');

    expect(readCsvTable(text, ['company name'])).toEqual([
      { 'company name': 'Paystack', title: 'Engineer' },
    ]);
  });

  it('reads a single-column file', () => {
    expect(readCsvTable('Name\nTypeScript\nDocker', ['name'])).toEqual([
      { name: 'TypeScript' },
      { name: 'Docker' },
    ]);
  });

  it('returns nothing when no row carries any expected column', () => {
    // A locale-translated or restructured export. "Nothing from this file" is the
    // honest answer; inventing a header would put garbage in someone's profile.
    expect(readCsvTable('Firma,Titel\nPaystack,Engineer', ['company name'])).toEqual([]);
  });

  it('tolerates rows shorter or longer than the header', () => {
    const rows = readCsvTable('Name,Proficiency\nYoruba\nIgbo,Native,extra', ['name']);

    expect(rows).toEqual([{ name: 'Yoruba' }, { name: 'Igbo', proficiency: 'Native' }]);
  });

  it('drops rows that are entirely empty', () => {
    expect(readCsvTable('Name\nTypeScript\n\n,\n', ['name'])).toEqual([
      { name: 'TypeScript' },
    ]);
  });
});

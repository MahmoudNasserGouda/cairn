/**
 * Turning what someone typed into what the model holds.
 *
 * Form values are strings; the profile holds numbers, `'present'`, and arrays. These
 * conversions are small, shared, and deliberately forgiving in one direction only:
 * they accept what a person would reasonably type, and they never invent a value that
 * was not there. A year field left blank stays absent rather than becoming `NaN` or
 * `0` — both of which would render as a date.
 */

/** Words people type to mean "I am still there". */
const PRESENT = new Set(['present', 'current', 'now', 'ongoing', 'today']);

/** A four-digit year in a plausible range, or nothing. */
export function toYear(value: string | undefined): number | undefined {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return undefined;
  // A career that began before 1900 or ends after 2100 is a typo, not a career.
  return parsed >= 1900 && parsed <= 2100 ? parsed : undefined;
}

/** A year, or `'present'` for an open-ended range. */
export function toEndYear(value: string | undefined): number | 'present' | undefined {
  const text = (value ?? '').trim().toLowerCase();
  if (text === '') return undefined;
  if (PRESENT.has(text)) return 'present';
  return toYear(value);
}

/** A textarea of bullet points: one per line, markers stripped, blanks dropped. */
export function toLines(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => stripMarker(line).trim())
    .filter((line) => line !== '')
    .slice(0, 20);
}

/** Markers someone pastes in from a CV, removed from the front of a line. */
const MARKERS = new Set([' ', '\t', '•', '·', '◦', '–', '—', '-', '*']);

function stripMarker(line: string): string {
  let at = 0;
  while (at < line.length && MARKERS.has(line[at] as string)) at++;
  return line.slice(at);
}

/** A trimmed value, or nothing — so an empty field is absent rather than `''`. */
export function toText(value: string | undefined): string | undefined {
  const text = (value ?? '').trim();
  return text === '' ? undefined : text;
}

/** How a year range is shown back in a form field. */
export function fromEndYear(value: number | 'present' | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * Only `http(s)` survives.
 *
 * These become `href`s, and the field accepts anything someone pastes — including,
 * eventually, something they were told to paste. The same rule the LinkedIn archive
 * reader applies to its `Websites` column, for the same reason.
 */
export function toHttpUrl(value: string | undefined): string | undefined {
  const text = (value ?? '').trim();
  if (text === '') return undefined;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `{ key: value }` or `{}`.
 *
 * `exactOptionalPropertyTypes` makes "absent" and "present but undefined" different
 * types, and every optional field in the profile model means the first one.
 */
export function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

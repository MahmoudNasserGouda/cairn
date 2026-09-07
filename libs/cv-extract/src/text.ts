/**
 * Shared text normalisation for extracted CV text. Extraction output is
 * untrusted (SECURITY.md T7), so control and zero-width characters are dropped
 * before the text reaches the parser or the review form — they carry no meaning
 * in a CV and are a classic way to smuggle look-alike content past a reader.
 *
 * Filtering by code point rather than a character-class literal keeps the source
 * itself free of the very bytes it strips.
 */

const TAB = 0x09;
const NEWLINE = 0x0a;
const SPACE = 0x20;
const DEL = 0x7f;
const C1_END = 0x9f;
const ZERO_WIDTH_START = 0x200b;
const ZERO_WIDTH_END = 0x200f;
const BOM = 0xfeff;

/** Strip C0/C1 controls and zero-width characters, keeping tab and newline. */
export function stripControlChars(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === TAB || code === NEWLINE) {
      out += char;
    } else if (code < SPACE || (code >= DEL && code <= C1_END)) {
      continue;
    } else if (code === BOM || (code >= ZERO_WIDTH_START && code <= ZERO_WIDTH_END)) {
      continue;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Collapse a document into tidy lines: normalise newlines, squeeze runs of
 * spaces and tabs, trim each line, and cap blank runs at one.
 */
export function normalizeLines(text: string): string {
  return stripControlChars(text.replace(/\r\n?/g, '\n'))
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

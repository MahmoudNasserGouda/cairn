/**
 * DOCX → plain text (ADR-0011). Reads exactly one part — `word/document.xml` —
 * out of the OOXML package and turns its runs into lines. `vbaProject.bin`,
 * embedded OLE objects and every other part are never touched, which is how
 * SECURITY.md T7's "never execute macros/embedded objects" is met: they are not
 * read at all, let alone interpreted.
 *
 * Tag handling is by regex, not DOMParser — a dedicated worker has no DOMParser
 * and neither does the Vitest node environment.
 */
import { normalizeLines } from './text';
import { readZipEntry, ZipError } from './zip';

const DOCUMENT_PART = 'word/document.xml';

/** Field codes (`HYPERLINK ...`) and tracked deletions are markup, not CV prose. */
const DROP_ELEMENTS = /<w:(instrText|delText|delInstrText)\b[^>]*>[\s\S]*?<\/w:\1>/g;
const TAB = /<w:tab\b[^>]*\/?>/g;
const BREAK = /<w:(?:br|cr)\b[^>]*\/?>/g;
/** A paragraph that ends a table cell must not also end the line. */
const PARAGRAPH_END_IN_CELL = /<\/w:p>(?=\s*<\/w:(?:tc|tr)>)/g;
const PARAGRAPH_END = /<\/w:p>/g;
const ROW_END = /<\/w:tr>/g;
const CELL_END = /<\/w:tc>/g;
/** Catch-all for whatever structural markup the named passes above don't name. */
const ANY_TAG = /<[^>]*>/g;

/**
 * Remove every `<...>` sequence, repeating until a pass makes no further
 * change. A single pass of a paired-tag regex can remove a tag in one shape
 * but leave a differently-shaped one behind it (the classic
 * `<scr<script>ipt>` reformation) — CodeQL's own recommendation for
 * `incomplete-multi-character-sanitization` is exactly this fixed-point loop,
 * since it removes tags as whole units (unlike stripping bracket characters
 * one at a time, which would also shred the surrounding `<w:p>` / `<w:t>`
 * structural markup this function depends on into literal leftover text).
 */
function stripAllTags(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = previous.replace(ANY_TAG, '');
  } while (current !== previous);
  return current;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match) => {
    const named = NAMED_ENTITIES[match.toLowerCase()];
    if (named !== undefined) return named;
    const numeric = /^&#x([0-9a-f]+);$/i.exec(match) ?? /^&#(\d+);$/.exec(match);
    if (!numeric) return match;
    const code = Number.parseInt(numeric[1]!, /^&#x/i.test(match) ? 16 : 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : '';
  });
}

/**
 * Turn `word/document.xml` markup into newline-separated plain text.
 *
 * Entities are decoded *before* tags are stripped, not after. CV text can
 * legitimately contain an entity-encoded angle bracket (someone's CV literally
 * mentioning `<script>`, which Word stores as `&lt;script&gt;`); decoding after
 * the strip would let that survive into the output as a live-looking tag. Since
 * `stripAllTags` runs after decoding here, anything that decodes into
 * tag-shaped text is caught by the same pass instead of slipping through.
 */
export function documentXmlToText(xml: string): string {
  const withBreaks = decodeEntities(xml)
    .replace(DROP_ELEMENTS, '')
    .replace(TAB, '\t')
    .replace(BREAK, '\n')
    .replace(PARAGRAPH_END_IN_CELL, '')
    .replace(CELL_END, '\t')
    .replace(ROW_END, '\n')
    .replace(PARAGRAPH_END, '\n');

  return normalizeLines(stripAllTags(withBreaks));
}

/**
 * Extract the visible text of a DOCX. Throws when the file is not a readable
 * OOXML package or trips a zip limit; returns `''` for a document with no runs.
 */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const part = await readZipEntry(bytes, DOCUMENT_PART);
  if (!part) {
    throw new ZipError(`not a Word document (no ${DOCUMENT_PART})`);
  }
  return documentXmlToText(new TextDecoder('utf-8').decode(part));
}

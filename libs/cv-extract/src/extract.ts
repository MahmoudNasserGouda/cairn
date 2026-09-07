/**
 * Format detection + dispatch for CV text extraction (ADR-0011). Framework-free
 * and offline: bytes in, plain text out. `apps/web` runs this inside a sandboxed
 * Web Worker under a size cap and a terminate-on-timeout budget (SECURITY.md T7);
 * `libs/profile`'s `parseCvText` then turns the text into structured fields.
 */
import { extractDocxText } from './docx';
import { extractPdfText } from './pdf';
import { normalizeLines } from './text';

export type CvFileKind = 'pdf' | 'docx' | 'text';

export interface ExtractedCv {
  readonly kind: CvFileKind;
  readonly text: string;
  /** PDFs only. */
  readonly pageCount?: number;
  /** Text was cut short by a page budget. */
  readonly truncated: boolean;
  /**
   * True when the file parsed but carries no usable text — the scanned /
   * image-only PDF case ADR-0011 sends to manual entry instead of OCR.
   */
  readonly empty: boolean;
}

export class UnsupportedCvFileError extends Error {}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const TEXT_EXTENSIONS = /\.(?:txt|md|markdown|text)$/i;

/** Fewer usable characters than this means "no text layer", not "a short CV". */
const MIN_USEFUL_CHARS = 24;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Identify the file by magic bytes first — a `.pdf` name on a zip, or a CV saved
 * with no extension at all, should both be handled by what the bytes actually
 * are. The filename is only consulted for plain text, which has no signature.
 */
export function detectKind(fileName: string, bytes: Uint8Array): CvFileKind {
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
  if (TEXT_EXTENSIONS.test(fileName)) return 'text';
  throw new UnsupportedCvFileError(
    'unsupported file — upload a PDF, a Word .docx, or a plain-text CV',
  );
}

function decodeText(bytes: Uint8Array): string {
  // Non-fatal decoding: a stray byte degrades to U+FFFD instead of throwing.
  return normalizeLines(new TextDecoder('utf-8').decode(bytes));
}

function isEmpty(text: string): boolean {
  return text.replace(/\s+/g, '').length < MIN_USEFUL_CHARS;
}

/** Extract plain text from a CV file. Never touches the network. */
export async function extractCvText(
  fileName: string,
  bytes: Uint8Array,
): Promise<ExtractedCv> {
  const kind = detectKind(fileName, bytes);

  if (kind === 'pdf') {
    const { text, pageCount, truncated } = await extractPdfText(bytes);
    return { kind, text, pageCount, truncated, empty: isEmpty(text) };
  }

  const text = kind === 'docx' ? await extractDocxText(bytes) : decodeText(bytes);
  return { kind, text, truncated: false, empty: isEmpty(text) };
}

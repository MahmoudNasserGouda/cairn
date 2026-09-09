/**
 * PDF → plain text (ADR-0011). Only the text layer is read: `getTextContent()`,
 * never `render()`. No canvas, no font faces, no WASM image codecs, and — since
 * pdf.js 6 — no `eval`/`new Function` anywhere in the library, which is what lets
 * it run under our `script-src 'self'` CSP (SECURITY.md non-negotiable 1).
 *
 * A scanned/image-only PDF has no text layer and yields `''`; the caller turns
 * that into the "try manual entry" guidance ADR-0011 calls for rather than
 * bundling an OCR engine.
 */
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Side-effect import: the worker module assigns `globalThis.pdfjsWorker`, which
// is the first place pdf.js looks for a parser. See `usePdfWorkerInProcess`.
// It ships no type declarations, hence no named import.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { normalizeLines } from './text';

/** CPU bound: a CV is a handful of pages, and this caps a hostile page count. */
export const MAX_PDF_PAGES = 30;

export interface PdfText {
  readonly text: string;
  /** Pages in the document, even when more than `MAX_PDF_PAGES` were read. */
  readonly pageCount: number;
  /** True when `pageCount` exceeded the page budget and text was cut short. */
  readonly truncated: boolean;
}

/**
 * Run pdf.js's parser in this same context instead of letting it spawn a worker
 * of its own. The caller (`apps/web`) already runs this inside a sandboxed worker
 * with a terminate-on-timeout budget, so a second one would buy nothing — and
 * both of pdf.js's own bootstrap paths are hostile to how we ship:
 *
 * - the real-worker path reads `window.location`, which does not exist inside a
 *   worker, and can wrap the script in a `blob:` URL that our CSP blocks;
 * - the fallback path does `await import(workerSrc)` on a runtime variable, which
 *   no bundler can resolve, so the chunk is never emitted.
 *
 * The static import above sidesteps both by registering the handler itself; this
 * guard turns a tree-shaken or reordered import into a clear failure rather than
 * a silent fall back to one of those two paths.
 */
function usePdfWorkerInProcess(): void {
  const globals = globalThis as { pdfjsWorker?: unknown };
  if (!globals.pdfjsWorker) {
    throw new Error('pdf.js did not register its in-process worker');
  }
}

function itemsToText(items: readonly (TextItem | { type: string })[]): string {
  let out = '';
  for (const item of items) {
    if (!('str' in item)) continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return out;
}

/** Extract the text layer of a PDF. Rejects if the file cannot be opened. */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  usePdfWorkerInProcess();

  const task = getDocument({
    // pdf.js takes ownership of and detaches the buffer it is handed.
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    // Errors only. Rendering-oriented warnings ("provide standardFontDataUrl")
    // are noise here: we read the text layer and never draw a glyph, and we
    // deliberately ship no font assets for pdf.js to fetch.
    verbosity: VerbosityLevel.ERRORS,
  });

  const doc = await task.promise;
  try {
    const pageCount = doc.numPages;
    const readable = Math.min(pageCount, MAX_PDF_PAGES);
    const pages: string[] = [];
    for (let n = 1; n <= readable; n++) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        pages.push(itemsToText(content.items));
      } finally {
        page.cleanup();
      }
    }
    return {
      text: normalizeLines(pages.join('\n')),
      pageCount,
      truncated: pageCount > readable,
    };
  } finally {
    // Destroying the loading task tears down the document and its worker.
    await task.destroy();
  }
}

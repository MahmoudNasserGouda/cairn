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

/**
 * One drawn run of text, with the geometry pdf.js reports alongside it.
 *
 * This is the whole point of the layout path. `itemsToText` above keeps `str` and
 * throws the rest away, which is why a two-column CV interleaves and a bullet loses
 * the role it belongs to — both are decidable from x, y and font, and both are
 * undecidable without them (ADR-0028).
 */
export interface PdfTextRun {
  readonly text: string;
  /** Points from the left edge of the page. */
  readonly x: number;
  /**
   * Points from the **top** of the page, increasing downward.
   *
   * PDF's own origin is the bottom-left, which means a run further down the page has
   * a *smaller* y. Every consumer wants reading order, so the axis is flipped once,
   * here, rather than in each of them.
   */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Rendered point size, taken from the text matrix rather than the `Tf` operand. */
  readonly fontSize: number;
  /**
   * pdf.js's internal font id for this run, e.g. `g_d0_f1`. Stable within one
   * document, and **the only weight signal available here**.
   *
   * pdf.js substitutes the standard fonts and reports every one of them as
   * `fontFamily: "sans-serif"` in `getTextContent().styles`, so "is this bold?"
   * cannot be answered from the text layer; the font objects that would say so
   * resolve only after `page.render()`, which we never call and do not want to.
   *
   * That turns out not to matter. What heading detection needs is not "this face
   * is named Bold" but "this run is set differently from the body" — and distinct
   * ids say exactly that, for embedded and oddly-named fonts too. `libs/doc-layout`
   * derives emphasis by taking the most common font as the body and treating the
   * rest as emphasised (ADR-0028).
   */
  readonly fontName: string;
  /** `true` when pdf.js considers the line to end after this run. */
  readonly endsLine: boolean;
}

export interface PdfPageLayout {
  /** 1-based, as the document numbers it. */
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly items: readonly PdfTextRun[];
}

export interface PdfLayout {
  readonly pages: readonly PdfPageLayout[];
  /** Pages in the document, even when more than `MAX_PDF_PAGES` were read. */
  readonly pageCount: number;
  readonly truncated: boolean;
}

/**
 * Extract the text layer **with its geometry**.
 *
 * Same document handling as `extractPdfText` — text layer only, no canvas, no font
 * assets, same page budget — so this adds information rather than risk.
 */
export async function extractPdfLayout(bytes: Uint8Array): Promise<PdfLayout> {
  usePdfWorkerInProcess();

  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    verbosity: VerbosityLevel.ERRORS,
  });

  const doc = await task.promise;
  try {
    const pageCount = doc.numPages;
    const readable = Math.min(pageCount, MAX_PDF_PAGES);
    const pages: PdfPageLayout[] = [];

    for (let n = 1; n <= readable; n++) {
      const page = await doc.getPage(n);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: PdfTextRun[] = [];

        for (const item of content.items) {
          if (!('str' in item)) continue;
          // transform is [a, b, c, d, e, f]: e/f are the translation and d the
          // vertical scale, which for unrotated text is the rendered point size.
          const [, , , scaleY, tx, ty] = item.transform as number[];
          const fontSize = Math.abs(scaleY ?? item.height ?? 0);
          // Blank runs carry no information and would only add noise to the
          // column and line clustering downstream.
          if (item.str.trim().length === 0) continue;
          items.push({
            text: item.str,
            x: tx ?? 0,
            y: viewport.height - (ty ?? 0),
            width: item.width,
            height: item.height,
            fontSize,
            fontName: item.fontName,
            endsLine: item.hasEOL,
          });
        }

        pages.push({
          pageNumber: n,
          width: viewport.width,
          height: viewport.height,
          items,
        });
      } finally {
        page.cleanup();
      }
    }

    return { pages, pageCount, truncated: pageCount > readable };
  } finally {
    await task.destroy();
  }
}

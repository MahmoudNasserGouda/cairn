import { Injectable, computed, signal } from '@angular/core';
import { parseCvText, type ParsedCv } from '@cairn/profile';
import { CV_MAX_BYTES, CV_PARSE_TIMEOUT_MS } from '@cairn/shared';
import {
  isCvExtractResponse,
  type CvExtractRequest,
  type CvExtractResponse,
} from './cv-worker-protocol';
import { createExtractionWorker } from './worker-url';

export type CvImportStatus = 'idle' | 'reading' | 'review' | 'error';

export interface CvDraft {
  readonly fileName: string;
  readonly parsed: ParsedCv;
  /**
   * The extracted plain text, kept only so the optional BYOK refinement pass has
   * something to send (ADR-0011). It lives in memory for as long as the review form is
   * open and goes no further: nothing persists it, and `reset()` drops it.
   */
  readonly text: string;
  /** Set when the file parsed but the page budget cut the text short. */
  readonly truncated: boolean;
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Drives one CV import: file → sandboxed worker → plain text → `parseCvText`
 * (ADR-0011). Nothing here writes to the profile — the draft it produces goes to
 * the review form first, and only a confirmed draft reaches `ProfileService`.
 *
 * The raw file bytes are held for the duration of a single call. The extracted text
 * outlives it by exactly one review — the AI refinement pass needs something to send —
 * and neither is ever persisted; SECURITY.md classes CV contents as transient.
 */
@Injectable({ providedIn: 'root' })
export class CvImportService {
  private readonly _status = signal<CvImportStatus>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _draft = signal<CvDraft | null>(null);

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly draft = this._draft.asReadonly();
  readonly busy = computed(() => this._status() === 'reading');

  readonly maxBytes = CV_MAX_BYTES;

  private nextId = 1;

  /** Clear the current draft and any error, back to the empty upload state. */
  reset(): void {
    this._draft.set(null);
    this._error.set(null);
    this._status.set('idle');
  }

  async import(file: File): Promise<void> {
    if (file.size > CV_MAX_BYTES) {
      this.fail(
        `that file is ${megabytes(file.size)} — the limit is ${megabytes(CV_MAX_BYTES)}`,
      );
      return;
    }

    this._error.set(null);
    this._draft.set(null);
    this._status.set('reading');

    try {
      const bytes = await file.arrayBuffer();
      const result = await this.extract(file.name, bytes);

      if (!result.ok) {
        this.fail(result.error);
        return;
      }
      if (result.empty) {
        this.fail(
          result.kind === 'pdf'
            ? 'no text found — this looks like a scanned PDF. Rujoom does not read images; ' +
                'export a text PDF from your editor, upload a .docx, or connect GitHub instead.'
            : 'that file has no readable text in it',
        );
        return;
      }

      this._draft.set({
        fileName: file.name,
        parsed: parseCvText(result.text),
        text: result.text,
        truncated: result.truncated,
      });
      this._status.set('review');
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'could not read that file');
    }
  }

  /**
   * Run one extraction in a throwaway worker. The worker is terminated on
   * success, on failure, and on timeout — that termination *is* the CPU budget
   * SECURITY.md T7 calls for, since a hostile file's whole point may be to spin
   * forever.
   */
  private extract(fileName: string, bytes: ArrayBuffer): Promise<CvExtractResponse> {
    const id = this.nextId++;
    const worker = createExtractionWorker();

    return new Promise<CvExtractResponse>((resolve) => {
      // `finish` only ever runs from an async callback, so `timer` is assigned
      // by the time it reads it.
      const finish = (response: CvExtractResponse): void => {
        clearTimeout(timer);
        worker.terminate();
        resolve(response);
      };

      const timer = setTimeout(() => {
        finish({
          id,
          ok: false,
          error: `reading that file took longer than ${CV_PARSE_TIMEOUT_MS / 1000}s — it may be corrupt`,
        });
      }, CV_PARSE_TIMEOUT_MS);

      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        // pdf.js posts its own handshake over this same port; ignore it.
        if (isCvExtractResponse(event.data, event)) finish(event.data);
      });
      worker.addEventListener('error', () => {
        finish({ id, ok: false, error: 'the file reader failed to start' });
      });

      const request: CvExtractRequest = { id, fileName, bytes };
      worker.postMessage(request, [bytes]);
    });
  }

  private fail(message: string): void {
    this._error.set(message);
    this._draft.set(null);
    this._status.set('error');
  }
}

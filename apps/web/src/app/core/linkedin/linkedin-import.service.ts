import { Injectable, computed, signal } from '@angular/core';
import type { LinkedinArchive } from '@cairn/linkedin-archive';
import { LINKEDIN_ARCHIVE_MAX_BYTES, LINKEDIN_PARSE_TIMEOUT_MS } from '@cairn/shared';
import {
  isLinkedinImportResponse,
  type LinkedinImportRequest,
  type LinkedinImportResponse,
} from './linkedin-worker-protocol';
import { createArchiveWorker } from './worker-url';

export type LinkedinImportStatus = 'idle' | 'reading' | 'review' | 'error';

export interface LinkedinDraft {
  readonly fileName: string;
  readonly archive: LinkedinArchive;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Drives one LinkedIn archive import: file → sandboxed worker → `LinkedinArchive`
 * (ADR-0029). Nothing here writes to the profile — the draft it produces goes to the
 * review step first, and only a confirmed draft reaches `ProfileService`.
 *
 * The raw bytes are held for the duration of a single call and transferred into the
 * worker rather than copied. The archive itself is never persisted; SECURITY.md
 * classes imported document contents as transient, and only the reviewed fields
 * survive the session.
 *
 * This is deliberately the same shape as `CvImportService`. Two importers that behave
 * differently would be two sets of failure modes to learn, and ADR-0029's whole
 * argument for the archive over the DMA API was that it is the flow we already have.
 */
@Injectable({ providedIn: 'root' })
export class LinkedinImportService {
  private readonly _status = signal<LinkedinImportStatus>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _draft = signal<LinkedinDraft | null>(null);

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly draft = this._draft.asReadonly();
  readonly busy = computed(() => this._status() === 'reading');

  readonly maxBytes = LINKEDIN_ARCHIVE_MAX_BYTES;

  private nextId = 1;

  /** Clear the current draft and any error, back to the empty upload state. */
  reset(): void {
    this._draft.set(null);
    this._error.set(null);
    this._status.set('idle');
  }

  async import(file: File): Promise<void> {
    if (file.size > LINKEDIN_ARCHIVE_MAX_BYTES) {
      this.fail(
        `that archive is ${megabytes(file.size)} — the limit is ` +
          `${megabytes(LINKEDIN_ARCHIVE_MAX_BYTES)}`,
      );
      return;
    }

    this._error.set(null);
    this._draft.set(null);
    this._status.set('reading');

    try {
      const bytes = await file.arrayBuffer();
      if (!isZip(bytes)) {
        // By far the likeliest wrong file is the CV from the control next to this
        // one. "Not a zip archive" would be true and useless.
        this.fail(
          'that is not a .zip — LinkedIn emails you one from Settings & Privacy → ' +
            'Data Privacy → Get a copy of your data',
        );
        return;
      }

      const result = await this.read(file.name, bytes);
      if (!result.ok) {
        this.fail(result.error);
        return;
      }
      if (result.archive.report.read.length === 0) {
        // A ZIP that parsed but held nothing we read. An empty review form with an
        // "Add to my profile" button under it would be a worse answer than this.
        this.fail(
          'none of the files Rujoom reads were in that archive — make sure it is the ' +
            'ZIP LinkedIn sent you, unpacked from no other folder',
        );
        return;
      }

      this._draft.set({ fileName: file.name, archive: result.archive });
      this._status.set('review');
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'could not read that archive');
    }
  }

  /**
   * Run one read in a throwaway worker. The worker is terminated on success, on
   * failure, and on timeout — that termination *is* the CPU budget SECURITY.md T7
   * calls for, since a hostile archive's whole point may be to spin forever.
   */
  private read(fileName: string, bytes: ArrayBuffer): Promise<LinkedinImportResponse> {
    const id = this.nextId++;
    const worker = createArchiveWorker();

    return new Promise<LinkedinImportResponse>((resolve) => {
      // `finish` only ever runs from an async callback, so `timer` is assigned by
      // the time it reads it.
      const finish = (response: LinkedinImportResponse): void => {
        clearTimeout(timer);
        worker.terminate();
        resolve(response);
      };

      const timer = setTimeout(() => {
        finish({
          id,
          ok: false,
          error:
            `reading that archive took longer than ` +
            `${LINKEDIN_PARSE_TIMEOUT_MS / 1000}s — it may be corrupt`,
        });
      }, LINKEDIN_PARSE_TIMEOUT_MS);

      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (isLinkedinImportResponse(event.data, event)) finish(event.data);
      });
      worker.addEventListener('error', () => {
        finish({ id, ok: false, error: 'the archive reader failed to start' });
      });

      const request: LinkedinImportRequest = { id, fileName, bytes };
      worker.postMessage(request, [bytes]);
    });
  }

  private fail(message: string): void {
    this._error.set(message);
    this._draft.set(null);
    this._status.set('error');
  }
}

/**
 * Check the magic bytes rather than the extension.
 *
 * A `.zip` name on a PDF and an archive the user renamed should both be handled by
 * what the file actually is — the same rule `detectKind` follows for CVs.
 */
function isZip(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  return ZIP_MAGIC.every((byte, at) => head[at] === byte);
}

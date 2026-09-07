/// <reference lib="webworker" />
import { extractCvText } from '@cairn/cv-extract';
import { isCvExtractRequest, type CvExtractResponse } from './cv-worker-protocol';

/**
 * The sandbox for CV text extraction (ADR-0011, SECURITY.md T7). A hostile PDF or
 * zip-bombed DOCX gets no DOM, no credentials, and no network here, and the
 * service that spawned this worker terminates it on a timeout. One worker per
 * import, so a wedged parse cannot affect the next one.
 *
 * This file is glue only — every parsing decision lives in `@cairn/cv-extract`,
 * where Vitest can cover it. pdf.js parses in here too, in-process: this worker
 * is already the sandbox, so it needs no worker of its own. It does share this
 * worker's message port, hence the guard (see `cv-worker-protocol`).
 */

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'could not read that file';
}

addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isCvExtractRequest(event.data)) return;
  const { id, fileName, bytes } = event.data;

  void extractCvText(fileName, new Uint8Array(bytes))
    .then((result): CvExtractResponse => ({ id, ok: true, ...result }))
    .catch((error: unknown): CvExtractResponse => {
      return { id, ok: false, error: message(error) };
    })
    .then((response) => {
      postMessage(response);
    });
});

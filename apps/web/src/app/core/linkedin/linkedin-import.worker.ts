/// <reference lib="webworker" />
import { readLinkedinArchive } from '@cairn/linkedin-archive';
import {
  isLinkedinImportRequest,
  type LinkedinImportResponse,
} from './linkedin-worker-protocol';

/**
 * The sandbox for LinkedIn archive reading (ADR-0029, SECURITY.md T7). A zip-bombed
 * or malformed archive gets no DOM, no credentials, and no network here, and the
 * service that spawned this worker terminates it on a timeout. One worker per import,
 * so a wedged parse cannot affect the next one.
 *
 * This file is glue only — every parsing decision lives in `@cairn/linkedin-archive`,
 * where Vitest can cover it, including the allowlist that is the whole point.
 */

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'could not read that archive';
}

addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isLinkedinImportRequest(event.data, event)) return;
  const { id, bytes } = event.data;

  void readLinkedinArchive(new Uint8Array(bytes))
    .then((archive): LinkedinImportResponse => ({ id, ok: true, archive }))
    .catch((error: unknown): LinkedinImportResponse => {
      return { id, ok: false, error: message(error) };
    })
    .then((response) => {
      postMessage(response);
    });
});

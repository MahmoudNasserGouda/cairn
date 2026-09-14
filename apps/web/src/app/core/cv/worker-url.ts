/**
 * Creates the CV extraction worker, past Trusted Types.
 *
 * The policy itself — and the reasoning behind it — lives in
 * [`core/worker-policy`](../worker-policy.ts), because a document may hold only one
 * `default` policy and every worker in the app has to share it. All that is left here
 * is the `new Worker(new URL(…))` literal, which must stay inline for the bundler to
 * emit the worker as a chunk.
 */
import { createWorker } from '../worker-policy';

/** A fresh, single-use extraction worker. The caller must terminate it. */
export function createExtractionWorker(): Worker {
  return createWorker(
    () => new Worker(new URL('./cv-extract.worker', import.meta.url), { type: 'module' }),
  );
}

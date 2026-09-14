/**
 * Creates the LinkedIn archive worker, past Trusted Types.
 *
 * The policy lives in [`core/worker-policy`](../worker-policy.ts) and is shared with
 * the CV worker — a document may hold only one `default` policy, so a second copy of
 * that code here would have silently blocked this worker in production. All that is
 * left is the `new Worker(new URL(…))` literal, which must stay inline for the
 * bundler to emit the worker as its own chunk.
 */
import { createWorker } from '../worker-policy';

/** A fresh, single-use archive worker. The caller must terminate it. */
export function createArchiveWorker(): Worker {
  return createWorker(
    () =>
      new Worker(new URL('./linkedin-import.worker', import.meta.url), {
        type: 'module',
      }),
  );
}

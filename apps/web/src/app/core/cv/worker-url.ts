/**
 * Creates the CV extraction worker, past Trusted Types.
 *
 * Two constraints meet here and neither bends:
 *
 * - The build only emits the worker as a chunk when it sees the literal
 *   `new Worker(new URL('./…', import.meta.url))`. Hoisting the URL into a
 *   variable silently drops the chunk, so the expression must stay inline.
 * - Our CSP sets `require-trusted-types-for 'script'` (ADR-0019), which makes
 *   the `Worker` constructor a `TrustedScriptURL` sink in Chromium. A plain
 *   `URL` argument throws, and Angular's own policies do not cover this sink.
 *
 * The only way to satisfy both is a **default** policy: when a sink is handed an
 * untrusted value the browser routes it through `default.createScriptURL`, which
 * lets the literal above stay exactly as the bundler needs it.
 *
 * cairn-security-reviewed: the default policy is not a rubber stamp. It rejects
 * every script URL unless it is same-origin *and* arrives during the one
 * synchronous `new Worker` call below, which `armed` brackets — so it cannot be
 * reached by any other sink, in this app or in a compromised dependency.
 * Installing it does not weaken anything: without it, every one of those sinks
 * was already blocked outright. No `trusted-types` directive is set, so naming a
 * policy `default` is permitted; browsers without Trusted Types skip all of this
 * and get the plain URL.
 */

interface TrustedTypesApi {
  createPolicy(name: string, rules: { createScriptURL(value: string): string }): unknown;
}

let installed = false;
let armed = false;

function installGuard(): void {
  if (installed) return;
  installed = true;

  const trustedTypes = (globalThis as { trustedTypes?: TrustedTypesApi }).trustedTypes;
  if (!trustedTypes) return;

  try {
    trustedTypes.createPolicy('default', {
      createScriptURL: (value: string): string => {
        if (armed && new URL(value, location.href).origin === location.origin) {
          return value;
        }
        throw new Error(`blocked script URL: ${value}`);
      },
    });
  } catch {
    // Only one `default` policy may exist per document. If something else — a future
    // Angular version, a dependency — installed one first, `createPolicy` throws.
    // Swallowing it lets `new Worker` proceed and be judged by *that* policy, which
    // either permits the same-origin chunk or blocks it. Letting the throw escape
    // would fail every CV import with "could not read that file" and hide the cause.
  }
}

/** A fresh, single-use extraction worker. The caller must terminate it. */
export function createExtractionWorker(): Worker {
  installGuard();
  armed = true;
  try {
    return new Worker(new URL('./cv-extract.worker', import.meta.url), {
      type: 'module',
    });
  } finally {
    armed = false;
  }
}

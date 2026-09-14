import type { LinkedinArchive } from '@cairn/linkedin-archive';

/**
 * Message contract between `LinkedinImportService` and the sandboxed archive worker
 * (ADR-0029). Plain data only, so both sides structured-clone cleanly.
 *
 * The archive crosses this boundary as the reader produced it — strings, numbers and
 * arrays, no classes. Nothing about the *file* crosses: the bytes are transferred in,
 * and what comes back is the eight files' worth of career facts and the report of what
 * was left unopened.
 */

export interface LinkedinImportRequest {
  readonly id: number;
  readonly fileName: string;
  /** Transferred, not copied — the service hands over ownership. */
  readonly bytes: ArrayBuffer;
}

export interface LinkedinImportSuccess {
  readonly id: number;
  readonly ok: true;
  readonly archive: LinkedinArchive;
}

export interface LinkedinImportFailure {
  readonly id: number;
  readonly ok: false;
  /** Already a user-facing sentence; never a stack trace. */
  readonly error: string;
}

export type LinkedinImportResponse = LinkedinImportSuccess | LinkedinImportFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A dedicated Worker's message channel is private to the single script that
 * constructed it — no other page, frame, or origin ever holds a reference to
 * `postMessage` into it, so there is no cross-origin sender to distinguish from a
 * legitimate one (unlike `Window.postMessage`, which any page can target). A
 * dedicated worker's `MessageEvent.origin` is always the empty string, in every
 * engine, so a same-origin check against `self.location.origin` would reject every
 * legitimate message.
 *
 * Rather than skip the check, this asserts the one invariant that *does* hold —
 * `origin === ''` is the entire population of messages a dedicated worker can receive
 * — so a future engine change, or this worker being reused in a way that breaks the
 * invariant, fails loudly instead of silently.
 */
function isSameContextMessage(event: MessageEvent<unknown>): boolean {
  return event.origin === '';
}

export function isLinkedinImportRequest(
  value: unknown,
  event?: MessageEvent<unknown>,
): value is LinkedinImportRequest {
  return (
    (!event || isSameContextMessage(event)) &&
    isRecord(value) &&
    typeof value['id'] === 'number' &&
    typeof value['fileName'] === 'string' &&
    value['bytes'] instanceof ArrayBuffer
  );
}

export function isLinkedinImportResponse(
  value: unknown,
  event?: MessageEvent<unknown>,
): value is LinkedinImportResponse {
  return (
    (!event || isSameContextMessage(event)) &&
    isRecord(value) &&
    typeof value['id'] === 'number' &&
    typeof value['ok'] === 'boolean'
  );
}

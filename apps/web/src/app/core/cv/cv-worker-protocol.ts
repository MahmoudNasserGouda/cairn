import type { CvFileKind } from '@cairn/cv-extract';

/**
 * Message contract between `CvImportService` and the sandboxed extraction
 * worker. Plain data only, so both sides structured-clone cleanly.
 *
 * The worker's `self` port is **shared**: importing pdf.js's parser runs a static
 * block that binds `WorkerMessageHandler` to `self` and immediately posts its own
 * `ready` handshake. That traffic is addressed with `{sourceName, targetName,
 * action}` and is none of our business — pdf.js ignores anything not addressed to
 * it, and the guards below let us do the same. Without them the first thing the
 * service sees is pdf.js's handshake, not our result.
 */

export interface CvExtractRequest {
  readonly id: number;
  readonly fileName: string;
  /** Transferred, not copied — the service hands over ownership. */
  readonly bytes: ArrayBuffer;
}

export interface CvExtractSuccess {
  readonly id: number;
  readonly ok: true;
  readonly kind: CvFileKind;
  readonly text: string;
  readonly pageCount?: number;
  readonly truncated: boolean;
  readonly empty: boolean;
}

export interface CvExtractFailure {
  readonly id: number;
  readonly ok: false;
  /** Already a user-facing sentence; never a stack trace. */
  readonly error: string;
}

export type CvExtractResponse = CvExtractSuccess | CvExtractFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A dedicated Worker's message channel is private to the single script that
 * constructed it — no other page, frame, or origin ever holds a reference to
 * `postMessage` into it, so there is no cross-origin sender to distinguish from
 * a legitimate one (unlike `Window.postMessage`, which any page can target).
 * Verified empirically: a dedicated worker's `MessageEvent.origin` is always the
 * empty string, for messages posted by its own creator, in every engine — it is
 * not the creator's origin. A same-origin check against `self.location.origin`
 * would therefore reject every legitimate message.
 *
 * Rather than skip the check, this asserts the one invariant that *does* hold —
 * `origin === ''` is the entire population of messages a dedicated worker can
 * receive — so a future engine change or a worker reused in a way that breaks
 * that invariant fails loudly instead of silently.
 */
function isSameContextMessage(event: MessageEvent<unknown>): boolean {
  return event.origin === '';
}

/** True only for a message this worker protocol sent, not pdf.js's own. */
export function isCvExtractRequest(
  value: unknown,
  event?: MessageEvent<unknown>,
): value is CvExtractRequest {
  return (
    (!event || isSameContextMessage(event)) &&
    isRecord(value) &&
    typeof value['id'] === 'number' &&
    typeof value['fileName'] === 'string' &&
    value['bytes'] instanceof ArrayBuffer
  );
}

/** True only for a reply from our worker, not pdf.js's `ready` handshake. */
export function isCvExtractResponse(
  value: unknown,
  event?: MessageEvent<unknown>,
): value is CvExtractResponse {
  return (
    (!event || isSameContextMessage(event)) &&
    isRecord(value) &&
    typeof value['id'] === 'number' &&
    typeof value['ok'] === 'boolean'
  );
}

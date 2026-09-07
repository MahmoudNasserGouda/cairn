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

/** True only for a message this worker protocol sent, not pdf.js's own. */
export function isCvExtractRequest(value: unknown): value is CvExtractRequest {
  return (
    isRecord(value) &&
    typeof value['id'] === 'number' &&
    typeof value['fileName'] === 'string' &&
    value['bytes'] instanceof ArrayBuffer
  );
}

/** True only for a reply from our worker, not pdf.js's `ready` handshake. */
export function isCvExtractResponse(value: unknown): value is CvExtractResponse {
  return (
    isRecord(value) && typeof value['id'] === 'number' && typeof value['ok'] === 'boolean'
  );
}

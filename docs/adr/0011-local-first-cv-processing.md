# 0011. Local-first CV processing

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

Phase 1 accepts a CV upload (PDF/DOCX) as a skill source. The spec prefers local-first
processing: file → browser → local text extraction → profile parser → unified profile.
AI-based CV interpretation is an optional BYOK enhancement; basic extraction must not
require paid AI.

## Decision

CV processing runs **entirely in the browser**:

- **Text extraction** in a Web Worker using client-side libraries (PDF text layer
  extraction; DOCX unzip + XML text). No file bytes leave the device.
- **Parsing** by a deterministic profile parser in `libs/profile` — section detection,
  skills/technologies keyword matching against a curated taxonomy, date-range → years of
  experience heuristics.
- **Optional AI pass** ([ADR-0009](0009-byok-ai-optional-enhancement.md)): if the user
  has a key, they may run an AI extraction that proposes structured fields for review.
  The disclosure panel ([ADR-0010](0010-ai-key-privacy-and-data-disclosure.md)) shows
  that the CV text will be sent to their provider.
- **User review** — all parsed fields land in an editable form; nothing is committed to
  the profile without confirmation.

Safety limits (file size cap, worker timeout, no macro/embedded-object execution) are in
[SECURITY.md](../../SECURITY.md).

## Consequences

- Parser quality for messy real-world CVs will be imperfect; the mandatory review step
  absorbs that.
- Scanned/image-only PDFs yield no text; the UI detects this and points the user to
  manual entry or GitHub analysis instead of bundling an OCR engine.
- The skills taxonomy is a shared asset also used by matching
  ([ADR-0007](0007-deterministic-explainable-matching-engine.md)) and must be versioned.

## Alternatives considered

- **Server-side parsing service.** Rejected: uploading CVs (PII) to an Rujoom server
  violates [ADR-0001](0001-local-first-zero-cost-architecture.md) and adds cost and
  liability.
- **Mandatory AI extraction.** Rejected: the spec requires a working no-paid-AI path.
- **Bundle a WASM OCR engine.** Deferred: large payload for a minority of inputs.

## Implementation notes

Added 2026-09-07, when the flow was built. The decision above is unchanged; these are
the choices it left open, recorded because each was constrained by a rule elsewhere.

- **PDF: `pdfjs-dist` (Apache-2.0).** The only credible client-side PDF text extractor.
  Pinned at `^6.3.289`: every 5.x we could have taken carries GHSA-hq66-cqwq-w95j
  ("arbitrary JavaScript execution upon opening a malicious PDF"), which is threat T7
  itself. pdf.js 6 also dropped its last `eval`/`new Function` use, so it runs under
  `script-src 'self'` unmodified. We use the **legacy** build: the modern one assumes
  `Uint8Array.prototype.toHex`, which neither Node 22 nor most current browsers have.
  Only `getTextContent()` is called — no canvas, no font assets, no WASM image codecs.
- **DOCX: our own ZIP reader**, ~150 lines over `DecompressionStream('deflate-raw')`,
  rather than a zip dependency ([ADR-0021](0021-supply-chain-and-dependency-security.md)).
  It reads exactly one part, `word/document.xml`, so `vbaProject.bin` and embedded OLE
  objects are never even decompressed, and the zip-bomb limits are ours to enforce: an
  entry cap, a declared-size check, and a running byte cap that aborts mid-inflate when
  the header lies.
- **Extraction logic lives in `libs/cv-extract`**, not in `apps/web`. It still *runs* in
  the worker, but Vitest only covers `libs/**`, so the app's worker is a ~30-line shim.
- **pdf.js parses in-process inside our worker** rather than spawning one of its own.
  Its real-worker path reads `window.location` (absent in a worker) and can fall back to
  a `blob:` URL that our CSP blocks; its fake-worker path does `await import(runtimeVar)`,
  which no bundler can resolve. A static import of the worker module registers
  `globalThis.pdfjsWorker` and sidesteps both. The cost is that pdf.js binds itself to the
  worker's `self` port and posts its own handshake, so our protocol is guarded by a
  message type check on both ends.
- **A Trusted Types policy is required.** `require-trusted-types-for 'script'`
  ([ADR-0019](0019-security-first-rendering.md)) makes the `Worker` constructor a
  `TrustedScriptURL` sink, and the build only emits the worker chunk for a literal
  `new Worker(new URL(…, import.meta.url))` — so the URL cannot be hoisted and wrapped.
  `apps/web/src/app/core/cv/worker-url.ts` installs a `default` policy that admits a
  script URL only when it is same-origin *and* arrives inside that one synchronous call.

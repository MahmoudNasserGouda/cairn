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

- **Server-side parsing service.** Rejected: uploading CVs (PII) to an OSC server
  violates [ADR-0001](0001-local-first-zero-cost-architecture.md) and adds cost and
  liability.
- **Mandatory AI extraction.** Rejected: the spec requires a working no-paid-AI path.
- **Bundle a WASM OCR engine.** Deferred: large payload for a minority of inputs.

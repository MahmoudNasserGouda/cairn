# 0028. Client-side OCR and document vision in an isolated CSP sandbox

- Status: Accepted
- Date: 2026-09-13
- Deciders: Project owner
- Supersedes the OCR deferral in [ADR-0011](0011-local-first-cv-processing.md)
- Constrained by: [ADR-0019](0019-security-first-rendering.md),
  [ADR-0021](0021-supply-chain-and-dependency-security.md)

## Context

[ADR-0011](0011-local-first-cv-processing.md) deferred OCR — "Bundle a WASM OCR engine.
Deferred: large payload for a minority of inputs" — and sent scanned CVs to manual entry.
Two things have changed.

**The CV path is now a headline feature, and it reads badly.** `extractPdfText` keeps
`item.str` and `item.hasEOL` from pdf.js and discards the coordinates, font name and
size that come with every text run. Two-column CVs interleave, bullets detach from their
role, and sections are recognised by matching against a nine-word list. A scanned CV
yields nothing at all. The project owner asked for "good OCR and computer vision"; the
deferral is the thing standing in the way.

**Every credible client-side OCR engine is WebAssembly.** PP-OCRv5 through ONNX Runtime
Web is the current best (Tesseract.js trails it by 5–15 character points on modern
documents and has no WebGPU path). Both are WASM, and a browser under `script-src 'self'`
**refuses to compile WebAssembly** unless `'wasm-unsafe-eval'` is present.

That collides head-on with [SECURITY.md](../../SECURITY.md) non-negotiable 1, which bans
`unsafe-eval`-family keywords in script directives, and with `scripts/check-csp.mjs:38`,
which fails the build on `'wasm-unsafe-eval'` by name. The collision is real: the app
origin holds the user's **GitHub OAuth token** and **BYOK AI key**, which is precisely the
origin where new code-generation capability is least welcome.

The question is therefore not "OCR or security" but **where the WASM runs**.

## Decision

OCR runs in an **isolated document that holds nothing worth stealing**, not on the
application origin.

### 1. Document vision first, and it needs no WASM at all

`libs/cv-extract` stops discarding geometry. `extractPdfLayout()` returns positioned text
runs — `str`, x/y/width/height derived from `item.transform`, rendered point size, and
the font id — and a new pure library `libs/doc-layout` turns those into lines, columns,
blocks, reading order, headings (by size and face, not by keyword), bullets and date
columns.

One correction found while building the fixtures, recorded because it shaped the design:
**pdf.js cannot tell us a run is bold.** It substitutes the standard fonts and reports
every one of them as `fontFamily: "sans-serif"`, and the font objects that carry the real
name resolve only after `page.render()` — which this path deliberately never calls. What
it does report is a stable per-face id, and that is the better signal anyway: heading
detection needs "this run is set differently from the body", not "this face is named
Bold", and font ids answer that for embedded and oddly-named fonts too. `libs/doc-layout`
takes the most common face as the body and treats the rest as emphasis.

This is the larger share of the quality win, it applies to every digital PDF, it adds no
dependency, and it is testable as pure functions. **It ships independently of OCR and is
not gated on anything in this ADR.** OCR is only for documents with no text layer.

### 2. OCR runs in a sandboxed, opaque-origin document

- The engine lives at **`/ocr/`** — its own HTML document, its own bundle, embedded by
  the app as `<iframe sandbox="allow-scripts">`. Without `allow-same-origin` the frame
  gets an **opaque origin**: it cannot read the app's `sessionStorage`, IndexedDB,
  `secrets` store, GitHub token or BYOK key, and it has no ambient authority of any kind.
- The protocol is `postMessage`: image bytes in, recognised text and boxes out. The frame
  is created for an import and torn down after it.
- `apps/web/public/_headers` gives `/ocr/*` its **own CSP**:
  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; img-src blob: data:;
  style-src 'unsafe-inline'; frame-ancestors 'self'`. The application's `/*` CSP is
  **unchanged** — non-negotiable 1 continues to hold for the origin that holds secrets.
- The sandbox has **no network egress**. Its `connect-src` admits only the origin serving
  its own model and WASM assets, and nothing else. A compromised OCR engine has no
  channel to exfiltrate on even if it had something to exfiltrate.
- Page rasterisation (pdf.js `render()` to an `OffscreenCanvas`) happens **inside** the
  sandbox. The app origin keeps its text-layer-only posture and still never draws a glyph.

### 3. The guard enforces the boundary rather than being relaxed

`scripts/check-csp.mjs` is **strengthened**, not loosened. It learns to read `_headers`
per path block and then asserts:

- `'wasm-unsafe-eval'` in the `/*` application block is a **hard failure**, as today;
- it is permitted **only** in the `/ocr/*` block;
- the `/ocr/*` block must carry `default-src 'none'`, must not name any origin other than
  the app's own, and must not gain `'unsafe-eval'` or `'unsafe-inline'` in a script
  directive.

A future change that quietly moves OCR onto the app origin fails CI.

### 4. Assets are self-hosted, lazy and licence-checked

Models (PP-OCRv5 mobile detection + recognition ONNX, Apache-2.0) and the ONNX Runtime
Web WASM (MIT) are **vendored and served from our own origin** —
`scripts/check-bundle-origins.mjs` forbids a CDN, and
[ADR-0021](0021-supply-chain-and-dependency-security.md) requires pinned, reviewed
dependencies. They are fetched **only** when `ExtractedCv.empty === true` or the user
uploads an image, so the ~8–16 MB never touches a user whose CV has a text layer.

## Consequences

- Non-negotiable 1 survives intact for the application origin. SECURITY.md gains a
  narrow, named exception for `/ocr/*` and a threat row for hostile image input.
- A scanned CV becomes usable instead of a dead end.
- The sandbox is a real boundary, not a naming convention: an opaque origin with no
  storage, no network and no token.
- Cost: a second bundle entry point, a `postMessage` protocol to test, a CI guard that
  now parses `_headers` structurally, and ~8–16 MB of vendored binary assets in the
  repository.
- OCR output is **untrusted text** exactly like the PDF text layer, and joins the same
  mandatory review form. Nothing OCR produces reaches the profile unconfirmed.
- WebGPU is used when available with a silent WASM fallback, so the sandbox works on
  browsers without it.

### Known unknown, to be settled before the pipeline is built

An opaque-origin document loads its subresources cross-origin. Whether Cloudflare Workers
static assets will serve the `/ocr/*` WASM and model files to that opaque origin under the
required `Access-Control-Allow-Origin` header **has not been verified**. This is spiked
first. If it does not work, the fallback is to serve the sandbox from a separate Workers
subdomain — still $0, one more deploy target, and a genuinely cross-origin boundary rather
than a same-site one, which is if anything stronger.

## Alternatives considered

- **Add `'wasm-unsafe-eval'` to the application CSP.** Rejected: it grants WebAssembly
  compilation to the one origin holding the GitHub token and the BYOK key, to serve a
  minority input format. The whole point of non-negotiable 1 is that this trade is not
  available for the asking.
- **Keep deferring OCR.** Rejected by the project owner: scanned and photographed CVs are
  common precisely among the users this product targets.
- **Tesseract.js instead of PP-OCRv5.** Rejected: materially worse accuracy on modern
  documents, no WebGPU, no per-line batching — and it needs the same CSP exception, so it
  buys nothing in security terms.
- **OCR via the user's BYOK vision model.** Rejected twice over: AI is frozen
  ([ADR-0033](0033-ai-capability-frozen.md)), and a core path that requires a paid key
  violates [ADR-0009](0009-byok-ai-optional-enhancement.md)'s rule that a useful non-AI
  mode always exists.
- **A serverless OCR endpoint.** Rejected: uploading CV images to a server is exactly what
  [ADR-0011](0011-local-first-cv-processing.md) and
  [ADR-0001](0001-local-first-zero-cost-architecture.md) exist to prevent.

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

### The spike: what was settled, and what was not (2026-09-13)

This ADR named one unknown and made it the thing to settle first. It was spiked with a
41-byte hand-written WebAssembly module rather than a 16 MB engine, so the answer cost
nothing to get and nothing to throw away.

**Settled — the capability question, and it is a yes.**

Serving the built app with the real `_headers` applied (`scripts/serve-static.mjs`,
added for this), a document under `/ocr/*`:

- gets **its own CSP**, distinct from the application's — per-path `_headers` works;
- loads a **same-origin script** under `script-src 'self'`;
- **compiles WebAssembly** under `'wasm-unsafe-eval'`;
- **fetches a `.wasm` asset** from our origin under `connect-src 'self'`;
- **streaming-instantiates** it — `WebAssembly.instantiateStreaming(fetch(...))`, which
  is the exact path ONNX Runtime takes.

The application's `/*` policy is untouched and carries no `'wasm-unsafe-eval'`. A
document under `/ocr/*` cannot frame anything at all (`default-src 'none'`), so the
sandbox cannot be used as a pivot back into the app.

**Not settled — script execution inside `sandbox="allow-scripts"`.**

Still open, and the first real-browser attempt did not answer it either. It is worth
recording why, because the failure looked exactly like the answer.

**Two real-browser runs (project owner, 2026-09-14) found two separate header bugs of
ours. Neither was the platform, and both looked exactly like it.**

*First run, empty frame and a silent parent.* `/ocr/index.html` was being served
`X-Frame-Options: DENY`. Cloudflare `_headers` applies **every** matching rule rather
than the most specific one, so `/*` matches `/ocr/index.html` as well, and a block only
overrides the headers it names — the `/ocr/*` block overrode the CSP and two others and
silently inherited `DENY`, which forbids framing from anywhere, same-origin included.
Chromium enforces this; Firefox ignores it in favour of `frame-ancestors` and says so in
the console, so it is a Chromium-only blocker but a real one. Fixed with
`X-Frame-Options: SAMEORIGIN` on `/ocr/*` — **and that fix did not work.** See the
third run below.

*Second run, and the one that mattered.* With the frame now loading, the sandbox was
refused its own script:

```
GET /ocr/sandbox.js   NS_ERROR_DOM_CORP_FAILED
blocked due to its Cross-Origin-Resource-Policy header
```

`/ocr/*` carried `Cross-Origin-Resource-Policy: same-site`. **An opaque origin belongs
to no site and no origin, so `same-site` and `same-origin` can never match it** — the
document loads and is then refused every asset it owns. `cross-origin` is the only value
an opaque-origin document can satisfy, and that is now what the path sets. The cost is
that the engine and its models become readable by any origin: public static files with
nothing user-specific in them, so the exposure is hotlinking rather than disclosure, and
framing the sandbox *document* is still governed by `frame-ancestors 'self'`.

### Third run: the fix was built on a wrong idea of `_headers` (2026-09-15)

Run locally rather than against the deployment, by serving the real build through
`wrangler dev` — the deployment sits behind Cloudflare Access, and `_headers` is a
Cloudflare artefact the Angular dev server does not apply, so this is the only way to
test the shipped policy without a browser on the deployed site.

**The premise of both earlier fixes was wrong. Cloudflare appends; it does not
override.** Naming a header in a more specific block does not replace the inherited
value — *both are sent*. Every `/ocr/*` response was carrying two
`Content-Security-Policy` headers and two `X-Frame-Options` values:

```
$ curl -sI http://127.0.0.1:8788/ocr/ | grep -ci content-security-policy
2
$ curl -sI http://127.0.0.1:8788/ocr/ | grep -i x-frame-options
x-frame-options: DENY
x-frame-options: SAMEORIGIN
```

Both are fatal, for different reasons. Two CSPs are enforced **cumulatively** — a
resource must satisfy every policy — so the application's `script-src 'self'` intersects
with the sandbox's and removes `'wasm-unsafe-eval'` again, while `frame-ancestors 'none'`
intersects to forbid framing outright. Two `X-Frame-Options` values are a conflict, which
Chromium resolves as DENY. So `X-Frame-Options: SAMEORIGIN` never took effect, and the
whole `/ocr/*` CSP was being neutralised by the policy it was meant to replace.

The fix is `_headers`' **unset** syntax, which is the only way a block can stop `/*` from
also applying:

```
/ocr/*
  ! Content-Security-Policy
  ! X-Frame-Options
  Content-Security-Policy: …
  X-Frame-Options: SAMEORIGIN
```

With that in place the path serves exactly one of each, confirmed both by `curl` and by
the spike page's own in-browser read-back.

**`scripts/check-csp.mjs` had the same wrong model and therefore passed it.** It computed
`effective = own ?? inherited`, i.e. assumed the block's header replaced the inherited
one. It now fails the build unless `/ocr/*` unsets each header it redefines — verified by
deleting an unset line and watching it fail.

### What the third run settled, and what it did not

| | |
|---|---|
| WebAssembly compiles and runs under the `/ocr/*` CSP | **yes** — `wasm-compile-inline`, `fetch-wasm-asset` and `wasm-instantiate-streaming` all pass, the last returning `add(20,22) = 42` |
| The sandbox can fetch its own assets under `connect-src 'self'` | **yes** |
| A `sandbox="allow-scripts"` frame on `/ocr/` loads | **yes** |
| The frame is a genuine opaque origin | **yes** — the parent gets `null` for `contentDocument` |
| The sandbox's script executes *inside the framed opaque origin* | **not settled** — see below |

The last row is the one still open, and the reason is the tool rather than the platform:
the in-app browser used for this run does not deliver `postMessage` from an
opaque-origin frame to its parent, so the spike's channel reports nothing whether or not
the script ran. Requests for `probe.wasm` attributable to framed loads suggest it does
run, but not cleanly enough to record as a result.

**Two things worth knowing before repeating this.** `/ocr/index.html` **307-redirects**
to `/ocr/` — Cloudflare normalises `index.html` away — so the spike now frames `ocr/`
directly rather than taking a redirect during a frame navigation. And the application
CSP's `upgrade-insecure-requests` rewrites the frame navigation to `https://`, which a
plain-HTTP local server closes; either serve HTTPS locally or drop that one directive
from the *built* `_headers` for the duration of the test.

### Reproducing this locally

```bash
npm run build && cd apps/web && npx wrangler dev --port 8788 --local
```

`wrangler` is already the project's deploy tool (`.github/workflows/deploy.yml` uses
`cloudflare/wrangler-action`), and this is the only way to exercise the real `_headers`
semantics — the same semantics that produced three separate wrong diagnoses.

**A hypothesis this disproved, worth recording because it was the likely-looking one.**
`script-src 'self'` was expected to fail in an opaque origin, on the reasoning that
`'self'` cannot match an origin that matches nothing. It does not fail: Firefox
*requested* `sandbox.js` and CORP rejected the response afterwards. A CSP refusal would
have produced no request at all and a violation report instead. `'self'` works.

`scripts/check-csp.mjs` now fails the build on both — an `/ocr/*` block served `DENY`
(inherited or otherwise), and a CORP value stricter than `cross-origin`. Each was
verified by reintroducing the bug and watching the guard catch it.

What remains genuinely unknown is one step further in than it was: the frame loads, CSP
permits its script, and the next run will say whether that script *runs* and can compile
WebAssembly on an opaque origin. Everything before that is now known to work.

The automation browser cannot check it: it executes no scripts in **any** iframe,
sandboxed or not, which was confirmed against an un-sandboxed inline control rather than
inferred. So the question needs a real browser, and `apps/web/public/ocr-spike.html`
diagnoses itself — it prints the headers the sandbox document was actually served,
distinguishes "the frame never loaded" from "the frame loaded and its script was
refused", and treats silence as a reportable outcome instead of leaving "running…" on
screen. That page is what turned an opaque failure into a one-line console answer, and
it earned its keep twice.

**That check must still pass before any OCR engine is vendored**, because the fallback
it would trigger — serving the sandbox from a separate Workers subdomain — changes the
deploy, not just a header.

**Two findings worth keeping, neither of them the thing being looked for.**

- **A `<meta>` CSP and a header CSP are both enforced, and the stricter wins.** The
  sandbox first declared `connect-src 'none'` in a `<meta>` while its header said
  `'self'`; the intersection silently blocked the model fetch. Anything that must load
  its own assets has to agree in both places, so the sandbox document now repeats its
  header policy exactly.
- **`check-csp.mjs` could not have caught a violation here.** It read only the *first*
  CSP line in `_headers`, so the `/ocr/*` block — the one carrying the exception this
  ADR exists to contain — was invisible to it, and it passed the moment that block was
  added. It now parses every block, keeps `'wasm-unsafe-eval'` a hard failure outside a
  one-entry allowlist, and additionally asserts the sandbox keeps `default-src 'none'`
  and names no outbound origin. Both rules were verified by making them fail on purpose.

## Alternatives considered## Alternatives considered

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

# 0019. Security-first rendering: CSP, sanitisation, Trusted Types

- Status: Accepted
- Date: 2026-08-30 (amended 2026-08-31)
- Deciders: Project owner

## Context

Security is the project's #1 requirement (project owner direction, 2026-08-30). The app
is a browser client that renders large amounts of **untrusted content**: repository
README/description/topic text, issue and PR bodies, contributor names, CV text, and
AI-provider responses — all in a context that holds the user's GitHub OAuth token and
BYOK AI keys. XSS is the highest-impact threat.

## Decision

- **Strict Content-Security-Policy**, delivered via the static host
  ([ADR-0004](0004-static-first-web-app-on-free-hosting.md)):
  - `default-src 'self'`; `script-src 'self'` (hashed/nonce'd, **no `unsafe-inline`,
    no `unsafe-eval`**); `object-src 'none'`; `base-uri 'none'`;
    `frame-ancestors 'none'`.
  - `connect-src` allowlists exactly: `api.github.com`, GitHub GraphQL, LinkedIn/Google
    OAuth endpoints, and the AI provider origins the user enabled — nothing wildcard.
  - `img-src` limited to `'self'`, `data:` (sized), and avatar hosts actually needed.
  - **`style-src 'self' 'unsafe-inline'`** — amendment ratified 2026-08-31. Angular
    emits component styles as injected `<style>` elements and the static host
    ([ADR-0004](0004-static-first-web-app-on-free-hosting.md)) cannot mint a
    per-request nonce. This is confined to `style-src`; script directives stay
    strict. `scripts/check-csp.mjs` permits `unsafe-inline` **only** here and fails
    the build if it appears in any other directive. Revisit if Angular ships
    hash-based or build-time style extraction that removes the need.
- **Trusted Types** enforced (`require-trusted-types-for 'script'`) with a single
  audited policy; DOM sink misuse becomes a build/runtime error.
- **Markdown/HTML rendering:** all Markdown is rendered by a hardened pipeline and the
  resulting HTML is sanitised with an **allowlist** (no `<script>`, no event handlers,
  no `javascript:` URLs, `rel="noopener noreferrer"` forced on links,
  `target` constrained). Raw HTML in Markdown is stripped, not passed through.
- **Angular defaults kept:** no `bypassSecurityTrust*` without a documented, reviewed
  justification marked `osc-security-reviewed` in the source; `innerHTML` only via the
  sanitised pipeline. One such exception is ratified (2026-08-31):
  `SafeHtmlService.trust()` wraps `bypassSecurityTrustHtml` around a string that has
  already passed DOMPurify (strict allowlist) **and** the Angular sanitizer, so the
  bypass re-labels known-clean HTML rather than trusting raw input. Any further
  exception needs the same review.
- **AI output is untrusted** and goes through the same sanitiser; it is also visually
  attributed so users do not mistake it for OSC content.
- **Prompt-injection awareness:** repository text included in AI prompts is fenced and
  labelled as untrusted data in the system prompt; the user disclosure panel
  ([ADR-0010](0010-ai-key-privacy-and-data-disclosure.md)) shows exactly what is sent.
- CI verifies the CSP header and runs a check that fails on `bypassSecurityTrust` /
  unsanitised `innerHTML` usage ([docs/ci-cd.md](../ci-cd.md)).

## Consequences

- Some convenient patterns (inline event handlers, `eval`-based libs, arbitrary
  third-party embeds) are off the table; library choices must respect this.
- The sanitiser allowlist needs maintenance as rendering features grow; changes are
  reviewed.
- Full threat model, asset inventory, and the rest of the controls live in
  [SECURITY.md](../../SECURITY.md); this ADR fixes the rendering/CSP posture.

## Alternatives considered

- **Relaxed CSP with `unsafe-inline` for *scripts*.** Rejected outright given the #1
  requirement and the tokens/keys at stake. (Style-only `unsafe-inline` is the
  narrowly-scoped exception above.)
- **Per-request CSP nonce for styles.** Rejected for the MVP: requires a server or
  edge function to inject the nonce, which contradicts
  [ADR-0002](0002-no-mandatory-application-backend.md).
- **Render Markdown without sanitising, trusting the parser.** Rejected: parsers have
  had bypasses; defence in depth is required.

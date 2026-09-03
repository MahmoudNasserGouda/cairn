# 0020. OAuth token and BYOK key handling

- Status: Accepted (refined by [ADR-0024](0024-github-oauth-token-exchange-function.md), 2026-09-02)
- Date: 2026-08-30
- Deciders: Project owner

> **Correction 2026-09-02 ([ADR-0024](0024-github-oauth-token-exchange-function.md)).**
> The line below expecting GitHub OAuth to work without a token-exchange function is
> **wrong** — GitHub supports neither PKCE nor a CORS-enabled device flow. GitHub now
> uses the stateless token-exchange Worker described in the fallback clause. Also:
> the identity slice requests only `read:user` (not `public_repo`, which grants
> *write*); reading public repos needs no scope at all.

## Context

The app authenticates the user to GitHub (and optionally LinkedIn, Google) and holds
BYOK AI keys, all client-side ([ADR-0001](0001-local-first-zero-cost-architecture.md),
[ADR-0009](0009-byok-ai-optional-enhancement.md)). Security is the #1 requirement. These
credentials are the crown jewels; their handling needs a dedicated decision.

## Decision

**OAuth (GitHub / LinkedIn / Google):**

- **Authorization Code + PKCE**, no implicit flow, no client secret in the app.
- Exact, static **redirect-URI allowlist** per provider (prod origin + the Pages
  preview origin pattern only); no wildcards, no user-supplied redirect.
- `state` (CSRF) and PKCE `code_verifier` are single-use, stored in
  `sessionStorage`, cleared immediately after the callback.
- If a provider does **not** support public-client PKCE from a static origin, that
  provider waits for a **minimal stateless token-exchange function**
  ([ADR-0016](0016-optional-serverless-api.md)) whose sole job is code→token; it stores
  nothing. GitHub OAuth is expected to work without it; LinkedIn is the likely
  exception.
- Request the **narrowest scopes** that work: GitHub `public_repo` / `read:user` (no
  `repo`, no write scopes at MVP); LinkedIn `openid profile email` only.

**Token storage:**

- Access tokens kept **in memory** for the session by default; an opt-in "stay signed
  in" persists an encrypted-at-rest token in IndexedDB with a short refresh cadence.
- Tokens never in LocalStorage, URLs, query strings, logs, telemetry, or error reports.
- A "sign out" control wipes tokens and provider-derived cache.

**BYOK AI keys:** governed by
[ADR-0010](0010-ai-key-privacy-and-data-disclosure.md) — device-only, never to Cairn,
never logged, redacted in any telemetry, "session only" option, direct-to-provider
calls.

**Extension:** tokens/keys in `chrome.storage.local` only (never `sync`), never exposed
to content scripts; background service worker mediates provider calls.

## Consequences

- LinkedIn support may lag GitHub if the token-exchange function is required — acceptable
  ([ADR-0012](0012-linkedin-as-oauth-identity-only.md)).
- In-memory-by-default means users re-authenticate more often; the UX copy explains the
  security reason and the opt-in.
- Encryption-at-rest for the persisted token needs a key-derivation approach (Web Crypto,
  non-extractable `CryptoKey`); detailed in [SECURITY.md](../../SECURITY.md).

## Alternatives considered

- **Implicit flow / token in URL fragment.** Rejected: deprecated, leaks via history and
  referrer.
- **Always persist tokens in LocalStorage.** Rejected: readable by any successful XSS;
  contradicts [ADR-0019](0019-security-first-rendering.md)'s threat model.
- **Route all provider calls through an Cairn proxy to hide tokens.** Rejected:
  mandatory backend, and the proxy would then hold every user's token — a worse target.

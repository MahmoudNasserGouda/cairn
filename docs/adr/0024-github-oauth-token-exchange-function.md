# 0024. OAuth token-exchange function

- Status: Accepted (generalized 2026-09-02, [ADR-0025](0025-multi-provider-identity.md))
- Date: 2026-09-02
- Deciders: Project owner
- Implements: [ADR-0016](0016-optional-serverless-api.md) (first serverless function)
- Refines: [ADR-0020](0020-oauth-token-and-byok-key-handling.md)

> **2026-09-02.** Generalized from GitHub-only to a per-provider route
> (`POST /<provider>/token`, providers `github` / `linkedin` / `google`) when
> [ADR-0025](0025-multi-provider-identity.md) added LinkedIn and Google as
> identity-only providers. Same properties: stateless, no storage, CORS-locked,
> one secret per provider. Directory: `api/optional-serverless/oauth/`.

## Context

[ADR-0020](0020-oauth-token-and-byok-key-handling.md) assumed GitHub OAuth would work
as a pure client-side Authorization Code + PKCE flow. **It does not.** Neither GitHub
OAuth Apps nor GitHub Apps support PKCE; the `code -> access_token` exchange always
requires the OAuth App **client secret**, which cannot ship in a static SPA
([ADR-0001](0001-local-first-zero-cost-architecture.md),
[ADR-0002](0002-no-mandatory-application-backend.md)).

The device flow avoids the secret but GitHub's device endpoints send no CORS headers,
so a browser cannot call them either. ADR-0020's own fallback clause anticipated this:
"If a provider does not support public-client PKCE … that provider waits for a minimal
stateless token-exchange function ([ADR-0016](0016-optional-serverless-api.md))."

## Decision

Add **one** stateless Cloudflare Worker, `cairn-auth`, at
`api/optional-serverless/github-oauth/`. This is the first function under ADR-0016,
which moves to **Accepted**.

- **Sole job:** `POST /github/token` with `{ code, redirect_uri }` →
  `{ access_token, token_type, scope }`. It calls
  `https://github.com/login/oauth/access_token` with the client id + secret and
  returns the result.
- **Holds:** `GITHUB_CLIENT_SECRET` (Worker secret), `GITHUB_CLIENT_ID` +
  `ALLOWED_ORIGIN` (vars).
- **Stores:** nothing. No KV, no DB, no cookies. No logging of the request body.
- **CORS:** `Access-Control-Allow-Origin` is the single app origin; any other `Origin`
  gets `403`.
- **Scopes:** the browser requests the narrowest that works — `read:user` for the
  identity slice, nothing more until a feature needs it. (ADR-0020's mention of
  `public_repo` was loose: reading public repos needs no scope, and `public_repo`
  grants *write*. Corrected here.)
- **Auth redirect, `state`, and `GET /user`** stay fully client-side with the user's
  own token (`libs/auth`, framework-free so the extension can reuse it — ADR-0014).

## Consequences

- Introduces a deployable server unit and its ADR-0016 operational responsibility,
  kept minimal: no state, no dependencies, ~150 lines.
- Near-zero cost on the Workers free tier; same Cloudflare account as the web app
  ([ADR-0004](0004-static-first-web-app-on-free-hosting.md)).
- **Client failure mode:** if `cairn-auth` is unreachable, `signIn()` reports "could
  not reach the sign-in service" and the app stays fully usable unauthenticated. One
  attempt per user action; no retry storm.
- The token is returned to the browser and held **in memory only** (ADR-0020). The
  Worker never sees it again.
- LinkedIn/Google, when added, get their own function + mini-ADR (or reuse this one
  with a provider parameter) — not decided here.

## Alternatives considered

- **Personal access token paste.** Zero infra, works today, but worse UX and invites
  over-scoped tokens. Kept as a possible future fallback, not the primary path.
- **Device flow via a CORS-proxy Worker.** Still needs a Worker, and the "type this
  code on github.com" UX is worse than a redirect for a web app.
- **Proxy all GitHub calls through the Worker to hide the token.** Rejected for the
  same reason as ADR-0020: it would then hold every user's token — a worse target —
  and contradicts [ADR-0006](0006-direct-github-api-usage.md).

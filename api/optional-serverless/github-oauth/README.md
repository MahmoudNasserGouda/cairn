# `cairn-auth` — GitHub OAuth token-exchange Worker

Stateless Cloudflare Worker. Mini-ADR: [ADR-0024](../../../docs/adr/0024-github-oauth-token-exchange-function.md).
Parent decision: [ADR-0016](../../../docs/adr/0016-optional-serverless-api.md).

## Why a server is unavoidable

GitHub OAuth (OAuth Apps and GitHub Apps) does **not** support Authorization Code +
PKCE. Completing `code -> access_token` requires the OAuth App **client secret**, which
cannot ship in a static SPA ([ADR-0020](../../../docs/adr/0020-oauth-token-and-byok-key-handling.md)).
This Worker is the smallest thing that holds the secret and does that one step.

## What it touches

| | |
|---|---|
| Input | `POST /github/token` with `{ "code": "...", "redirect_uri": "..." }` from the app origin only |
| Talks to | `https://github.com/login/oauth/access_token` |
| Output | `{ access_token, token_type, scope }` (or `{ error }`) |
| Stores | **nothing** — no KV, no DB, no cookies, no logging of the body |
| Secrets | `GITHUB_CLIENT_SECRET` (Worker secret); `GITHUB_CLIENT_ID`, `ALLOWED_ORIGIN` (vars) |

CORS is locked to `ALLOWED_ORIGIN`; any other `Origin` gets `403`.

## Client failure mode

If the Worker is unreachable or errors, `signIn()` surfaces "could not reach the
sign-in service" and the app stays fully usable unauthenticated. No retry storm — one
attempt per user action.

## Deploy

```bash
cd api/optional-serverless/github-oauth
wrangler secret put GITHUB_CLIENT_SECRET      # paste the OAuth App secret
wrangler deploy \
  --var GITHUB_CLIENT_ID:<client-id> \
  --var ALLOWED_ORIGIN:https://cairn.mahmoudnasser98.workers.dev
```

The OAuth App (github.com → Settings → Developer settings → OAuth Apps) needs its
**Authorization callback URL** set to exactly `https://cairn.mahmoudnasser98.workers.dev/`
and the same value passed as the SPA's `redirectUri`.

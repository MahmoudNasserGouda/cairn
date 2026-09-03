# `cairn-auth` — OAuth token-exchange Worker

Stateless Cloudflare Worker. Mini-ADR:
[ADR-0024](../../../docs/adr/0024-github-oauth-token-exchange-function.md).
Provider policy: [ADR-0025](../../../docs/adr/0025-multi-provider-identity.md).
Parent decision: [ADR-0016](../../../docs/adr/0016-optional-serverless-api.md).

## Why a server is unavoidable

None of GitHub, LinkedIn, or Google offer a usable public-client PKCE flow from a
static origin — the `code -> access_token` step needs a client **secret**, which
cannot ship in a static SPA
([ADR-0020](../../../docs/adr/0020-oauth-token-and-byok-key-handling.md)). GitHub has
no PKCE at all; LinkedIn/Google's web flow still requires the secret. This Worker is
the smallest thing that holds the secrets and does that one step.

## Interface

| | |
|---|---|
| Route | `POST /<provider>/token` — `<provider>` ∈ `github` \| `linkedin` \| `google` |
| Body | `{ "code": "...", "redirect_uri": "..." }` from the app origin only |
| Talks to | the provider's token endpoint (JSON for GitHub, form-encoded for OIDC) |
| Output | `{ access_token, token_type, scope }` (or `{ error }`) |
| Stores | **nothing** — no KV, no DB, no cookies, no logging of the body |
| Secrets | `<PROVIDER>_CLIENT_SECRET`; vars `<PROVIDER>_CLIENT_ID`, `ALLOWED_ORIGIN` |

CORS is locked to `ALLOWED_ORIGIN`; any other `Origin` gets `403`. A provider with no
id + secret configured returns `501 provider_not_configured`.

## Client failure mode

If the Worker is unreachable or errors, `signIn()` surfaces "could not reach the
sign-in service" and the app stays fully usable unauthenticated. One attempt per user
action.

## Deploy

```bash
cd api/optional-serverless/oauth
wrangler secret put GITHUB_CLIENT_SECRET            # + LINKEDIN_/GOOGLE_ if used
wrangler deploy \
  --var GITHUB_CLIENT_ID:<id> \
  --var LINKEDIN_CLIENT_ID:<id> \
  --var GOOGLE_CLIENT_ID:<id> \
  --var ALLOWED_ORIGIN:https://cairn.mahmoudnasser98.workers.dev
```

Each OAuth app's callback URL must equal the `redirectUri` in
`libs/shared/src/config.ts` (`https://cairn.mahmoudnasser98.workers.dev/`).

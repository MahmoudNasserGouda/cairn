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

Two routes. Both require an `Origin` header that is on the `ALLOWED_ORIGIN` list —
a missing or unlisted `Origin` gets `403 origin_not_allowed`. `ALLOWED_ORIGIN` is a
comma-separated list, so a dev origin can be added alongside production.

This is an **origin allowlist, not CORS**: CORS only constrains browsers, and the
check used to skip any request that simply omitted the header, which left the
token exchange reachable from curl. `redirect_uri` is validated against the same
list (`400 redirect_uri_not_allowed`).

| | |
|---|---|
| `POST /<provider>/token` | `{ "code": "...", "redirect_uri": "..." }` → `{ access_token, token_type, scope }` (or `{ error }`). `<provider>` ∈ `github` \| `linkedin` \| `google`. JSON body for GitHub, form-encoded for the OIDC pair. `501 provider_not_configured` if that provider's id/secret aren't set. |
| `POST /linkedin/identity` | `{ "token": "..." }` → the raw LinkedIn `userinfo` JSON, passed through verbatim. **Only needs the access token, no client secret** — LinkedIn's `userinfo` endpoint sends no CORS headers, so the browser cannot call it directly and this relays it. GitHub and Google's `userinfo`/`user` endpoints do support CORS and are called directly by the client; `/github/identity` and `/google/identity` return `404 not_relayed`. |

Stores **nothing** for either route — no KV, no DB, no cookies, no logging of bodies.

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

`libs/shared/src/config.ts` derives `redirectUri` from the origin the app is served
from, so each OAuth app's callback URL must be `<origin>/` for every origin you
intend to support.

### Signing in from `localhost`

`npm run -w @cairn/web start` serves the app on `http://localhost:4200`, so its
redirect URI is `http://localhost:4200/`. To sign in there you must, for each
provider you want:

1. Register `http://localhost:4200/` as an additional callback URL on the OAuth app.
   (GitHub OAuth Apps allow only one callback URL — use a second, dev-only OAuth app
   and point `clientId` at it locally rather than changing the production one.)
2. Add the origin to this Worker, **or** run a dev Worker:

   ```bash
   wrangler dev --var ALLOWED_ORIGIN:http://localhost:4200
   ```

Prefer the dev Worker. Adding `http://localhost:4200` to the deployed
`ALLOWED_ORIGIN` lets anyone running the app locally complete an exchange with the
production client secret.

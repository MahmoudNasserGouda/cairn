# 0034. GitLab as a second data connection — and the first with no Worker

- Status: Accepted
- Date: 2026-09-15
- Deciders: Project owner
- Refines: [ADR-0006](0006-direct-github-api-usage.md),
  [ADR-0025](0025-multi-provider-identity.md),
  [ADR-0024](0024-github-oauth-token-exchange-function.md)
- Measured against: [ADR-0026](0026-job-and-opportunity-ingestion.md)'s acceptance bar,
  with one deliberate departure — see *Which bar applies*

## Context

[ADR-0025](0025-multi-provider-identity.md) made GitHub the only **data** connection and
LinkedIn and Google identity-only, because neither offers profile data worth reading. It
did not say GitHub must be the only one forever; it said the others had nothing to give.

GitLab does. Projects, per-project language breakdowns, merge requests, events and group
membership — the same shape `libs/github` already turns into a profile fragment. Overlap
with GitHub's audience is high but not total, and GitLab is common inside employers'
internal estates, which is exactly where a developer's strongest work is often invisible
to a public GitHub profile.

But the data is not the reason this ADR exists first.

### The architectural reason

Every provider Rujoom uses today forced the `cairn-auth` Worker into the authentication
path. None of GitHub, LinkedIn or Google offers a workable public-client PKCE flow, so
the `code → token` exchange has to happen somewhere that can hold a client secret
([ADR-0024](0024-github-oauth-token-exchange-function.md),
[SECURITY.md](../../SECURITY.md) non-negotiable 5). That Worker is the single piece of
server-side infrastructure in a project whose first ADR is
*[local-first, zero-cost](0001-local-first-zero-cost-architecture.md)*.

**GitLab needs none of it.** Verified 2026-09-15 by reading its OpenID discovery document
from a browser:

```
GET https://gitlab.com/.well-known/openid-configuration   → 200, CORS
  code_challenge_methods_supported: ["plain", "S256"]
  authorization_endpoint:           https://gitlab.com/oauth/authorize
  token_endpoint:                   https://gitlab.com/oauth/token
```

`S256` on a public client means the browser can complete the exchange itself: no client
secret, nothing to hold, no server in the path. GitLab would be **the first provider that
is local-first end to end**, and that is worth more to this project than the extra
repositories.

### What was verified, and how

All from a real browser, on an origin that is not GitLab's, with a deliberately
permissive `connect-src` so that a failure would be GitLab refusing us rather than our
own CSP refusing itself:

| Probe | Result |
|---|---|
| `GET /api/v4/projects/278964` | `200`, `response.type === "cors"` |
| `GET /api/v4/projects/278964/languages` | `200` — `{Ruby: 68.24, JavaScript: 20.17, Vue: 7.41, …}` |
| `GET /api/v4/groups/gitlab-org/projects` | `200`, list returned |
| `GET /.well-known/openid-configuration` | `200`, `S256` present |
| `POST /oauth/token` (form-encoded, bogus client) | `200`-path CORS: `response.type === "cors"`, JSON error body **readable** |
| `GET /api/v4/user` with an `Authorization` header | `401`, `response.type === "cors"` — the preflight was answered |

The last two were added after the first draft of this ADR, and they are the ones the
decision actually rests on. The original table verified the *data* endpoints and the
discovery document, which is not the same claim: PKCE in a browser lives or dies on
whether the **token endpoint** answers a cross-origin POST, and every authenticated read
carries an `Authorization` header, which is not CORS-safelisted and therefore triggers a
preflight the API has to answer separately. Both hold.

Two details worth keeping, because they are the difference between this working and
this nearly working:

- **Form-encoded means no preflight on the exchange.** `application/x-www-form-urlencoded`
  is a safelisted content type, so the token POST is a simple request. Sending it as JSON
  would add an OPTIONS round trip for no benefit.
- **The OAuth application must be registered as non-confidential.** The probe returned
  `invalid_client` — correct for a made-up client id, and the same error a *confidential*
  app would return when the browser omits the secret it cannot hold. That is a
  registration setting, not something a probe can confirm from outside, and it is the one
  remaining way this can be got wrong at deploy time.

The language endpoint is worth noting: GitLab returns **percentages already normalised**,
where GitHub returns raw byte counts that `githubToFragment` has to normalise itself. The
mapping is therefore simpler, not harder.

**The first attempt at this probe measured nothing**, because the probe page inherited the
application's own `connect-src` and every request failed identically. That is the same
last-rule-wins mechanic that made the OCR sandbox unframeable
([ADR-0028](0028-ocr-and-document-vision-sandbox.md)), met twice in two days. Recorded
here because "all three candidates failed" looked like a finding and was an own goal.

## Which bar applies

The plan called for measuring each deferred source against
[ADR-0026](0026-job-and-opportunity-ingestion.md)'s acceptance bar. Four of its five
criteria apply cleanly. **Criterion 2 — "no user credential, no login, no per-user
token" — does not**, and pretending otherwise would be the wrong kind of tidy.

That criterion governs **feeds**: a stream of job listings read on the user's behalf,
where holding anyone's credential would be indefensible. GitLab here is a **data
connection** — the user's own account, read with the user's own token, at the user's
explicit instruction. That is the category [ADR-0006](0006-direct-github-api-usage.md)
already authorises for GitHub, under the token rules in
[ADR-0020](0020-oauth-token-and-byok-key-handling.md), and this ADR extends it to a
second provider rather than inventing a new shape.

Against the remaining four:

1. **Documented and permitted** — GitLab's REST API v4 is public and documented, and
   reading one's own account through OAuth is its intended use.
2. *(feed criterion, does not apply — see above)*
3. **Reachable without a secret** — yes, and more strongly than any provider so far: PKCE
   means there is no secret anywhere, not even in a Worker.
4. **Origin declared in both places** — `https://gitlab.com` goes into
   `ALLOWED_CONNECT_ORIGINS` and the CSP `connect-src`, so `check-csp.mjs` and
   `check-bundle-origins.mjs` enforce it.
5. **Its own mini-ADR** — this document.

## Decision

**GitLab becomes a second data connection, authenticated with Authorization Code + PKCE
in the browser, with no Worker in the path.**

- **Scope: `read_user` + `read_api`**, the narrowest pair that reads a profile and its
  projects. Not `api`, which is read *and write*, for the same reason
  [ADR-0030](0030-github-graphql-profile-read.md) refused classic `repo`.
- **The token is handled exactly as GitHub's is** — in memory, mirrored to
  `sessionStorage` only, never LocalStorage, never IndexedDB, never logged
  ([ADR-0020](0020-oauth-token-and-byok-key-handling.md)).
- **`state` and the PKCE `code_verifier`** are single-use and stored in `sessionStorage`
  alongside the pending provider record, cleared on callback — the mechanism
  `libs/auth` already implements for the other three providers.
- **It produces a profile fragment with `gitlab` provenance**, merged by the same
  `mergeProfile` as everything else ([ADR-0031](0031-profile-v2-provenance.md)). This
  requires adding `gitlab` to `ProfileSource`, which is a schema change and therefore
  carries a migration.
- **GitHub stays the default.** GitLab is offered beside it, not instead of it, and a
  user may connect either, both, or neither.

## Consequences

- The first provider that needs no server. If GitLab were ever the *only* connection a
  user had, `cairn-auth` would not be in their path at all.
- `ProfileSource` gains a fourth import source, which means: a new precedence position, a
  new provenance colour in the token layer, a new source row on the profile hub's
  **Sources** section, and a `PROFILE_SCHEMA_VERSION` bump with a migration. None of that
  is hard, but it is not free, and it is the reason this is its own phase rather than an
  afternoon.
- Where does `gitlab` sit in precedence? **Beside `github`, not above it.** Both are
  measured rather than stated, both are inference about a person from repository
  metadata, and neither has a claim to outrank the other. Two measured sources
  disagreeing about a language is a case the merge has not had before — see *Open
  questions*.
- `libs/github`'s client — cache, dedupe, ETag, per-resource rate-limit floor — is
  GitHub-shaped in its rate-limit handling but not otherwise. Some of it generalises;
  deciding how much is an implementation question, not a decision for this ADR.
- One more OAuth application to register and keep configured, and one more redirect URI
  in the allowlist.

## Open questions, recorded rather than guessed

- **Two measured sources, one language.** A user with Ruby on GitLab and Ruby on GitHub
  should not have their level doubled, nor should the smaller account silently win. The
  likely answer is to sum byte-equivalents before normalising, but `libs/profile`'s skill
  merge currently reconciles *between* sources rather than *within* a tier. This needs a
  test before it needs code.
- **Self-managed GitLab instances.** The endpoints are identical, the origin is not, and
  `connect-src` is an allowlist that cannot contain "whatever host the user types"
  without abandoning [SECURITY.md](../../SECURITY.md) non-negotiable 6. GitLab.com only,
  for the same reason the personal-site URL is refused
  ([ADR-0037](0037-declined-sources.md)).

## Alternatives considered

- **Route GitLab through `cairn-auth` like the others.** Rejected: it would work, and it
  would throw away the only reason GitLab is first in line. Uniformity is not worth
  giving up the one provider that does not need the server.
- **Read public GitLab profiles anonymously by username, with no OAuth at all.** Tempting
  — the API allows it and the probes above were anonymous. Rejected as the *primary*
  path: it cannot see private or internal projects, which is precisely the work GitLab
  users have that GitHub cannot show, so it would deliver the weakest half of the
  argument for integrating at all. Worth reconsidering later as a zero-friction preview.
- **Wait for a user to ask for it.** Reasonable, and the honest counter-argument to this
  whole ADR. The answer is that the PKCE property is architectural: it is the first
  evidence that the Worker is a provider limitation rather than a design necessity, and
  that is worth establishing while the auth layer is fresh.

# 0030. GitHub GraphQL as the profile data path, and the scope policy

- Status: Accepted
- Date: 2026-09-13
- Deciders: Project owner
- Refines: [ADR-0006](0006-direct-github-api-usage.md),
  [ADR-0025](0025-multi-provider-identity.md)
- Constrained by: [ADR-0020](0020-oauth-token-and-byok-key-handling.md)

## Context

GitHub is the only provider Rujoom reads data from
([ADR-0025](0025-multi-provider-identity.md)). It is read through four REST endpoints
(`libs/github/src/user.ts`), and the result is thin in two different ways.

**It is expensive.** One profile load costs up to **16 requests**: `/user`,
`/user/repos`, a merged-PR search, and `/repos/{full_name}/languages` fifteen times over
(`LANGUAGE_FETCH_LIMIT = 15`). Fifteen of those sixteen exist to answer one question —
which languages does this person write.

**It is shallow.** It returns skills, interests and one synthetic "Public GitHub
activity" experience entry that spans account creation to last push. It does not return
the contribution calendar, pinned repositories, repositories contributed to,
organizations, social links, bio, company, location, sponsors or the profile README —
all of which GitHub exposes, most of them **at the permission level we already hold**.

A separate question rides along. Reading private repositories would materially improve
the skills signal for developers whose real work is not public. GitHub's classic OAuth
offers exactly one scope for that, and it is `repo`.

## Decision

### 1. GraphQL becomes the profile data path

One `POST https://api.github.com/graphql` replaces the REST fan-out in
`collectGithubActivity`. The query returns, in a single request: viewer identity and bio
fields, `socialAccounts`, `contributionsCollection` (totals, calendar and
`contributionsByRepository`), `pinnedItems`, `repositoriesContributedTo`,
`topRepositories` **with their language breakdowns**, `organizations`,
`sponsorshipsAsMaintainer`, gists, followers and following.

The profile README is not in GraphQL and comes from REST
`GET /repos/{login}/{login}/readme`. It is untrusted Markdown and goes through
`SafeHtmlService` like every other external document.

REST is **not** removed. `libs/github` keeps its REST client for repository analysis,
health signals, issue lists and search — GraphQL is adopted where it wins, not as a
migration for its own sake.

**Rate limiting.** GraphQL bills against a separate 5,000-**points**/hour budget rather
than the REST request budget. `libs/github/src/client.ts` already tracks limits per
resource (`core` vs `search`, because `/search/*` has a 10–30/minute bucket);
`graphql` becomes a third resource under the same `resourceForPath` / `floorFor`
mechanism. Caching, deduplication, ETag revalidation and 429 backoff apply unchanged;
GraphQL requests are POSTs, so the cache key is the query plus its variables.

### 2. Default scopes: `read:user`, `user:email`, `read:org`

`user:email` lets a CV's email address be matched to the GitHub account, which is what
makes cross-source identity resolution possible at all
([ADR-0031](0031-profile-v2-provenance.md)). `read:org` unlocks `organizations`.
Everything else in the query above is already covered by `read:user`.

### 3. Private repositories: a separate, read-only, opt-in credential — not `repo`

**Classic OAuth has no read-only private-repository scope.** GitHub's `repo` grants full
control of private repositories, *including write access to code*. Requesting it during
sign-in would mean the token held in `sessionStorage`
([ADR-0020](0020-oauth-token-and-byok-key-handling.md)) could rewrite every private
repository the user owns — in exchange for counting language bytes. The project owner
asked for private-repo reading; this ADR grants the capability and refuses that
particular key to it.

Private-repo reading is therefore **not part of sign-in**. It is a separate opt-in in
which the user pastes a **fine-grained personal access token** scoped to the
repositories they choose, with `Metadata: read` and `Contents: read` and nothing else.
It is stored exactly as the BYOK AI key is: in the isolated `secrets` IndexedDB object
store, never in LocalStorage, never in a log, never in a URL, with the same memory-only
opt-out. It is used only for the private-repo language query, and revoking it in GitHub's
UI is sufficient and immediate.

A **GitHub App** was the other read-only candidate and is rejected on architecture:
installation tokens require signing a JWT with the app's private key, which means a
server holding a secret, which [ADR-0002](0002-no-mandatory-application-backend.md)
forbids as a requirement for a core capability.

If classic `repo` is ever wired despite this, it must be a new ADR that says plainly that
write access to all private repositories was accepted, and why.

## Consequences

- Profile loads drop from up to 16 requests to 1 (+1 for the README), which matters most
  for the rate-limited users this product targets.
- The profile gains real material: a contribution calendar, the repositories someone
  actually contributed to rather than only the ones they own, what they pinned, who they
  work with, and their own words in a bio and README.
- `githubToProfile` can stop inferring years from account age as its only experience
  signal — `contributionsCollection` carries dated activity.
- The sign-in consent screen now mentions email and organization access. That is a real
  cost in conversion and is accepted; neither reads anything private.
- Private-repo support is a second, deliberate step with its own UI, its own storage and
  its own revocation story, rather than a checkbox on a login screen.
- A GraphQL schema change is a runtime break rather than a compile error. The query is
  covered by recorded-response fixtures, and a malformed or partial response degrades to
  the fields that did arrive rather than failing the profile load.

## Implementation notes

Added 2026-09-13, when it was built. The decision above is unchanged; these are the
things it left open, each settled by something the code or a test insisted on.

- **The REST viewer module is gone**, not kept alongside. `libs/github/src/user.ts`
  existed only to assemble the profile, and once GraphQL did that its last caller
  disappeared. REST remains the transport for repository analysis, health signals,
  issue lists and search, exactly as this ADR says — what went is the fan-out, not the
  client.
- **`mergedPullRequests` is nullable, and that is the point.** The Search API version
  reported a throttle as `0`, which then scored as an empty track record; that bug is
  named in this ADR's context. GraphQL removes the throttle, so the instinct was to
  drop the "known" flag — but a *partial* GraphQL response can still null the field,
  and collapsing that to `0` would have reintroduced the same bug through a different
  door. `null` means "we could not check" all the way through
  `collectViewerGraph` -> `githubToFragment` -> `contributions.known`. An existing
  test is what caught this.
- **Organisation membership is read but never becomes employment.** GitHub cannot tell
  a job from a community, an alumni group or a hackathon team, so an `ExperienceEntry`
  built from one would invent a role the user never claimed — and then sit in the
  profile looking authoritative. It is carried for the UI to show as an affiliation.
- **A bio fills `headline`, not `summary`.** It is a one-line header; `summary` waits
  for a source that actually carries prose.
- **Pinned repositories become projects.** They are the one part of a GitHub profile
  the user curated by hand, so the claim is one GitHub genuinely supports.
- **Biographical claims are stamped at low confidence** (0.5, and 0.3 for the activity
  span) so they lose a tie to any source that actually asked the user. What GitHub
  *measures* — language bytes, contribution counts — carries full confidence, because
  nothing else claims those and precedence never arises.
- **`graphql` is a third rate-limit resource** alongside `core` and `search`, under the
  same `resourceForPath` / `floorFor` mechanism. GraphQL is a POST, so ETag
  revalidation does not apply and freshness is TTL alone; and because GitHub reports a
  failed query as **200 with an `errors` array**, success is read from the body rather
  than the status line, and a failed query is never cached.
- **Scopes are live**: `read:user user:email read:org`. The read-only private-repo PAT
  this ADR specifies is **not built yet** — no UI collects one, so nothing reads a
  private repository today.

**Not verified end to end.** The query is covered by recorded-response fixtures and the
transport by unit tests, but no signed-in run against real GitHub has happened — that
needs a live OAuth flow. First real sign-in is where a schema or scope mismatch would
show up.

## Alternatives considered

- **Keep REST and just raise `LANGUAGE_FETCH_LIMIT`.** Rejected: makes the request
  count worse and still returns none of the missing data.
- **Classic `repo` scope at sign-in.** Rejected, see above. The owner's request for
  private-repo data is honoured by a different key, not refused.
- **GitHub App installation.** Rejected: requires a secret-holding backend
  ([ADR-0002](0002-no-mandatory-application-backend.md)).
- **Move all of `libs/github` to GraphQL.** Rejected: repository search, issue lists and
  several health signals are cheaper or only available over REST. Two transports, one
  client.

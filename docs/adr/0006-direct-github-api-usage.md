# 0006. Direct GitHub API usage from the browser

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

GitHub is the central data source: repository metadata, languages, issues, pull
requests, contributors, and commit activity. The spec is explicit: use GitHub directly
whenever possible, do not route every request through an Cairn backend, and implement
caching, deduplication, rate-limit awareness, pagination, and incremental loading.

## Decision

The browser will call the **GitHub REST and GraphQL APIs directly**, authenticated with
the user's own OAuth token ([ADR-0020](0020-oauth-token-and-byok-key-handling.md)).

`libs/github` will provide a single client that enforces:

- **Response cache** in IndexedDB keyed by URL + query, with per-resource TTLs
  (e.g. repo metadata 24 h, issues 1 h, commit activity 6 h) and a total size cap with
  LRU eviction.
- **Request deduplication** — concurrent identical in-flight requests share one promise.
- **Conditional requests** — store and send `ETag` / `Last-Modified`; a `304` refreshes
  the TTL at zero quota cost.
- **Rate-limit awareness** — read `X-RateLimit-Remaining` / `Reset`, surface budget in
  the UI, back off and serve cache when low, honour `Retry-After` on secondary limits.
- **Pagination + incremental loading** — cursor-based where GraphQL allows; never fetch
  a full history when a windowed query answers the question.
- **GraphQL preferred** for multi-field reads to cut request count.

Unauthenticated (60 req/h) mode is supported for anonymous browsing with aggressive
caching and clear UI messaging.

## Consequences

- No server proxy means the user's token and IP are what GitHub sees — acceptable and
  privacy-preserving.
- CORS: GitHub's API allows browser calls; the extension may additionally use its host
  permissions.
- A future serverless cache of *popular public* repo data
  ([ADR-0016](0016-optional-serverless-api.md)) could reduce per-user quota use, but is
  not required and must not become mandatory.
- Cache correctness (stale scores after a repo changes) is a known trade-off; TTLs and a
  manual "refresh" affordance mitigate it.

## Alternatives considered

- **Proxy all GitHub traffic through Cairn.** Rejected: bandwidth cost, a single shared
  rate-limit bucket, privacy regression, and a mandatory backend.
- **No caching, rely on GitHub limits.** Rejected: 5000 req/h is quickly exhausted by
  discovery + health analysis over many repos.

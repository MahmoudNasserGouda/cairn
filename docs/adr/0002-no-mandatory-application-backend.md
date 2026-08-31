# 0002. No mandatory application backend

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

[ADR-0001](0001-local-first-zero-cost-architecture.md) commits to local-first. The spec
lists potential future backend responsibilities (payments, sponsorship management,
optional sync, server-side OAuth where required, abuse prevention, anonymous analytics,
cached public repo data, business administration) but insists the MVP must not depend on
an OSC backend.

## Decision

We will ship with **no application backend**. Any server-side capability that later
proves genuinely necessary will be implemented as **stateless serverless functions**
(see [ADR-0016](0016-optional-serverless-api.md)), added one concrete requirement at a
time, never as an always-on service.

Server-side OAuth token exchange is the one capability that may be needed sooner (some
providers disallow public-client flows); if so it will be a single minimal serverless
function whose only job is the code-for-token exchange, holding no user state.

## Consequences

- No server to secure, patch, scale, or pay for during the MVP.
- Features that inherently need a trusted server (moderated community content, payment
  webhooks) are gated behind [ADR-0016](0016-optional-serverless-api.md).
- Client code must handle rate limiting, retries, and caching itself
  ([ADR-0006](0006-direct-github-api-usage.md)).
- Open question: whether LinkedIn / Google OAuth can be done purely client-side with
  PKCE, or whether the token-exchange function is required at MVP
  ([ADR-0020](0020-oauth-token-and-byok-key-handling.md)).

## Alternatives considered

- **Thin BFF (backend-for-frontend) from day one.** Rejected: even a thin server is a
  cost and attack-surface commitment that the MVP does not need.
- **Edge middleware on the static host.** Deferred: acceptable as a future serverless
  option, not a launch dependency.

# 0016. Optional serverless API

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

> **2026-09-02.** Moved Proposed → Accepted: the first function landed —
> [ADR-0024](0024-github-oauth-token-exchange-function.md), the GitHub OAuth
> token-exchange Worker. The per-function ADR gate below is now in force for real.

## Context

The spec allows a future small serverless platform for capabilities that genuinely need
a trusted server: payment/sponsorship processing, sponsorship moderation, optional cloud
sync, server-side OAuth token exchange where required, abuse prevention, anonymous
analytics, and a cache of popular public repo data. It insists on stateless serverless
functions over an always-on server, and that the core product keeps working if these
services are down.

## Decision (proposed)

- A single `api/optional-serverless/` package holds independently deployable **stateless
  functions** (Cloudflare Workers preferred, aligned with
  [ADR-0004](0004-static-first-web-app-on-free-hosting.md)).
- Each function is added only when a concrete requirement lands, with its own mini-ADR
  noting: why a server is unavoidable, what data it touches, its retention, and its
  failure mode in the client.
- Likely first functions, in order of probability:
  1. **OAuth token exchange** — **done for GitHub**
     ([ADR-0024](0024-github-oauth-token-exchange-function.md)); GitHub has no PKCE.
     LinkedIn/Google to follow.
  2. **Payment/sponsorship webhooks** from the hosted store/checkout
     ([ADR-0018](0018-monetization-donations-and-no-backend-paid-features.md)).
  3. **Sponsored-repository submission + moderation** queue
     ([ADR-0017](0017-sponsorship-must-not-distort-scores.md)).
  4. **Anonymous, aggregate product analytics** (privacy-preserving, no PII).
- A serverless database is introduced only alongside a function that needs it, never
  ahead of need.
- The web app degrades gracefully: every feature that calls a function has a defined
  offline/unavailable behaviour.

## Consequences

- Introduces recurring cost potential (kept near $0 on free serverless tiers initially)
  and real operational/security responsibility — hence the per-function ADR gate.
- Enables monetization and community features that the pure client cannot do safely.

## Alternatives considered

- **Always-on Node server / container.** Rejected by the spec's non-goals.
- **BaaS (Supabase/Firebase) as the "backend".** Possible for the database slice later;
  still gated behind a concrete requirement and an ADR.

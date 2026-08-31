# 0016. Optional serverless API

- Status: Proposed (future)
- Date: 2026-08-30
- Deciders: Project owner

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
  1. **OAuth token exchange** (LinkedIn/Google) if public-client PKCE is insufficient.
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

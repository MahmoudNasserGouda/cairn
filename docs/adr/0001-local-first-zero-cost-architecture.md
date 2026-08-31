# 0001. Local-first, zero-cost architecture

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

Open Source Compass targets students, junior developers, and developers in emerging
markets. The product must be sustainable for a solo/small team with no funding. The
revised technical architecture mandates: $0 operating cost for the MVP, no
Open Source Compass (OSC) owned AI inference bill, no mandatory database, no mandatory
application backend, and maximum browser/device computation.

## Decision

We will build Open Source Compass as a **local-first** application. The core product —
profile building, repository and issue discovery, matching, health analysis, portfolio
generation — will run entirely in the user's browser against third-party APIs and local
storage. No OSC-owned infrastructure is required for the core experience.

Optional cloud services may be added later (see [ADR-0016](0016-optional-serverless-api.md))
only where they deliver clear business value, and the core product must keep working if
those services are unavailable.

## Consequences

- Infrastructure cost for the MVP is a domain name at most.
- All heavy logic must be implementable client-side; this constrains library choices.
- Cross-device sync, server-side analytics, and shared community data are explicitly
  deferred and require their own ADRs when introduced.
- Data durability depends on the user's browser storage; the portfolio export is the
  durable artifact.
- Open question: acceptable staleness windows for cached public data (tracked in
  [ADR-0006](0006-direct-github-api-usage.md)).

## Alternatives considered

- **Traditional SaaS (backend + Postgres + hosted AI).** Rejected: recurring cost,
  scaling risk, and an AI inference bill that does not fit the funding model.
- **Backend-optional but backend-default.** Rejected: a default backend accretes
  responsibilities and cost; "optional" must mean the core never depends on it.

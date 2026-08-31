# 0017. Sponsorship must not distort organic scores

- Status: Accepted (principle; enforcement deferred to when sponsorship ships)
- Date: 2026-08-30
- Deciders: Project owner

## Context

Phase 8 introduces sponsored repositories and sponsored learning resources. The spec is
explicit: sponsored content must be clearly labelled, and sponsorship must never
silently manipulate organic recommendation scores.

## Decision

- **Score integrity:** `libs/matching`, `libs/scoring`, and
  `libs/repository-analysis` take **no sponsorship input**. Sponsored status is not a
  feature, weight, or tiebreaker in any score
  ([ADR-0007](0007-deterministic-explainable-matching-engine.md),
  [ADR-0008](0008-ai-free-repository-health-engine.md)).
- **Separate surface:** sponsored repositories appear in a **distinct, visually
  labelled slot** ("Sponsored") separate from the organic recommendation list, with a
  disclosure link explaining the arrangement.
- **Same data, honest scores:** a sponsored repo still shows its real, unmodified match
  and health scores — including low ones.
- **No dark patterns:** sponsored items are not injected mid-list, not styled to mimic
  organic results, and are excluded from "recommended for you" counts.
- **Auditability:** the rule is enforced by tests that assert score functions ignore a
  `sponsored` flag, and by a documented review step before any sponsorship feature ships.

## Consequences

- Sponsorship revenue ([ADR-0018](0018-monetization-donations-and-no-backend-paid-features.md))
  is capped by how much clearly-labelled, non-deceptive placement users tolerate — an
  accepted trade-off for trust.
- The sponsorship pipeline itself needs [ADR-0016](0016-optional-serverless-api.md)
  (submission, moderation, billing) and is out of scope for the MVP.

## Alternatives considered

- **Gentle ranking boost for sponsors.** Rejected: this is exactly the silent
  manipulation the spec forbids.
- **No sponsored repos at all.** Viable fallback if labelled placement underperforms;
  donations and paid themes remain.

# 0007. Deterministic, explainable Matching Engine

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

The matching engine is a core business capability. The spec states it **must not depend
on AI** and must be deterministic and explainable, producing a Repository Match Score,
Issue Match Score, Contribution Confidence Score, and Skill Gap from user attributes and
repository/issue signals.

## Decision

`libs/matching` and `libs/scoring` implement a **pure, deterministic, synchronous**
scoring pipeline. No network calls, no AI, no randomness, no wall-clock reads inside the
scoring functions (time-derived inputs like "days since last commit" are computed by the
caller and passed in).

- Each score is a weighted sum of named sub-scores in `[0, 1]`, surfaced to the UI as a
  breakdown, e.g.:

  ```
  Repository Match: 91%
    Skill Match        40%
    Technology Match   25%
    Experience Match   15%
    Activity           10%
    Learning Value     10%
  ```

- **Weights live in a versioned config module** (`libs/scoring/weights.ts`), separate
  from UI code, and are overridable per user preset.
- Every score returns a structured explanation object (which inputs moved it, and by how
  much) that the UI renders as "why this match".
- Fully unit-tested with fixed fixtures; snapshot tests lock behaviour so weight changes
  are deliberate and reviewed.

## Consequences

- Results are reproducible and debuggable; support questions ("why 40%?") are answerable.
- Tuning weights is a reviewed config change with test churn, not a silent tweak.
- AI features may *present* or *summarise* match results but must never be required to
  produce them ([ADR-0009](0009-byok-ai-optional-enhancement.md)).
- Sponsored placement must not feed into these scores
  ([ADR-0017](0017-sponsorship-must-not-distort-scores.md)).

## Alternatives considered

- **LLM-scored matching.** Rejected: non-deterministic, costly, unexplainable, and a
  platform dependency the spec forbids.
- **Opaque ML ranking model.** Rejected for the MVP: no training data, and it defeats
  the explainability requirement.

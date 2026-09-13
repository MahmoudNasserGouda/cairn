# 0033. The AI capability is frozen behind a flag

- Status: Accepted
- Date: 2026-09-13
- Deciders: Project owner
- Refines: [ADR-0009](0009-byok-ai-optional-enhancement.md),
  [ADR-0010](0010-ai-key-privacy-and-data-disclosure.md)

## Context

The BYOK AI layer was wired end to end on 2026-09-12: a `/settings` page holding the
user's own provider, model and key in an isolated `secrets` IndexedDB store; one
`AiService` through which every call must pass; a per-action disclosure panel showing the
verbatim payload; and two consumers — a written issue explanation and an AI re-read of an
imported CV. It works, and it respects every constraint
[ADR-0009](0009-byok-ai-optional-enhancement.md) and
[ADR-0010](0010-ai-key-privacy-and-data-disclosure.md) set.

It is also ahead of the product underneath it.

The profile the AI enhances holds seven fields. GitHub is read through four REST
endpoints. The CV parser discards the document geometry pdf.js hands it. LinkedIn
contributes a display name. The optional layer is more finished than the deterministic
core it is supposed to be optional *to* — and ADR-0009's own premise is that "a useful
non-AI mode always exists". That mode is currently the weaker half.

The project owner's direction: keep the AI feature for the future, stop working on it now.

## Decision

The AI capability is **frozen**, not removed.

- A single flag — `FEATURES.ai` in `libs/shared/src/config.ts`, **`false` by default** —
  gates every AI entry point: the `/settings` AI panel, the disclosure dialog mounted in
  `app.component.ts`, the dashboard's AI issue explanation, and the "Re-read this CV with
  AI" control on the profile page.
- With the flag off the shipped product is **entirely AI-free**. No provider call is
  reachable, no key can be entered, no AI control renders. The deterministic fallbacks
  (`libs/ai/src/fallback.ts`, `explainIssueWithoutAI`) are no longer "shown first" — they
  are all there is.
- `libs/ai` and `apps/web/src/app/core/ai/` **stay in the repository, stay typechecked,
  and stay in CI with their tests passing.** Frozen, not rotting. A frozen library whose
  tests are skipped is a library that has silently broken.
- No new AI feature is built, and no existing one is extended, while this ADR stands.
  `libs/ai` is touched only when a refactor elsewhere requires it to keep compiling.
- ADRs [0009](0009-byok-ai-optional-enhancement.md) and
  [0010](0010-ai-key-privacy-and-data-disclosure.md) remain **Accepted and unamended**.
  Their terms are what unfreezing must still satisfy; this ADR changes the schedule, not
  the rules.

Unfreezing is flipping one constant, and is a product decision, not an architectural one.

## Consequences

- Engineering effort moves to the fundamentals: profile depth, data sources, CV reading,
  design ([ADR-0028](0028-ocr-and-document-vision-sandbox.md)–
  [0032](0032-design-system-and-information-architecture.md)).
- The product surface gets smaller and more honest. Every number a user sees is
  deterministic and explainable, which is what
  [ADR-0007](0007-deterministic-explainable-matching-engine.md) and
  [ADR-0008](0008-ai-free-repository-health-engine.md) always wanted the default to be.
- A flagged-off code path is a code path nobody exercises. The mitigation is that the
  tests still run: `libs/ai`'s own suite is unconditional, and the app-layer tests cover
  both flag states so the gating itself is tested rather than assumed.
- The isolated `secrets` IndexedDB store stays in the schema. It is where
  [ADR-0030](0030-github-graphql-profile-read.md)'s optional read-only GitHub PAT lives,
  so it has a second tenant and does not become dead schema.
- No data is orphaned: nothing caches an AI response today
  (PROJECT_GUIDE open questions), so freezing strands nothing. A user who already stored a
  key keeps it in `secrets` and can still clear it — the clear control stays reachable
  while a key exists, even with the flag off.

## Alternatives considered

- **Leave the AI features visible and simply build nothing new.** Rejected: it leaves the
  most polished surface in the product pointing at its weakest data, and it works against
  the parallel goal of an interface that does not read as machine-made.
- **Delete `libs/ai` and the app wiring.** Rejected: it is finished, correct, and
  expensive to rebuild; the disclosure panel in particular encodes
  [ADR-0010](0010-ai-key-privacy-and-data-disclosure.md) in code.
- **Keep the flag on in development, off in production.** Rejected: two shapes of the app,
  one of which nobody uses, is how a flag rots. One default, both states tested.

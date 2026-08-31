# 0005. Angular + TypeScript + shared-core monorepo

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

The spec recommends Angular + TypeScript for the web app and envisions three clients
(web, browser extension, future desktop) sharing common core libraries. It suggests a
monorepo with `apps/*`, `libs/*`, and a future `api/`, and notes Nx "may be considered
if its benefits outweigh its complexity".

## Decision

We will use a **single Git monorepo** with:

```
apps/        web, extension, (desktop — future)
libs/        github, profile, matching, scoring, repository-analysis,
             issue-analysis, portfolio, ai, shared
api/         optional-serverless — future, empty for now
```

- **Language:** TypeScript everywhere, `strict` mode on.
- **Web app framework:** Angular (standalone components, typed reactive forms,
  Angular Router).
- **`libs/*` are framework-agnostic** plain TypeScript (no Angular imports) so the
  extension and a future desktop client can reuse them. Angular-specific glue lives in
  `apps/web`.
- **Nx: not adopted now.** Start with npm workspaces + project references. Revisit Nx
  when build times or the affected-graph justify it; capture that as a new ADR.

## Consequences

- A clear dependency rule: `apps/*` may depend on `libs/*`; `libs/*` never depend on
  `apps/*`; `libs/*` avoid framework and DOM globals except where a lib is explicitly
  browser-only (e.g. `libs/shared` storage).
- Lint rules (import boundaries) must enforce the layering.
- Without Nx, task orchestration is hand-rolled npm scripts; acceptable at current size.
- The extension build ([ADR-0014](0014-browser-extension-reuses-shared-core.md)) consumes
  `libs/*` as source, not as published packages.

## Alternatives considered

- **Nx from the start.** Deferred: real value (caching, affected graph, generators) but
  added conceptual load for a small team at MVP; the layout above keeps the door open.
- **Polyrepo with published packages.** Rejected: version-bump friction dominates at
  this scale.
- **React / Svelte.** Out of scope — the spec fixes Angular; revisiting would need its
  own ADR and a strong reason.

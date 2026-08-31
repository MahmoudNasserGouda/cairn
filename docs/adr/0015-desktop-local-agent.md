# 0015. Desktop / local agent

- Status: Proposed (future)
- Date: 2026-08-30
- Deciders: Project owner

## Context

The spec envisions a future desktop client for deep analysis of locally cloned
repositories: local repo → Cairn Desktop → repository analyzer → local AI or BYOK AI →
architecture / contribution guidance, with potential Ollama integration and no Cairn AI
inference cost.

## Decision (proposed)

When built, the desktop client will:

- Reuse `libs/*` ([ADR-0005](0005-angular-typescript-shared-core-monorepo.md)) and add a
  `libs/repository-analysis` local mode that reads the working tree and full Git history
  directly (no API quota).
- Support **local models via Ollama** (or any OpenAI-compatible local runtime) through
  the same `IAIProvider` abstraction ([ADR-0009](0009-byok-ai-optional-enhancement.md)),
  plus BYOK cloud providers.
- Ship as a thin shell (Tauri preferred over Electron for size/security) around the
  shared core.
- Keep all analysis and data on the user's machine; no phone-home.

## Consequences

- Deep, quota-free architecture analysis and reading-order generation become possible.
- New attack surface (filesystem access, spawning a local model runtime) needs its own
  security pass before release.
- Not in the hackathon or early-launch scope; this ADR exists to keep the shared-core
  boundary honest so the desktop client is an addition, not a rewrite.

## Alternatives considered

- **Electron.** Larger footprint, heavier security burden than Tauri.
- **CLI-only tool.** Possible earlier, smaller step; could precede the GUI desktop app.
- **Do server-side deep analysis instead.** Rejected: cost and the point is to use the
  user's own machine.

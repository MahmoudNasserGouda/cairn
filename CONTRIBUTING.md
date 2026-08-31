# Contributing to Open Source Compass

## Setup

```bash
nvm use            # Node 22.13.0 (see .nvmrc)
npm ci
npm run verify     # format + lint + typecheck + test + CSP guard
```

Git hooks are installed automatically (`prepare` script → `.githooks`). They run
`gitleaks` (if installed) and Prettier on staged files.

## Layout

See [`ARCHITECTURE.md`](ARCHITECTURE.md) §5 and [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md).

- `libs/*` — framework-agnostic TypeScript. **No Angular, no RxJS, no DOM globals**
  (except `libs/shared`). Enforced by ESLint.
- `apps/web` — Angular 20, standalone, zoneless.
- `apps/extension` — Manifest V3, built with esbuild.

## Rules

- **`apps/*` may import `libs/*`; never the reverse.**
- Scoring must stay deterministic — no `Date.now()`, `Math.random()`, or IO inside
  `libs/scoring`, `libs/matching`, `libs/repository-analysis`, `libs/issue-analysis`.
  Changing weights means bumping `WEIGHTS_VERSION` and updating snapshots on purpose.
- Every AI feature needs a non-AI fallback.
- All externally-sourced text is sanitised before rendering
  (`SafeHtmlService` / `stripToText`).
- New runtime dependency or new outbound origin → call it out in the PR; expect
  security review. Add origins to `libs/shared/src/config.ts` **and**
  `apps/web/public/_headers`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## Commands

| Command | What |
| --- | --- |
| `npm run verify` | The full local gate |
| `npm test` / `npm run test:watch` | Unit tests (Vitest) |
| `npm run build` | libs + web + extension |
| `npm run guard` | CSP + bundle-origin guards |
| `npm run -w @osc/web start` | Dev server |
| `npm run -w @osc/extension build:watch` | Rebuild the extension on change |

## Security

Read [`SECURITY.md`](SECURITY.md). The non-negotiables list there is enforced by CI
(`scripts/check-csp.mjs`, `scripts/check-bundle-origins.mjs`, CodeQL, gitleaks, OSV).
Report vulnerabilities per `SECURITY.md` §6 — do not open a public issue.

# 0022. CI/CD is mandatory infrastructure

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

Project owner direction (2026-08-30): CI/CD is a requirement, not optional, and belongs
in the architecture from day one. The project is local-first with free static hosting
([ADR-0004](0004-static-first-web-app-on-free-hosting.md)) and security-first
([ADR-0019](0019-security-first-rendering.md),
[ADR-0021](0021-supply-chain-and-dependency-security.md)).

## Decision

- **GitHub Actions** is the CI/CD platform (free for public repos; no added infra).
- **The pipeline is the only path to production.** No manual deploys; branch protection
  on `main` requires all checks green and at least one review; no direct pushes.
- **Required checks on every PR:** install (`npm ci`, cached) → format check → lint
  (incl. import-boundary rules from
  [ADR-0005](0005-angular-typescript-shared-core-monorepo.md)) → typecheck (`tsc
  --strict`) → unit tests with a coverage gate → build all apps → **CodeQL SAST** →
  **dependency/OSV scan** → **secret scan (gitleaks)** → **license check** →
  CSP/`bypassSecurityTrust` guard → bundle-size budget.
- **SBOM** (CycloneDX) generated on release.
- **Preview deploy** per PR (Cloudflare Pages preview); **production deploy** of
  `apps/web` on merge to `main`; **extension artifact** built in CI, with a manual
  approval gate for store submission.
- **Conventional Commits** + automated changelog + semantic version tags.
- **CI secrets** limited to deploy tokens, stored as encrypted GitHub secrets, not
  exposed to fork PRs; workflow `permissions` least-privilege; actions pinned by SHA.
- Full detail and the pipeline diagram: [docs/ci-cd.md](../ci-cd.md).

## Consequences

- Contributor changes cannot merge until the security and quality gates pass — slower,
  intentionally.
- Some checks (CodeQL, full build) add minutes; caching and `paths` filters keep PR
  feedback reasonable. Nx affected-graph is a future optimisation
  ([ADR-0005](0005-angular-typescript-shared-core-monorepo.md)).
- Free-tier build minutes are ample for a public repo; a private repo would need a
  minutes budget.

## Alternatives considered

- **Manual build + drag-drop deploy for the hackathon, CI later.** Rejected by project
  owner direction and because the security gates are the point.
- **Cloudflare Pages Git integration doing the build.** Used for previews, but the
  authoritative build + all gates run in GitHub Actions so security checks are
  non-bypassable.

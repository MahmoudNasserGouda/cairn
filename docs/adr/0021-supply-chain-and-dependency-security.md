# 0021. Supply-chain and dependency security

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

A static client-side app ships **all its code to the browser**, including every
dependency. A single compromised npm package can exfiltrate the user's GitHub token and
BYOK keys. Security is the #1 requirement, so the dependency supply chain is in scope
from day one.

## Decision

- **Minimal dependency surface.** New runtime dependencies require justification in the
  PR; prefer the platform (Web Crypto, `fetch`, `Intl`, `structuredClone`) over a
  library. No dependency is added for something a few lines of code solve.
- **Lockfile committed**, `npm ci` everywhere, exact versions (no `^`/`~` on runtime
  deps for security-sensitive packages).
- **Automated scanning in CI** ([docs/ci-cd.md](../ci-cd.md)): OSV / `npm audit`
  (fail on high/critical), license allowlist check, and a bundle-content check that the
  production bundle contains no unexpected new origins in `connect-src`.
- **Renovate** (or Dependabot) for updates, grouped, with the full CI suite gating merge.
- **CI actions pinned by commit SHA**, not tag; the CI runner has least-privilege
  `GITHUB_TOKEN` permissions.
- **Secret scanning** (gitleaks) in CI and as a pre-commit hook; the repo contains no
  secrets ([ADR-0020](0020-oauth-token-and-byok-key-handling.md)). The license-signing
  private key ([ADR-0018](0018-monetization-donations-and-no-backend-paid-features.md))
  lives only in the issuer's environment.
- **SBOM** (CycloneDX) generated per release and published as a build artifact.
- **Subresource Integrity** on any unavoidable external asset; goal is zero external
  runtime assets (self-host fonts, etc.), consistent with the CSP in
  [ADR-0019](0019-security-first-rendering.md).
- **`npm` provenance / publish** not applicable (nothing published) except a future
  extension bundle, which is built only in CI.

## Consequences

- Slower dependency adoption and more code review; accepted for the risk reduction.
- Contributors must run the pre-commit hooks; CI is the backstop.
- Bundle-origin and license checks may produce false positives that need an allowlist
  entry with a reviewed reason.

## Alternatives considered

- **Trust npm + occasional `npm audit`.** Rejected as insufficient for an app that
  ships user credentials to the same context as third-party code.
- **Vendoring all dependencies.** Rejected: maintenance burden outweighs benefit given
  the small, pinned dependency set.

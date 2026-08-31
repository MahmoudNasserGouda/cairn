# Branch protection configuration

Apply to `main` (GitHub → Settings → Branches → Add rule). This is the
non-bypassable enforcement point for [ADR-0022](adr/0022-ci-cd-is-mandatory-infrastructure.md).

## Required settings

- **Require a pull request before merging** — 1 approval, dismiss stale approvals,
  require review from Code Owners.
- **Require status checks to pass**, require branches up to date. Required checks:
  - `CI passed` (the `ci-ok` job — aggregates verify, build, dependency-scan, secret-scan)
  - `Analyze (javascript-typescript)` (CodeQL)
- **Require conversation resolution before merging.**
- **Require linear history.**
- **Do not allow bypassing the above** (applies to admins).
- **Restrict who can push** — no direct pushes; PRs only.
- Block force pushes and deletions.

## Environments (Settings → Environments)

- `production` — required reviewers, deploy token `CLOUDFLARE_PAGES_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`.
- `github-pages` — default Pages environment.
- `extension-store` — required reviewer (manual gate before store submission),
  `CHROME_STORE_*` / `FIREFOX_AMO_*` secrets.

## Secrets (Settings → Secrets and variables → Actions)

Only deploy/publish tokens. No application runtime secrets exist
([SECURITY.md](../SECURITY.md) section 5). Secrets are not exposed to fork PRs;
deploy jobs only run on `push` to `main`.

## First-time setup

1. Enable GitHub Pages (Source: GitHub Actions).
2. Create the three environments above with their secrets and reviewers.
3. Enable CodeQL default setup is **off** — this repo uses the `codeql.yml` workflow.
4. Enable Dependabot alerts + secret scanning + push protection (Settings → Code security).
5. Add Renovate (or keep Dependabot) — see [`renovate.json`](../renovate.json).

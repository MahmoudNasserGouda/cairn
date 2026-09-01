# Branch protection configuration

Apply to `main` (GitHub → Settings → Branches → Add rule). This is the
non-bypassable enforcement point for [ADR-0022](adr/0022-ci-cd-is-mandatory-infrastructure.md).

## Required settings

- **Require a pull request before merging** — dismiss stale approvals, require review
  from Code Owners. Approval count depends on mode (see below).
- **Require status checks to pass**, require branches up to date. Required checks:
  - `CI passed` (the `ci-ok` job — aggregates verify, build, dependency-scan, secret-scan)
  - `Analyze (javascript-typescript)` (CodeQL)
- **Require conversation resolution before merging.**
- **Require linear history.**
- **Restrict who can push** — no direct pushes; PRs only.
- Block force pushes and deletions.

## Solo vs team mode

The status checks, linear history, and force-push/deletion blocks are **always on**.
Only the human-review gate changes with team size.

| Setting | Solo mode (current) | Team mode (≥ 2 maintainers) |
|---|---|---|
| Required approvals | **0** | **1** |
| Bypass list | Repository admin (so the sole maintainer can merge) | **empty** — no bypass, admins included |
| Rationale | one person cannot approve their own PR; checks + CodeQL still gate every merge | independent review restored; "Do not allow bypassing" enforced |

**Switching to team mode** when a second maintainer joins: set required approvals to
`1`, clear the ruleset bypass list, and enable **Do not allow bypassing the above**.
Nothing else changes. Update the "current" column here when you do.

## Environments (Settings → Environments)

- `production` — required reviewers, deploy token `CLOUDFLARE_PAGES_TOKEN` (must carry
  the **Workers Scripts: Edit** permission — deploy uses `wrangler deploy`, not Pages;
  secret name kept for continuity), `CLOUDFLARE_ACCOUNT_ID`.
- `extension-store` — required reviewer (manual gate before store submission),
  `CHROME_STORE_*` / `FIREFOX_AMO_*` secrets (deferred until first store submission).

## Secrets (Settings → Secrets and variables → Actions)

Only deploy/publish tokens. No application runtime secrets exist
([SECURITY.md](../SECURITY.md) section 5). Secrets are not exposed to fork PRs;
deploy jobs only run on `push` to `main`.

## First-time setup

1. Create the environments above with their secrets and reviewers.
2. CodeQL default setup is **off** — this repo uses the `codeql.yml` workflow.
3. Enable Dependabot alerts + secret scanning + push protection (Settings → Code security).
4. Add Renovate (or keep Dependabot) — see [`renovate.json`](../renovate.json).

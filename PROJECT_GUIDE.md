# Cairn — Project Guide

The living orientation document for this repo: **where things are and how we work.**
This is a snapshot with a changelog, not a real-time view. The authoritative record of
decisions is [`docs/adr/`](docs/adr/README.md). Kept current by the
[`update-project-guide`](.claude/skills/update-project-guide/SKILL.md) skill
([ADR-0023](docs/adr/0023-living-project-guide-via-skill.md)) — run it after every phase
or meaningful step.

## Product in one line

Cairn helps students, junior devs, and developers in emerging markets discover
open-source projects, understand codebases, contribute, and turn contributions into a
career. (Renamed from "Open Source Compass" 2026-08-31 — the compass was only the
discovery slice; internal npm scope is `@cairn/*`, component prefix `cn-`.) Full
context: [`ARCHITECTURE.md`](ARCHITECTURE.md) §1; roadmap: [§15](ARCHITECTURE.md#15-roadmap--architecture-mapping).

## Current status

**Phase 1 — Foundation. Monorepo + CI/CD live; the web app is deployed on two hosts.**

Done:

- Architecture docs: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md),
  [`docs/ci-cd.md`](docs/ci-cd.md), ADRs 0001–0023.
- **Monorepo scaffold** — npm workspaces, TS strict, path aliases, ESLint flat config
  with the `libs → apps` import-boundary rule, Prettier, Vitest.
- **All nine `libs/*` implemented** with real logic and **68 passing unit tests**:
  deterministic matching + scoring, AI-free repository health, issue difficulty, the
  cached GitHub client (dedup + ETag + rate-limit floor), CV parser + skills taxonomy,
  BYOK AI provider abstraction + non-AI fallbacks + prompt-injection fencing,
  client-side portfolio generator + offline Ed25519 license verification.
- **`apps/web`** — Angular 20 standalone + zoneless, hash routing, DOMPurify sanitiser
  service, IndexedDB store, dashboard + repository-analysis pages. Production build
  ≈ 64 kB transfer.
- **`apps/extension`** — Manifest V3, esbuild build, GitHub content-script panel using
  the shared engines via a background service worker.
- **CI/CD** — `.github/workflows/ci.yml` (verify · build · dependency-scan ·
  secret-scan · SBOM · `ci-ok` gate), `codeql.yml`, `deploy.yml` (Cloudflare Workers +
  GitHub Pages + extension artifact behind a manual gate). Custom guards:
  `check-csp.mjs`, `check-bundle-origins.mjs`, `check-licenses.mjs`.
- `npm run verify` passes; `npm audit` clean (0 vulnerabilities).
- **Repo is on GitHub** (`MahmoudNasserGouda/cairn`, default `main`). Branch protection
  active — currently **solo mode**: required checks (`CI passed`, CodeQL `Analyze`) +
  linear history + no force-push, but **0 required approvals** and an admin bypass so
  the sole maintainer can merge (see drift note, 2026-09-02 changelog).
- **Web app is live** on both hosts:
  - Cloudflare Workers (primary) — `https://cairn.mahmoudnasser98.workers.dev/`
  - GitHub Pages (mirror) — `https://mahmoudnassergouda.github.io/cairn/`
    (served under `/cairn/`; `deploy.yml` rewrites `<base href>` for this copy).
  `production` / `github-pages` / `extension-store` environments exist;
  `extension-store` secrets deferred until store submission.

Next:

1. GitHub OAuth (Authorization Code + PKCE) → first real unified-profile slice
   ([ADR-0020](docs/adr/0020-oauth-token-and-byok-key-handling.md)).
2. Wire the CV upload flow: sandboxed Web Worker text extraction → `parseCvText`.
3. Readiness dashboard on the real profile (replace `DEMO_*` fixtures).

## Repo map

```
apps/web/                  Angular 20 SPA — primary MVP                 [built: shell + 2 pages]
  src/app/core/            SafeHtmlService (DOMPurify), IndexedDbStore
  src/app/pages/           dashboard, repositories
  public/_headers          host security headers + CSP (Cloudflare Workers / GH Pages)
  wrangler.toml            Cloudflare Workers static-assets deploy config
apps/extension/            Manifest V3 extension (esbuild)              [built: content + background]
apps/desktop/              Tauri local agent                           [future — ADR-0015]
libs/shared/               Result, math, redacting logger, KeyValueStore, sanitizer contract, config
libs/scoring/              weightedScore + explanation, versioned WEIGHTS (WEIGHTS_VERSION=1)
libs/matching/             repositoryMatch / issueMatch / contributionConfidence / skillGap
libs/repository-analysis/  healthScore (AI-free), architecture model + readingOrder
libs/issue-analysis/       analyzeIssue — deterministic difficulty + required-knowledge
libs/github/               GithubClient (cache + dedup + ETag + rate-limit), repo/health fetchers
libs/profile/              UnifiedProfile + mergeProfile, CV parser, skills taxonomy (v1)
libs/portfolio/            metrics, static HTML/MD generator, Ed25519 license verify
libs/ai/                   IAIProvider (OpenAI/Gemini/OpenRouter), fenced prompts, disclosure, fallbacks
api/optional-serverless/   stateless functions                         [future — ADR-0016]
scripts/                   check-csp, check-bundle-origins, check-licenses, setup-hooks
brand/                     logo.svg / logo-dark.svg / mark.svg + brand/README.md
docs/adr/                  23 ADRs · docs/ci-cd.md · docs/branch-protection.md
```

## How we work (conventions)

- **Runtime:** Node `22.13.0` (`.nvmrc`). **Package manager:** npm workspaces.
- **Language:** TypeScript `~5.8` strict everywhere. `libs/*` are framework-free
  (except `libs/shared`, browser-only); `apps/*` → `libs/*` only, never the reverse —
  ESLint `no-restricted-imports` enforces it, plus no `@angular/*` / `rxjs` in `libs/*`.
- **Test runner: Vitest** (resolved open question). Engine libs are pure and
  snapshot-tested; coverage gate 70% in `vitest.config.ts`.
- **Determinism:** no `Date.now()` / `Math.random()` / IO inside `libs/scoring`,
  `libs/matching`, `libs/repository-analysis`, `libs/issue-analysis`. Time-derived
  inputs are computed by the caller and passed in.
- **Weights:** changing one means bumping `WEIGHTS_VERSION` in
  `libs/scoring/src/weights.ts` and updating inline snapshots on purpose.
- **AI is optional** — every AI feature has a non-AI fallback (`libs/ai/src/fallback.ts`).
- **Commits:** Conventional Commits. **Branches:** no direct push to `main`; PR + 1
  review + all required checks (see [`docs/branch-protection.md`](docs/branch-protection.md)).

## Security non-negotiables

Full list: [`SECURITY.md`](SECURITY.md) §8. Enforced by CI (`check-csp.mjs`,
`check-bundle-origins.mjs`, CodeQL, gitleaks, OSV, license guard). Short version:

1. No `unsafe-inline` / `unsafe-eval` in **script** CSP directives. `style-src
   'unsafe-inline'` is a ratified exception for Angular component styles (2026-08-31)
   and permitted nowhere else. No `bypassSecurityTrust*` without a reviewed, marked
   (`cairn-security-reviewed`) exception — one ratified: `SafeHtmlService.trust()`,
   post-DOMPurify + post-Angular-sanitizer only.
2. All external content (GitHub, AI, CV, user free-text) is sanitised before rendering.
3. OAuth tokens and BYOK keys: never logged, never sent to Cairn, never in URLs.
4. No secret is committed to the repo.
5. OAuth is Authorization Code + PKCE with an exact redirect-URI allowlist.
6. New runtime dependencies and new outbound origins need explicit review; origins go in
   `libs/shared/src/config.ts` **and** `apps/web/public/_headers`.
7. The core product stays functional and safe with no backend and no AI key.

## How to run / build / test / deploy

```bash
npm ci
npm run verify        # format + lint + typecheck + test(+coverage) + CSP guard
npm test              # Vitest only            npm run test:watch
npm run build         # libs (tsc) + web (ng) + extension (esbuild)
npm run guard         # check-csp + check-bundle-origins
npm run -w @cairn/web start                 # Angular dev server
npm run -w @cairn/extension build:watch     # rebuild extension on change
```

Deploy is **CI-only** (`.github/workflows/deploy.yml`, on push to `main`):
Cloudflare Workers static assets (primary, `apps/web/wrangler.toml`) + GitHub Pages
(mirror) + extension artifact (manual store gate). Details:
[`docs/ci-cd.md`](docs/ci-cd.md).

## Decisions & open questions

- **Decisions:** [`docs/adr/`](docs/adr/README.md) — 23 ADRs. Accepted: 0001–0014,
  0017–0023. Future: 0015 (desktop), 0016 (serverless API).
- **Open questions:**
  - Per-resource cache TTLs — draft values in `libs/shared/src/config.ts`
    (`CACHE_TTL_MS`); still need calibration ([ADR-0006](docs/adr/0006-direct-github-api-usage.md)).
  - LinkedIn/Google OAuth: public-client PKCE from a static origin, or a token-exchange
    function at MVP? ([ADR-0020](docs/adr/0020-oauth-token-and-byok-key-handling.md),
    [ADR-0012](docs/adr/0012-linkedin-as-oauth-identity-only.md)).
  - Health-engine thresholds need a calibration data set
    ([ADR-0008](docs/adr/0008-ai-free-repository-health-engine.md)).
  - ~~Jest vs Vitest~~ → **Vitest** (2026-08-31).
  - ~~`style-src 'unsafe-inline'` CSP exception~~ → **ratified 2026-08-31**; wording
    updated in [ADR-0019](docs/adr/0019-security-first-rendering.md) and `SECURITY.md` §8.
  - GitHub Actions pinned by tag, not SHA, on first commit — Renovate
    (`helpers:pinGitHubActionDigests`) converts them on its first PR.

## Changelog

### 2026-09-02 — Live on GitHub + two-host deploy

- **Pushed to GitHub** (`MahmoudNasserGouda/cairn`). Enabled Dependabot alerts, secret
  scanning + push protection, and private vulnerability reporting. Branch protection
  applied to `main` (required checks, linear history, no force-push/deletion).
- **Web deploy moved Cloudflare Pages → Cloudflare Workers static assets** (PR #1):
  `apps/web/wrangler.toml` (assets-only, `dist/browser`, SPA fallback); `deploy.yml`
  `deploy-cloudflare` job now runs `wrangler deploy`. Free `*.workers.dev` subdomain,
  no paid custom domain. Canonical URL updated in `security.txt`. **ADR-0004 amended.**
- **Fixed the GitHub Pages mirror** (PR #5): it 404'd because it published the artifact
  root (no `index.html`) instead of `dist/browser/`, and shipped `<base href="/">`
  while Pages serves under `/cairn/`. `deploy.yml` now publishes `dist/browser` and
  rewrites the base href for the Pages copy only. Both hosts now serve the app.
- **CI fix** (PR #1): `gitleaks-action@v2` now requires `GITHUB_TOKEN`; added it to the
  `secret-scan` job.
- Sections updated: Status (phase line + Done/Next), this changelog. Deploy details in
  "How to run / build / test / deploy" were updated with the Workers switch.
- **Extension distribution decided:** Chrome Web Store + Firefox AMO, both deferred
  (not self-hosting). No code/CI change yet.
- **⚠ DRIFT (2 items, need an owner decision):**
  1. **Branch protection is looser than [`docs/branch-protection.md`](docs/branch-protection.md).**
     That doc mandates *1 approval* and *do not allow bypassing (admins included)*. The
     live `main` ruleset has **0 required approvals** and an **admin bypass** so the
     solo maintainer can merge. Reasonable while solo, but the doc and the config
     disagree. Fix: add a "solo mode vs team mode" section to the doc, or restore the
     stricter rule once a second maintainer joins.
  2. **No CSP / security headers on the GitHub Pages mirror.** GitHub Pages ignores the
     `_headers` file, so the mirror serves with none of the CSP or security headers
     that Cloudflare applies ([SECURITY.md](SECURITY.md) §8.1–8.2 are met on the
     primary only). Options: accept the mirror as best-effort and document it, inject
     a `<meta http-equiv="Content-Security-Policy">` fallback into the Pages
     `index.html` during deploy, or drop the mirror.

### 2026-08-31 — Rename to Cairn + publish prep

- Renamed the product **Open Source Compass → Cairn** ("compass" described only
  discovery; the product spans profile → discovery → understanding → portfolio →
  career). Mechanical sweep across all tracked files: npm scope `@osc/* → @cairn/*`,
  root package `cairn`, Angular selector prefix `osc- → cn-`, marker
  `osc-security-reviewed → cairn-security-reviewed`, IndexedDB name `cairn`.
  `npm audit` clean; `verify` + `build` + guards green after relink.
- Added `brand/` assets (cairn = stacked trail stones) + `favicon.svg` wired into the
  web app; header shows the mark.
- Hardened `.gitignore` (env / keys / certs / `*.pem` / license-signing key / CI creds /
  editor files / caches). Confirmed no secrets and no build output are tracked.
- Filled placeholders: `@OWNER → @MahmoudNasserGouda`; `security.txt` + `SECURITY.md`
  §6 now point at GitHub private advisories + `mahmoudnasser98@gmail.com`. Deploy
  target `https://cairn.mahmoudnasser98.workers.dev/` (free `workers.dev` subdomain;
  custom domain deferred — costs money).
- Rewrote `README.md` for a public audience. Added `.claude/launch.json`.
- Guide updated: header, Product one-liner, Repo map, this changelog.
- Drift: none.

### 2026-08-31 — Phase 1: monorepo + CI/CD scaffold

- Built the full workspace: 9 `libs/*` with real implementations and 68 passing Vitest
  tests, `apps/web` (Angular 20 zoneless, builds to ~64 kB), `apps/extension` (MV3 +
  esbuild). Framework-free lib boundary enforced by ESLint.
- CI/CD: `ci.yml` (verify · build · OSV/audit/licenses · gitleaks · SBOM · `ci-ok`
  aggregate gate), `codeql.yml`, `deploy.yml` (Cloudflare + GitHub Pages + extension
  artifact). Guards `check-csp.mjs`, `check-bundle-origins.mjs`, `check-licenses.mjs`
  wired in. `_headers` carries the strict CSP + security headers.
  Governance: `CODEOWNERS`, PR template, `docs/branch-protection.md`, `CONTRIBUTING.md`.
- New runtime deps (all expected / reviewed): the Angular 20 packages
  ([ADR-0005](docs/adr/0005-angular-typescript-shared-core-monorepo.md)), `rxjs`,
  `tslib`, and **`dompurify`** for the sanitiser
  ([ADR-0019](docs/adr/0019-security-first-rendering.md)). `npm audit` clean.
- Resolved: test runner = Vitest. Node pinned to 22.13.0.
- Guide sections updated: Status, Repo map, Conventions, Security non-negotiables,
  How to run/build/test/deploy, Decisions & open questions.
- Drift raised, **both accepted by the owner 2026-08-31 and folded into the docs:**
  1. CSP `style-src 'self' 'unsafe-inline'` for Angular component styles on a
     nonce-less static host. `script-src` stays strict `'self'`. `check-csp.mjs`
     permits `unsafe-inline` only in `style-src`. Wording updated in
     [ADR-0019](docs/adr/0019-security-first-rendering.md) and `SECURITY.md` §8.
  2. `SafeHtmlService.trust()`'s `bypassSecurityTrustHtml` (post-DOMPurify +
     post-Angular-sanitizer), marked `cairn-security-reviewed` — recorded as the one
     ratified exception in ADR-0019 and `SECURITY.md` §8.

### 2026-08-31 — CSP + sanitizer exceptions ratified

- Owner accepted both drift items. `SECURITY.md` §8 non-negotiable 1 and
  [ADR-0019](docs/adr/0019-security-first-rendering.md) (Status: amended 2026-08-31)
  now scope the `unsafe-inline` ban to script directives, record `style-src
  'unsafe-inline'` as an Angular-only exception, and name `SafeHtmlService.trust()`
  as the single reviewed `bypassSecurityTrust*` use.
- No code change — `check-csp.mjs` already enforced exactly this.

### 2026-08-30 — Architecture documentation

- Turned the product spec + local-first/zero-cost strategy into structured docs:
  `ARCHITECTURE.md`, `SECURITY.md`, `docs/ci-cd.md`, and ADRs 0001–0023.
- Incorporated project owner direction: security #1; CI/CD mandatory; donations +
  no-backend paid features live from the MVP
  ([ADR-0018](docs/adr/0018-monetization-donations-and-no-backend-paid-features.md));
  guide maintained via a skill
  ([ADR-0023](docs/adr/0023-living-project-guide-via-skill.md)).
- Created this guide and the `update-project-guide` skill.
- Drift: none (no code yet).

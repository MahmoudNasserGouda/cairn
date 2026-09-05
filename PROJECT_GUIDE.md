# Rujoom — Project Guide

The living orientation document for this repo: **where things are and how we work.**
This is a snapshot with a changelog, not a real-time view. The authoritative record of
decisions is [`docs/adr/`](docs/adr/README.md). Kept current by the
[`update-project-guide`](.claude/skills/update-project-guide/SKILL.md) skill
([ADR-0023](docs/adr/0023-living-project-guide-via-skill.md)) — run it after every phase
or meaningful step.

## Product in one line

Rujoom helps students, junior devs, and developers in emerging markets discover
open-source projects, understand codebases, contribute, and turn contributions into a
career. (Renamed from "Open Source Compass" 2026-08-31 — the compass was only the
discovery slice; internal npm scope is `@cairn/*`, component prefix `cn-`.) Full
context: [`ARCHITECTURE.md`](ARCHITECTURE.md) §1; roadmap: [§15](ARCHITECTURE.md#15-roadmap--architecture-mapping).

## Current status

**Phase 1 — Foundation. Monorepo + CI/CD live, web app deployed, multi-provider
sign-in working, real GitHub profile feeding the dashboard.**

Done:

- Architecture docs: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md),
  [`docs/ci-cd.md`](docs/ci-cd.md), ADRs 0001–0025.
- **Monorepo scaffold** — npm workspaces, TS strict, path aliases, ESLint flat config
  with the `libs → apps` import-boundary rule, Prettier, Vitest.
- **Ten `libs/*` implemented** with real logic and **92 passing unit tests**:
  deterministic matching + scoring, AI-free repository health, issue difficulty, the
  cached GitHub client (dedup + ETag + rate-limit floor), CV parser + skills taxonomy,
  BYOK AI provider abstraction + non-AI fallbacks + prompt-injection fencing,
  client-side portfolio generator + offline Ed25519 license verification, framework-free
  multi-provider OAuth (`libs/auth`).
- **`apps/web`** — Angular 20 standalone + zoneless, hash routing, DOMPurify sanitiser
  service, IndexedDB store, dashboard + repositories pages, multi-provider sign-in
  modal. Production build ≈ 70 kB transfer.
- **Real GitHub profile on the dashboard** — for a user signed in with GitHub,
  `libs/github` viewer fetchers + `libs/profile`'s `githubToProfile` build a
  `UnifiedProfile` (repo languages → weighted skills, topics → interests, account age
  → experience level, merged-PR count) which drives the match / contribution-confidence
  / skill-gap scores and a "Your profile" panel. Anonymous / identity-only users keep
  the `DEMO_*` fixtures. Orchestrated by `apps/web` `ProfileService` (`core/profile/`).
- **`apps/extension`** — Manifest V3, esbuild build, GitHub content-script panel using
  the shared engines via a background service worker.
- **CI/CD** — `.github/workflows/ci.yml` (verify · build · dependency-scan ·
  secret-scan · SBOM · `ci-ok` gate), `codeql.yml`, `deploy.yml` (Cloudflare Workers
  static assets · `cairn-auth` Worker · extension artifact behind a manual gate).
  Custom guards: `check-csp.mjs`, `check-bundle-origins.mjs`, `check-licenses.mjs`.
- `npm run verify` passes; `npm audit` clean (0 vulnerabilities).
- **Repo is on GitHub** (`MahmoudNasserGouda/cairn`, default `main`). Branch protection
  active in **solo mode** — required checks (`CI passed`, CodeQL `Analyze`) + linear
  history + no force-push, with **0 required approvals** and an admin bypass so the
  sole maintainer can merge. Switch to team mode (1 approval, no bypass) when a second
  maintainer joins — see [`docs/branch-protection.md`](docs/branch-protection.md).
- **Web app is live** — Cloudflare Workers, `https://cairn.mahmoudnasser98.workers.dev/`
  (sole host; the GitHub Pages mirror was dropped, see changelog). `production` /
  `extension-store` environments exist; `extension-store` secrets deferred.
- **Sign-in works** — GitHub, LinkedIn, and Google OAuth apps are configured and the
  `cairn-auth` Worker is deployed with all three secrets. GitHub is the data
  connection (reads repos); LinkedIn/Google are identity only. UI is a modal
  (`core/auth/sign-in-dialog`), not nav-bar buttons
  ([ADR-0024](docs/adr/0024-github-oauth-token-exchange-function.md),
  [ADR-0025](docs/adr/0025-multi-provider-identity.md)).

Next:

1. Wire the CV upload flow: sandboxed Web Worker text extraction → `parseCvText`
   ([ADR-0011](docs/adr/0011-local-first-cv-processing.md)), merged onto the GitHub
   profile via `mergeProfile`.
2. Replace the dashboard's `DEMO_REPO` / `DEMO_ISSUE` targets with real repos/issues
   (the developer side is now real; the comparison target is still fixed to `vercel/swr`).
3. Readiness dashboard on the real profile.
4. Job-board ingestion ADR (public feeds + the extension "save this listing" pattern).

## Repo map

```
apps/web/                  Angular 20 SPA — primary MVP                 [built: shell + 2 pages + sign-in]
  src/app/core/            SafeHtmlService (DOMPurify), IndexedDbStore
  src/app/core/auth/       AuthService (in-memory tokens, redirect flow) + sign-in-dialog modal
  src/app/core/profile/    ProfileService — GitHub token → collectGithubActivity → githubToProfile
  src/app/pages/           dashboard, repositories
  public/_headers          security headers + CSP, applied by Cloudflare Workers
  wrangler.toml            Cloudflare Workers static-assets deploy config
apps/extension/            Manifest V3 extension (esbuild)              [built: content + background]
apps/desktop/              Tauri local agent                           [future — ADR-0015]
api/optional-serverless/oauth/  cairn-auth Worker: stateless code→token + LinkedIn identity relay
libs/shared/               Result, math, redacting logger, KeyValueStore, sanitizer contract, config
libs/scoring/              weightedScore + explanation, versioned WEIGHTS (WEIGHTS_VERSION=1)
libs/matching/             repositoryMatch / issueMatch / contributionConfidence / skillGap
libs/repository-analysis/  healthScore (AI-free), architecture model + readingOrder
libs/issue-analysis/       analyzeIssue — deterministic difficulty + required-knowledge
libs/github/               GithubClient (cache + dedup + ETag + rate-limit); repo/health + viewer (user.ts) fetchers
libs/profile/              UnifiedProfile + mergeProfile, githubToProfile, CV parser, skills taxonomy (v1)
libs/portfolio/            metrics, static HTML/MD generator, Ed25519 license verify
libs/auth/                 framework-free multi-provider OAuth (provider records, state, exchange, identity)
libs/ai/                   IAIProvider (OpenAI/Gemini/OpenRouter), fenced prompts, disclosure, fallbacks
scripts/                   check-csp, check-bundle-origins, check-licenses, setup-hooks
brand/                     logo.svg / logo-dark.svg / logo.png / mark.svg + brand/README.md
docs/adr/                  25 ADRs · docs/ci-cd.md · docs/branch-protection.md
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
- **Commits:** Conventional Commits. **Branches:** no direct push to `main`; PR + all
  required checks + (in team mode) 1 review. Currently **solo mode** — 0 approvals,
  admin bypass (see [`docs/branch-protection.md`](docs/branch-protection.md)).

## Security non-negotiables

Full list: [`SECURITY.md`](SECURITY.md) §8. Enforced by CI (`check-csp.mjs`,
`check-bundle-origins.mjs`, CodeQL, gitleaks, OSV, license guard). Short version:

1. No `unsafe-inline` / `unsafe-eval` in **script** CSP directives. `style-src
   'unsafe-inline'` is a ratified exception for Angular component styles (2026-08-31)
   and permitted nowhere else. No `bypassSecurityTrust*` without a reviewed, marked
   (`cairn-security-reviewed`) exception — one ratified: `SafeHtmlService.trust()`,
   post-DOMPurify + post-Angular-sanitizer only.
2. All external content (GitHub, AI, CV, user free-text) is sanitised before rendering.
3. OAuth tokens and BYOK keys: never logged, never stored by Cairn, never in URLs.
   The GitHub token transits the stateless `cairn-auth` Worker once during the code
   exchange (and LinkedIn's identity relay), then lives only in browser memory.
4. No secret is committed to the repo. OAuth client secrets live only in the
   `cairn-auth` Worker env.
5. OAuth is Authorization Code + single-use `state` + exact redirect-URI allowlist.
   PKCE where the provider supports it; where it does not (all three today), the
   `code → token` step runs in the CORS-locked `cairn-auth` Worker.
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
Cloudflare Workers static assets (`apps/web/wrangler.toml`) + the `cairn-auth`
token-exchange Worker + extension artifact (manual store gate). Details:
[`docs/ci-cd.md`](docs/ci-cd.md).

Per enabled provider, set once out-of-band: `wrangler secret put
<PROVIDER>_CLIENT_SECRET` on the `cairn-auth` Worker, and the GitHub Actions repo
**variable** `OAUTH_<PROVIDER>_CLIENT_ID` (the `GITHUB_` prefix is reserved by
Actions, hence `OAUTH_GITHUB_…`). Each OAuth app's callback URL must equal the
provider's `redirectUri` in `libs/shared/src/config.ts`.

## Decisions & open questions

- **Decisions:** [`docs/adr/`](docs/adr/README.md) — 25 ADRs. Accepted: 0001–0014,
  0016–0025. Future: 0015 (desktop).
- **Open questions:**
  - Per-resource cache TTLs — draft values in `libs/shared/src/config.ts`
    (`CACHE_TTL_MS`); still need calibration ([ADR-0006](docs/adr/0006-direct-github-api-usage.md)).
  - Job-board ingestion: which public APIs (Adzuna / Remotive / …) and the extension
    "save this listing" capture pattern — needs its own ADR
    ([ADR-0025](docs/adr/0025-multi-provider-identity.md) §Job data).
  - ~~LinkedIn/Google OAuth: own function or shared?~~ → **shared** `cairn-auth` with a
    per-provider route; identity only ([ADR-0025](docs/adr/0025-multi-provider-identity.md), 2026-09-03).
  - ~~GitHub OAuth: PKCE from a static origin?~~ → **no** — no provider does; resolved
    via the `cairn-auth` Worker (2026-09-03,
    [ADR-0024](docs/adr/0024-github-oauth-token-exchange-function.md)).
  - The §8 non-negotiables 3 & 5 were reworded for the `cairn-auth` Worker but never
    got an explicit owner "ratified" note the way the CSP exceptions did — treat as
    accepted-by-merge unless the owner says otherwise. (The `public_repo` scope wording
    in `SECURITY.md` §2 was swept out 2026-09-05 — `read:user` only.)
  - "Stay signed in" (opt-in encrypted-at-rest token in IndexedDB) not built yet —
    token is in-memory only ([ADR-0020](docs/adr/0020-oauth-token-and-byok-key-handling.md)).
  - Health-engine thresholds need a calibration data set
    ([ADR-0008](docs/adr/0008-ai-free-repository-health-engine.md)).
  - ~~Jest vs Vitest~~ → **Vitest** (2026-08-31).
  - ~~`style-src 'unsafe-inline'` CSP exception~~ → **ratified 2026-08-31**; wording
    updated in [ADR-0019](docs/adr/0019-security-first-rendering.md) and `SECURITY.md` §8.
  - GitHub Actions pinned by tag, not SHA, on first commit — Renovate
    (`helpers:pinGitHubActionDigests`) converts them on its first PR.

## Changelog

### 2026-09-05 — Real GitHub profile feeds the dashboard

PRs #21–23 merged; #24 in flight.

- **`libs/github/src/user.ts`** (new) — viewer-scoped fetchers on `GithubClient.get`:
  `fetchViewer` (`/user`), `fetchViewerRepos` (fork-filtered, pushed-sorted, one page
  of 100), `fetchRepoLanguages`, `fetchMergedPrCount` (Search API, best-effort).
  `collectGithubActivity` composes them, pulling languages for the 15 most-recently
  pushed repos. New `CACHE_TTL_MS` entries: `viewer`, `viewerRepos`, `mergedPrCount`
  (1 h each — still uncalibrated, see open questions).
- **`libs/profile/src/github.ts`** (new) — `githubToProfile(activity, base?)`, mirroring
  `cvToProfile`: aggregate language bytes → `SkillProficiency` levels (share of the
  top language, 0.3 floor), repo topics → interests, account `created_at` → one
  `ExperienceEntry` so `mergeProfile` derives `experienceLevel` / `totalYears`. Uses a
  local `GithubActivityInput` interface — **no `libs/profile → libs/github` import
  edge** (keeps the lib boundary clean).
- **`apps/web` `ProfileService`** (`core/profile/`) — an `effect` on the GitHub
  identity + token builds a token-scoped `GithubClient` (shared `gh:` IndexedDB cache),
  runs the fetch + map, exposes `profile()` / `priorContributions()` / `loading()` /
  `error()` signals; stale-token results are dropped. `DashboardComponent.dev` is now a
  `computed` (real snapshot or `DEMO_DEV`); a **"Your profile"** panel renders the
  loaded skills / experience / merged-PR count, and load error/loading states are shown
  explicitly instead of silently falling back to demo.
- **#24 (open):** `repositoryMatch`'s `technology` sub-score switches from symmetric
  `jaccard` to directional `technologyCoverage` (share of the repo's stack the dev
  knows) — a broad generalist is no longer penalised for extra skills. Fixture
  snapshot 51 → 53.
- 92 tests (16 files); `verify` + `build:web` + guards green. GitHub OAuth scope stays
  `read:user` — `/user/repos` returns the viewer's **public** repos on that scope,
  which is all the profile needs.
- Guide sections updated: Status (done + next), Repo map (`libs/github`, `libs/profile`,
  `apps/web/core/profile`), this changelog.
- Drift: none.

### 2026-09-05 — Sign-in: LinkedIn CORS fix, modal UI, all providers live

- **All three OAuth apps configured and live** — GitHub / LinkedIn / Google client IDs
  merged into config; `cairn-auth` deployed with all three secrets. Sign-in works
  end to end at `https://cairn.mahmoudnasser98.workers.dev/`.
- **LinkedIn "could not reach LinkedIn" fixed.** Its `userinfo` endpoint sends no CORS
  headers, so a direct browser fetch is blocked. `cairn-auth` gained a
  `POST /linkedin/identity` route that relays the call server-side with only the
  access token (no client secret). `OAuthProvider` gained `identityViaWorker` /
  `identityExchangeUrl`; `fetchIdentity` branches on it. GitHub and Google stay direct.
  `https://api.linkedin.com` removed from the connect-src allowlist. If Google ever
  shows the same symptom the fix is identical (`/google/identity` route half-scaffolded).
- **Sign-in moved off the nav bar into a modal** (`core/auth/sign-in-dialog`). Nav is
  now a single **Sign in** button (or identity chip + **Sign out**). The modal splits
  into **"Connect your work"** (GitHub — reads repos + contribution history) and
  **"Faster sign-in · optional"** (LinkedIn / Google — name, email, photo only),
  implementing [ADR-0025](docs/adr/0025-multi-provider-identity.md)'s UI intent.
  `OAuthProvider` gained `role: 'data' | 'identity'`. Backdrop / Esc / close dismiss;
  focus moves in on open and is restored on close; minimal Tab trap; auto-opens on a
  redirect-callback error. **No new dependency** (no Angular CDK).
- CI-var rename: `vars.GITHUB_OAUTH_CLIENT_ID` → `vars.OAUTH_GITHUB_CLIENT_ID`
  (Actions reserves the `GITHUB_` prefix); LinkedIn/Google match the pattern.
- `verify` + `build` + guards green; 81 tests (14 files).
- Guide sections updated: Status, Repo map, Security non-negotiables (synced to
  `SECURITY.md` §8 wording), Decisions & open questions, this changelog.
- Drift: none. (`SECURITY.md` §2's stale `public_repo` scope wording was swept out in
  a follow-up — `read:user` only, per
  [ADR-0024](docs/adr/0024-github-oauth-token-exchange-function.md).)

### 2026-09-03 — Sign-in: multi-provider identity slice

PRs #10–12. Scope: **auth + identity only** — deriving a `UnifiedProfile` from GitHub
and replacing the dashboard `DEMO_*` fixtures is the next slice.

- **`libs/auth`** (new, framework-free): `OAuthProvider` records, `buildAuthorizeUrl`,
  single-use `state`, `exchangeCodeForToken`, `fetchIdentity` (GitHub REST + OIDC
  `userinfo`), `isProviderConfigured`. 12 Vitest tests.
- **`cairn-auth` Worker** (`api/optional-serverless/oauth/`): stateless
  `POST /<provider>/token` for GitHub / LinkedIn / Google — none support usable
  static-origin PKCE (GitHub has none at all; the OIDC pair still need the secret).
  JSON body for GitHub, form-encoded for OIDC. **New [ADR-0024](docs/adr/0024-github-oauth-token-exchange-function.md)
  (generalized) + [ADR-0025](docs/adr/0025-multi-provider-identity.md);
  [ADR-0016](docs/adr/0016-optional-serverless-api.md) Proposed → Accepted.**
- **Provider policy ([ADR-0025](docs/adr/0025-multi-provider-identity.md)):** GitHub is
  the only *data* connection (token kept for repo reads); LinkedIn + Google are
  *identity only* (name/email/avatar, token discarded after `userinfo`). LinkedIn has
  no profile-data API — confirmed, not just chosen. "Import from Wuzzuf / Indeed /
  Gulf Talent / …" is **out of scope** — no APIs, and credential scraping is barred by
  SECURITY.md §5. Profile data comes from CV upload + GitHub + manual entry; job data
  from public listing feeds + the extension.
- **`apps/web`**: `AuthService` (per-provider in-memory tokens, redirect flow with
  `{provider,state}` in `sessionStorage`, sign-out wipes the `gh:` cache),
  `provideAuth()` initializer. (Nav-bar buttons — later replaced by the modal, see the
  2026-09-05 entry.)
- **Config/CI**: `OAUTH_PROVIDERS` + `openidconnect.googleapis.com` / `cairn-auth`
  origins in `libs/shared/src/config.ts` and `_headers` connect-src; `deploy.yml`
  `deploy-auth-worker` job; `typecheck` covers the Worker.
- **Docs**: ADR-0020 corrected (no provider PKCE; `read:user` only); ADR-0012
  generalized; `SECURITY.md` T4/T4b + non-negotiables 3 & 5.
- Drift: none at the time. (Owner ratification of the reworded `SECURITY.md` §8
  non-negotiables and ADR-0025's "no job-board import" scope was never explicitly
  recorded — see Decisions & open questions; treat as accepted-by-merge.)

### 2026-09-02 — Live on GitHub; single-host deploy

- **Pushed to GitHub** (`MahmoudNasserGouda/cairn`). Enabled Dependabot alerts, secret
  scanning + push protection, and private vulnerability reporting. Branch protection
  applied to `main` (required checks, linear history, no force-push/deletion).
- **Web deploy moved Cloudflare Pages → Cloudflare Workers static assets** (PR #1):
  `apps/web/wrangler.toml` (assets-only, `dist/browser`, SPA fallback); `deploy.yml`
  `deploy-cloudflare` job now runs `wrangler deploy`. Free `*.workers.dev` subdomain,
  no paid custom domain. Canonical URL updated in `security.txt`. **ADR-0004 amended.**
- **GitHub Pages mirror: added, fixed, then dropped.** PR #5 fixed a 404 (it published
  the artifact root instead of `dist/browser/`, and served `<base href="/">` under a
  `/cairn/` path). Then, per owner decision, **the mirror was removed entirely** — the
  `deploy-pages` job is deleted, `github-pages` environment retired, docs updated.
  Reason: GitHub Pages ignores `_headers`, so the mirror had no CSP or security headers
  ([SECURITY.md](SECURITY.md) §8) — a weaker public copy was a liability, not
  resilience. **ADR-0004 amended (2026-09-02).** Cloudflare Workers is the sole host.
- **Branch protection: "solo vs team mode" added to
  [`docs/branch-protection.md`](docs/branch-protection.md).** The always-on rules
  (checks, CodeQL, linear history, no force-push) are separated from the review gate,
  which is 0 approvals + admin bypass while solo and 1 approval + no bypass with a
  second maintainer. The doc and the live config now agree.
- **CI fix** (PR #1): `gitleaks-action@v2` now requires `GITHUB_TOKEN`; added it to the
  `secret-scan` job.
- **Extension distribution decided:** Chrome Web Store + Firefox AMO, both deferred
  (not self-hosting). No code/CI change yet.
- Sections updated: Status, Repo map, How to run / build / test / deploy, this
  changelog.
- Drift: none — both items raised in the first draft of this entry are now resolved
  (solo/team-mode doc; mirror dropped).

### 2026-08-31 — Rename to Rujoom + publish prep

- Renamed the product **Open Source Compass → Rujoom** ("compass" described only
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

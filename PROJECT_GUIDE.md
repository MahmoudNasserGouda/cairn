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

**Phase 2 — Discovery Engine. Phase 1 is complete (monorepo + CI/CD, web app
deployed, multi-provider sign-in, real GitHub profile, CV import, contribution
readiness, and match / confidence / skill-gap scoring against a real repo + issue).
The product now also *recommends* repositories: `/discover` turns the user's profile
into at most four GitHub searches and ranks the results deterministically
([ADR-0027](docs/adr/0027-search-only-repository-discovery.md)), closing the last
"not started" item in the README's original MVP scope.**

Done:

- Architecture docs: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md),
  [`docs/ci-cd.md`](docs/ci-cd.md), ADRs 0001–0027.
- **Monorepo scaffold** — npm workspaces, TS strict, path aliases, ESLint flat config
  with the `libs → apps` import-boundary rule, Prettier, Vitest.
- **Thirteen `libs/*` implemented** with real logic; **311 passing tests** across
  `libs/`, `apps/web` and the `cairn-auth` Worker:
  deterministic matching + scoring, AI-free repository health, issue difficulty, the
  cached GitHub client (dedup + ETag + rate-limit floor), CV parser + skills taxonomy,
  BYOK AI provider abstraction + non-AI fallbacks + prompt-injection fencing,
  client-side portfolio generator + offline Ed25519 license verification, framework-free
  multi-provider OAuth (`libs/auth`), `libs/targets` (analysis outputs → matching
  snapshots), and `libs/discovery` (profile → search plan → ranked recommendations).
- **`apps/web`** — Angular 20 standalone + zoneless, hash routing, DOMPurify sanitiser
  service, IndexedDB store, dashboard + discover + repositories pages, multi-provider
  sign-in modal, profile page with CV import. Production build ≈ 71 kB transfer initial
  (pdf.js sits in a 430 kB lazy worker chunk, loaded only on a CV upload).
- **Real GitHub profile on the dashboard** — for a user signed in with GitHub,
  `libs/github` viewer fetchers + `libs/profile`'s `githubToProfile` build a
  `UnifiedProfile` (repo languages → weighted skills, topics → interests, account age
  → experience level, merged-PR count) which drives the match / contribution-confidence
  / skill-gap scores and a "Your profile" panel. Users with neither GitHub nor a CV
  get an empty state, not a demo profile. Orchestrated by `apps/web` `ProfileService`
  (`core/profile/`).
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
- **CV upload works end to end** — drop a PDF / .docx / .txt on **/profile** and the
  bytes go to a sandboxed, terminate-on-timeout Web Worker; `libs/cv-extract` pulls out
  plain text (pdf.js text layer, or our own ZIP reader for `word/document.xml`);
  `parseCvText` structures it; a **mandatory review form** lets the user edit and
  confirm before anything is committed; `cvToProfile` merges it onto the GitHub profile
  and the reviewed fields persist in IndexedDB. No bytes leave the device and no raw CV
  text is ever stored ([ADR-0011](docs/adr/0011-local-first-cv-processing.md)).
- **Contribution readiness on the dashboard** — `contributionReadiness` in
  `libs/profile` scores the merged profile against no target at all: skill depth, skill
  breadth, experience, track record, and profile completeness, through the same
  `weightedScore` engine as every other score. It is the first number on the page that
  means something to a real user, and it needs no repository discovery and no new
  network call. The panel shows the banded percent, a bar and note per part, the
  connected/missing sources, and next steps ranked by the points each would recover.
- **Real repo + issue as the scoring target** — the dashboard "Scoring target" panel
  searches GitHub (`/search/repositories`), the user picks a repo, then picks an open
  issue from a list. `libs/targets` maps `RepoOverview` + `healthScore` + `analyzeIssue`
  onto the `RepositorySnapshot` / `IssueSnapshot` the matching engine already takes, so
  the match / contribution-confidence / skill-gap cards and the "Why this match"
  explanation recompute against live data. **The comparison target is now always a real
  repo the user picks** — there is no `vercel/swr` demo fallback; until a repo is chosen
  the score cards show an empty/prompt state, and the confidence card prompts for an
  issue until one is picked. Choice persists in IndexedDB. Orchestrated by `apps/web`
  `TargetService` (`core/targets/`), sharing one `GithubClientService`.
- **GitHub client + session hardening** — the rate-limit floor is tracked **per
  resource** (`core` vs `search`; `/search/*` has a tiny 10/30 bucket) as
  `min(configured floor, 10% of that resource's quota)`, so a search burst no longer
  blocks core calls (`libs/github` `resourceForPath` / `floorFor`). A signed-in session
  now **survives a page refresh** — identities + the GitHub token are mirrored into
  `sessionStorage` (`cairn.session.v1`, wiped on sign-out and never in LocalStorage /
  IndexedDB), restored on load ([ADR-0020](docs/adr/0020-oauth-token-and-byok-key-handling.md)).
- **Wiring layer under test at last** — `vitest.config.ts` now has two projects: `libs`
  (node) and `app` (jsdom, `apps/**` + `api/**`, Angular `TestBed`). Previously only
  `libs/**` was collected, so every Angular service, both page components and the OAuth
  Worker sat outside the runner — a green `npm test` said nothing about the code users
  actually touch. 159 → **255 tests**; the 70% coverage gate now measures
  `apps/web/src/app` and `api/**` as well. Adds `tsconfig.test.json` (test files were
  not typechecked either) and `scripts/test-setup.ts`.
- **Twelve wiring-layer bugs fixed** (2026-09-11). The headline three: adding a second
  identity no longer **disconnects GitHub** (`completeSignInFromRedirect` skipped
  `restoreSession` on a callback load, then persisted over it); `redirectUri` is derived
  from the origin the app is served from, so **sign-in works on `localhost`**; and the
  extension's `host_permissions` now include `api.github.com`, without which **every**
  API call it made failed. Full list in the changelog.

- **Repository discovery** — `/discover` asks `libs/discovery` to turn the profile into
  a search plan (strongest language · that language filtered by `good-first-issues:>=3`
  · second language · one topic interest), runs the lanes **sequentially** through the
  shared `GithubClient`, merges the results, and ranks them by six named signals
  (`skillFit`, `technologyFit`, `newcomerSignal`, `activity`, `approachability`,
  `learning`). Every card carries a plain-language "why" and an expandable per-signal
  breakdown; three presets re-rank **without re-querying**; "Score my fit" promotes a
  recommendation to the dashboard's scoring target. A whole run costs **four search
  requests, not four per candidate** — no per-repository call happens until the user
  picks one ([ADR-0027](docs/adr/0027-search-only-repository-discovery.md)). Two
  deliberate refusals: a profile with no programming language gets a clear explanation
  rather than a guessed search, and a repository whose stack GitHub does not report is
  **excluded rather than scored** (`skillCoverage` returns a neutral 1 for an empty
  requirement list, which would otherwise float it to the top as a perfect match).

Next:

1. First job/opportunity feed — a key-free source behind ADR-0026's acceptance bar, its
   own mini-ADR, and an `OpportunitySnapshot` in `libs/matching`.
2. Optional BYOK AI refinement pass over the parsed CV — deliberately deferred out of
   the CV slice; needs the ADR-0010 disclosure panel wired first.

## Repo map

```
apps/web/                  Angular 20 SPA — primary MVP                 [built: shell + 3 pages + sign-in]
  src/app/core/            SafeHtmlService (DOMPurify), IndexedDbStore
  src/app/core/auth/       AuthService (in-memory tokens, redirect flow) + sign-in-dialog modal
  src/app/core/profile/    ProfileService — GitHub + reviewed CV → one UnifiedProfile (persisted)
  src/app/core/targets/    TargetService — repo search → pick repo + issue → scoring snapshots (persisted)
  src/app/core/discovery/  DiscoveryService — profile → search plan → ranked recommendations (preset persisted)
  src/app/core/github-client.ts  one shared GithubClient (token-bound when signed in)
  src/app/core/cv/         CvImportService + sandboxed extraction worker + Trusted Types worker URL
  src/app/pages/           dashboard, discover, repositories, profile (CV import + review form)
  public/_headers          security headers + CSP, applied by Cloudflare Workers
  wrangler.toml            Cloudflare Workers static-assets deploy config
apps/extension/            Manifest V3 extension (esbuild)              [built: content + background]
apps/desktop/              Tauri local agent                           [future — ADR-0015]
api/optional-serverless/oauth/  cairn-auth Worker: stateless code→token + LinkedIn identity relay
libs/shared/               Result, math, redacting logger, KeyValueStore, sanitizer contract, config,
                           skills taxonomy (moved here from libs/profile so the repo side canonicalises too)
libs/scoring/              weightedScore + explanation, versioned WEIGHTS (WEIGHTS_VERSION=1),
                           incl. DISCOVERY_WEIGHTS + the three presets
libs/matching/             repositoryMatch / issueMatch / contributionConfidence / skillGap
libs/discovery/            pure: profile → planQueries (GitHub search syntax) → rankRepositories (ADR-0027)
libs/repository-analysis/  healthScore (AI-free), architecture model + readingOrder
libs/issue-analysis/       analyzeIssue — deterministic difficulty + required-knowledge
libs/github/               GithubClient (cache + dedup + ETag + per-resource rate-limit + 429 backoff
                           + stale-on-error + LRU eviction + uncached 202 statistics placeholders);
                           repo/health + viewer + repo-search + issue-list fetchers
libs/profile/              UnifiedProfile + mergeProfile, githubToProfile, CV parser, contributionReadiness
                           (taxonomy re-exported from libs/shared)
libs/cv-extract/           PDF/DOCX/text → plain text; own ZIP reader, pdf.js text layer (ADR-0011)
libs/portfolio/            metrics, static HTML/MD generator, Ed25519 license verify
libs/targets/              pure: RepoOverview + healthScore + analyzeIssue → Repository/IssueSnapshot
libs/auth/                 framework-free multi-provider OAuth (provider records, state, exchange, identity)
libs/ai/                   IAIProvider (OpenAI/Gemini/OpenRouter), fenced prompts, disclosure, fallbacks
scripts/                   check-csp, check-bundle-origins, check-licenses, setup-hooks, test-setup (jsdom/TestBed)
brand/                     logo.svg / logo-dark.svg / logo.png / mark.svg + brand/README.md
docs/adr/                  27 ADRs · docs/ci-cd.md · docs/branch-protection.md
```

## How we work (conventions)

- **Runtime:** Node `22.13.0` (`.nvmrc`). **Package manager:** npm workspaces.
- **Language:** TypeScript `~5.8` strict everywhere. `libs/*` are framework-free
  (except `libs/shared`, browser-only); `apps/*` → `libs/*` only, never the reverse —
  ESLint `no-restricted-imports` enforces it, plus no `@angular/*` / `rxjs` in `libs/*`.
- **Test runner: Vitest**, two projects (resolved open question). `libs` runs in node;
  `app` runs `apps/**` + `api/**` in jsdom against Angular's `TestBed`
  (`scripts/test-setup.ts`). Engine libs are pure and snapshot-tested; services and
  components are tested through their public signals. Coverage gate 70% over `libs/*`,
  `apps/web/src/app` and `api/**`. Test files are typechecked via `tsconfig.test.json`.
  **A bug fixed in the wiring layer needs a test that fails without the fix** — verify
  that by reverting the fix, not by assuming.
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
   and permitted nowhere else. No `bypassSecurityTrust*` and no Trusted Types policy
   without a reviewed, marked (`cairn-security-reviewed`) exception — two ratified:
   `SafeHtmlService.trust()` (post-DOMPurify + post-Angular-sanitizer only), and the
   `default` Trusted Types policy in `core/cv/worker-url.ts`, which admits a script URL
   only when it is same-origin and arrives inside the one synchronous call that starts
   the CV extraction worker.
2. All external content (GitHub, AI, CV, user free-text) is sanitised before rendering.
3. OAuth tokens and BYOK keys: never logged, never stored by Cairn, never in URLs.
   The GitHub token transits the stateless `cairn-auth` Worker once during the code
   exchange (and LinkedIn's identity relay), then lives only in browser memory.
4. No secret is committed to the repo. OAuth client secrets live only in the
   `cairn-auth` Worker env.
5. OAuth is Authorization Code + single-use `state` + exact redirect-URI allowlist.
   **No provider we use offers workable public-client PKCE**, so every `code → token`
   step runs in the `cairn-auth` Worker. The Worker **requires** an `Origin` on its
   (comma-separated) `ALLOWED_ORIGIN` list and validates `redirect_uri` against the
   same list — a *missing* `Origin` is a 403, not a pass. CORS constrains only
   browsers; this is an origin allowlist, and the distinction is load-bearing.
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
Actions, hence `OAUTH_GITHUB_…`). `redirectUri` is now derived from the origin the app
is served from, so each OAuth app's callback URL must be `<origin>/` for every origin
you support, and that origin must also be on the Worker's `ALLOWED_ORIGIN` list. To sign
in from `localhost:4200`, prefer a dev Worker
(`wrangler dev --var ALLOWED_ORIGIN:http://localhost:4200`) over widening the deployed
one — see `api/optional-serverless/oauth/README.md`.

## Decisions & open questions

- **Decisions:** [`docs/adr/`](docs/adr/README.md) — 26 ADRs. Accepted: 0001–0014,
  0016–0026. Future: 0015 (desktop).
- **Open questions:**
  - Per-resource cache TTLs — draft values in `libs/shared/src/config.ts`
    (`CACHE_TTL_MS`); still need calibration ([ADR-0006](docs/adr/0006-direct-github-api-usage.md)).
  - ~~Job-board ingestion: which public APIs (Adzuna / Remotive / …) and the extension
    "save this listing" capture pattern?~~ → **two paths only** (public feeds +
    `activeTab` capture), with an acceptance bar every feed must clear and a mini-ADR
    per source; no source authorised yet
    ([ADR-0026](docs/adr/0026-job-and-opportunity-ingestion.md), 2026-09-07).
  - Which key-free feed goes first — Remotive and Arbeitnow are the candidates, but
    neither's CORS headers or terms have been checked
    ([ADR-0026](docs/adr/0026-job-and-opportunity-ingestion.md) §Acceptance criteria).
  - ~~LinkedIn/Google OAuth: own function or shared?~~ → **shared** `cairn-auth` with a
    per-provider route; identity only ([ADR-0025](docs/adr/0025-multi-provider-identity.md), 2026-09-03).
  - ~~GitHub OAuth: PKCE from a static origin?~~ → **no** — no provider does; resolved
    via the `cairn-auth` Worker (2026-09-03,
    [ADR-0024](docs/adr/0024-github-oauth-token-exchange-function.md)).
  - The §8 non-negotiables 3 & 5 were reworded for the `cairn-auth` Worker but never
    got an explicit owner "ratified" note the way the CSP exceptions did — treat as
    accepted-by-merge unless the owner says otherwise. (The `public_repo` scope wording
    in `SECURITY.md` §2 was swept out 2026-09-05 — `read:user` only.)
  - The session now survives a **page refresh** (in-memory + `sessionStorage` mirror,
    2026-09-11). "Stay signed in" across a **tab close** (opt-in encrypted-at-rest token
    in IndexedDB) is still not built
    ([ADR-0020](docs/adr/0020-oauth-token-and-byok-key-handling.md)).
  - ~~The built `index.html` violated two of our own CSP directives (`<base href="/">`
    vs `base-uri 'none'`; a stylesheet `onload=` vs `script-src 'self'`).~~ → **fixed
    2026-09-11** — the base href moved to `APP_BASE_HREF` (no `<base>` element) and the
    critical-CSS inliner is off (`optimization.styles.inlineCritical: false`), so the
    built HTML obeys the CSP. `check-csp.mjs` now also scans `dist/browser/index.html`
    for a `<base>` tag or inline `on*=` handler to stop it regressing.
  - Health-engine thresholds need a calibration data set
    ([ADR-0008](docs/adr/0008-ai-free-repository-health-engine.md)). **Discovery's star
    bands and push-recency curve want the same data set** — `STAR_PEAK_LOG` in
    `libs/discovery/src/bands.ts` is a considered guess, and every other discovery
    number is derived from it.
  - **Two scores for one repository.** Discovery reports a search-only score and the
    dashboard reports a fuller `repositoryMatch` for the same repo; they legitimately
    disagree (the deep read sees languages a search response never returns). The copy
    frames one as a shortlist and one as a decision, but whether that is enough for a
    real user is untested ([ADR-0027](docs/adr/0027-search-only-repository-discovery.md)
    consequences).
  - **`libs/ai` and `libs/portfolio` have no consumer.** Both are implemented and
    tested; nothing in `apps/` imports either, so the three "WOW" AI features and the
    portfolio generator are *not* shipped. `libs/ai` also needs the ADR-0010 disclosure
    panel and a BYOK key-entry UI before it can be wired at all. README now says so
    plainly; the guide's Status list should not imply otherwise.
  - ~~**No discovery.**~~ → **built 2026-09-11** — `/discover` ranks repositories from
    the profile ([ADR-0027](docs/adr/0027-search-only-repository-discovery.md)).
    **No manual profile entry** remains: a user can only *deselect* CV-parsed skills,
    not add one by hand. **Issue-level discovery** also remains manual — discovery
    recommends a repository, and the issue is still picked from that repo's open list.
  - The GitHub-derived experience span is a proxy: account creation year → most recent
    visible push. It no longer runs to `present` (a dormant 2015 account used to read as
    a decade and scored `advanced`), but it still cannot know when someone started
    programming. Worth revisiting if a better signal appears.
  - `libs/matching`'s `issueMatch()` is exported and tested but never called by any app;
    the dashboard uses `contributionConfidence` instead. Decide whether it earns its
    place or goes.
  - Whether the `default` Trusted Types policy's new `try/catch` needs the same explicit
    ratification the policy itself got — see the drift note in the 2026-09-11 changelog
    entry below.
  - ~~Jest vs Vitest~~ → **Vitest** (2026-08-31).
  - ~~`style-src 'unsafe-inline'` CSP exception~~ → **ratified 2026-08-31**; wording
    updated in [ADR-0019](docs/adr/0019-security-first-rendering.md) and `SECURITY.md` §8.
  - GitHub Actions pinned by tag, not SHA, on first commit — Renovate
    (`helpers:pinGitHubActionDigests`) converts them on its first PR.

## Changelog

### 2026-09-11 — Phase 2 slice: repository discovery

The product now recommends repositories instead of only scoring ones you name — the
last "not started" item from the README's original MVP scope.

- **New `libs/discovery` (13th lib, pure).** `planQueries` turns a `DeveloperSnapshot`
  into at most four search lanes; `buildRepoSearchQuery` renders each as GitHub search
  syntax; `rankRepositories` scores candidates over six named signals and returns a
  plain-language "why" per result. No dependency on `libs/github` — discovery emits
  query *strings*, the client merely executes them.
- **[ADR-0027](docs/adr/0027-search-only-repository-discovery.md) — search-only
  ranking.** Deep-analysing candidates would cost ~6 requests each (~240 a run) against
  a 60/hour unauthenticated core quota, with the candidate search drawing on the
  Search API's separate 10/min bucket. Discovery therefore ranks from search-response
  fields alone, and only a repository the user *picks* gets the full health + match
  path. The trade — coarser scores — is recorded in the ADR, not hidden.
- **`/discover` page + `DiscoveryService`** in `apps/web`: three presets that re-rank
  without re-querying, an expandable per-signal breakdown, a "what was searched" panel
  showing the actual queries, and "Score my fit" to promote a recommendation to the
  dashboard target. Lanes run sequentially and a run **keeps partial results** when the
  search quota runs out mid-way.
- **Supporting changes.** `LANGUAGE_SKILLS` + `isLanguageSkill` in `libs/shared`
  (TAXONOMY_VERSION 2 → 3) — GitHub's `language:` qualifier silently returns nothing
  for a framework, so languages and topics must be told apart. `DISCOVERY_WEIGHTS` +
  `discoveryWeightsFor` in `libs/scoring` (`WEIGHTS_VERSION` unchanged — a new map, not
  a changed weight). `RepoSearchResult` now carries the fields the same response
  already returned (`allTopics`, `forks`, `openIssues`, `pushedAt`, `archived`,
  `isFork`, `htmlUrl`) plus a `sort` option.
- **Two bugs found by running it, not by reading it.**
  1. **GitHub's 202 statistics placeholder.** `/stats/commit_activity` answers `202`
     with `{}` while GitHub computes the series, so the request *succeeds* and
     `collectHealthSignals`' per-call `.catch()` never fired — `{}.slice(-4)` threw and
     the repository simply would not open. Discovery made this the common path
     (recommended repos are ones nobody has looked at). Fixed in two places: the client
     **no longer caches** a 202 body (caching `{}` under a 6-hour TTL would pin the repo
     at "no activity" long after GitHub finished), and `collectHealthSignals` coerces
     non-array bodies. `libs/github/src/repository.test.ts` is new — that collector had
     no test at all.
  2. **Star window vs. approachability curve disagreed.** The searched band topped out
     at 20k stars for an intermediate while `starApproachability` peaked at ~1.6k. Since
     each lane asks for the *most-starred* repos in the window, every result arrived
     pinned to the ceiling — the ranker only ever saw repositories its own scoring
     thought too big. `STAR_WINDOW` is now **derived from** `STAR_PEAK_LOG`
     (`libs/discovery/src/bands.ts`) so the two cannot drift, with a test asserting the
     window brackets the peak. Live top results moved from 15–17k-star megaprojects to
     4–5k ones, and top scores rose 74% → 78%.
- **Verified end to end in the browser** against the live GitHub API, signed out:
  4 searches → ranked list → "Why this?" → "Score my fit" → dashboard with the target
  loaded and its issue list populated.
- 255 → **311 tests** (38 files). `npm run verify`, `npm run build`, and both guards
  green; `npm install` re-run so the new workspace is in `package-lock.json` (CI uses
  `npm ci`, which would otherwise fail to resolve `@cairn/discovery`). `npm audit`
  clean.
- Sections updated: Status, Repo map, Open questions, this changelog.
- Drift: none. `libs/discovery` adds no runtime dependency (non-negotiable 6), is
  framework-free (ADR-0005), spends no new origins (the GitHub origin is already on the
  `connect-src` allowlist), and renders all repository text through Angular
  interpolation only (ADR-0019 / SECURITY.md §8).

### 2026-09-11 — Audit-and-fix pass: wiring-layer bugs, and `apps/` + `api/` under test

Audit of every "finished" feature against the code. The engines were sound; almost
everything broken lived in the layer between them and the user — the layer no test
touched.

- **Root cause fixed first.** `vitest.config.ts` only collected `libs/**`, so no
  Angular service, component or the OAuth Worker was ever run by CI. Split into two
  projects (`libs`/node, `app`/jsdom + Angular `TestBed`), added `tsconfig.test.json`
  (test files were not typechecked either) and `scripts/test-setup.ts`. **159 → 255
  tests**; coverage gate held at 70% and extended to `apps/web/src/app` + `api/**`.
- **Auth — a second identity disconnected GitHub.** `completeSignInFromRedirect` called
  `restoreSession()` only on a *non*-callback load, so a callback started from an empty
  identity list and `persistSession()` overwrote the stored session with just the
  provider that had returned. GitHub is the only data provider, so this silently killed
  the profile and the token. Restore now runs first, unconditionally.
- **Sign-in was impossible on `localhost`.** `OAUTH_REDIRECT_URI` was hardcoded to the
  deployed Workers URL, so the documented `npm run -w @cairn/web start` flow bounced the
  developer to production. Now derived from `location.origin`, with the production
  origin as the non-browser fallback.
- **`cairn-auth` Worker — the origin check had a hole.** `origin !== null && origin !==
  ALLOWED_ORIGIN` waved through every request that simply *omitted* the header (curl,
  any non-browser client), leaving an unauthenticated endpoint that signs exchanges with
  our client secret and relays arbitrary bearer tokens. An allowlisted `Origin` is now
  required; `ALLOWED_ORIGIN` is a comma-separated list; and `redirect_uri` is validated
  against it, which SECURITY.md T4 had promised but the code never did. 13 new tests.
- **Extension made zero successful API calls.** `host_permissions` covered
  `github.com` but not `api.github.com`, which the background worker actually fetches.
  Added. Also re-renders on Turbo navigation instead of going stale on the first repo.
- **Match scores were computed across two different vocabularies.** The developer side
  canonicalised through the taxonomy; the repository side used raw `toSkillTag`. So a
  repo topic `nodejs` could never match a developer's `node`, and free-text topics
  (`hacktoberfest`, `awesome`, `oss`) counted as required technologies — deflating every
  coverage score and listing "hacktoberfest" as a skill to go and learn. Taxonomy moved
  to `libs/shared` (re-exported from `libs/profile`); repo languages + topics now
  canonicalise and filter through `toKnownSkills`.
- **Taxonomy integrity.** `javascript` and `node` both claimed the alias `nodejs` and the
  Map silently gave it to whichever was declared last; `dotnet` sat in `KNOWN_SKILLS`
  while also being an alias of `c#`, so nothing could ever carry it; the bare `actions`
  alias matched the English word in any CV. All three fixed, all three now guarded by
  tests. `TAXONOMY_VERSION` 1 → 2.
- **"Skill coverage 100% · 0 to learn"** for any repo with no detected technologies —
  `skillGap` returned `coverage: 1` for an empty requirement list. Now carries
  `analysed: false` and the dashboard renders a dash.
- **`listOpenIssues` reported "no open issues"** for repositories that had them: the
  endpoint counts PRs as issues with no way to exclude them, and one filtered page of 30
  could come back nearly empty. Now pages (up to 3 × 100) until it has enough real
  issues.
- **`GithubClient` threw away good cache on transient faults** — any non-OK response or
  network error rejected even with a valid cached copy, contradicting the local-first
  story. Now serves stale on network error and on upstream errors; handles 429 and
  quota-bearing 403 as a secondary rate limit with `Retry-After` backoff; adds a request
  timeout; and finally *implements* `CACHE_MAX_ENTRIES`, which was declared with an
  "LRU eviction" comment and referenced nowhere while IndexedDB grew unbounded.
- **A throttled search silently became "0 merged PRs"** — indistinguishable from a
  genuinely empty track record, and it fed the readiness score. `fetchMergedPrCount` now
  reports `known: false` and the dashboard says the number is unavailable.
- **`ProfileService` built its own second `GithubClient`**, so the Search quota it burned
  was invisible to the dashboard's repo search and vice versa. Uses the shared
  `GithubClientService`.
- **`TargetService.restore()` could discard a saved issue** that was merely further down
  a long list. It now keeps the choice and explains, rather than overwriting with null.
- **`DEMO_DEV` removed.** The 2026-09-10 slice dropped the demo *repo* but left the demo
  *developer*, so an anonymous visitor saw real repo data scored against a fictional
  beginner, labelled with their own percentages. Anonymous users now get an empty state.
- **GitHub experience stopped being invented.** The span ran from account creation to
  `present`, so a 2015 account untouched since 2016 read as ~11 years and scored
  `advanced`. It now ends at the most recent visible push, and an account with no repos
  claims no experience at all.
- **Trusted Types**: the `default` policy install is wrapped in `try/catch` — only one
  may exist per document, and an uncaught throw would have failed every CV import with a
  generic "could not read that file".
- **Docs reconciled with the code.** `README.md`, `ARCHITECTURE.md` (§overview, the
  sign-in sequence diagram, §security) claimed **PKCE**, which exists nowhere in
  `libs/auth`; only `SECURITY.md` and ADR-0024 were honest. Corrected everywhere. The
  README's feature list now separates *working today* from *built as libraries, not
  wired to any UI* (`libs/ai`, `libs/portfolio`) from *not started* (discovery, manual
  profile entry).
- Guide sections updated: Status, Repo map, Conventions, Security non-negotiables (§5),
  How to run / deploy, Open questions.

**⚠ Drift — two items need the owner's call:**

1. **New dev dependency `jsdom` added without prior review.** Non-negotiable 6 covers
   *runtime* dependencies and `jsdom` is `devDependencies`-only (it does not enter any
   bundle — verified by the bundle-origin guard), but it is a large transitive tree and
   the rule's spirit points at flagging it. It was required to test `apps/` at all.
   Ratify or replace with `happy-dom`.
2. **The `default` Trusted Types policy now has a `try/catch`.** SECURITY.md §8.1 and
   ADR-0011 enumerate this policy as one of two ratified exceptions, described as
   rejecting every script URL that is not same-origin *and* armed. That property is
   unchanged when our policy installs. The new fallback path is: if some other code
   installed a `default` policy first, `createPolicy` throws, we swallow it, and the
   `new Worker` call is judged by *that* policy instead of ours. Nothing we control is
   weakened — a foreign `default` policy governs the document regardless — but the
   exception's wording no longer covers every path, so it should be re-ratified or the
   wording widened.


### 2026-09-11 — Real-target-only dashboard, GitHub/session hardening, CSP fix

Closes Next item 1. The dashboard no longer scores against the `vercel/swr` demo target,
and two engineering fixes from this branch (`9a044e4`) plus the built-HTML CSP correction
are recorded here.

- **Dashboard requires a real target** (`apps/web` `dashboard.component.ts`) — deleted the
  `DEMO_REPO` / `DEMO_ISSUE` fixtures. The match / confidence / skill-gap / "Why this
  match" cards render only once a repo is picked (empty/prompt state otherwise); the
  confidence card prompts for an issue until one is chosen. `DEMO_DEV` (anonymous
  *developer* side) is unchanged. The repo-dependent computeds are now null-safe. Verified
  in-browser: empty state → search `state machine` → pick `statelyai/xstate` (match 22%,
  coverage 17%, live "Why this match") → pick issue #5480 (confidence 51%); console clean.
- **Per-resource GitHub rate-limit floor** (`libs/github/src/client.ts`, `9a044e4`) —
  tracks `core` vs `search` quota separately (`resourceForPath` / `floorFor`;
  `min(configured floor, 10% of that resource's quota)`) so a `/search/*` burst no longer
  starves core calls. +2 tests (suite now **159 across 24 files**).
- **Refresh-surviving session** (`apps/web` `auth.service.ts`, `9a044e4`) — identities +
  GitHub token mirrored into `sessionStorage` (`cairn.session.v1`), restored on load,
  wiped on sign-out; never LocalStorage / IndexedDB (ADR-0020, SECURITY.md note dated
  2026-09-10).
- **Built `index.html` now obeys the CSP** — removed the `<base href="/">` element (base
  href supplied via `APP_BASE_HREF` in `app.config.ts`) and disabled the critical-CSS
  inliner (`angular.json` `optimization.styles.inlineCritical: false`) so no inline
  `onload=` handler is emitted. `check-csp.mjs` extended to assert the built HTML has no
  `<base>` / inline `on*=`. Resolves the long-standing CSP self-violation open question.
- **`README.md` Status reconciled** — was stale at "nine libraries (68 tests) / Next up:
  GitHub OAuth"; now matches the guide (twelve libs, 159 tests, sign-in + profile + CV +
  readiness + real target shipped, 26 ADRs).
- Guide sections updated: Status (test count, real-target + hardening done bullets, Next
  list advanced), Open questions (CSP resolved, session-persistence refined), this
  changelog.
- Drift: none. No new outbound origin (`api.github.com` already allow-listed); CSP in
  `_headers` unchanged (the fix makes the *built HTML* conform to it, not the other way);
  no new runtime dependency; core still works with no backend and no AI key.

### 2026-09-10 — Real repo + issue as the dashboard scoring target

Closes Next item 1. The developer side of every dashboard score was already real
(GitHub profile + CV); the comparison target was hard-coded to `vercel/swr` / issue
`#100`. Now the user searches for a repo and picks an open issue.

- **`libs/github`** gained two fetchers: `searchRepositories` (`/search/repositories`,
  new `CACHE_TTL_MS.repoSearch` = 10 min) and `listOpenIssues` (`/repos/:o/:r/issues`,
  drops entries with a `pull_request` key, reuses the `issues` TTL) + `toIssueInput`.
  `libs/github` now also depends on `@cairn/issue-analysis` (types) — acyclic.
- **`libs/targets`** (new, 12th lib, pure) — `repoToSnapshot` (health → `[0,1]`,
  `newcomerFriendliness`, a conservative `inferRequiredExperience` ladder that never
  returns `expert`) and `issueToSnapshot` (`analyzeIssue` output → `IssueSnapshot`).
  Types-only deps on matching / repository-analysis / issue-analysis; the overview
  input is a local structural type, so no `libs/github` edge. 11 tests.
- **`apps/web`** — `GithubClientService` (`core/github-client.ts`): one shared
  `GithubClient`, token-bound when signed in, else anonymous; `/repositories` now uses
  it too instead of building its own. `TargetService` (`core/targets/`) owns the
  search → pick-repo → pick-issue flow and persists `{repoSlug, issueNumber}` under
  `dashboard:target:v1`. Dashboard has a "Scoring target" panel (`FormsModule`); the
  `match` / `confidence` / `gap` / explanation computeds read the live snapshots with
  the `DEMO_*` fixtures as the no-selection fallback. All repo/issue text is
  interpolation-only (untrusted external content, non-negotiable 2).
- **Suite is 157 tests across 24 files.** `verify` + `build` + `guard` green. Initial
  web bundle still ~71 kB transfer.
- **ESLint** `ignores` gained `.claude/**` — a stray local git worktree under
  `.claude/worktrees/` was breaking `eslint .` with project-service parse errors.
- Verified in-browser: repo search returns live results and the demo fallback + captions
  render correctly. The repo→snapshot happy path could not be exercised here — the
  shared-IP **unauthenticated** GitHub rate limit trips the client's 50-remaining floor
  after ~10 calls; the `RateLimitError` path surfaces gracefully ("serving cache only",
  cards stay on demo) and the mapping is unit-tested. A signed-in token (5000/h) avoids
  the floor.
- Guide sections updated: Status (phase line, done, Next, lib + test counts), Repo map
  (`libs/targets`, `libs/github` line, `apps/web` core entries), this changelog.
- Drift: none. No new outbound origin (`api.github.com` was already allow-listed) — CSP
  and `_headers` untouched, both guards green. No new runtime dependency. Core still
  works with no backend and no AI key; the dashboard falls back to demo fixtures when no
  GitHub call is possible.

### 2026-09-10 — Phase 1 profile work landed on `main` (reconcile)

PRs #27 (readiness), #28 (ADR-0026), #29 (CV upload) and #30 (vitest bump) all merged.
The three feature entries below were each written on their own branch; this reconciles
the volatile sections against `main`.

- **Test suite is 142 across 20 files** (readiness added 12; the CV slice's own count
  in its entry, 128/19, was mid-slice). `verify` + `build` green on `main`.
- **CV extraction hardened after a CodeQL pass on #29** — `documentXmlToText` now loops
  the tag strip until the string stops changing (CodeQL's own remediation for
  incomplete multi-character sanitisation), and the `present|current|now` end-year
  match in the profile review form is properly anchored. No behaviour change for
  well-formed input.
- **`libs/profile` now depends on `@cairn/scoring`** (workspace, not a runtime external)
  for `contributionReadiness` — acyclic, mirrors `libs/matching`.
- **`vitest` 3.2.4 → 4.1.11** (#30) — closes GHSA-82fw-gwwq-j7x9 (dev-server-only path
  traversal in `@vitest/mocker`; no 3.x backport). `vitest.config.ts` unchanged; the 70%
  gate still enforces. `check-licenses.mjs` also reworked to read `npm ls --json` off
  the thrown error: `@angular/build` still pins `vitest@^3.1.1` for a builder path this
  repo never runs, so `npm ls` now exits `ELSPROBLEMS` while still printing a valid tree.
- **ADR-0026** closed the job-ingestion open question; `docs/adr/` is 26, all Accepted
  except 0015. The Next list drops the "job-board ingestion ADR" item (done) — the
  successor is "first job/opportunity feed" behind ADR-0026's bar.
- Guide sections updated: Status (test count), Next list, this entry, and the "140" in
  the readiness entry below corrected to 142. `docs/ci-cd.md`'s unit-test row corrected
  from "Jest/Vitest" (a label predating the runner decision) to Vitest.
- Drift: none. No new outbound origin, no CSP change, core still works with no backend
  and no AI key.

### 2026-09-07 — Contribution readiness on the merged profile

- Added `contributionReadiness` (and `profileCompleteness`) to `libs/profile`, scoring
  the merged `UnifiedProfile` alone — no target repository, no new fetch. Five
  weighted parts (skill depth, skill breadth, experience, track record, profile
  completeness) through a new `READINESS_WEIGHTS` map in `libs/scoring`, reusing
  `weightedScore` / `label` rather than a second scoring path. `WEIGHTS_VERSION` was
  deliberately not bumped — no existing weight changed.
- Dashboard gained a "Contribution readiness" panel between "Your profile" and the
  existing `DEMO_REPO` / `DEMO_ISSUE` metric cards, which are untouched: banded
  percent, a bar + note per part, connected/missing profile sources, and next steps
  ranked by the points each would recover (`experience` deliberately excluded from
  next steps — it isn't something a user can go and do).
- 12 new tests in `libs/profile/src/readiness.test.ts` (determinism, monotonicity,
  completeness partition, next-step ranking, an inline snapshot lock); suite is 142
  tests across 20 files, coverage gate still passes.
- Guide sections updated: Status (phase line, done list, Next), Repo map
  (`libs/profile` entry).
- Drift: none. No new dependency, no new outbound origin, no CSP change; `libs/profile`
  gaining a `@cairn/scoring` dependency is acyclic (scoring → shared only) and mirrors
  `libs/matching`'s existing shape.

### 2026-09-07 — CV upload flow: worker extraction → review → merged profile

Closes the last open item of the Phase 1 profile work
([ADR-0011](docs/adr/0011-local-first-cv-processing.md)). The parser half already
existed and was tested; this is the browser half.

- **`libs/cv-extract`** (new, 11th lib) — `extractCvText(fileName, bytes)`: format
  detected by **magic bytes**, not extension, then PDF via pdf.js's text layer, DOCX via
  our own ~150-line ZIP reader over `DecompressionStream('deflate-raw')`, or plain text.
  It reads exactly one DOCX part (`word/document.xml`), so `vbaProject.bin` and embedded
  OLE objects are never decompressed. The zip-bomb limits are ours to enforce: an entry
  cap, a declared-size check, and a running byte cap that aborts mid-inflate when the
  header lies. **35 new tests** (128 total, 19 files) — the DOCX and PDF fixtures are
  built byte-for-byte in-test, so no binaries enter the repo.
- **`apps/web/src/app/core/cv/`** — `CvImportService` enforces `CV_MAX_BYTES` (declared
  in config since day one and never used until now), spawns **one worker per import**,
  and terminates it on success, on failure, and on `CV_PARSE_TIMEOUT_MS` — that
  termination is T7's CPU budget. The worker itself is a ~30-line shim; all parsing logic
  stays in the lib, where Vitest reaches it.
- **`/profile` page** — dropzone plus the ADR-0011 **mandatory review form** (editable
  name / email, per-skill checkboxes, editable role rows, add-a-role), a merged-profile
  panel with `github` / `cv` provenance badges, and remove-imported-CV. Signals only, no
  `FormsModule`; every value is interpolated, never `innerHTML` — extracted CV text is
  untrusted.
- **`ProfileService`** now composes both sources: `profile` became a `computed` over
  `githubToProfile` + `cvToProfile`, the reviewed `ParsedCv` persists under
  `profile:cv:v1` in IndexedDB, and signing out of GitHub no longer wipes the CV.
  Rebuilding from the base each time keeps re-import **idempotent** — `mergeProfile`
  concatenates experience without dedupe, so appending would have inflated `totalYears`.
  Verified in-browser: importing the same CV twice stays at ~10 yrs.

**Three things surfaced only by testing the built bundle under the real CSP** — worth
recording, because none of them shows up under `ng serve` or in CI:

1. `require-trusted-types-for 'script'` makes the **`Worker` constructor a
   `TrustedScriptURL` sink**, and the bundler only emits the worker chunk for a literal
   `new Worker(new URL(…, import.meta.url))` — so the URL cannot be hoisted and wrapped.
   Resolved with a tightly-scoped `default` Trusted Types policy
   (`core/cv/worker-url.ts`, marked `cairn-security-reviewed`). `SECURITY.md` §8.1 and
   non-negotiable 1 above now list it as the second ratified exception.
2. pdf.js **binds itself to the worker's `self` port** on import and posts its own
   handshake, which the service was reading as the extraction result. Both ends now
   type-guard their messages.
3. Our own `index.html` breaks two of its own CSP directives. See the drift note below.

- **Dependency review (non-negotiable 6):** `pdfjs-dist@^6.3.289`, Apache-2.0 — our
  first heavy runtime dependency. Pinned to 6.x deliberately: every 5.x carries
  GHSA-hq66-cqwq-w95j (arbitrary JS execution on opening a malicious PDF — threat T7
  itself), and pdf.js 6 also dropped its last `eval` / `new Function`. `npm audit` clean,
  license guard green. It lands in a **lazy worker chunk** (430 kB transfer, fetched only
  on an upload); the initial bundle is unchanged at 71 kB. Rationale recorded in ADR-0011.
- **`check-bundle-origins.mjs` `IGNORE` widened by three entries** — `https://a`,
  `https://x`, `https://foo.bar`, all placeholder hosts inside the pdf.js chunk (core-js
  probing `URL` / `URLSearchParams` support; pdf.js resolving in-PDF links against a
  dummy base in order to reject them). Verified non-fetching; `ALLOWED_CONNECT_ORIGINS`
  and the CSP were deliberately **not** touched.
- The optional BYOK AI refinement pass over the parsed CV is **deliberately deferred** —
  ADR-0011 requires the no-AI path to stand alone, and the AI pass needs the ADR-0010
  disclosure panel first. Now item 4 under Next.
- Guide sections updated: Status (done + next), Repo map (`libs/cv-extract`, `core/cv/`,
  profile page), Security non-negotiables 1, Decisions & open questions, this changelog.
- Drift: ⚠ one, **pre-existing and not introduced by this slice**. The built
  `index.html` emits markup its own CSP blocks: Angular's `<base href="/">` against
  `base-uri 'none'`, and a stylesheet `onload="this.media='all'"` against
  `script-src 'self'`. Both are blocked and nothing breaks (hash routing; the stylesheet
  still applies), but it means the CSP had never been exercised against a built bundle in
  a browser. Needs an owner decision: drop the base tag and the preload trick, or relax
  the directives.

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

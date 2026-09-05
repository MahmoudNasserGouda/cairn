# Rujoom — Architecture Overview

This is the entry point for the Rujoom architecture. It gives the system
picture and links to the deeper documents:

- **Decisions:** [`docs/adr/`](docs/adr/README.md) — 23 Architecture Decision Records.
- **Security:** [`SECURITY.md`](SECURITY.md) — trust model, threat model, controls.
- **CI/CD:** [`docs/ci-cd.md`](docs/ci-cd.md) — pipeline and gates.
- **Working guide:** [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) — current status and conventions.

## 1. Product summary & positioning

Rujoom helps students, junior developers, and developers in emerging
markets discover suitable open-source projects, understand unfamiliar codebases, make
meaningful contributions, and turn those contributions into professional opportunities.

The product is organised around five questions:

1. **Who am I?** — a unified developer profile from GitHub, optional LinkedIn/Google, a
   CV, and manual entry.
2. **What should I contribute to?** — repository and issue discovery.
3. **Why is it a good match?** — deterministic, explainable match and health scores.
4. **How do I start?** — the Open Source Copilot (architecture explorer, issue
   explainer, contribution navigator).
5. **How do I showcase my progress?** — a generated contributor portfolio.

## 2. Architecture principles

| Principle | Consequence | ADR |
|-----------|-------------|-----|
| **Local-first** | Core product runs in the browser against third-party APIs + local storage | [0001](docs/adr/0001-local-first-zero-cost-architecture.md) |
| **$0 operating cost for the MVP** | Static hosting, no backend, no DB, no Rujoom AI bill | [0001](docs/adr/0001-local-first-zero-cost-architecture.md), [0004](docs/adr/0004-static-first-web-app-on-free-hosting.md) |
| **No mandatory backend** | Server code only as stateless serverless functions, added per concrete need | [0002](docs/adr/0002-no-mandatory-application-backend.md), [0016](docs/adr/0016-optional-serverless-api.md) |
| **No mandatory database** | IndexedDB + LocalStorage; sync deferred | [0003](docs/adr/0003-no-mandatory-database-local-first-storage.md) |
| **Maximum browser/device computation** | Matching, health, CV parsing, portfolio generation all client-side | [0007](docs/adr/0007-deterministic-explainable-matching-engine.md), [0008](docs/adr/0008-ai-free-repository-health-engine.md), [0011](docs/adr/0011-local-first-cv-processing.md), [0013](docs/adr/0013-client-side-portfolio-generation.md) |
| **Direct third-party APIs** | Call GitHub directly with the user's token; no proxy | [0006](docs/adr/0006-direct-github-api-usage.md) |
| **BYOK AI, optional** | Users bring their own key; a useful non-AI mode always exists | [0009](docs/adr/0009-byok-ai-optional-enhancement.md) |
| **Security first** | Strict CSP, sanitisation, PKCE, minimal deps, CI gates — the #1 requirement | [0019](docs/adr/0019-security-first-rendering.md), [0020](docs/adr/0020-oauth-token-and-byok-key-handling.md), [0021](docs/adr/0021-supply-chain-and-dependency-security.md) |
| **CI/CD from day one** | Pipeline is the only path to prod; security gates block merge | [0022](docs/adr/0022-ci-cd-is-mandatory-infrastructure.md) |
| **Evolve, don't rewrite** | Shared core libraries; each new client/service is an addition | [0005](docs/adr/0005-angular-typescript-shared-core-monorepo.md) |

## 3. System context (C4 level 1)

```mermaid
flowchart TB
    User([Developer / student])

    subgraph Clients["Rujoom clients"]
        Web["Web app (primary MVP)<br/>static SPA"]
        Ext["Browser extension<br/>(after web MVP)"]
        Desktop["Desktop / local agent<br/>(future)"]
    end

    Host["Free static host<br/>Cloudflare Workers static assets"]
    GH["GitHub REST + GraphQL API"]
    LI["LinkedIn / Google OIDC"]
    AI["BYOK AI providers<br/>OpenAI / Gemini / OpenRouter"]
    Store["Hosted store / checkout<br/>Lemon Squeezy / Gumroad"]
    Serverless["Optional serverless API<br/>(future)"]

    User --> Web & Ext & Desktop
    Host -. serves .-> Web
    Web --> GH & LI & AI
    Ext --> GH & AI
    Desktop --> GH & AI
    Desktop --> Local["Local repo + local model (Ollama)"]
    User -. donations / premium .-> Store
    Web -. future .-> Serverless
```

## 4. Container view (C4 level 2)

```mermaid
flowchart TB
    subgraph Web["apps/web — Angular SPA"]
        UI["UI: dashboard, discovery, repo details,<br/>architecture explorer, navigator, portfolio"]
        NgGlue["Angular services / state / router"]
    end

    subgraph Ext["apps/extension — MV3"]
        CS["content script (GitHub panels)"]
        BG["background service worker"]
    end

    subgraph Libs["libs/* — framework-agnostic TypeScript"]
        LGithub["github — cached API client"]
        LProfile["profile — unified profile + CV parser"]
        LMatching["matching — match scores"]
        LScoring["scoring — score primitives + weights config"]
        LRepo["repository-analysis — health, architecture"]
        LIssue["issue-analysis — difficulty, explainer inputs"]
        LPortfolio["portfolio — static site generator"]
        LAI["ai — IAIProvider abstraction"]
        LShared["shared — storage, cache, sanitiser, types"]
    end

    LocalStore[("IndexedDB / LocalStorage /<br/>chrome.storage.local")]
    Serverless["api/optional-serverless (future)"]

    NgGlue --> Libs
    CS --> Libs
    BG --> Libs
    Libs --> LShared
    LShared <--> LocalStore
    LGithub --> ExtGH["GitHub API"]
    LAI --> ExtAI["AI providers"]
    Libs -. future .-> Serverless
```

## 5. Shared core / monorepo layout

Single Git monorepo, npm workspaces, TypeScript `strict`
([ADR-0005](docs/adr/0005-angular-typescript-shared-core-monorepo.md)):

```
OpenSourceCompass/
├── apps/
│   ├── web/                  # Angular SPA — the primary MVP
│   ├── extension/            # MV3 browser extension (after web MVP)
│   └── desktop/              # future — Tauri shell + local analysis
├── libs/
│   ├── github/               # cached, deduped, rate-limit-aware GitHub client
│   ├── profile/              # unified profile model, CV text extraction + parser, skills taxonomy
│   ├── matching/             # repository & issue match scores
│   ├── scoring/              # score primitives, explanation objects, versioned weights config
│   ├── repository-analysis/  # health engine, architecture model, reading order
│   ├── issue-analysis/       # difficulty estimation, required-knowledge extraction
│   ├── portfolio/            # client-side static site / markdown generator, theme templates
│   ├── ai/                   # IAIProvider + OpenAI / Gemini / OpenRouter, non-AI fallbacks
│   └── shared/               # storage abstraction, cache, HTML sanitiser, common types, config
└── api/
    └── optional-serverless/  # future — stateless functions, empty at MVP
```

Dependency rule: `apps/*` → `libs/*` only; `libs/*` never import `apps/*`; `libs/*` are
framework-free except `libs/shared` (browser storage) — enforced by lint
([docs/ci-cd.md](docs/ci-cd.md)).

Nx is **not** adopted yet; the layout keeps the option open.

## 6. Key data flows

### 6a. GitHub OAuth + direct API with local cache

```mermaid
sequenceDiagram
    participant U as User
    participant App as Web app
    participant SS as sessionStorage
    participant GH as GitHub
    participant Cache as IndexedDB cache

    U->>App: Sign in with GitHub
    App->>SS: store state + PKCE verifier (single-use)
    App->>GH: authorize (code + PKCE, exact redirect)
    GH-->>App: redirect with code
    App->>SS: verify state, read verifier, then clear
    App->>GH: exchange code (PKCE, public client)
    GH-->>App: access token (kept in memory by default)
    U->>App: Open repo discovery
    App->>Cache: lookup (URL + query)
    alt fresh in cache
        Cache-->>App: cached response
    else stale or missing
        App->>GH: GraphQL query (+ ETag if known)
        GH-->>App: 200 data  /  304 not modified
        App->>Cache: store with fetched-at + ETag
    end
    App->>App: compute scores locally (libs/matching, libs/scoring)
```

### 6b. CV upload → local parse

```mermaid
sequenceDiagram
    participant U as User
    participant App as Web app
    participant W as Sandboxed Web Worker
    participant P as libs/profile parser
    participant AI as BYOK provider (optional)

    U->>App: Upload CV (PDF/DOCX)
    App->>App: enforce size cap
    App->>W: file bytes (never leave device)
    W->>W: extract text (timeout + CPU budget)
    W-->>App: plain text
    App->>P: parse (sections, skills taxonomy, date ranges)
    P-->>App: draft profile fields
    opt user has AI key
        App->>U: disclosure panel — "CV text will be sent to <provider>"
        U->>App: confirm
        App->>AI: extract structured fields
        AI-->>App: suggestions (sanitised, untrusted)
    end
    App->>U: editable review form
    U->>App: confirm → commit to unified profile (IndexedDB)
```

### 6c. BYOK AI request with disclosure

```mermaid
sequenceDiagram
    participant U as User
    participant App as Web app
    participant D as Disclosure panel
    participant Prov as AI provider (user's key)

    U->>App: "Explain this issue"
    App->>D: show provider, model, exact payload<br/>(system prompt + fenced untrusted repo text)
    U->>D: (optional) trim files / context
    U->>D: Send
    App->>Prov: direct request with user's key (never via Rujoom)
    Prov-->>App: response
    App->>App: sanitise output (allowlist), label as AI-generated
    App->>U: render
    Note over App: key + token never in prompt, logs, or telemetry
```

### 6d. Portfolio generation

```mermaid
sequenceDiagram
    participant U as User
    participant App as Web app
    participant Gen as libs/portfolio
    participant Score as libs/scoring

    U->>App: Generate portfolio
    App->>Score: compute Contribution / Consistency / Impact / Community scores
    App->>Gen: unified profile + contributions + chosen theme
    Gen->>Gen: sanitise user free-text, apply template
    Gen-->>App: index.html (inlined) + markdown + Pages-ready folder
    App->>U: download (.zip) + copy-paste deploy instructions
    U->>U: deploy to their own GitHub Pages / Cloudflare Pages
```

## 7. Data classification & storage

| Class | Examples | Where | Policy |
|-------|----------|-------|--------|
| **User-specific** | Unified profile, skills, interests, saved repos/issues, preferences, AI config | IndexedDB (local only) | Source of truth; export/import JSON for backup; sync deferred ([ADR-0003](docs/adr/0003-no-mandatory-database-local-first-storage.md)) |
| **Secrets** | GitHub token, BYOK AI keys | Memory by default; encrypted IndexedDB / isolated store opt-in | Never logged, never to Rujoom, never in URLs ([ADR-0010](docs/adr/0010-ai-key-privacy-and-data-disclosure.md), [ADR-0020](docs/adr/0020-oauth-token-and-byok-key-handling.md)) |
| **Public repo data** | Metadata, languages, issues, PRs, contributors, commit activity | IndexedDB cache from GitHub | Per-resource TTL, ETag revalidation, size cap + LRU eviction ([ADR-0006](docs/adr/0006-direct-github-api-usage.md)) |
| **Derived** | Match Score, Health Score, Difficulty, Confidence, portfolio metrics | Not persisted (recomputed) or cached briefly with inputs | Deterministic, explainable ([ADR-0007](docs/adr/0007-deterministic-explainable-matching-engine.md), [ADR-0008](docs/adr/0008-ai-free-repository-health-engine.md)) |

## 8. Engines (AI-free, deterministic)

### Matching Engine — `libs/matching` + `libs/scoring`

Pure, synchronous, no network, no randomness, no wall-clock reads inside scoring.
Inputs: user skills / experience / technologies / interests, repository technologies /
activity, issue difficulty, community signals. Outputs: Repository Match Score, Issue
Match Score, Contribution Confidence Score, Skill Gap — each a weighted sum of named
sub-scores with an explanation object.

```
Repository Match: 91%
  Skill Match        40%
  Technology Match   25%
  Experience Match   15%
  Activity           10%
  Learning Value     10%
  ─────────────────────
  Total             100%
```

Weights live in `libs/scoring/weights.ts`, versioned, separate from UI, overridable per
preset. Snapshot-tested. See [ADR-0007](docs/adr/0007-deterministic-explainable-matching-engine.md).

### Repository Health Engine — `libs/repository-analysis`

Signal-based, same rules. Signals: recent commit activity, release cadence, issue
response behaviour, PR activity, maintainer activity, contributor count / bus factor,
`good first issue` availability, documentation indicators.

```
Health Score: 92
  Activity: High
  Maintenance: High
  Documentation: Good
  New Contributor Support: High
```

See [ADR-0008](docs/adr/0008-ai-free-repository-health-engine.md).

## 9. Security architecture

Everything from GitHub, LinkedIn, AI providers, CV files, and repository content is
**untrusted input** rendered in a browser context that holds the user's GitHub token
and BYOK AI keys. The response is: strict CSP with no `unsafe-inline`/`eval`, Trusted
Types, an allowlist HTML sanitiser on all Markdown and AI output, OAuth Authorization
Code + PKCE with an exact redirect-URI allowlist, in-memory-by-default token storage,
minimal pinned dependencies with CI scanning, and least-privilege everywhere.

Full trust model, asset inventory, STRIDE-lite threat table, and the non-negotiables
list: **[SECURITY.md](SECURITY.md)**. Decisions:
[ADR-0019](docs/adr/0019-security-first-rendering.md),
[ADR-0020](docs/adr/0020-oauth-token-and-byok-key-handling.md),
[ADR-0021](docs/adr/0021-supply-chain-and-dependency-security.md).

## 10. CI/CD

GitHub Actions is the only path to production. Every PR runs: install → format → lint
(incl. import boundaries) → typecheck → unit tests + coverage → build → **CodeQL SAST**,
**OSV/npm-audit**, **gitleaks**, **license check**, **CSP/`bypassSecurityTrust` guard**,
**bundle-origin check** → preview deploy. Merge to `main` adds SBOM generation and
deploys `apps/web` to Cloudflare Workers static assets; the extension artifact is built
in CI behind a manual store-submission gate.

Full pipeline and stage detail: **[docs/ci-cd.md](docs/ci-cd.md)**. Decision:
[ADR-0022](docs/adr/0022-ci-cd-is-mandatory-infrastructure.md).

## 11. Cost model

Preferred order for any capability:

1. Browser / device computation
2. Direct third-party API
3. Static hosting
4. Free serverless service
5. Paid infrastructure — only when actual usage requires it

| Phase | Static hosting | Backend | Database | AI | Storage | Total |
|-------|----------------|---------|----------|----|---------|-------|
| Hackathon | $0 | $0 | $0 | $0 (BYOK) | $0 | **$0** (optional: a domain) |
| Early launch | $0 | $0 | $0 | $0 | $0 | **~$0/month** |
| Growing | $0 | free tiers | free tier | $0 | free tier | **~$0–5+/month**, rising only with real usage |

## 12. Monetization (what's live at MVP)

Per [ADR-0018](docs/adr/0018-monetization-donations-and-no-backend-paid-features.md) and
project owner direction — **live from the MVP, no backend:**

- **Donations** — GitHub Sponsors, Ko-fi, Buy Me a Coffee (outbound links only).
- **Premium portfolio themes & premium client-side features** — sold via a hosted store
  (Lemon Squeezy / Gumroad); unlocked by an **offline-verifiable signed license key**
  (Ed25519, public key in the app). The spec's free-feature set stays fully functional.

**Deferred** (needs a backend, [ADR-0016](docs/adr/0016-optional-serverless-api.md)):
sponsored-repository placement pipeline, sponsored learning placement, enterprise
talent/analytics. Sponsored content, when it exists, is clearly labelled and **never**
influences organic scores
([ADR-0017](docs/adr/0017-sponsorship-must-not-distort-scores.md)).

## 13. Architecture evolution

```mermaid
flowchart TD
    S1["Stage 1 — Static web app<br/>+ local storage + direct APIs + BYOK AI"]
    S2["Stage 2 — + browser extension<br/>sharing the core libraries"]
    S3["Stage 3 — + optional serverless API<br/>payments, sponsorships, optional sync"]
    S4["Stage 4 — + desktop / local agent<br/>local repo analysis + local AI"]
    S5["Stage 5 — + optional cloud services<br/>community, enterprise features"]
    S1 --> S2 --> S3 --> S4 --> S5
    Note["The core product stays functional even if<br/>every optional cloud service is unavailable."]
```

## 14. Non-goals (do not build initially)

Always-on VPS · traditional microservices · mandatory PostgreSQL · Redis · centralized
AI inference · a server-side proxy for every repository request · custom payment
processing · custom file hosting · mandatory user accounts · mandatory cloud sync.

Add any of these only when a concrete product requirement justifies it, via a new ADR.

## 15. Roadmap ↔ architecture mapping

| Phase | Product goal | Enabling components | Key ADRs | Hackathon scope? |
|-------|--------------|---------------------|----------|------------------|
| **1 — Foundation & Profile Intelligence** | Unified developer profile, readiness dashboard | `libs/profile`, `libs/github`, `libs/matching`, `libs/scoring`, `libs/shared` | 0001, 0003, 0006, 0007, 0011, 0012, 0020 | ✅ (GitHub OAuth, LinkedIn OAuth, CV upload, unified profile, confidence score) |
| **2 — Discovery Engine** | Repository & issue discovery, filters, health | `libs/github`, `libs/repository-analysis`, `libs/issue-analysis`, `libs/matching` | 0006, 0007, 0008 | ✅ (repo discovery, match engine, health analysis, issue discovery) |
| **3 — Open Source Copilot** | Architecture Explorer, Issue Explainer, Contribution Navigator, PR Explainer, Reading Order | `libs/ai`, `libs/repository-analysis`, `libs/issue-analysis` | 0009, 0010, 0019 | ✅ WOW features: Architecture Explorer, Issue Explainer, Contribution Navigator |
| **4 — Growth Engine** | Skill gap analysis, learning recs, roadmaps | `libs/matching` (skill gap), `libs/ai` (optional), curated content data | 0007, 0009 | ➖ |
| **5 — Contributor Identity** | Portfolio, OSS resume, timeline, analytics | `libs/portfolio`, `libs/scoring` | 0013, 0018 | ✅ (contributor portfolio) |
| **6 — Community Layer** | Reviews, stories, guides, recommendations | `api/optional-serverless` + serverless DB | 0016 | ➖ (needs backend) |
| **7 — AI Marketplace** | Shared prompts & analysis templates | `libs/ai` template model + `api/optional-serverless` for sharing | 0009, 0016 | ➖ |
| **8 — Sustainability & Revenue** | Donations, sponsored repos, sponsored learning, enterprise | Donation links + hosted store + client license check (now); sponsorship/enterprise pipeline (later) | 0017, 0018, 0016 | Partial: donations + paid themes live; sponsorship pipeline deferred |

## 16. ADR index

See [`docs/adr/README.md`](docs/adr/README.md) for the full table. Summary:

- **Accepted:** 0001–0014, 0017 (principle), 0018–0023.
- **Proposed / future:** 0015 (desktop agent), 0016 (serverless API).

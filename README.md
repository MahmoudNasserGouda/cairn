<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-dark.svg" />
    <img alt="Rujoom" src="brand/logo.svg" width="240" />
  </picture>
</p>

<p align="center"><strong>Find your path into open source.</strong></p>

<p align="center">
  <a href="https://github.com/MahmoudNasserGouda/cairn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MahmoudNasserGouda/cairn/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="Infra cost" src="https://img.shields.io/badge/infra%20cost-%240%2Fmo-brightgreen.svg" />
  <img alt="AI" src="https://img.shields.io/badge/AI-bring%20your%20own%20key-8A2BE2.svg" />
</p>

---

**Rujoom** helps students, junior developers, and developers in emerging markets
**discover** suitable open-source projects, **understand** unfamiliar codebases, make
**meaningful contributions**, and turn those contributions into a **career**.

A cairn is a stack of stones that marks a trail through unfamiliar terrain — and that
each traveller adds to for the next. That is the whole product: it guides you from *"who
am I?"* to *"what should I contribute to?"* to *"how do I start?"* to *"how do I show
what I've done?"*.

It is **local-first**: the core runs entirely in your browser against public APIs and
your own device storage. No account, no backend, no database, and no Rujoom-funded AI
bill — you bring your own API key if you want AI features at all.

## Why it's different

| | |
|---|---|
| 🧭 **Deterministic, explainable scoring** | Repository match, health, and contribution confidence are computed from named, weighted signals — never a black-box model. Every score shows *why*. |
| 🔒 **Security-first** | Strict CSP, Trusted Types, allowlist sanitisation of everything external, OAuth Authorization Code through an origin-allowlisted token-exchange Worker, minimal pinned dependencies, and CI gates (CodeQL · OSV · gitleaks · custom CSP/bundle guards). See [`SECURITY.md`](SECURITY.md). |
| 💸 **$0 to run** | Static hosting on a free tier, direct third-party APIs, local storage. Target infra cost for the MVP: **$0/month**. |
| 🔑 **Bring your own key** | AI (architecture explorer, issue explainer, contribution navigator) is an *optional* enhancement via OpenAI / Gemini / OpenRouter. Keys stay on your device. Every AI feature has a non-AI fallback. |
| 📦 **One shared core, many clients** | Framework-free TypeScript libraries power the web app today and a browser extension / desktop agent later. |

## Features

**Working today**

- Multi-provider sign-in (GitHub · LinkedIn · Google); GitHub is the data connection
- Unified developer profile from **GitHub analysis** + **CV upload** (PDF / .docx / txt,
  parsed on-device in a sandboxed worker, with a mandatory review step)
- **Contribution readiness** — a target-free score of how prepared you are, with
  ranked next steps
- **Repository discovery** — your profile becomes a handful of GitHub searches, and the
  results are ranked by named, weighted signals with a plain-language "why" on every
  card. Three presets (balanced · quick win · stretch) re-rank without re-querying
- Pick a **real repository and open issue** as a scoring target, then see
  deterministic **repository match**, **contribution confidence** and **skill gap**
  against it, each with its "why"
- **Repository health** analysis (activity, maintenance, docs, newcomer-friendliness)
- Browser extension: health + newcomer-friendliness inline on a GitHub repo page

**Built as libraries, not yet wired to any UI**

These have real implementations and tests in `libs/*`, but nothing in the app calls
them yet — treat them as planned, not shipped:

- Contributor **portfolio** generator (`libs/portfolio`)
- **Architecture Explorer**, **Issue Explainer**, **Contribution Navigator** — the BYOK
  AI features, including the provider abstraction, prompt fencing and non-AI fallbacks
  (`libs/ai`). There is no key-entry UI or disclosure panel yet, so AI is currently off.

**Not started**

- **Issue-level discovery** — discovery recommends repositories; picking the issue
  inside one is still a manual choice from that repository's open list
- **Manual** profile entry — you can edit and deselect what the CV parser found, but
  you cannot yet add a skill by hand
- Growth roadmaps, contributor identity & analytics, community reviews/stories, a
  prompt-template marketplace. Full plan:
  [`ARCHITECTURE.md` §15](ARCHITECTURE.md#15-roadmap--architecture-mapping).

## How it works

```
You → your skills → readiness → repos we recommend → a repo + issue you pick → match & confidence → contribution
```

(The `recommendations → portfolio → career` half of that pipeline is designed and
partly implemented in `libs/*`, but not yet reachable from the app.)

Everything user-specific lives in IndexedDB. Public repository data is fetched straight
from the GitHub API (with caching, dedup, ETag revalidation and rate-limit awareness)
and cached locally. Scores are derived on-device. AI calls, if enabled, go directly from
your browser to your chosen provider — never through Rujoom.

Read the full picture in [`ARCHITECTURE.md`](ARCHITECTURE.md): C4 diagrams, data flows,
the scoring engines, the cost model, and the 26 [Architecture Decision Records](docs/adr/README.md).

## Quick start

```bash
# Node 22.13.0  (see .nvmrc)
npm ci
npm run verify        # format + lint + typecheck + test (+coverage) + CSP guard
npm run -w @cairn/web start          # dev server → http://localhost:4200
```

Other commands:

```bash
npm test                       # Vitest unit tests (watch: npm run test:watch)
npm run build                  # libs (tsc) + web (Angular) + extension (esbuild)
npm run guard                  # CSP + bundle-origin security guards
npm run -w @cairn/extension build:watch
```

## Project structure

```
apps/
  web/                  Angular 20 SPA — the primary MVP (standalone, zoneless)
  extension/            Manifest V3 browser extension (esbuild)
libs/                   framework-free TypeScript — shared by every client
  shared/               storage, redacting logger, sanitiser contract, config
  scoring/              weighted-score primitive + versioned weights
  matching/             repository / issue match, contribution confidence, skill gap
  repository-analysis/  AI-free health engine, architecture model, reading order
  issue-analysis/       deterministic difficulty + required-knowledge extraction
  github/               cached GitHub client (dedup · ETag · rate-limit floor)
  profile/              unified profile, CV parser, skills taxonomy
  portfolio/            static portfolio generator, offline Ed25519 license verify
  ai/                   IAIProvider (OpenAI/Gemini/OpenRouter), fenced prompts, fallbacks
scripts/                CI security guards (CSP, bundle origins, licenses)
docs/adr/               Architecture Decision Records
brand/                  logo / mark assets
```

Dependency rule: `apps/*` may import `libs/*`; never the reverse. `libs/*` are
framework-free (except `libs/shared`, which is browser-only). Enforced by ESLint.

## Tech stack

TypeScript · Angular 20 (standalone, zoneless) · Vitest · ESLint (flat) · Prettier ·
DOMPurify · esbuild · GitHub Actions · Cloudflare Workers.

## Security

Security is the project's #1 requirement. The trust model, STRIDE-lite threat table,
and the non-negotiables list are in [`SECURITY.md`](SECURITY.md).

**Found a vulnerability?** Report it privately via
[GitHub Security Advisories](https://github.com/MahmoudNasserGouda/cairn/security/advisories/new)
or email `mahmoudnasser98@gmail.com` — please don't open a public issue.

## Sustainability

Rujoom is free. It is supported by **donations** (GitHub Sponsors, Ko-fi, Buy Me a
Coffee) and optional **premium portfolio themes / features** that unlock client-side
with no backend. The free feature set stays fully functional. Sponsored content, when it
exists, is clearly labelled and never influences organic scores
([ADR-0017](docs/adr/0017-sponsorship-must-not-distort-scores.md),
[ADR-0018](docs/adr/0018-monetization-donations-and-no-backend-paid-features.md)).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: `npm run verify` must pass, commits
follow [Conventional Commits](https://www.conventionalcommits.org/), and changes to the
security surface (CSP, sanitiser, auth, dependencies, outbound origins) get explicit
review. New contributors: [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) is the fastest way in.

## Status

Phase 1 (Foundation). The web app is live on Cloudflare Workers, backed by twelve
shared libraries (157 passing tests), the browser extension, and the full CI/CD
pipeline. Multi-provider sign-in (GitHub for data; LinkedIn/Google for identity), a real
GitHub-derived unified profile, local-first CV import, contribution-readiness scoring,
and a dashboard that scores against a real repo + issue the user picks are all shipped.
Next up: make the comparison target always a real repo/issue (drop the demo fallback),
then the first key-free job/opportunity feed.

## License

[MIT](LICENSE)

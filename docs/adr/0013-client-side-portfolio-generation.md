# 0013. Client-side portfolio generation

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

Phase 5 (Contributor Identity) turns contributions into a portfolio / open-source
resume / contribution timeline. The spec: portfolio generation should be client-side
(unified profile → generator → static HTML/Markdown), users deploy the result to
GitHub Pages / Cloudflare Pages / other static hosting, and OSC does not need to host
portfolios.

## Decision

`libs/portfolio` generates, **in the browser**, a self-contained static site from the
unified profile and contribution data:

- Outputs: a single **HTML** file (inlined CSS, no external calls), a **Markdown**
  document, and a **GitHub Pages-ready** folder (`index.html`, `assets/`, no build step).
- Themes are data-driven templates; a free set ships in-app. Premium themes are unlocked
  client-side ([ADR-0018](0018-monetization-donations-and-no-backend-paid-features.md)).
- Metrics shown (Contribution Score, Consistency Score, Impact Score, Community Score)
  are computed by `libs/scoring` deterministically
  ([ADR-0007](0007-deterministic-explainable-matching-engine.md)).
- The user downloads the artifact (a `.zip` or individual files) and deploys it
  themselves; the app provides copy-paste deploy instructions.

## Consequences

- OSC hosts nothing user-generated → no moderation, storage, or takedown burden at MVP.
- Public shareable profiles hosted *by OSC* (Phase 5/6) would need
  [ADR-0016](0016-optional-serverless-api.md) and are out of scope here.
- Generated HTML must itself be safe (no injected script from profile free-text fields) —
  the generator sanitises user input ([SECURITY.md](../../SECURITY.md)).
- Portfolio export doubles as the durable backup of the local-first profile
  ([ADR-0003](0003-no-mandatory-database-local-first-storage.md)).

## Alternatives considered

- **OSC-hosted portfolio pages.** Deferred: attractive for network effects but pulls in
  hosting, accounts, and moderation.
- **Server-side static site generation.** Rejected: unnecessary; templating in the
  browser is sufficient.

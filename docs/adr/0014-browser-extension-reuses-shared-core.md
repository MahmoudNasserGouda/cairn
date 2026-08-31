# 0014. Browser extension reuses the shared core

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

The spec's delivery model has a browser extension that gives a contextual GitHub
experience (Repository Match Score, Repository Health, Recommended Issues, Beginner
Friendliness, Technology Match, Architecture Analysis, Contribution Navigator) and
reuses the web application's core libraries, at $0/month infrastructure cost.

## Decision

`apps/extension` is a **Manifest V3** extension that imports `libs/*` directly as source
(same monorepo, [ADR-0005](0005-angular-typescript-shared-core-monorepo.md)):

- **Content script** injects a compact panel onto `github.com` repo, issue, and PR
  pages, rendering scores from `libs/matching`, `libs/scoring`,
  `libs/repository-analysis` computed against `libs/github`.
- **Shared state** with the web app is *not* automatic — the extension has its own
  `chrome.storage.local` copy of the profile, with an explicit import/export or a
  "sync from web app" action the user triggers.
- **Least privilege manifest:** host permissions limited to `https://github.com/*` and
  the configured AI provider origins; no `tabs`, no broad `<all_urls>`; `activeTab`
  where possible.
- AI features reuse `libs/ai` with the user's key in `chrome.storage.local`
  ([ADR-0010](0010-ai-key-privacy-and-data-disclosure.md)).
- No extension backend. Store registration fees are a one-off, separate from recurring
  infra cost.

## Consequences

- The extension ships after the web MVP; `libs/*` must stay framework-agnostic to make
  this cheap ([ADR-0005](0005-angular-typescript-shared-core-monorepo.md)).
- Two stores (Chrome, Firefox) mean two review processes; the MV3 codebase targets both
  with `webextension-polyfill`.
- Content-script DOM injection into GitHub is brittle to GitHub redesigns; selectors are
  isolated and defensively coded.
- Security review of the content script's privilege boundary is mandatory
  ([SECURITY.md](../../SECURITY.md)).

## Alternatives considered

- **Separate extension repo with `libs/*` as npm packages.** Rejected: publish/version
  friction at MVP scale.
- **Bookmarklet.** Rejected: too limited for panels and storage.

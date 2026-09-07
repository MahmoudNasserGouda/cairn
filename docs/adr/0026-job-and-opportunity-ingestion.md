# 0026. Job and opportunity ingestion: public feeds and user-initiated capture

- Status: Accepted
- Date: 2026-09-07
- Deciders: Project owner
- Builds on: [ADR-0025](0025-multi-provider-identity.md),
  [ADR-0014](0014-browser-extension-reuses-shared-core.md),
  [ADR-0016](0016-optional-serverless-api.md)
- Refines: [ADR-0014](0014-browser-extension-reuses-shared-core.md)

## Context

[ADR-0025](0025-multi-provider-identity.md) settled _whose_ data Rujoom may read and
closed its job-data section with a promise: public listings only, each source behind its
own mini-ADR, and "that capability gets its own ADR when it is built." This is that ADR.
It is written before any ingestion code so the boundary exists first.

Two things were left open.

**Which sources.** The market splits cleanly. Indeed's API is a partner/employer product
with no job-seeker endpoint. Wuzzuf, Bayt, Gulf Talent and Naukri publish no API and no
OAuth at all. What remains is a small set of aggregators that do publish a feed — Adzuna,
Remotive, USAJobs, Arbeitnow and similar — plus GitHub issues, which Rujoom already
reads. Those feeds differ on the two axes that matter to a static, backend-less client:
whether they require an API key, and whether they send CORS headers. Neither is settled
by reading a marketing page, and a key changes the architecture, not just a config line.

**How the extension may capture a listing.** ADR-0025 pointed at the browser extension as
the answer for a board with no feed. But
[ADR-0014](0014-browser-extension-reuses-shared-core.md) pins the extension to
`https://github.com/*` and says "no `tabs`, no broad `<all_urls>`". Read literally, the
capability ADR-0025 promised cannot be built. That conflict between two accepted records
has to be resolved rather than quietly discovered by whoever writes the code.

The constraints that bind both: [SECURITY.md](../../SECURITY.md) §5 bars
credential-driven access, §8.6 requires review of every new outbound origin, and §8.7
requires the core product to work with no backend at all.

## Decision

### Two ingestion paths, and only two

1. **Public feeds** — documented, credential-free APIs read on the user's behalf, giving
   a stream of listings to match against.
2. **User-initiated capture** — the extension records the single listing the user is
   already looking at, on their device, on their gesture.

Nothing else. No crawler, no bulk import, no server-side scrape, no reading any user's
account on any board. "Import everything from every site" remains declined
([ADR-0025](0025-multi-provider-identity.md)), not deferred.

### Acceptance criteria for a feed

**This ADR authorises no specific source.** It fixes the bar a source must clear. A feed
may be integrated only when all five hold:

1. **Documented and permitted.** A public API or feed with published terms that allow
   this use. A response that merely happens to be fetchable is not a feed.
2. **No user credential.** No login, no per-user token, no password. A service-level
   application key is not automatically disqualifying, but see (3).
3. **Reachable without a secret, or gated.** Either the browser can call it directly —
   CORS headers present, no key — which is the preferred shape and the only one that
   leaves [ADR-0001](0001-local-first-zero-cost-architecture.md) and
   [ADR-0002](0002-no-mandatory-application-backend.md) intact; or the call goes through
   a Worker under [ADR-0016](0016-optional-serverless-api.md)'s existing gate, whose
   mini-ADR must state why the server is unavoidable, what data it touches, its
   retention, and its failure mode in the client. A key is never shipped in the bundle: a
   static origin cannot hold a secret ([SECURITY.md](../../SECURITY.md) §8.4).
4. **Origin declared in both places.** The new origin goes into
   `ALLOWED_CONNECT_ORIGINS` in `libs/shared/src/config.ts` _and_ the CSP `connect-src`
   in `apps/web/public/_headers`, so `scripts/check-csp.mjs` and
   `scripts/check-bundle-origins.mjs` enforce it in CI
   ([SECURITY.md](../../SECURITY.md) §8.6).
5. **Its own mini-ADR**, recording which of these it satisfies and how.

Against that bar the candidates ADR-0025 named stand as follows — evaluated, not
approved:

- **Adzuna**, **USAJobs** — require an application key. They fail (3) as a direct browser
  call and are viable only behind a Worker with its own ADR-0016 mini-ADR. That server is
  a real cost, so neither is worth building before a key-free source has proved the
  feature is wanted.
- **Remotive**, **Arbeitnow** — key-free, and therefore the natural first candidates.
  Their CORS headers and terms are unverified; verifying them is the first task of
  whichever mini-ADR proposes them.
- **GitHub issues** — already ingested under
  [ADR-0006](0006-direct-github-api-usage.md); no further decision needed.

A source that fails the bar is declined and the reason written down, in the manner
ADR-0025 set for the boards with no API.

### Extension capture

This refines [ADR-0014](0014-browser-extension-reuses-shared-core.md)'s least-privilege
bullet; it does not reverse it.

- Capture runs on **`activeTab` plus an explicit user gesture** — the user clicks the
  toolbar action while reading a listing. `activeTab` grants access to that one tab, at
  that moment, because the user asked for it. No static host permission is added beyond
  `https://github.com/*`, and `<all_urls>` stays forbidden.
- **One listing per gesture.** No background reads, no automatic capture, no following
  links out of the captured page. The extension gets no ambient view of browsing.
- What is stored is **normalised text fields** — title, organisation, location, the
  technologies the taxonomy recognises, the listing URL — not a copy of the page and
  never the user's session.
- Captured records live in the extension's own `chrome.storage.local`
  ([ADR-0014](0014-browser-extension-reuses-shared-core.md)) and reach the web app only
  through the explicit import/export that ADR already defines. **Nothing is sent to a
  Rujoom server**, because there is none to send it to.
- A captured listing is untrusted external text: sanitised before rendering
  ([ADR-0019](0019-security-first-rendering.md)) and run through the skills taxonomy like
  any other free text. The content-script privilege review ADR-0014 makes mandatory
  applies to this path in particular.

### Data model direction

A signpost for the implementing slice, not an implementation. Listings become a snapshot
type in `libs/matching` alongside `RepositorySnapshot` and `IssueSnapshot`, scored by the
same `weightedScore` engine, so opportunity matching stays deterministic and explainable
on the same terms as everything else
([ADR-0007](0007-deterministic-explainable-matching-engine.md)). Feed listings and
captured listings normalise to one type; provenance is a field on it, not a second model.

## Consequences

- The first feed slice is small: one key-free source, one snapshot type, two config
  edits. That is the point of the bar above.
- The extension gains an `activeTab` permission and needs a store-review justification
  for it — written twice, once per store
  ([ADR-0014](0014-browser-extension-reuses-shared-core.md)).
- Captured listings are device-local. The web app cannot match against them until the
  user imports, and there is no cross-device sync. That is the price of having no
  backend, and it is accepted.
- Boards with no feed are served only as well as the user's own browsing serves them.
  Rujoom will not close that gap by scraping, and the UI should say so plainly rather
  than imply coverage it does not have.
- ADR-0014's permission bullet now reads through this record; its Status line carries the
  amendment.

## Alternatives considered

- **A broad `<all_urls>` content script that recognises listing pages.** Rejected. It
  grants ambient read access to every page the user visits in order to serve an
  occasional gesture, invites store rejection, and makes the extension's blast radius the
  whole web — the opposite of ADR-0014's posture.
- **Server-side crawling into a shared listings cache.** Rejected. It breaks the terms of
  every board worth crawling, contradicts
  [ADR-0001](0001-local-first-zero-cost-architecture.md) and
  [ADR-0002](0002-no-mandatory-application-backend.md), and makes Rujoom the party
  responsible for redistributing other people's listings.
- **Authorising Remotive (or another key-free feed) here and now.** Rejected as
  premature: nobody has yet verified its CORS headers or read its terms, and an ADR that
  authorises a source on an assumption is worse than one that sets the test.
- **Headless login per user.** Rejected, and already settled by
  [ADR-0025](0025-multi-provider-identity.md) — credentials, ToS, security.

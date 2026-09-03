# 0012. LinkedIn as OAuth / identity only

- Status: Accepted (generalized by [ADR-0025](0025-multi-provider-identity.md), 2026-09-02)
- Date: 2026-08-30
- Deciders: Project owner

> **2026-09-02.** [ADR-0025](0025-multi-provider-identity.md) confirms this decision
> as technical reality — LinkedIn has *no* profile-data API left, so "identity only"
> is the only option, not just the chosen one. LinkedIn now shares the pluggable
> identity layer with GitHub and Google; its token is discarded right after the one
> `userinfo` call. Same "no scraping, CV/GitHub/manual for real history" stance.

## Context

The spec lists LinkedIn OAuth as an identity source. Its LinkedIn integration strategy:
primarily OAuth/identity, use only fields available through official APIs and granted
permissions, no unauthorised scraping, supplement from CV/GitHub/manual editing if
LinkedIn exposes too little, and the product must remain useful without LinkedIn.

## Decision

- LinkedIn is an **optional identity provider**. We request only the minimal OpenID
  Connect scopes (`openid`, `profile`, `email`) and use only what those return
  (name, headline/photo where provided, verified email).
- **No scraping**, no unofficial endpoints, no storing of connection graphs.
- Richer professional history comes from the **CV**
  ([ADR-0011](0011-local-first-cv-processing.md)), **GitHub analysis**, and **manual
  entry** — not LinkedIn.
- The entire onboarding and profile flow works with LinkedIn skipped.
- OAuth mechanics (PKCE, redirect allowlist, whether a token-exchange serverless
  function is needed) are in
  [ADR-0020](0020-oauth-token-and-byok-key-handling.md).

## Consequences

- The profile's "professional identity" is thinner than a full LinkedIn import would
  give; this is an accepted trade-off for compliance and zero-cost.
- If LinkedIn's public-client OAuth is not usable from a static SPA, LinkedIn support
  waits for the token-exchange function rather than blocking the MVP.
- Terms-of-service risk is minimised by staying within official scopes.

## Alternatives considered

- **Scrape LinkedIn profiles the user pastes.** Rejected: violates LinkedIn ToS and the
  spec's explicit prohibition.
- **Ask users to upload a LinkedIn data export.** Possible future convenience; not a
  launch feature.

# 0018. Monetization: donations + no-backend paid features from the MVP

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

The spec lists payments as "not required for the MVP" and prioritises donations >
sponsored repositories > sponsored learning > future premium features. **Project owner
direction (2026-08-30) overrides this:** donations and paid templates / paid features
**that do not require a backend** are live from the MVP. Only backend-dependent revenue
stays deferred.

## Decision

**Live from the MVP (no backend, no OSC-hosted payment code):**

- **Donations** — GitHub Sponsors, Ko-fi, and Buy Me a Coffee links surfaced in-app
  (About, footer, a non-intrusive support prompt). Pure outbound links; no integration.
- **Premium portfolio themes and premium client-side features** — sold through a
  **hosted store / checkout** (e.g. Lemon Squeezy or Gumroad). The vendor handles
  payment, tax, and license-key issuance.
- **Unlock mechanism** — the user pastes a license key; `libs/portfolio` / the relevant
  feature validates it **client-side** (offline-verifiable signed license, e.g. Ed25519
  signature over the license payload with a public key shipped in the app). No
  server call needed to unlock; no OSC endpoint.
- Premium features are strictly additive (extra themes, advanced analytics views,
  export options). The free product per the spec's "Free Features" list stays fully
  functional.

**Deferred to [ADR-0016](0016-optional-serverless-api.md) (needs a backend):**

- Sponsored-repository placement pipeline (submission, moderation, billing).
- Sponsored learning-resource placement.
- Enterprise talent/analytics/hiring offerings.
- Server-side license revocation / seat management.

## Consequences

- Some revenue from launch with zero infra and zero payment-handling liability.
- Offline license validation cannot revoke a leaked key without an app update or a later
  serverless check; acceptable for low-priced digital goods. Keys are per-purchase and
  rate-limit-free by nature.
- The signing keypair's private key is a real secret — kept out of the repo, used only
  in the vendor/issuer flow ([SECURITY.md](../../SECURITY.md),
  [ADR-0021](0021-supply-chain-and-dependency-security.md)).
- License-key entry is user input and must be validated/sanitised
  ([ADR-0019](0019-security-first-rendering.md)).

## Alternatives considered

- **Wait for a backend to do any monetization.** Rejected by project owner direction.
- **Custom Stripe integration now.** Rejected: needs a server for webhooks and secrets;
  hosted store avoids all of it ([ADR-0002](0002-no-mandatory-application-backend.md)).
- **Donation-only at MVP.** Rejected: leaves easy, backend-free product revenue on the
  table.

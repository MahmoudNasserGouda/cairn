# 0003. No mandatory database; local-first storage

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

The spec's data strategy: user-specific data stored locally by default; public
repository data fetched from GitHub and cached locally; derived data (scores) computed
locally. A serverless database is a *future* option for accounts, sync, sponsorships,
and community content.

## Decision

We will use **IndexedDB** as the primary client store and **LocalStorage** only for
small, simple, synchronous values (feature flags, last-used view). A thin storage
abstraction (`libs/shared`) will wrap both so call sites do not touch the APIs directly.

Stored client-side:

- Unified developer profile, skills, interests, experience level
- Saved repositories and issues, preferences
- Cached public repository metadata (with fetched-at timestamps)
- AI provider configuration (see [ADR-0010](0010-ai-key-privacy-and-data-disclosure.md))

No server database ships with the MVP.

## Consequences

- The storage abstraction needs a schema version and migration mechanism from the first
  release.
- Users can export/import their profile (JSON) as a manual backup and transfer path;
  this doubles as the portability story until sync exists.
- A future serverless database ([ADR-0016](0016-optional-serverless-api.md)) must treat
  the local store as the source of truth on first sync, then reconcile.
- Cache eviction policy for `IndexedDB` public-data must be defined (size cap + TTL).

## Alternatives considered

- **LocalStorage only.** Rejected: 5 MB cap, synchronous, string-only — inadequate for
  cached repo graphs.
- **Hosted database from the start (Supabase / Firebase free tier).** Rejected: pulls in
  accounts, auth, and a vendor dependency the MVP does not need; contradicts
  [ADR-0001](0001-local-first-zero-cost-architecture.md).

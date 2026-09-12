# 0010. AI key privacy and data disclosure

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

The spec's AI privacy requirements: API keys must remain on the user's device, never be
stored on Rujoom servers, never be logged, never be transmitted to Rujoom infrastructure. The
UI must explain what data is sent to the selected provider, and users should be able to
control what is included where practical.

## Decision

- **Storage:** BYOK keys are stored only in the user's browser. Default is IndexedDB in
  an isolated store; an opt-in "session only" mode keeps the key in memory and requires
  re-entry each session. Keys are never placed in LocalStorage, URLs, query strings, or
  analytics.
- **Transmission:** keys go only to the provider endpoint the user selected. There is no
  Rujoom endpoint that receives, forwards, or proxies AI traffic
  ([ADR-0009](0009-byok-ai-optional-enhancement.md)).
- **Logging:** the app's logging/telemetry redacts anything matching a key pattern;
  request/response bodies for AI calls are never sent to any telemetry sink.
- **Disclosure:** before each AI action the UI shows a **"what will be sent" panel** —
  the provider, the model, and the exact payload (system prompt + the repository/issue
  text being included). The user can expand it and, where the feature allows, deselect
  files or trim context before sending.
- **Extension:** the extension follows the same rules; keys live in
  `chrome.storage.local` (not `sync`), never in content scripts.

## Consequences

- Users bear responsibility for their provider's data handling; the disclosure panel
  makes the trust boundary explicit.
- A "clear all AI data" control must wipe the key and any cached AI responses.
- Telemetry design ([SECURITY.md](../../SECURITY.md)) must be built with these
  redaction rules from the start, not retrofitted.

## Alternatives considered

- **Encrypt the key at rest with a user passphrase.** Deferred: adds UX friction; the
  origin-isolation of browser storage plus "session only" mode is the MVP baseline. Can
  be added later without an ADR reversal.
- **Store the key server-side "securely".** Prohibited by the spec and by
  [ADR-0001](0001-local-first-zero-cost-architecture.md).

## Implementation notes

Added 2026-09-12, when the key handling and disclosure panel were built.

- **"Isolated store" is literal.** `apps/web` opens one IndexedDB database with two
  object stores: `kv` for app state and `secrets` for the BYOK key and nothing else
  (`SCHEMA_VERSION` 1 → 2, both created in one `onupgradeneeded`). That is what makes
  "clear all AI data" surgical — it empties `secrets` and deletes the settings row, and
  cannot touch the profile; equally, clearing the profile cannot leave a key behind.
- **Session-only mode writes nothing at all**, rather than writing and deleting later.
  Switching *to* it deletes the persisted copy immediately.
- **Consent is per action and is never remembered.** There is no "don't ask again",
  because the payload differs every time. The panel shows the provider, the model, the
  verbatim system and user prompts, and each document with its size; the user can drop a
  document or strip email addresses, and what they approve is exactly what is sent.
  Dismissing the panel — Cancel, Escape, or the backdrop — resolves as a decline and
  fires no request.
- **The key is bound one way.** The settings field writes into the service and is cleared
  on save; nothing reads it back into the DOM. `logger` already redacts `sk-*` / `AIza*`
  patterns, and `AiService` logs the feature, provider and model on failure — never the
  payload, never the key.
- **Deferred, unchanged:** the extension's own `chrome.storage.local` key handling, and
  caching AI responses (nothing is cached today, so "clear cached AI responses" has
  nothing to clear yet).

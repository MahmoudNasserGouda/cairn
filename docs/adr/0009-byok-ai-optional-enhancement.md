# 0009. BYOK AI as an optional enhancement

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

Phase 3 (Open Source Copilot) and later phases use AI for the Architecture Explorer,
Issue Explainer, Contribution Navigator, PR Explainer, Reading Order Generator, and
career recommendations. The spec mandates **BYOK (Bring Your Own Key)** with OpenAI,
Gemini, and OpenRouter, no Rujoom-funded inference, and a useful non-AI mode.

## Decision

`libs/ai` defines a provider abstraction:

```
IAIProvider
  ├── OpenAIProvider
  ├── GeminiProvider
  └── OpenRouterProvider
```

- The user supplies their own API key; requests go **directly from the browser to the
  chosen provider** (or via the provider's own proxy, never Rujoom's).
- `IAIProvider` exposes a small capability surface (chat/completion with system+user
  messages, token budget hints, streaming) so features are provider-agnostic.
- Every AI-powered feature has a **defined non-AI fallback** (deterministic summaries,
  file heuristics, static templates). The app is fully usable with no key configured.
- AI features are visibly labelled as AI-generated and may be wrong.

Key handling and data disclosure are covered by
[ADR-0010](0010-ai-key-privacy-and-data-disclosure.md).

## Consequences

- $0 AI cost to Rujoom; the user controls spend and model choice.
- Feature quality varies by the user's provider/model; UI should set expectations.
- CORS: not all providers allow direct browser calls with all key types; where a
  provider blocks browser origins, document it and prefer OpenRouter or the provider's
  browser-allowed path — do **not** add an Rujoom proxy.
- Prompt-injection risk from repository content fed into prompts — see
  [ADR-0019](0019-security-first-rendering.md) and `SECURITY.md`.

## Alternatives considered

- **Rujoom-hosted inference with a free tier.** Rejected: unbounded cost, the central risk
  the architecture is designed to avoid.
- **Single provider (OpenAI only).** Rejected: lock-in, and OpenRouter/Gemini give users
  cheaper or free options.
- **Local-model-only (Ollama).** Deferred to the desktop client
  ([ADR-0015](0015-desktop-local-agent.md)); not viable for a pure web MVP.

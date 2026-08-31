/**
 * BYOK AI provider abstraction (ADR-0009). Requests go directly from the browser to
 * the user's chosen provider — never through OSC infrastructure. Keys are supplied
 * per-call by apps/web from device-only storage (ADR-0010) and must never be logged.
 */
export type ProviderId = 'openai' | 'gemini' | 'openrouter';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly model: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export interface ChatResponse {
  readonly text: string;
  readonly model: string;
  readonly provider: ProviderId;
}

export interface IAIProvider {
  readonly id: ProviderId;
  readonly defaultModel: string;
  /** Origin the app must allowlist in CSP connect-src for this provider. */
  readonly apiOrigin: string;
  chat(req: ChatRequest, apiKey: string): Promise<ChatResponse>;
}

export interface ProviderConfig {
  readonly fetchImpl?: typeof fetch;
}

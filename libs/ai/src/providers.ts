import type {
  ChatRequest,
  ChatResponse,
  IAIProvider,
  ProviderConfig,
  ProviderId,
} from './provider';

function resolveFetch(cfg?: ProviderConfig): typeof fetch {
  return cfg?.fetchImpl ?? globalThis.fetch.bind(globalThis);
}

export class OpenAIProvider implements IAIProvider {
  readonly id: ProviderId = 'openai';
  readonly defaultModel = 'gpt-4o-mini';
  readonly apiOrigin = 'https://api.openai.com';
  constructor(private readonly cfg?: ProviderConfig) {}

  async chat(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const res = await resolveFetch(this.cfg)(`${this.apiOrigin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxOutputTokens ?? 1024,
        temperature: req.temperature ?? 0.2,
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return {
      text: json.choices[0]?.message.content ?? '',
      model: req.model,
      provider: this.id,
    };
  }
}

export class OpenRouterProvider implements IAIProvider {
  readonly id: ProviderId = 'openrouter';
  readonly defaultModel = 'openrouter/auto';
  readonly apiOrigin = 'https://openrouter.ai';
  constructor(private readonly cfg?: ProviderConfig) {}

  async chat(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const res = await resolveFetch(this.cfg)(
      `${this.apiOrigin}/api/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          max_tokens: req.maxOutputTokens ?? 1024,
          temperature: req.temperature ?? 0.2,
        }),
        ...(req.signal ? { signal: req.signal } : {}),
      },
    );
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return {
      text: json.choices[0]?.message.content ?? '',
      model: req.model,
      provider: this.id,
    };
  }
}

export class GeminiProvider implements IAIProvider {
  readonly id: ProviderId = 'gemini';
  readonly defaultModel = 'gemini-1.5-flash';
  readonly apiOrigin = 'https://generativelanguage.googleapis.com';
  constructor(private readonly cfg?: ProviderConfig) {}

  async chat(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const system = req.messages.find((m) => m.role === 'system')?.content;
    const url = `${this.apiOrigin}/v1beta/models/${req.model}:generateContent`;
    const res = await resolveFetch(this.cfg)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          maxOutputTokens: req.maxOutputTokens ?? 1024,
          temperature: req.temperature ?? 0.2,
        },
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = (await res.json()) as {
      candidates?: { content: { parts: { text: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content.parts.map((p) => p.text).join('') ?? '';
    return { text, model: req.model, provider: this.id };
  }
}

export function createProvider(id: ProviderId, cfg?: ProviderConfig): IAIProvider {
  switch (id) {
    case 'openai':
      return new OpenAIProvider(cfg);
    case 'gemini':
      return new GeminiProvider(cfg);
    case 'openrouter':
      return new OpenRouterProvider(cfg);
  }
}

export const PROVIDER_ORIGINS: Readonly<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai',
};

import { Injectable, inject, signal } from '@angular/core';
import { buildMessages, createProvider, type BuildPromptInput } from '@cairn/ai';
import { logger } from '@cairn/shared';
import { AiDisclosureService } from './ai-disclosure.service';
import { AiSettingsService } from './ai-settings.service';

export type AiOutcome =
  | { readonly status: 'ok'; readonly text: string }
  /** The user closed the disclosure panel. Not an error, and nothing was sent. */
  | { readonly status: 'declined' }
  | { readonly status: 'error'; readonly message: string };

/** Provider errors arrive as `Error("OpenAI 401")` from `libs/ai`. */
function describe(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  const raw = error instanceof Error ? error.message : String(error);
  const status = Number(/\b(\d{3})\b/.exec(raw)?.[1]);
  if (status === 401 || status === 403) {
    return 'your provider rejected that API key — check it on the settings page';
  }
  if (status === 429) return 'your provider is rate-limiting you — try again shortly';
  if (status >= 500 && status < 600) return 'your provider is having trouble right now';
  if (/failed to fetch|networkerror/i.test(raw)) {
    // The browser blocks a cross-origin reply with no CORS headers before any status
    // is visible, so a dead connection and a provider that refuses web pages look
    // identical here. Name both rather than guessing (ADR-0009).
    return (
      'could not reach your provider — it may refuse requests from a web page ' +
      '(OpenAI does), or your connection is down'
    );
  }
  return 'the request to your provider failed';
}

/**
 * The single path from a feature to a BYOK provider (ADR-0009).
 *
 * Every call is gated by the disclosure panel (ADR-0010) and every call is
 * user-initiated: nothing here runs on a timer, on load, or in the background. The key
 * is read once per request and handed to `libs/ai`, which puts it in a header — it is
 * never logged, and neither request nor response bodies are, because both can contain
 * the user's CV.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly settings = inject(AiSettingsService);
  private readonly disclosure = inject(AiDisclosureService);

  private readonly _running = signal(false);
  readonly running = this._running.asReadonly();

  private controller: AbortController | null = null;

  /** Abort an in-flight request. Safe to call when nothing is running. */
  cancel(): void {
    this.controller?.abort();
  }

  async run(feature: string, input: BuildPromptInput): Promise<AiOutcome> {
    const key = this.settings.peekKey();
    if (key === null) {
      return { status: 'error', message: 'add an API key on the settings page first' };
    }

    const providerId = this.settings.provider();
    const model = this.settings.model();
    const approved = await this.disclosure.ask({
      feature,
      provider: providerId,
      model,
      input,
    });
    if (approved === null) return { status: 'declined' };

    const controller = new AbortController();
    this.controller = controller;
    this._running.set(true);
    try {
      const response = await createProvider(providerId).chat(
        { messages: buildMessages(approved), model, signal: controller.signal },
        key,
      );
      const text = response.text.trim();
      return text.length > 0
        ? { status: 'ok', text }
        : { status: 'error', message: 'your provider returned an empty response' };
    } catch (error) {
      const message = describe(error);
      if (message === 'cancelled') return { status: 'declined' };
      // Context only — never the payload, never the key.
      logger.warn('AI request failed', { feature, provider: providerId, model });
      return { status: 'error', message };
    } finally {
      this._running.set(false);
      this.controller = null;
    }
  }
}

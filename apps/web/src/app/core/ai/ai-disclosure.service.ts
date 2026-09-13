import { Injectable, computed, signal } from '@angular/core';
import { disclose, type BuildPromptInput, type ProviderId } from '@cairn/ai';

export interface DisclosureRequest {
  /** Human name of the action, e.g. "Refine CV". Shown in the dialog title. */
  readonly feature: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly input: BuildPromptInput;
}

/** Matches an address anywhere in a block of text, not just a whole field. */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function hasEmail(content: string): boolean {
  // A /g regex carries lastIndex between calls; build a fresh test each time.
  return new RegExp(EMAIL_RE.source, 'i').test(content);
}

function stripEmails(content: string): string {
  return content.replace(new RegExp(EMAIL_RE.source, 'gi'), '[email removed]');
}

/**
 * The "what will be sent" gate (ADR-0010). Every AI call goes through here, and the
 * user consents to that exact payload each time — there is deliberately no "don't ask
 * again", because the payload is different every time.
 *
 * The state lives in the service rather than the component so the rules that decide
 * what actually leaves the device — which documents are included, whether an address
 * is stripped — are testable without rendering a dialog.
 */
@Injectable({ providedIn: 'root' })
export class AiDisclosureService {
  private readonly _request = signal<DisclosureRequest | null>(null);
  private readonly _excluded = signal<ReadonlySet<number>>(new Set<number>());
  private readonly _redactEmail = signal(true);
  private resolve: ((value: BuildPromptInput | null) => void) | null = null;

  readonly request = this._request.asReadonly();
  readonly redactEmail = this._redactEmail.asReadonly();
  readonly open = computed(() => this._request() !== null);

  /** What would be sent if the user pressed Send right now. */
  readonly effectiveInput = computed<BuildPromptInput | null>(() => {
    const req = this._request();
    if (!req) return null;
    const excluded = this._excluded();
    const redact = this._redactEmail();
    return {
      ...req.input,
      docs: req.input.docs
        .filter((_, i) => !excluded.has(i))
        .map((doc) => (redact ? { ...doc, content: stripEmails(doc.content) } : doc)),
    };
  });

  /** The payload panel the user reads before deciding. */
  readonly payload = computed(() => {
    const req = this._request();
    const input = this.effectiveInput();
    return req && input ? disclose(req.provider, req.model, input) : null;
  });

  readonly containsEmail = computed(() =>
    (this._request()?.input.docs ?? []).some((d) => hasEmail(d.content)),
  );

  isIncluded(index: number): boolean {
    return !this._excluded().has(index);
  }

  toggleDoc(index: number): void {
    this._excluded.update((set) => {
      const next = new Set(set);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  setRedactEmail(value: boolean): void {
    this._redactEmail.set(value);
  }

  /**
   * Show the panel and wait. Resolves with the payload to send, or `null` if the user
   * declined — a decline must leave no trace of a request having been made.
   */
  ask(request: DisclosureRequest): Promise<BuildPromptInput | null> {
    this.settle(null);
    this._excluded.set(new Set<number>());
    this._redactEmail.set(true);
    this._request.set(request);
    return new Promise<BuildPromptInput | null>((resolve) => {
      this.resolve = resolve;
    });
  }

  confirm(): void {
    const input = this.effectiveInput();
    // Nothing left to send is a decline, not an empty request.
    this.settle(input && input.docs.length > 0 ? input : null);
    this._request.set(null);
  }

  cancel(): void {
    this.settle(null);
    this._request.set(null);
  }

  private settle(value: BuildPromptInput | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(value);
  }
}

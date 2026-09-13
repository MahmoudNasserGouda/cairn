import { Component, inject, signal } from '@angular/core';
import type { ProviderId } from '@cairn/ai';
import {
  AI_PROVIDERS,
  AiSettingsService,
  type KeyStorageMode,
} from '../core/ai/ai-settings.service';

function value(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

/**
 * BYOK AI settings (ADR-0009, ADR-0010).
 *
 * The key is bound one way only: it is written from this form into the service and
 * never read back into the DOM, so it cannot be recovered from the page once saved.
 * Everything else on the page is a preference.
 */
@Component({
  selector: 'cn-settings',
  standalone: true,
  template: `
    <h1>Settings</h1>

    <section class="panel">
      <h2>AI features <span class="opt">optional</span></h2>
      <p class="muted small">
        Rujoom never pays for AI and never proxies it. If you add your own API key,
        requests go from this browser straight to the provider you pick; if you don't,
        every feature still works — you get the deterministic version instead of the
        written one.
      </p>

      <div class="fields">
        <label>
          Provider
          <select [value]="settings.provider()" (change)="onProvider($event)">
            @for (p of providers; track p.id) {
              <option [value]="p.id">{{ p.label }}</option>
            }
          </select>
        </label>
        <label>
          Model
          <input
            type="text"
            [value]="settings.model()"
            (change)="onModel($event)"
            autocomplete="off"
          />
        </label>
      </div>

      <p class="muted small">
        Get a key from <code>{{ keysUrl() }}</code> — Rujoom does not open that page for
        you, and never sees the key you create there.
      </p>

      @if (!browserCallable()) {
        <p class="warn">
          Heads up: this provider's API refuses requests made from a web page, so a key
          for it will not work here. Rujoom will not route your request through a server
          of ours to get around that. Pick OpenRouter or Gemini instead.
        </p>
      }

      <label class="key">
        API key
        <input
          type="password"
          name="cn-ai-key"
          placeholder="{{
            settings.hasKey() ? 'A key is saved — type to replace it' : 'Paste your key'
          }}"
          autocomplete="off"
          spellcheck="false"
          [value]="draftKey()"
          (input)="draftKey.set(asValue($event))"
        />
      </label>

      <div class="actions">
        <button type="button" [disabled]="draftKey().length === 0" (click)="saveKey()">
          Save key
        </button>
        @if (settings.hasKey()) {
          <span class="saved" role="status">
            <span class="dot"></span> Key saved ({{ storageLabel() }})
          </span>
        }
      </div>

      <label class="choice">
        <input
          type="checkbox"
          [checked]="settings.storage() === 'session'"
          (change)="onStorageMode($event)"
        />
        <span>
          Forget the key when I close this tab
          <span class="muted small">
            — keeps it in memory only. Off by default: the key is kept in this browser's
            own database, in a store that holds nothing else.
          </span>
        </span>
      </label>

      <hr />

      <button type="button" class="danger" (click)="clearAll()">Clear all AI data</button>
      <p class="muted small">
        Deletes the key and these preferences from this device. Your profile, CV and
        scoring target are untouched.
      </p>
      @if (cleared()) {
        <p class="muted small" role="status">Cleared.</p>
      }
    </section>

    <section class="panel">
      <h2>What gets sent</h2>
      <p class="muted small">
        Before every AI action Rujoom shows you the exact payload — provider, model, and
        the full prompt — and sends nothing until you approve it. You can drop documents
        from the payload or strip email addresses out of it there. Answers from a model
        are labelled as AI-generated: they can be wrong, and they are never applied to
        your profile without you accepting them field by field.
      </p>
    </section>
  `,
  styles: [
    `
      .muted {
        color: var(--muted);
      }
      .small {
        font-size: 0.85rem;
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem 1.15rem;
        background: var(--panel);
        margin-bottom: 1.25rem;
      }
      h2 {
        margin: 0 0 0.35rem;
        font-size: 1.05rem;
      }
      .opt {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.05rem 0.45rem;
        vertical-align: middle;
      }
      .fields {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin: 0.9rem 0;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.85rem;
        color: var(--muted);
        flex: 1 1 12rem;
      }
      label.key {
        flex: 1 1 100%;
      }
      input[type='text'],
      input[type='password'],
      select {
        padding: 0.4rem 0.6rem;
        background: var(--bg);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 8px;
        font: inherit;
        min-width: 0;
      }
      .choice {
        flex-direction: row;
        align-items: flex-start;
        gap: 0.5rem;
        margin-top: 0.9rem;
        color: var(--fg);
        font-size: 0.9rem;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.75rem;
      }
      .saved {
        color: var(--muted);
        font-size: 0.85rem;
      }
      .dot {
        display: inline-block;
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: #34d399;
        margin-right: 0.3rem;
      }
      button {
        padding: 0.45rem 0.9rem;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--accent);
        color: #06131f;
        font-weight: 600;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      button.danger {
        background: none;
        color: #f87171;
        border-color: #f87171;
      }
      hr {
        border: 0;
        border-top: 1px solid var(--border);
        margin: 1.25rem 0 1rem;
      }
      code {
        font-size: 0.8rem;
      }
      .warn {
        color: #fbbf24;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class SettingsComponent {
  protected readonly settings = inject(AiSettingsService);
  protected readonly providers = AI_PROVIDERS;

  protected readonly draftKey = signal('');
  protected readonly cleared = signal(false);

  protected asValue(event: Event): string {
    return value(event);
  }

  protected keysUrl(): string {
    return this.current()?.keysUrl ?? '';
  }

  /** False for a provider whose API the browser cannot call at all (ADR-0009). */
  protected browserCallable(): boolean {
    return this.current()?.browserCallable ?? true;
  }

  private current(): (typeof AI_PROVIDERS)[number] | undefined {
    const id = this.settings.provider();
    return AI_PROVIDERS.find((p) => p.id === id);
  }

  protected storageLabel(): string {
    return this.settings.storage() === 'session' ? 'this tab only' : 'in this browser';
  }

  protected onProvider(event: Event): void {
    void this.settings.setProvider(value(event) as ProviderId);
  }

  protected onModel(event: Event): void {
    void this.settings.setModel(value(event));
  }

  protected onStorageMode(event: Event): void {
    const mode: KeyStorageMode = (event.target as HTMLInputElement).checked
      ? 'session'
      : 'persistent';
    void this.settings.setStorageMode(mode);
  }

  protected saveKey(): void {
    void this.settings.setKey(this.draftKey());
    // Clearing the field is the point: the key must not sit in the DOM afterwards.
    this.draftKey.set('');
    this.cleared.set(false);
  }

  protected clearAll(): void {
    void this.settings.clearAll();
    this.draftKey.set('');
    this.cleared.set(true);
  }
}

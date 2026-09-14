import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { ProviderId } from '@cairn/ai';
import {
  AI_PROVIDERS,
  AiSettingsService,
  type KeyStorageMode,
} from '../../core/ai/ai-settings.service';
import { AI_ENABLED } from '../../core/features';
import {
  ButtonComponent,
  CardComponent,
  FieldComponent,
  FieldControlDirective,
  SectionComponent,
  TagComponent,
} from '../../ui';

function value(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

/**
 * BYOK AI settings (ADR-0009, ADR-0010, ADR-0033).
 *
 * The key is bound **one way only**: written from this form into the service and never
 * read back into the DOM, so it cannot be recovered from the page once saved. That is
 * why the input shows a placeholder about a saved key rather than the key itself.
 */
@Component({
  selector: 'cn-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    FieldComponent,
    FieldControlDirective,
    SectionComponent,
    TagComponent,
  ],
  template: `
    <h1>Settings</h1>

    <cn-section
      heading="AI features"
      description="Rujoom never pays for AI and never proxies it."
      class="first"
    >
      <cn-tag slot="actions" [tone]="aiEnabled ? 'neutral' : 'warn'">
        {{ aiEnabled ? 'optional' : 'turned off' }}
      </cn-tag>

      <cn-card>
        @if (aiEnabled) {
          <p class="muted">
            If you add your own API key, requests go from this browser straight to the
            provider you pick. If you don't, every feature still works — you get the
            deterministic version instead of the written one.
          </p>

          <div class="fields">
            <cn-field label="Provider">
              <select
                cn-control
                [value]="settings.provider()"
                (change)="onProvider($event)"
              >
                @for (p of providers; track p.id) {
                  <option [value]="p.id">{{ p.label }}</option>
                }
              </select>
            </cn-field>
            <cn-field label="Model">
              <input
                cn-control
                type="text"
                [value]="settings.model()"
                (change)="onModel($event)"
                autocomplete="off"
              />
            </cn-field>
          </div>

          <p class="muted">
            Get a key from <code>{{ keysUrl() }}</code> — Rujoom does not open that page
            for you, and never sees the key you create there.
          </p>

          @if (!browserCallable()) {
            <p class="warn" role="alert">
              This provider's API refuses requests made from a web page, so a key for it
              will not work here. Rujoom will not route your request through a server of
              ours to get around that. Pick OpenRouter or Gemini instead.
            </p>
          }

          <cn-field
            label="API key"
            hint="Written straight into storage and never read back into this page."
          >
            <input
              cn-control
              type="password"
              name="cn-ai-key"
              [placeholder]="
                settings.hasKey()
                  ? 'A key is saved — type to replace it'
                  : 'Paste your key'
              "
              autocomplete="off"
              spellcheck="false"
              [value]="draftKey()"
              (input)="draftKey.set(asValue($event))"
            />
          </cn-field>

          <div class="actions">
            <button cn-button [disabled]="draftKey().length === 0" (click)="saveKey()">
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
              <span class="muted">
                — keeps it in memory only. Off by default: the key is kept in this
                browser's own database, in a store that holds nothing else.
              </span>
            </span>
          </label>

          <hr />

          <button cn-button variant="danger" size="sm" (click)="clearAll()">
            Clear all AI data
          </button>
          <p class="muted">
            Deletes the key and these preferences from this device. Your profile, CV and
            scoring target are untouched.
          </p>
          @if (cleared()) {
            <p class="muted" role="status">Cleared.</p>
          }
        } @else {
          <p class="muted">
            AI is turned off in this build (<a
              href="https://github.com/MahmoudNasserGouda/cairn/blob/main/docs/adr/0033-ai-capability-frozen.md"
              rel="noopener noreferrer"
              >ADR-0033</a
            >). It was built, it works, and it is paused while the parts of Rujoom that
            need no model — your profile, the scores, repository discovery — are made
            properly good. Nothing is missing in the meantime: every feature that would
            have had an AI version ships its deterministic version, which is the one that
            was always meant to be the default.
          </p>

          @if (settings.hasKey()) {
            <hr />
            <p class="muted">
              A key you saved before the freeze is still on this device. Nothing can use
              it while AI is off, and you can remove it now.
            </p>
            <button cn-button variant="danger" size="sm" (click)="clearAll()">
              Clear all AI data
            </button>
            @if (cleared()) {
              <p class="muted" role="status">Cleared.</p>
            }
          }
        }
      </cn-card>
    </cn-section>

    @if (aiEnabled) {
      <cn-section heading="What gets sent" class="stacked">
        <cn-card>
          <p class="muted">
            Before every AI action Rujoom shows you the exact payload — provider, model,
            and the full prompt — and sends nothing until you approve it. You can drop
            documents from the payload or strip email addresses out of it there. Answers
            from a model are labelled as AI-generated: they can be wrong, and they are
            never applied to your profile without you accepting them field by field.
          </p>
        </cn-card>
      </cn-section>
    }
  `,
  styles: [
    `
      h1 {
        margin-bottom: var(--space-5);
      }
      .first {
        margin-top: var(--space-5);
      }
      .stacked {
        margin-top: var(--space-8);
      }
      .muted {
        color: var(--fg-muted);
        font-size: var(--text-sm);
        max-width: var(--measure-prose);
      }
      .warn {
        color: var(--warn);
        font-size: var(--text-sm);
        max-width: var(--measure-prose);
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: var(--space-3);
        margin: var(--space-4) 0;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin: var(--space-4) 0;
        flex-wrap: wrap;
      }
      .saved {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: var(--radius-full);
        background: var(--good);
      }
      .choice {
        display: flex;
        gap: var(--space-3);
        align-items: flex-start;
        font-size: var(--text-sm);
        margin-bottom: var(--space-4);
      }
      .choice input {
        width: auto;
        margin-top: 3px;
      }
      hr {
        border: 0;
        border-top: 1px solid var(--border);
        margin: var(--space-5) 0;
      }
      code {
        font-family: var(--font-mono);
        font-size: 0.95em;
      }
    `,
  ],
})
export class SettingsPageComponent {
  protected readonly settings = inject(AiSettingsService);
  /** Frozen off by default (ADR-0033); only the clear-my-key path stays reachable. */
  protected readonly aiEnabled = inject(AI_ENABLED);
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

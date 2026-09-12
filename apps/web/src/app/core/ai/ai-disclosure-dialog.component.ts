import { Component, type ElementRef, effect, inject, viewChild } from '@angular/core';
import { AiDisclosureService } from './ai-disclosure.service';

/**
 * "What will be sent" — the panel ADR-0010 requires before every AI action.
 *
 * It shows the real payload, not a summary of it: the provider, the model, the system
 * prompt verbatim, and each included document. The prompts are rendered as
 * interpolated text inside `<pre>`; they contain untrusted CV and repository content
 * (SECURITY.md T7 / T10), so nothing here goes near `innerHTML`.
 *
 * Modelled on `core/auth/sign-in-dialog` — one host instance in `app.component`, state
 * in a service, focus moved in on open and restored on close.
 */
@Component({
  selector: 'cn-ai-disclosure-dialog',
  standalone: true,
  template: `
    @if (svc.request(); as req) {
      @if (svc.payload(); as payload) {
        <div class="backdrop" (click)="onBackdrop($event)">
          <div
            #panel
            class="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cn-ai-disclosure-title"
            tabindex="-1"
            (keydown)="onKeydown($event)"
          >
            <h2 id="cn-ai-disclosure-title">Before this is sent</h2>
            <p class="muted">
              {{ req.feature }} will send the text below from this browser straight to
              <strong>{{ payload.provider }}</strong> ({{ payload.model }}). Rujoom has no
              server in the path and keeps no copy. Your provider's own terms apply to
              anything you send them.
            </p>

            <h3>Included ({{ payload.approxChars }} characters)</h3>
            @for (doc of req.input.docs; track doc.label; let i = $index) {
              <label class="doc">
                <input
                  type="checkbox"
                  [checked]="svc.isIncluded(i)"
                  (change)="svc.toggleDoc(i)"
                />
                <span>{{ doc.label }}</span>
                <span class="muted small">{{ doc.content.length }} chars</span>
              </label>
            }

            @if (svc.containsEmail()) {
              <label class="doc">
                <input
                  type="checkbox"
                  [checked]="svc.redactEmail()"
                  (change)="onRedactToggle($event)"
                />
                <span>Remove email addresses from what is sent</span>
              </label>
            }

            <details>
              <summary>Show the exact prompt</summary>
              <h4>System</h4>
              <pre>{{ payload.systemPrompt }}</pre>
              <h4>User</h4>
              <pre>{{ payload.userPrompt }}</pre>
            </details>

            @if (nothingLeft()) {
              <p class="warn">Nothing is left to send — include something, or cancel.</p>
            }

            <div class="actions">
              <button type="button" [disabled]="nothingLeft()" (click)="svc.confirm()">
                Send to {{ payload.provider }}
              </button>
              <button type="button" class="ghost" (click)="svc.cancel()">Cancel</button>
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        z-index: 100;
      }
      .panel {
        width: 100%;
        max-width: 36rem;
        max-height: calc(100vh - 2rem);
        overflow-y: auto;
        background: var(--panel);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 1.5rem;
      }
      h2 {
        margin: 0 0 0.5rem;
        font-size: 1.15rem;
      }
      h3 {
        margin: 1.1rem 0 0.4rem;
        font-size: 0.95rem;
      }
      h4 {
        margin: 0.8rem 0 0.25rem;
        font-size: 0.8rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .muted {
        color: var(--muted);
      }
      .small {
        font-size: 0.8rem;
      }
      .warn {
        color: #fbbf24;
        font-size: 0.85rem;
      }
      .doc {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.3rem 0;
        font-size: 0.9rem;
      }
      .doc .muted {
        margin-left: auto;
      }
      details {
        margin-top: 0.9rem;
      }
      summary {
        cursor: pointer;
        color: var(--muted);
        font-size: 0.9rem;
      }
      pre {
        max-height: 14rem;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.6rem 0.75rem;
        font-size: 0.8rem;
        margin: 0;
      }
      .actions {
        display: flex;
        gap: 0.6rem;
        margin-top: 1.2rem;
      }
      button {
        padding: 0.5rem 1rem;
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
      button.ghost {
        background: none;
        color: var(--fg);
        font-weight: 500;
      }
    `,
  ],
})
export class AiDisclosureDialogComponent {
  protected readonly svc = inject(AiDisclosureService);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.svc.open()) {
        this.returnFocusTo =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => this.panel()?.nativeElement.focus());
      } else if (this.returnFocusTo !== null) {
        this.returnFocusTo.focus();
        this.returnFocusTo = null;
      }
    });
  }

  protected nothingLeft(): boolean {
    return (this.svc.effectiveInput()?.docs.length ?? 0) === 0;
  }

  protected onRedactToggle(event: Event): void {
    this.svc.setRedactEmail((event.target as HTMLInputElement).checked);
  }

  /** Dismissing the panel is a decline, so it must go through `cancel()`. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.svc.cancel();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.svc.cancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = this.panel()?.nativeElement;
    if (panel === undefined) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, summary, [tabindex]:not([tabindex="-1"])',
    );
    const firstEl = focusable.item(0);
    const lastEl = focusable.item(focusable.length - 1);
    if (firstEl === null || lastEl === null) return;

    const active = document.activeElement;
    if (event.shiftKey && active === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && active === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  }
}

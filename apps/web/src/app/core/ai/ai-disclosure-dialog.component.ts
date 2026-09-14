import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AiDisclosureService } from './ai-disclosure.service';
import { ButtonComponent, SheetComponent } from '../../ui';

/**
 * "What will be sent" — the panel ADR-0010 requires before every AI action.
 *
 * It shows the real payload, not a summary of it: the provider, the model, the system
 * prompt verbatim, and each included document. The prompts are rendered as
 * interpolated text inside `<pre>`; they contain untrusted CV and repository content
 * (SECURITY.md T7 / T10), so nothing here goes near `innerHTML`.
 *
 * The backdrop, focus trap, Escape handling and focus restore are `cn-sheet`'s now
 * (ADR-0032). **Dismissing is a decline** — Escape, the backdrop and the close button
 * all have to reach `cancel()`, or a user who waved the dialog away would leave the
 * request hanging rather than refused. That mapping is the one thing this component
 * cannot delegate, so it is explicit below.
 */
@Component({
  selector: 'cn-ai-disclosure-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, SheetComponent],
  template: `
    @if (svc.request(); as req) {
      @if (svc.payload(); as payload) {
        <cn-sheet [(open)]="open" heading="Before this is sent">
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
              <span class="size">{{ doc.content.length }} chars</span>
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
            <p class="warn" role="alert">
              Nothing is left to send — include something, or cancel.
            </p>
          }

          <div slot="footer">
            <button cn-button variant="quiet" (click)="svc.cancel()">Cancel</button>
            <button cn-button [disabled]="nothingLeft()" (click)="svc.confirm()">
              Send to {{ payload.provider }}
            </button>
          </div>
        </cn-sheet>
      }
    }
  `,
  styles: [
    `
      .muted {
        color: var(--fg-muted);
        font-size: var(--text-sm);
        margin: 0 0 var(--space-4);
      }
      h3 {
        margin: 0 0 var(--space-2);
        font-size: var(--text-sm);
      }
      h4 {
        margin: var(--space-3) 0 var(--space-1);
        font-size: var(--text-xs);
        color: var(--fg-muted);
      }
      .doc {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin-bottom: var(--space-2);
        font-size: var(--text-sm);
      }
      .doc input {
        width: auto;
      }
      .size {
        color: var(--fg-subtle);
        font-size: var(--text-xs);
      }
      details {
        margin: var(--space-4) 0;
        font-size: var(--text-sm);
      }
      summary {
        cursor: pointer;
        color: var(--accent);
      }
      pre {
        margin: 0;
        padding: var(--space-3);
        background: var(--surface-sunken);
        border-radius: var(--radius-md);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 14rem;
        overflow-y: auto;
      }
      .warn {
        color: var(--warn);
        font-size: var(--text-sm);
      }
    `,
  ],
})
export class AiDisclosureDialogComponent {
  protected readonly svc = inject(AiDisclosureService);

  protected readonly open = signal(false);

  constructor() {
    effect(() => this.open.set(this.svc.open()));
    effect(() => {
      // The sheet closed itself — Escape, the backdrop, or its close button. Every
      // one of those is the user declining, and ADR-0010 means declining sends
      // nothing. Leaving it merely "closed" would strand the pending request.
      if (!this.open() && this.svc.open()) this.svc.cancel();
    });
  }

  protected nothingLeft(): boolean {
    return (this.svc.effectiveInput()?.docs.length ?? 0) === 0;
  }

  protected onRedactToggle(event: Event): void {
    this.svc.setRedactEmail((event.target as HTMLInputElement).checked);
  }
}

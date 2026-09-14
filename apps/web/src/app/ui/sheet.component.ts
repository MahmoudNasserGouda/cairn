import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';

let nextSheetId = 0;

/** Everything that can hold focus. `[tabindex="-1"]` is programmatic only, so excluded. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * A modal or drawer that behaves (ADR-0032).
 *
 * Focus moves in on open and back to whatever opened it on close; Escape and a
 * backdrop click both dismiss; Tab and Shift+Tab cycle inside rather than escaping to
 * the page behind. The sign-in dialog already implemented all of that, correctly, once
 * — this is that behaviour extracted so the next dialog does not get a second, worse
 * copy of it.
 *
 * `side` is presentation only: `center` is a dialog, `right` is a drawer, `bottom` is
 * the shape a phone expects. All three are the same component with the same semantics,
 * because a drawer that forgets to restore focus is broken in exactly the way a dialog
 * is.
 *
 * Two-way bound, so a caller writes `[(open)]="showing"` and the sheet can close
 * itself from Escape or the backdrop without an output the caller has to remember to
 * handle.
 *
 * **Guard your content with `@if (open())`.** Projected nodes are created in the
 * *caller's* view, not this one, so every binding inside them evaluates on each change
 * detection whether or not the sheet is showing. That is how Angular content
 * projection works and this component cannot change it — a closed sheet whose content
 * reads a service will still read it, and in one case still threw.
 */
@Component({
  selector: 'cn-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="backdrop" (click)="onBackdrop($event)" (keydown)="onKeydown($event)">
        <div
          #panel
          class="panel"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          tabindex="-1"
        >
          <header>
            <h2 [id]="titleId">{{ heading() }}</h2>
            <button
              #closeBtn
              type="button"
              class="close"
              [attr.aria-label]="'Close ' + heading()"
              (click)="close()"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M2 2 L14 14 M14 2 L2 14"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </header>

          <div class="body"><ng-content /></div>

          <footer><ng-content select="[slot='footer']" /></footer>
        </div>
      </div>
    }
  `,
  host: { '[class]': "'side-' + side()" },
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        background: rgb(0 0 0 / 45%);
        padding: var(--space-4);
      }
      :host(.side-center) .backdrop {
        align-items: center;
        justify-content: center;
      }
      :host(.side-right) .backdrop {
        justify-content: flex-end;
        padding: 0;
      }
      :host(.side-bottom) .backdrop {
        align-items: flex-end;
        padding: 0;
      }

      .panel {
        display: flex;
        flex-direction: column;
        background: var(--surface-raised);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        max-height: 100%;
        width: min(34rem, 100%);
      }
      :host(.side-right) .panel {
        height: 100%;
        border-radius: var(--radius-lg) 0 0 var(--radius-lg);
        width: min(26rem, 100%);
      }
      :host(.side-bottom) .panel {
        width: 100%;
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        max-height: 85vh;
      }

      @media (prefers-reduced-motion: no-preference) {
        .panel {
          animation: cn-sheet-in var(--dur-base) var(--ease);
        }
      }
      @keyframes cn-sheet-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
        padding: var(--space-4) var(--space-5);
        border-bottom: 1px solid var(--border);
      }
      h2 {
        font-size: var(--text-lg);
        margin: 0;
      }
      .close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border: 0;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--fg-muted);
        cursor: pointer;
      }
      .close:hover {
        background: var(--surface-sunken);
        color: var(--fg);
      }

      .body {
        padding: var(--space-5);
        overflow: auto;
      }
      footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        padding: var(--space-4) var(--space-5);
        border-top: 1px solid var(--border);
      }
      footer:empty {
        display: none;
      }
    `,
  ],
})
export class SheetComponent {
  readonly open = model(false);
  readonly heading = input.required<string>();
  readonly side = input<'center' | 'right' | 'bottom'>('center');

  protected readonly titleId = `cn-sheet-${nextSheetId++}`;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.returnFocusTo =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // After the `@if` has rendered the panel.
        queueMicrotask(() => this.closeBtn()?.nativeElement.focus());
      } else if (this.returnFocusTo !== null) {
        this.returnFocusTo.focus();
        this.returnFocusTo = null;
      }
    });
  }

  protected close(): void {
    this.open.set(false);
  }

  protected onBackdrop(event: MouseEvent): void {
    // Only the backdrop itself — a click that started inside the panel and ended on
    // the backdrop (a drag across a text selection) must not dismiss.
    if (event.target === event.currentTarget) this.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = this.panel()?.nativeElement;
    if (panel === undefined) return;
    const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable.item(0);
    const last = focusable.item(focusable.length - 1);
    if (first === null || last === null) return;

    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The one panel (ADR-0032).
 *
 * It replaces six divergent `.panel` definitions — `app.component`, `profile`,
 * `dashboard`, `discover`, `settings` and `repositories` each carried their own, and
 * they had already drifted apart on padding and radius. A page that needs a different
 * card changes this file, where everyone can see the change.
 */
@Component({
  selector: 'cn-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    '[class.pad-sm]': "padding() === 'sm'",
    '[class.pad-none]': "padding() === 'none'",
    '[class.is-raised]': 'raised()',
    '[class.is-quiet]': 'quiet()',
    '[class.is-interactive]': 'interactive()',
  },
  styles: [
    `
      :host {
        display: block;
        padding: var(--space-5);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
      }
      :host(.pad-sm) {
        padding: var(--space-4);
      }
      :host(.pad-none) {
        padding: 0;
      }
      /* Dialogs and popovers sit above the page and say so. */
      :host(.is-raised) {
        background: var(--surface-raised);
        box-shadow: var(--shadow-lg);
      }
      /* For a card inside a card, where a second border would read as a box in a box. */
      :host(.is-quiet) {
        background: transparent;
        box-shadow: none;
      }
      :host(.is-interactive) {
        cursor: pointer;
      }
      @media (prefers-reduced-motion: no-preference) {
        :host(.is-interactive) {
          transition:
            border-color var(--dur-fast) var(--ease),
            box-shadow var(--dur-fast) var(--ease);
        }
      }
      :host(.is-interactive:hover) {
        border-color: var(--border-strong);
        box-shadow: var(--shadow-md);
      }
      :host(.is-interactive:focus-within) {
        border-color: var(--accent);
      }
    `,
  ],
})
export class CardComponent {
  readonly padding = input<'md' | 'sm' | 'none'>('md');
  readonly raised = input(false);
  readonly quiet = input(false);
  /** Hover and focus affordances. Set it only when the whole card is a target. */
  readonly interactive = input(false);
}

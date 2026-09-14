import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';

export type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * The one button (ADR-0032).
 *
 * It attaches to a **real `<button>` or `<a>`** rather than wrapping one:
 *
 *     <button cn-button variant="primary" (click)="save()">Save</button>
 *     <a cn-button variant="ghost" routerLink="/profile">Your profile</a>
 *
 * An attribute selector, not an element, and the reason is not style. A
 * `<cn-button>` wrapper sits between a form and its submit control, which costs
 * `type="submit"`, the disabled semantics, implicit label association and keyboard
 * activation — all of which would then have to be re-plumbed through inputs and
 * outputs, badly. Keeping the native element keeps all of it for free, and an
 * attribute-selector *component* (rather than a directive) keeps the scoped styles
 * too, so the CSS still lives in `ui/` where ADR-0032 puts it.
 *
 * `loading` sets `aria-busy` and blocks the pointer but deliberately does **not** set
 * `disabled`: a control that drops out of the tab order mid-interaction leaves the
 * keyboard user wherever they happened to be standing.
 */
@Component({
  selector: 'button[cn-button], a[cn-button]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    '[class]': '"v-" + variant() + " s-" + size()',
    '[class.is-block]': 'block()',
    '[class.is-loading]': 'loading()',
    '[attr.aria-busy]': "loading() ? 'true' : null",
  },
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        font: inherit;
        font-weight: var(--weight-medium);
        line-height: 1.2;
        cursor: pointer;
        text-decoration: none;
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: no-preference) {
        :host {
          transition:
            background-color var(--dur-fast) var(--ease),
            border-color var(--dur-fast) var(--ease),
            color var(--dur-fast) var(--ease);
        }
      }

      :host(.s-md) {
        padding: var(--space-2) var(--space-4);
        font-size: var(--text-sm);
        min-height: 2.25rem;
      }
      :host(.s-sm) {
        padding: var(--space-1) var(--space-3);
        font-size: var(--text-xs);
        min-height: 1.75rem;
      }
      :host(.is-block) {
        display: flex;
        width: 100%;
      }

      :host(.v-primary) {
        background: var(--accent);
        color: var(--accent-fg);
      }
      :host(.v-primary:hover:not([disabled])) {
        background: var(--accent-hover);
      }

      :host(.v-ghost) {
        background: var(--surface);
        color: var(--fg);
        border-color: var(--border-strong);
      }
      :host(.v-ghost:hover:not([disabled])) {
        background: var(--surface-sunken);
      }

      /* For the third action in a row, where a third border is noise. */
      :host(.v-quiet) {
        background: transparent;
        color: var(--fg-muted);
      }
      :host(.v-quiet:hover:not([disabled])) {
        color: var(--fg);
        background: var(--surface-sunken);
      }

      :host(.v-danger) {
        background: transparent;
        color: var(--bad);
        border-color: currentColor;
      }
      :host(.v-danger:hover:not([disabled])) {
        background: color-mix(in srgb, var(--bad) 12%, transparent);
      }

      :host([disabled]),
      :host(.is-loading) {
        cursor: default;
        opacity: 0.55;
      }
      :host(.is-loading) {
        pointer-events: none;
      }
    `,
  ],
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly loading = input(false, { transform: booleanAttribute });
  /** Fill the available width — its own input, because a full-width ghost is normal. */
  readonly block = input(false, { transform: booleanAttribute });
}

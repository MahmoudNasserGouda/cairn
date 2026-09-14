import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';
import { LogoComponent } from './logo.component';

/**
 * What is missing, and the action that fixes it (ADR-0032).
 *
 * `docs/design-system.md` makes this a craft rule rather than a component preference:
 * an empty panel is a state someone will actually see, often on their first visit, and
 * `<p class="muted">No data</p>` tells them nothing about what to do. Every empty panel
 * gets a heading that names the gap and a slot for the control that closes it.
 *
 * The mark is the cairn — four stones, the thing the product is named for. An empty
 * panel is the one place there is room for it.
 */
@Component({
  selector: 'cn-empty-state',
  standalone: true,
  imports: [LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!compact()) {
      <cn-logo [size]="40" class="mark" />
    }

    <p class="headline">{{ headline() }}</p>
    @if (detail(); as text) {
      <p class="detail">{{ text }}</p>
    }
    <div class="actions"><ng-content /></div>
  `,
  host: { '[class.is-compact]': 'compact()' },
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--space-2);
        padding: var(--space-6) var(--space-4);
        color: var(--fg-muted);
      }
      :host(.is-compact) {
        padding: var(--space-4) var(--space-2);
      }
      .mark {
        opacity: 0.75;
        margin-bottom: var(--space-1);
      }
      .headline {
        margin: 0;
        color: var(--fg);
        font-weight: var(--weight-medium);
      }
      .detail {
        margin: 0;
        font-size: var(--text-sm);
        max-width: 44ch;
      }
      .actions {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
        justify-content: center;
        margin-top: var(--space-2);
      }
      .actions:empty {
        display: none;
      }
    `,
  ],
})
export class EmptyStateComponent {
  /** Names the gap — "No skills yet", not "No data". */
  readonly headline = input.required<string>();
  /** One sentence on why it is empty and what fills it. */
  readonly detail = input<string | null>(null);
  /** Drop the mark and tighten the padding, for an empty slot inside a card. */
  readonly compact = input(false, { transform: booleanAttribute });
}

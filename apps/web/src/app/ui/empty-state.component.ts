import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * What is missing, and the action that fixes it (ADR-0032).
 *
 * `docs/design-system.md` makes this a craft rule rather than a component preference:
 * an empty panel is a state someone will actually see, often on their first visit, and
 * `<p class="muted">No data</p>` tells them nothing about what to do. Every empty panel
 * gets a heading that names the gap and a slot for the control that closes it.
 *
 * The mark is the cairn — four stones, the thing the product is named for — drawn from
 * the brand gradient. An empty page is the one place there is room for it.
 */
@Component({
  selector: 'cn-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!compact()) {
      <svg class="mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="cn-empty-stone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--stone-400)" />
            <stop offset="1" stop-color="var(--stone-700)" />
          </linearGradient>
        </defs>
        <g fill="url(#cn-empty-stone)">
          <rect x="16" y="7" width="16" height="7" rx="3.5" />
          <rect x="12" y="17" width="24" height="8" rx="4" />
          <rect x="9" y="28" width="30" height="8" rx="4" />
          <rect x="13" y="39" width="22" height="5" rx="2.5" />
        </g>
      </svg>
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
        width: 40px;
        height: 40px;
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
  readonly compact = input(false);
}

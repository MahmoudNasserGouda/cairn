import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Heading + description + content — the page building block (ADR-0032).
 *
 * It exists so a heading is never just an `<h2>` someone sized by hand, and so the
 * gap between a heading and its description is the same on every page. `actions` is a
 * projection slot rather than an input because what belongs next to a heading is a
 * button, a link, or a count, and typing that as data would be inventing a grammar.
 *
 *     <cn-section heading="Experience" description="Where you have worked.">
 *       <a cn-button variant="ghost" size="sm" slot="actions">Add a role</a>
 *       …
 *     </cn-section>
 */
@Component({
  selector: 'cn-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div class="titles">
        @if (heading(); as text) {
          @if (level() === 3) {
            <h3 [id]="headingId()">{{ text }}</h3>
          } @else {
            <h2 [id]="headingId()">{{ text }}</h2>
          }
        }
        @if (description(); as text) {
          <p class="desc">{{ text }}</p>
        }
      </div>
      <div class="actions"><ng-content select="[slot='actions']" /></div>
    </div>
    <ng-content />
  `,
  host: { '[attr.aria-labelledby]': 'headingId()' },
  styles: [
    `
      :host {
        display: block;
      }
      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-4);
        margin-bottom: var(--space-4);
        flex-wrap: wrap;
      }
      .titles {
        min-width: 0;
      }
      .desc {
        margin: var(--space-1) 0 0;
        color: var(--fg-muted);
        font-size: var(--text-sm);
        max-width: var(--measure-prose);
      }
      .actions {
        display: flex;
        gap: var(--space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .actions:empty {
        display: none;
      }
    `,
  ],
})
export class SectionComponent {
  readonly heading = input<string | null>(null);
  readonly description = input<string | null>(null);
  /**
   * Heading rank. A section nested inside another must not restart at `h2` — a
   * screen-reader's heading outline is a table of contents, and a jump from `h2` to
   * `h2` inside it reads as a new top-level topic.
   */
  readonly level = input<2 | 3>(2);
  /** Ties the landmark to its heading, so the section is announced by name. */
  readonly headingId = input<string | null>(null);
}

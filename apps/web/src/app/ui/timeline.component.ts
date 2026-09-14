import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * One dated entry. Deliberately not `ExperienceEntry` — education, certifications and
 * contribution history all render here, and coupling the view to one model would mean
 * four near-identical timelines.
 */
export interface TimelineEntry {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly startYear?: number | undefined;
  readonly endYear?: number | 'present' | undefined;
  readonly detail?: string | undefined;
  readonly bullets?: readonly string[] | undefined;
}

/** "2019 – present", "2019 – 2021", "2019", or nothing to show. */
export function yearRange(
  start: number | undefined,
  end: number | 'present' | undefined,
): string {
  if (start === undefined && end === undefined) return '';
  if (start === undefined) return String(end);
  if (end === undefined) return String(start);
  if (start === end) return String(start);
  return `${start} – ${end}`;
}

/**
 * Dated entries down a rail: roles, education, contribution history (ADR-0032).
 *
 * The dates sit in their own column with tabular figures, so a list of years lines up
 * instead of shimmering — which is also the shape `libs/cv-parse` works so hard to
 * recover from a two-column CV, so it is fitting that it renders as one.
 *
 * Everything projected through `entry-actions` is the caller's: the hub puts an edit
 * control there, and the review forms put nothing.
 */
@Component({
  selector: 'cn-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol>
      @for (entry of entries(); track entry.id) {
        <li>
          <div class="when">{{ range(entry) || '—' }}</div>
          <div class="what">
            <p class="title">{{ entry.title }}</p>
            @if (entry.subtitle) {
              <p class="subtitle">{{ entry.subtitle }}</p>
            }
            @if (entry.detail) {
              <p class="detail">{{ entry.detail }}</p>
            }
            @if (entry.bullets?.length) {
              <ul class="bullets">
                @for (bullet of entry.bullets; track $index) {
                  <li>{{ bullet }}</li>
                }
              </ul>
            }
          </div>
        </li>
      }
    </ol>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-5);
      }
      li {
        display: grid;
        grid-template-columns: 7.5rem 1fr;
        gap: var(--space-4);
        position: relative;
      }
      /* The rail: one line down the gutter, drawn by the row rather than an element. */
      li::before {
        content: '';
        position: absolute;
        left: calc(7.5rem + (var(--space-4) / 2) - 1px);
        top: 0.6rem;
        bottom: calc(var(--space-5) * -1);
        width: 1px;
        background: var(--border);
      }
      li:last-child::before {
        display: none;
      }
      li::after {
        content: '';
        position: absolute;
        left: calc(7.5rem + (var(--space-4) / 2) - 4px);
        top: 0.45rem;
        width: 7px;
        height: 7px;
        border-radius: var(--radius-full);
        background: var(--border-strong);
      }

      .when {
        font-size: var(--text-xs);
        color: var(--fg-subtle);
        padding-top: 0.15rem;
        text-align: right;
        white-space: nowrap;
      }
      .what {
        min-width: 0;
      }
      .title {
        margin: 0;
        font-weight: var(--weight-medium);
      }
      .subtitle,
      .detail {
        margin: var(--space-1) 0 0;
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .detail {
        color: var(--fg-subtle);
      }
      .bullets {
        margin: var(--space-2) 0 0;
        padding-left: var(--space-4);
        display: grid;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }

      /* Below this the date column costs more than the alignment is worth. */
      @media (max-width: 36rem) {
        li {
          grid-template-columns: 1fr;
          gap: var(--space-1);
        }
        li::before,
        li::after {
          display: none;
        }
        .when {
          text-align: left;
        }
      }
    `,
  ],
})
export class TimelineComponent {
  readonly entries = input.required<readonly TimelineEntry[]>();

  protected range(entry: TimelineEntry): string {
    return yearRange(entry.startYear, entry.endYear);
  }
}

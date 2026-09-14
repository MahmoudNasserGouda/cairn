import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';
import type { ScoreBreakdown } from '@cairn/scoring';

/** A part of the score, as the UI needs it: named, sized, and explained. */
interface Row {
  readonly key: string;
  readonly label: string;
  readonly percent: number;
  readonly note: string | null;
  readonly width: number;
}

/** `skillFit` → `Skill fit`. The engines speak camelCase; people do not. */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * A score with its named parts (ADR-0032).
 *
 * Every engine in this project already returns a `ScoreBreakdown` — the number and the
 * reasons it came out that way. Until now the UI mostly showed the number and hid the
 * reasons behind a toggle. `docs/design-system.md` makes that a principle: *earned, not
 * decorated* — show the breakdown next to the number, because a percentage no one can
 * interrogate is indistinguishable from one we made up.
 *
 * `unknown` is a first-class state, not a zero. A rate-limited GitHub count has to read
 * "couldn't check"; rendering it as 0% would be reporting a track record of none.
 */
@Component({
  selector: 'cn-score-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top">
      <span class="label">{{ label() }}</span>
      @if (unknown()) {
        <span class="unknown">couldn't check</span>
      } @else {
        <span class="value"
          >{{ breakdown()?.percent ?? 0 }}<span class="pct">%</span></span
        >
      }
    </div>

    @if (unknown()) {
      <p class="note">{{ unknownReason() }}</p>
    } @else if (breakdown(); as score) {
      <div
        class="track"
        role="meter"
        [attr.aria-label]="label()"
        [attr.aria-valuenow]="score.percent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="fill" [style.width.%]="score.percent"></div>
      </div>

      @if (rows().length) {
        <ul class="parts">
          @for (row of rows(); track row.key) {
            <li>
              <span class="part-label">{{ row.label }}</span>
              <span class="part-track" aria-hidden="true">
                <span class="part-fill" [style.width.%]="row.width"></span>
              </span>
              <span class="part-value">{{ row.percent }}%</span>
              @if (row.note) {
                <span class="part-note">{{ row.note }}</span>
              }
            </li>
          }
        </ul>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .label {
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .value {
        font-size: var(--text-2xl);
        font-weight: var(--weight-semibold);
        line-height: 1;
      }
      .pct {
        font-size: var(--text-base);
        color: var(--fg-subtle);
        margin-left: 1px;
      }
      .unknown {
        font-size: var(--text-sm);
        color: var(--warn);
        font-weight: var(--weight-medium);
      }
      .note {
        margin: var(--space-2) 0 0;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }

      .track {
        height: 8px;
        margin-top: var(--space-2);
        border-radius: var(--radius-full);
        background: var(--surface-sunken);
        border: 1px solid var(--border);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: linear-gradient(90deg, var(--stone-500), var(--accent));
      }
      @media (prefers-reduced-motion: no-preference) {
        .fill,
        .part-fill {
          transition: width var(--dur-slow) var(--ease);
        }
      }

      .parts {
        list-style: none;
        margin: var(--space-4) 0 0;
        padding: 0;
        display: grid;
        gap: var(--space-2);
      }
      .parts li {
        display: grid;
        grid-template-columns: minmax(6rem, 9rem) 1fr auto;
        align-items: center;
        gap: var(--space-2) var(--space-3);
        font-size: var(--text-xs);
      }
      .part-label {
        color: var(--fg-muted);
      }
      .part-track {
        height: 4px;
        border-radius: var(--radius-full);
        background: var(--surface-sunken);
      }
      .part-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--border-strong);
      }
      .part-value {
        color: var(--fg-muted);
      }
      .part-note {
        grid-column: 1 / -1;
        color: var(--fg-subtle);
      }

      @media (max-width: 30rem) {
        .parts li {
          grid-template-columns: 1fr auto;
        }
        .part-track {
          display: none;
        }
      }
    `,
  ],
})
export class ScoreBarComponent {
  readonly label = input.required<string>();
  readonly breakdown = input<ScoreBreakdown | null>(null);
  /**
   * True when the figure could not be measured.
   *
   * Distinct from a score of zero, and the distinction is the whole point: GitHub's
   * search bucket is 10-30 requests a minute, and a throttled merged-PR count read as
   * "no contributions" was a real bug in this project.
   */
  readonly unknown = input(false, { transform: booleanAttribute });
  readonly unknownReason = input(
    'We could not reach the data this needs. Try again later.',
  );
  /** Show the named parts. Off for a compact row of several scores. */
  readonly showParts = input(true, { transform: booleanAttribute });

  protected readonly rows = computed<Row[]>(() => {
    const score = this.breakdown();
    if (!score || !this.showParts()) return [];

    // Bars are scaled against the strongest part, not against 100, so a set of parts
    // that all land near 0.3 is still readable as a shape rather than four stubs.
    const peak = Math.max(...score.parts.map((p) => p.value), 0.01);
    return score.parts.map((part) => ({
      key: part.key,
      label: humanise(part.key),
      percent: Math.round(part.value * 100),
      note: part.note ?? null,
      width: Math.round((part.value / peak) * 100),
    }));
  });
}

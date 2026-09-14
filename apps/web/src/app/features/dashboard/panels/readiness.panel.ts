import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ReadinessReport } from '@cairn/profile';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  SectionComponent,
  TagComponent,
} from '../../../ui';

/** Display copy for the readiness score-part keys. */
const PART_LABELS: Readonly<Record<string, string>> = {
  skillDepth: 'Skill depth',
  skillBreadth: 'Skill breadth',
  experience: 'Experience',
  track: 'Track record',
  completeness: 'Sources connected',
};

/**
 * How ready you are to contribute — against no target at all.
 *
 * Presentational: it takes the report and renders it. The score itself is
 * `contributionReadiness` in `libs/profile`, which the container calls, so this
 * component has no way to accidentally compute a different number from the one the
 * engine produced.
 */
@Component({
  selector: 'cn-readiness-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    SectionComponent,
    TagComponent,
  ],
  template: `
    <cn-section heading="Contribution readiness">
      @if (report(); as r) {
        <cn-card>
          <p class="headline">
            <span class="big">{{ r.score.percent }}<span class="pct">%</span></span>
            <span class="band" [attr.data-band]="r.band">{{ r.band }}</span>
          </p>

          <ul class="parts">
            @for (part of r.score.parts; track part.key) {
              <li>
                <span class="label">{{ partLabel(part.key) }}</span>
                <span class="bar" aria-hidden="true">
                  <span class="fill" [style.width.%]="part.value * 100"></span>
                </span>
                <span class="note">{{ part.note }}</span>
              </li>
            }
          </ul>

          @if (!trackRecordKnown()) {
            <p class="unknown">
              GitHub's search quota was exhausted, so your merged-PR count could not be
              read. "Track record" is scored as 0 here and will correct itself on a later
              refresh — it is not a record of none.
            </p>
          }

          <h3>Profile sources</h3>
          <div class="tags">
            @for (source of r.completeness.have; track source) {
              <cn-tag tone="good">{{ source }}</cn-tag>
            }
            @for (source of r.completeness.missing; track source) {
              <cn-tag hint="Not connected yet">{{ source }}</cn-tag>
            }
          </div>

          @if (r.nextSteps.length) {
            <h3>What would move it most</h3>
            <ul class="steps">
              @for (step of r.nextSteps; track step.key) {
                <li>
                  <span>{{ step.label }}</span>
                  <span class="impact">+{{ step.impact }} pts</span>
                </li>
              }
            </ul>
          }
        </cn-card>
      } @else {
        <cn-empty-state
          headline="Nothing to score yet"
          detail="Readiness is measured against your profile, not against a repository —
            so it needs a profile first."
        >
          <a cn-button routerLink="/profile/sources">Connect a source</a>
        </cn-empty-state>
      }
    </cn-section>
  `,
  styles: [
    `
      .headline {
        display: flex;
        align-items: baseline;
        gap: var(--space-3);
        margin: 0 0 var(--space-4);
      }
      .big {
        font-size: var(--text-3xl);
        font-weight: var(--weight-semibold);
        line-height: 1;
      }
      .pct {
        font-size: var(--text-lg);
        color: var(--fg-subtle);
      }
      .band {
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
      }
      .band[data-band='High'] {
        color: var(--good);
      }
      .band[data-band='Medium'] {
        color: var(--warn);
      }
      .band[data-band='Low'] {
        color: var(--fg-muted);
      }

      .parts {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-2);
      }
      .parts li {
        display: grid;
        grid-template-columns: minmax(7rem, 9rem) 6rem 1fr;
        align-items: center;
        gap: var(--space-3);
        font-size: var(--text-sm);
      }
      .label {
        color: var(--fg-muted);
      }
      .bar {
        height: 5px;
        border-radius: var(--radius-full);
        background: var(--surface-sunken);
      }
      .fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--accent);
      }
      .note {
        color: var(--fg-subtle);
        font-size: var(--text-xs);
      }

      .unknown {
        margin: var(--space-4) 0 0;
        font-size: var(--text-xs);
        color: var(--warn);
        max-width: var(--measure-prose);
      }
      h3 {
        margin: var(--space-5) 0 var(--space-2);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-2);
        font-size: var(--text-sm);
      }
      .steps li {
        display: flex;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .impact {
        color: var(--good);
        font-variant-numeric: tabular-nums;
      }

      @media (max-width: 40rem) {
        .parts li {
          grid-template-columns: 1fr;
          gap: var(--space-1);
        }
        .bar {
          display: none;
        }
      }
    `,
  ],
})
export class ReadinessPanelComponent {
  readonly report = input<ReadinessReport | null>(null);
  /**
   * False when GitHub would not answer the merged-PR query.
   *
   * The panel says so rather than letting a throttle read as a track record of none —
   * which it did, once, and which is most likely to happen to exactly the users whose
   * record is thinnest.
   */
  readonly trackRecordKnown = input(true);

  protected readonly partLabel = computed(
    () => (key: string) => PART_LABELS[key] ?? key,
  )();
}

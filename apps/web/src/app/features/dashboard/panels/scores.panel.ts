import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ScoreBreakdown } from '@cairn/scoring';
import type { SkillGap } from '@cairn/matching';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  SectionComponent,
} from '../../../ui';

/**
 * Match, confidence and skill gap, against the chosen target.
 *
 * Presentational, and pointedly careful about the difference between **zero** and
 * **unknown**. A repository whose stack GitHub does not report has no skill coverage
 * to compute — that is "we cannot tell", not "you know none of it" — and the two look
 * nothing alike here.
 */
@Component({
  selector: 'cn-scores-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    SectionComponent,
  ],
  template: `
    @if (match(); as m) {
      <cn-section heading="Scored against {{ repoName() }}">
        <div class="figures">
          <cn-card>
            <p class="value">{{ m.percent }}<span class="pct">%</span></p>
            <p class="label">Repository match</p>
            <p class="detail">{{ repoName() }}</p>
          </cn-card>

          <cn-card>
            @if (confidence(); as c) {
              <p class="value">{{ c.percent }}<span class="pct">%</span></p>
              <p class="label">Contribution confidence</p>
              <p class="detail">issue #{{ issueNumber() }}</p>
            } @else {
              <p class="value none">—</p>
              <p class="label">Contribution confidence</p>
              <p class="detail">pick an open issue</p>
            }
          </cn-card>

          <cn-card>
            @if (gap()?.analysed) {
              <p class="value">{{ coverage() }}<span class="pct">%</span></p>
              <p class="label">Skill coverage</p>
              <p class="detail">{{ missingCount() }} to learn</p>
            } @else {
              <p class="value none">—</p>
              <p class="label">Skill coverage</p>
              <p class="detail">GitHub reports no stack for this repository</p>
            }
          </cn-card>
        </div>

        <div class="detail-grid">
          <cn-card>
            <h3>Why this match</h3>
            <pre>{{ explanation() }}</pre>
          </cn-card>

          <cn-card>
            <h3>Skill gap</h3>
            @if (gap()?.analysed) {
              <ol class="gap">
                @for (skill of gap()?.recommendedOrder ?? []; track skill) {
                  <li>{{ skill }}</li>
                } @empty {
                  <li class="none">Nothing missing for this target.</li>
                }
              </ol>
              <p class="hint">In the order worth learning them.</p>
            } @else {
              <p class="hint">
                GitHub reports no technologies for this repository, so there is nothing to
                compare against. That is why the coverage figure reads "—" rather than 0%.
              </p>
            }
          </cn-card>
        </div>
      </cn-section>
    } @else if (hasProfile()) {
      <cn-empty-state
        headline="No target chosen"
        detail="Match, confidence and skill gap all score you against a specific
          repository and issue. Pick one above."
      />
    } @else {
      <cn-empty-state
        headline="No profile to score"
        detail="These score you against a repository, so they need to know something
          about you first."
      >
        <a cn-button routerLink="/profile/sources">Connect a source</a>
      </cn-empty-state>
    }
  `,
  styles: [
    `
      .figures {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
        gap: var(--space-3);
      }
      .value {
        margin: 0;
        font-size: var(--text-3xl);
        font-weight: var(--weight-semibold);
        line-height: 1;
      }
      .value.none {
        color: var(--fg-subtle);
      }
      .pct {
        font-size: var(--text-lg);
        color: var(--fg-subtle);
      }
      .label {
        margin: var(--space-2) 0 0;
        font-size: var(--text-sm);
      }
      .detail {
        margin: 2px 0 0;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
        gap: var(--space-3);
        margin-top: var(--space-4);
      }
      h3 {
        margin: 0 0 var(--space-3);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      pre {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--fg-muted);
      }
      .gap {
        margin: 0;
        padding-left: var(--space-5);
        display: grid;
        gap: var(--space-1);
        font-size: var(--text-sm);
      }
      .none {
        color: var(--fg-subtle);
        list-style: none;
        margin-left: calc(var(--space-5) * -1);
      }
      .hint {
        margin: var(--space-3) 0 0;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
    `,
  ],
})
export class ScoresPanelComponent {
  readonly match = input<ScoreBreakdown | null>(null);
  readonly confidence = input<ScoreBreakdown | null>(null);
  readonly gap = input<SkillGap | null>(null);
  readonly explanation = input('');
  readonly repoName = input<string | null>(null);
  readonly issueNumber = input<number | null>(null);
  readonly hasProfile = input(false);

  /** Rounded here only for display; the engine's number is the one of record. */
  protected readonly coverage = computed(() => {
    const gap = this.gap();
    return gap?.analysed === true ? Math.round(gap.coverage * 100) : null;
  });

  protected readonly missingCount = computed(() => this.gap()?.missing.length ?? 0);
}

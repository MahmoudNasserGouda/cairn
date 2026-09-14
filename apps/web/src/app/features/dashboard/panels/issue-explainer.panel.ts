import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { explainIssueWithoutAI, issueExplainerPrompt } from '@cairn/ai';
import { AI_ENABLED } from '../../../core/features';
import { AiService } from '../../../core/ai/ai.service';
import { AiSettingsService } from '../../../core/ai/ai-settings.service';
import { TargetService } from '../../../core/targets/target.service';
import {
  ButtonComponent,
  CardComponent,
  SectionComponent,
  TagComponent,
} from '../../../ui';

/**
 * What the chosen issue actually asks for.
 *
 * The **deterministic** read is what you see first, always. That is ADR-0009's rule —
 * every AI feature has a non-AI fallback — inverted into the interface: the fallback
 * is not what you get when something fails, it is the default, and the written version
 * is an optional second opinion you pay for with your own key.
 */
@Component({
  selector: 'cn-issue-explainer-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent, CardComponent, SectionComponent, TagComponent],
  template: `
    @if (target.selectedIssue(); as issue) {
      <cn-section heading="Understand this issue">
        <cn-card>
          <p class="which">#{{ issue.number }} · {{ issue.title }}</p>

          @if (aiEnabled && aiExplanation(); as written) {
            <cn-tag tone="warn">AI-generated · may be wrong</cn-tag>
            <p class="explain">{{ written }}</p>
            <button cn-button variant="quiet" size="sm" (click)="clearAiExplanation()">
              Show the plain version
            </button>
          } @else {
            <p class="explain">{{ plainExplanation() }}</p>

            @if (aiEnabled) {
              @if (aiSettings.hasKey()) {
                <button
                  cn-button
                  variant="ghost"
                  size="sm"
                  [loading]="ai.running()"
                  (click)="explainIssue()"
                >
                  {{ ai.running() ? 'Asking your provider…' : 'Explain with AI' }}
                </button>
              } @else {
                <p class="hint">
                  That is the deterministic read. Add your own API key under
                  <a routerLink="/settings">Settings</a> for a written explanation.
                </p>
              }
            }
          }

          @if (aiEnabled && aiError(); as message) {
            <p class="error" role="alert">{{ message }}</p>
          }
        </cn-card>
      </cn-section>
    }
  `,
  styles: [
    `
      .which {
        margin: 0 0 var(--space-3);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .explain {
        margin: var(--space-3) 0;
        white-space: pre-wrap;
        max-width: var(--measure-prose);
      }
      .hint {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--fg-subtle);
      }
      .error {
        color: var(--bad);
        font-size: var(--text-sm);
      }
    `,
  ],
})
export class IssueExplainerPanelComponent {
  protected readonly target = inject(TargetService);
  protected readonly ai = inject(AiService);
  protected readonly aiSettings = inject(AiSettingsService);
  /** Frozen off by default; the deterministic explanation is then all there is. */
  protected readonly aiEnabled = inject(AI_ENABLED);

  private readonly _aiExplanation = signal<string | null>(null);
  protected readonly aiExplanation = this._aiExplanation.asReadonly();
  protected readonly aiError = signal<string | null>(null);

  constructor() {
    // An explanation belongs to one issue. Picking another must not leave the previous
    // issue's text sitting under the new issue's title.
    effect(() => {
      this.target.issueNumber();
      this._aiExplanation.set(null);
      this.aiError.set(null);
    });
  }

  protected readonly plainExplanation = computed(() => {
    const snapshot = this.target.issueSnapshot();
    const item = this.target.selectedIssue();
    if (!snapshot || !item) return '';
    return explainIssueWithoutAI({
      title: item.title,
      difficulty: snapshot.difficulty,
      requiredKnowledge: snapshot.requiredSkills,
      scopeClarity: snapshot.scopeClarity,
    });
  });

  protected clearAiExplanation(): void {
    this._aiExplanation.set(null);
  }

  protected async explainIssue(): Promise<void> {
    const item = this.target.selectedIssue();
    const repo = this.target.repoName();
    if (!item || repo === null) return;
    this.aiError.set(null);

    const outcome = await this.ai.run(
      `Explaining issue #${item.number}`,
      issueExplainerPrompt({
        repo,
        number: item.number,
        title: item.title,
        body: item.body,
        labels: item.labels,
      }),
    );
    if (outcome.status === 'declined') return;
    if (outcome.status === 'error') {
      this.aiError.set(outcome.message);
      return;
    }
    this._aiExplanation.set(outcome.text);
  }
}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TargetService } from '../../../core/targets/target.service';
import {
  ButtonComponent,
  CardComponent,
  FieldComponent,
  FieldControlDirective,
  SectionComponent,
} from '../../../ui';

/**
 * Choosing what to be scored against.
 *
 * Interactive, so it injects `TargetService` rather than taking inputs — the search,
 * the repository and the issue are one conversation with one service, and threading
 * five outputs back up to the page would be ceremony.
 *
 * **There is no demo target.** Scoring a stranger against a fictional repository and
 * labelling the result with their own percentages is worse than showing nothing, so
 * until a repository is picked the score panels say so.
 */
@Component({
  selector: 'cn-target-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonComponent,
    CardComponent,
    FieldComponent,
    FieldControlDirective,
    SectionComponent,
  ],
  template: `
    <cn-section
      heading="Scoring target"
      description="Pick a real repository and one of its open issues. Every score below
        is computed against these."
    >
      <cn-card>
        <form (ngSubmit)="runSearch()">
          <cn-field label="Find a repository" [error]="svc.error()">
            <input
              cn-control
              name="repoSearch"
              type="search"
              [(ngModel)]="searchText"
              placeholder="e.g. state machine"
              autocomplete="off"
            />
          </cn-field>
          <button cn-button type="submit" [loading]="svc.searching()">
            {{ svc.searching() ? 'Searching…' : 'Search' }}
          </button>
        </form>

        @if (svc.results().length) {
          <ul class="results">
            @for (r of svc.results(); track r.fullName) {
              <li>
                <button type="button" class="result" (click)="pickRepo(r.fullName)">
                  <span class="name">{{ r.fullName }}</span>
                  <span class="meta">
                    ★ {{ r.stars }}
                    @if (r.primaryLanguage) {
                      · {{ r.primaryLanguage }}
                    }
                  </span>
                  @if (r.description) {
                    <span class="desc">{{ r.description }}</span>
                  }
                </button>
              </li>
            }
          </ul>
        }

        @if (svc.repoName(); as name) {
          <div class="chosen">
            <p class="scoring">
              Scoring against <strong>{{ name }}</strong>
              <button cn-button variant="quiet" size="sm" (click)="svc.clear()">
                Clear
              </button>
            </p>

            @if (svc.issues().length) {
              <cn-field
                label="Open issue"
                hint="Contribution confidence is scored against one issue, not the
                  repository as a whole."
              >
                <select
                  cn-control
                  name="issue"
                  [ngModel]="svc.issueNumber()"
                  (ngModelChange)="pickIssue($event)"
                >
                  <option [ngValue]="null" disabled>Choose an open issue…</option>
                  @for (i of svc.issues(); track i.number) {
                    <option [ngValue]="i.number">#{{ i.number }} — {{ i.title }}</option>
                  }
                </select>
              </cn-field>
            } @else {
              <p class="hint">No open issues found for this repository.</p>
            }
          </div>
        } @else {
          <p class="hint">
            Nothing chosen yet. Search above, or bring one over from
            <strong>Discover</strong>.
          </p>
        }
      </cn-card>
    </cn-section>
  `,
  styles: [
    `
      form {
        display: flex;
        align-items: flex-end;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
      }
      form cn-field {
        flex: 1 1 auto;
      }
      .results {
        list-style: none;
        margin: 0 0 var(--space-4);
        padding: 0;
        display: grid;
        gap: var(--space-1);
        max-height: 18rem;
        overflow-y: auto;
      }
      .result {
        display: grid;
        gap: 2px;
        width: 100%;
        text-align: left;
        padding: var(--space-2) var(--space-3);
        border: 0;
        border-radius: var(--radius-md);
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .result:hover {
        background: var(--surface-sunken);
      }
      .name {
        font-weight: var(--weight-medium);
        font-size: var(--text-sm);
      }
      .meta,
      .desc {
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
      .chosen {
        border-top: 1px solid var(--border);
        padding-top: var(--space-4);
      }
      .scoring {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin: 0 0 var(--space-4);
        font-size: var(--text-sm);
        flex-wrap: wrap;
      }
      .hint {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--fg-subtle);
      }

      @media (max-width: 36rem) {
        form {
          flex-direction: column;
          align-items: stretch;
        }
      }
    `,
  ],
})
export class TargetPanelComponent {
  protected readonly svc = inject(TargetService);
  protected searchText = '';

  protected runSearch(): void {
    void this.svc.search(this.searchText);
  }

  protected pickRepo(slug: string): void {
    this.searchText = '';
    void this.svc.selectRepo(slug);
  }

  protected pickIssue(issueNumber: number | null): void {
    if (issueNumber !== null) this.svc.selectIssue(issueNumber);
  }
}

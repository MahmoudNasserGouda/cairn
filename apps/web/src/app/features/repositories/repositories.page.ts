import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  fetchRepoOverview,
  collectHealthSignals,
  type RepoOverview,
} from '@cairn/github';
import { healthScore, type HealthReport } from '@cairn/repository-analysis';
import { GithubClientService } from '../../core/github-client';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  FieldComponent,
  FieldControlDirective,
  SectionComponent,
  TagComponent,
} from '../../ui';

interface RepoResult {
  readonly overview: RepoOverview;
  readonly health: HealthReport;
}

/** `owner/repo`, and nothing that is not that. */
const SLUG = /^([\w.-]+)\/([\w.-]+)$/;

/**
 * Analyse any repository by name (ADR-0006, ADR-0008).
 *
 * The health engine is deterministic and AI-free — every band below is computed from
 * named signals, so `docs/design-system.md`'s "earned, not decorated" applies: the
 * bands are shown next to the headline rather than behind a disclosure.
 */
@Component({
  selector: 'cn-repositories',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    FieldComponent,
    FieldControlDirective,
    SectionComponent,
    TagComponent,
  ],
  template: `
    <cn-section
      heading="Analyse a repository"
      description="Health, activity and newcomer support for any public repository.
        Computed from named signals — no model is involved."
    >
      <form (ngSubmit)="analyse()">
        <cn-field
          label="Repository"
          hint="owner/repo. Called from your browser and cached locally; unauthenticated
            requests are rate-limited."
          [error]="error()"
        >
          <input
            cn-control
            name="slug"
            type="text"
            [(ngModel)]="slug"
            placeholder="angular/angular"
            autocomplete="off"
          />
        </cn-field>
        <button cn-button type="submit" [loading]="loading()" [disabled]="loading()">
          {{ loading() ? 'Analysing…' : 'Analyse' }}
        </button>
      </form>

      @if (result(); as r) {
        <cn-card>
          <h2>{{ r.overview.fullName }}</h2>
          @if (r.overview.description) {
            <p class="description">{{ r.overview.description }}</p>
          }

          @if (r.overview.technologies.length) {
            <div class="tags">
              @for (t of r.overview.technologies; track t) {
                <cn-tag>{{ t }}</cn-tag>
              }
            </div>
          }

          <p class="headline">Health: {{ r.health.headline }}</p>
          <dl class="bands">
            <div>
              <dt>Activity</dt>
              <dd>{{ r.health.activity }}</dd>
            </div>
            <div>
              <dt>Maintenance</dt>
              <dd>{{ r.health.maintenance }}</dd>
            </div>
            <div>
              <dt>Documentation</dt>
              <dd>{{ r.health.documentation }}</dd>
            </div>
            <div>
              <dt>Newcomer support</dt>
              <dd>{{ r.health.newContributorSupport }}</dd>
            </div>
          </dl>
        </cn-card>
      } @else if (!loading()) {
        <cn-empty-state
          headline="Nothing analysed yet"
          detail="Type a repository above. Anything public works — it does not have to be
            one of yours."
          compact
        />
      }
    </cn-section>
  `,
  styles: [
    `
      form {
        display: flex;
        align-items: flex-end;
        gap: var(--space-3);
        margin-bottom: var(--space-5);
        max-width: 34rem;
      }
      form cn-field {
        flex: 1 1 auto;
      }
      h2 {
        margin: 0;
        font-size: var(--text-lg);
      }
      .description {
        margin: var(--space-2) 0 var(--space-3);
        color: var(--fg-muted);
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin-bottom: var(--space-4);
      }
      .headline {
        margin: 0 0 var(--space-3);
        font-weight: var(--weight-medium);
      }
      .bands {
        margin: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
        gap: var(--space-3);
      }
      .bands dt {
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
      .bands dd {
        margin: 2px 0 0;
        font-weight: var(--weight-medium);
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
export class RepositoriesPageComponent {
  private readonly client = inject(GithubClientService).get();

  protected slug = 'angular/angular';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<RepoResult | null>(null);

  protected async analyse(): Promise<void> {
    const match = SLUG.exec(this.slug.trim());
    if (!match) {
      this.error.set('That is not an owner/repo name — try angular/angular.');
      return;
    }
    const id = { owner: match[1] as string, repo: match[2] as string };
    this.loading.set(true);
    this.error.set(null);
    try {
      const [overview, signals] = await Promise.all([
        fetchRepoOverview(this.client, id),
        collectHealthSignals(this.client, id),
      ]);
      this.result.set({ overview, health: healthScore(signals) });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      this.loading.set(false);
    }
  }
}

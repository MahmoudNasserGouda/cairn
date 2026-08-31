import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  GithubClient,
  fetchRepoOverview,
  collectHealthSignals,
  type RepoOverview,
} from '@cairn/github';
import { healthScore, type HealthReport } from '@cairn/repository-analysis';
import { IndexedDbStore } from '../core/indexeddb-store';

interface RepoResult {
  readonly overview: RepoOverview;
  readonly health: HealthReport;
}

@Component({
  selector: 'cn-repositories',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Analyse a repository</h1>
    <p class="muted">
      Paste <code>owner/repo</code>. Calls the GitHub API directly from your browser and
      caches the result locally (ADR-0006). Unauthenticated requests are rate-limited.
    </p>

    <form (ngSubmit)="analyse()">
      <input
        name="slug"
        [(ngModel)]="slug"
        placeholder="angular/angular"
        aria-label="owner/repo"
        autocomplete="off"
      />
      <button type="submit" [disabled]="loading()">
        {{ loading() ? 'Analysing…' : 'Analyse' }}
      </button>
    </form>

    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    }

    @if (result(); as r) {
      <section class="panel">
        <h2>{{ r.overview.fullName }}</h2>
        <p>{{ r.overview.description }}</p>
        <p class="tags">
          @for (t of r.overview.technologies; track t) {
            <span class="tag">{{ t }}</span>
          }
        </p>
        <div class="scoreline">
          <strong>Health {{ r.health.headline }}</strong>
          <span>Activity: {{ r.health.activity }}</span>
          <span>Maintenance: {{ r.health.maintenance }}</span>
          <span>Docs: {{ r.health.documentation }}</span>
          <span>Newcomer support: {{ r.health.newContributorSupport }}</span>
        </div>
      </section>
    }
  `,
  styles: [
    `
      .muted {
        color: var(--muted);
      }
      form {
        display: flex;
        gap: 0.5rem;
        margin: 1rem 0;
      }
      input {
        flex: 1;
        padding: 0.5rem 0.75rem;
        background: var(--panel);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      button {
        padding: 0.5rem 1rem;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--accent);
        color: #06131f;
        font-weight: 600;
        cursor: pointer;
      }
      .error {
        color: #f87171;
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem;
        background: var(--panel);
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .tag {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.1rem 0.55rem;
        font-size: 0.8rem;
      }
      .scoreline {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-top: 0.75rem;
        color: var(--muted);
      }
      .scoreline strong {
        color: var(--fg);
      }
    `,
  ],
})
export class RepositoriesComponent {
  private readonly store = inject(IndexedDbStore);
  private readonly client = new GithubClient({ cache: this.store });

  protected slug = 'angular/angular';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<RepoResult | null>(null);

  protected async analyse(): Promise<void> {
    const match = /^([\w.-]+)\/([\w.-]+)$/.exec(this.slug.trim());
    if (!match) {
      this.error.set('Enter a valid owner/repo slug.');
      return;
    }
    const id = { owner: match[1]!, repo: match[2]! };
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

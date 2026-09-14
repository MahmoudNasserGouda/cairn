import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { WeightPreset } from '@cairn/scoring';
import type { Recommendation } from '@cairn/discovery';
import {
  DiscoveryService,
  DISCOVERY_PRESETS,
} from '../../core/discovery/discovery.service';
import { ProfileService } from '../../core/profile/profile.service';
import { TargetService } from '../../core/targets/target.service';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  SectionComponent,
  TagComponent,
} from '../../ui';

/** Display copy for the discovery score-part keys. */
const PART_LABELS: Readonly<Record<string, string>> = {
  skillFit: 'Skill fit',
  technologyFit: 'Stack you know',
  newcomerSignal: 'Newcomer support',
  activity: 'Activity',
  approachability: 'Approachable size',
  learning: 'Learning value',
};

/**
 * Repository discovery (ADR-0027).
 *
 * Every number here comes with its reasons, because the whole claim of this engine is
 * that it is explainable — a percentage nobody can interrogate is indistinguishable
 * from one we made up.
 */
@Component({
  selector: 'cn-discover',
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
    <cn-section
      heading="Find a project"
      description="Your profile becomes a handful of GitHub searches, and the results are
        ranked by named, weighted signals — the same deterministic engine as every other
        score here."
    >
      @if (!svc.canRun()) {
        @if (!profileSvc.profile()) {
          <cn-empty-state
            headline="No profile to search with"
            detail="Discovery ranks repositories against you, so it needs to know
              something about you first."
          >
            <a cn-button routerLink="/profile/sources">Connect a source</a>
          </cn-empty-state>
        } @else {
          <cn-empty-state
            headline="No programming language on your profile"
            detail="Every search runs against a language, so there is nothing to search
              for yet. Import a CV, or connect GitHub and let your repositories speak."
          >
            <a cn-button routerLink="/profile/sources">Add a source</a>
            <a cn-button variant="ghost" routerLink="/profile/skills">Add a skill</a>
          </cn-empty-state>
        }
      } @else {
        <cn-card class="controls">
          <fieldset>
            <legend>What are you looking for?</legend>
            <div class="presets">
              @for (p of presets; track p.id) {
                <label class="preset" [class.selected]="svc.preset() === p.id">
                  <input
                    type="radio"
                    name="preset"
                    [value]="p.id"
                    [checked]="svc.preset() === p.id"
                    (change)="choosePreset(p.id)"
                  />
                  <span>
                    <strong>{{ p.label }}</strong>
                    <span class="hint">{{ p.hint }}</span>
                  </span>
                </label>
              }
            </div>
          </fieldset>
          <button cn-button [loading]="svc.running()" (click)="run()">
            {{ svc.running() ? 'Searching GitHub…' : runLabel() }}
          </button>
        </cn-card>

        @if (svc.error(); as e) {
          <p class="notice error" role="alert">{{ e }}</p>
        }
        @if (targetError(); as e) {
          <p class="notice error" role="alert">Couldn't open that repository: {{ e }}</p>
        }
        @if (svc.throttled() && svc.recommendations().length) {
          <p class="notice warn" role="status">
            GitHub's search quota ran out part-way through, so this is ranked from fewer
            searches than planned. Signing in with GitHub raises the limit from 10 to 30
            searches a minute.
          </p>
        }

        @if (svc.plan().length) {
          <details class="plan">
            <summary>What was searched ({{ svc.plan().length }} queries)</summary>
            <ul>
              @for (q of svc.plan(); track q.query) {
                <li>
                  <span>{{ q.rationale }}</span>
                  <code>{{ q.query }}</code>
                </li>
              }
            </ul>
          </details>
        }

        @if (svc.recommendations().length) {
          <ul class="results">
            @for (r of svc.recommendations(); track r.candidate.fullName) {
              <li>
                <cn-card>
                  <header>
                    <div class="title">
                      <a
                        [href]="r.candidate.htmlUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ r.candidate.fullName }}</a
                      >
                      <span class="stars">★ {{ r.candidate.stars }}</span>
                    </div>
                    <span class="score" [attr.data-band]="band(r)">
                      {{ r.score.percent }}%
                    </span>
                  </header>

                  @if (r.candidate.description) {
                    <p class="desc">{{ r.candidate.description }}</p>
                  }

                  <div class="tags">
                    @for (t of r.known; track t) {
                      <cn-tag tone="good" hint="You already know this">{{ t }}</cn-tag>
                    }
                    @for (t of r.newToYou; track t) {
                      <cn-tag hint="New to you">{{ t }}</cn-tag>
                    }
                  </div>

                  <ul class="reasons">
                    @for (reason of r.reasons; track reason) {
                      <li>{{ reason }}</li>
                    }
                  </ul>

                  <div class="actions">
                    <button
                      cn-button
                      size="sm"
                      [loading]="picking() === r.candidate.fullName"
                      (click)="useAsTarget(r)"
                    >
                      {{
                        picking() === r.candidate.fullName ? 'Loading…' : 'Score my fit'
                      }}
                    </button>
                    <button cn-button variant="quiet" size="sm" (click)="toggleWhy(r)">
                      {{
                        expanded() === r.candidate.fullName ? 'Hide the why' : 'Why this?'
                      }}
                    </button>
                  </div>

                  @if (expanded() === r.candidate.fullName) {
                    <ul class="parts">
                      @for (part of r.score.parts; track part.key) {
                        <li>
                          <span>{{ partLabel(part.key) }}</span>
                          <span class="bar">
                            <span class="fill" [style.width.%]="part.value * 100"></span>
                          </span>
                          <span class="note">{{ part.note }}</span>
                        </li>
                      }
                    </ul>
                  }
                </cn-card>
              </li>
            }
          </ul>

          @if (rejectedNote(); as note) {
            <p class="rejected">{{ note }}</p>
          }
        } @else if (svc.hasRun() && !svc.running() && !svc.error()) {
          <cn-empty-state
            headline="Nothing came back"
            detail="That usually means the star and activity windows were too tight for
              your profile."
          >
            <button cn-button variant="ghost" (click)="choosePreset('learning')">
              Try the Stretch preset
            </button>
            <a cn-button variant="ghost" routerLink="/repositories">
              Analyse one you know
            </a>
          </cn-empty-state>
        }
      }
    </cn-section>
  `,
  styles: [
    `
      .controls {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--space-5);
        flex-wrap: wrap;
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
      }
      legend {
        padding: 0 0 var(--space-3);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .presets {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .preset {
        display: flex;
        gap: var(--space-2);
        align-items: flex-start;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: var(--text-sm);
        max-width: 14rem;
      }
      .preset.selected {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .preset input {
        width: auto;
        margin-top: 3px;
      }
      .preset span {
        display: block;
        min-width: 0;
      }
      .hint {
        display: block;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }

      .notice {
        margin: var(--space-4) 0;
        font-size: var(--text-sm);
      }
      .notice.error {
        color: var(--bad);
      }
      .notice.warn {
        color: var(--warn);
      }

      .plan {
        margin: var(--space-4) 0;
        font-size: var(--text-sm);
      }
      .plan summary {
        cursor: pointer;
        color: var(--accent);
      }
      .plan ul {
        list-style: none;
        margin: var(--space-3) 0 0;
        padding: 0;
        display: grid;
        gap: var(--space-2);
      }
      .plan code {
        display: block;
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        color: var(--fg-subtle);
        overflow-wrap: anywhere;
      }

      .results {
        list-style: none;
        margin: var(--space-5) 0 0;
        padding: 0;
        display: grid;
        gap: var(--space-4);
      }
      header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .title {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        flex-wrap: wrap;
        min-width: 0;
      }
      .title a {
        font-weight: var(--weight-medium);
      }
      .stars {
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
      .score {
        font-size: var(--text-xl);
        font-weight: var(--weight-semibold);
      }
      .score[data-band='High'] {
        color: var(--good);
      }
      .score[data-band='Medium'] {
        color: var(--warn);
      }
      .score[data-band='Low'] {
        color: var(--fg-muted);
      }
      .desc {
        margin: var(--space-2) 0;
        color: var(--fg-muted);
        font-size: var(--text-sm);
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin: var(--space-3) 0;
      }
      .reasons {
        margin: 0 0 var(--space-4);
        padding-left: var(--space-4);
        font-size: var(--text-sm);
        color: var(--fg-muted);
        display: grid;
        gap: var(--space-1);
      }
      .actions {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .parts {
        list-style: none;
        margin: var(--space-4) 0 0;
        padding-top: var(--space-4);
        border-top: 1px solid var(--border);
        display: grid;
        gap: var(--space-2);
        font-size: var(--text-xs);
      }
      .parts li {
        display: grid;
        grid-template-columns: minmax(7rem, 9rem) 5rem 1fr;
        align-items: center;
        gap: var(--space-3);
      }
      .bar {
        height: 4px;
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
      }
      .rejected {
        margin-top: var(--space-4);
        font-size: var(--text-xs);
        color: var(--fg-subtle);
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
export class DiscoverPageComponent {
  protected readonly svc = inject(DiscoveryService);
  protected readonly profileSvc = inject(ProfileService);
  protected readonly targetSvc = inject(TargetService);
  private readonly router = inject(Router);

  protected readonly presets = DISCOVERY_PRESETS;
  protected readonly expanded = signal<string | null>(null);
  protected readonly picking = signal<string | null>(null);

  /**
   * A failure from `TargetService` while promoting a recommendation. Without this the
   * "Score my fit" button simply did nothing on failure — it stayed on the page with
   * no explanation, because the error lives on the *target* service, not this one.
   */
  protected readonly targetError = this.targetSvc.error;

  protected readonly runLabel = computed(() =>
    this.svc.hasRun() ? 'Search again' : 'Find repositories for me',
  );

  /**
   * How many candidates were filtered out and why. Worth saying: "12 of 47" reads as
   * a shortlist, while a silent 47 → 12 reads as "GitHub only had 12".
   */
  protected readonly rejectedNote = computed(() => {
    const result = this.svc.result();
    if (!result) return null;
    const { archived, fork } = result.rejected;
    const bare = result.rejected['no-declared-stack'];
    const dropped = archived + fork + bare;
    if (dropped === 0) return null;
    const parts: string[] = [];
    if (archived) parts.push(`${archived} archived`);
    if (fork) parts.push(`${fork} forked`);
    if (bare) parts.push(`${bare} with no detectable stack`);
    return `Ranked ${result.recommendations.length} of ${result.considered} repositories found — ${parts.join(', ')} were set aside.`;
  });

  protected partLabel(key: string): string {
    return PART_LABELS[key] ?? key;
  }

  protected band(r: Recommendation): 'High' | 'Medium' | 'Low' {
    if (r.score.total >= 0.75) return 'High';
    return r.score.total >= 0.45 ? 'Medium' : 'Low';
  }

  protected run(): void {
    void this.svc.run();
  }

  protected choosePreset(preset: WeightPreset): void {
    void this.svc.setPreset(preset);
  }

  protected toggleWhy(r: Recommendation): void {
    const name = r.candidate.fullName;
    this.expanded.set(this.expanded() === name ? null : name);
  }

  /**
   * Promote a recommendation to *the* scoring target and hand off to the dashboard,
   * where it gets the full treatment discovery deliberately skipped: health signals,
   * `repositoryMatch`, and an issue to pick.
   */
  protected async useAsTarget(r: Recommendation): Promise<void> {
    const name = r.candidate.fullName;
    this.picking.set(name);
    try {
      await this.targetSvc.selectRepo(name);
      if (this.targetSvc.repoName() === name) {
        await this.router.navigate(['/dashboard']);
      }
    } finally {
      this.picking.set(null);
    }
  }
}

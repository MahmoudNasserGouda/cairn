import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { WeightPreset } from '@cairn/scoring';
import type { Recommendation } from '@cairn/discovery';
import { DiscoveryService, DISCOVERY_PRESETS } from '../core/discovery/discovery.service';
import { ProfileService } from '../core/profile/profile.service';
import { TargetService } from '../core/targets/target.service';

/** Display copy for the discovery score-part keys. */
const PART_LABELS: Readonly<Record<string, string>> = {
  skillFit: 'Skill fit',
  technologyFit: 'Stack you know',
  newcomerSignal: 'Newcomer support',
  activity: 'Activity',
  approachability: 'Approachable size',
  learning: 'Learning value',
};

@Component({
  selector: 'cn-discover',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Find a project</h1>
    <p class="muted">
      Your profile becomes a handful of GitHub searches, and the results are ranked by
      named, weighted signals — the same deterministic engine as every other score here
      (no AI, no black box).
    </p>

    @if (!svc.canRun()) {
      <section class="panel">
        @if (!profileSvc.profile()) {
          <p class="muted">
            No profile yet — connect GitHub from the sign-in menu, or
            <a routerLink="/profile">import a CV</a>. Discovery ranks repositories
            <em>against you</em>, so it needs one.
          </p>
        } @else {
          <p class="muted">
            Your profile does not name a programming language yet, so there is nothing to
            search for. Every search runs against a language — add one by
            <a routerLink="/profile">importing a CV</a>, or connect GitHub so your public
            repositories can speak for you.
          </p>
        }
      </section>
    } @else {
      <section class="panel controls">
        <fieldset>
          <legend>What are you looking for?</legend>
          <div class="presets">
            @for (p of presets; track p.id) {
              <label
                class="preset"
                [class.selected]="svc.preset() === p.id"
                [attr.data-preset]="p.id"
              >
                <input
                  type="radio"
                  name="preset"
                  [value]="p.id"
                  [checked]="svc.preset() === p.id"
                  (change)="choosePreset(p.id)"
                />
                <strong>{{ p.label }}</strong>
                <span class="muted small">{{ p.hint }}</span>
              </label>
            }
          </div>
        </fieldset>
        <button type="button" class="primary" (click)="run()" [disabled]="svc.running()">
          {{ svc.running() ? 'Searching GitHub…' : runLabel() }}
        </button>
      </section>

      @if (svc.error(); as e) {
        <p class="notice error">{{ e }}</p>
      }

      @if (targetError(); as e) {
        <p class="notice error">Couldn't open that repository: {{ e }}</p>
      }

      @if (svc.throttled() && svc.recommendations().length) {
        <p class="notice muted">
          GitHub's search quota ran out part-way through, so this is ranked from fewer
          searches than planned. Signing in with GitHub raises the limit from 10 to 30
          searches a minute.
        </p>
      }

      @if (svc.plan().length) {
        <details class="panel plan">
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
            <li class="panel rec">
              <header>
                <div class="title">
                  <a
                    [href]="r.candidate.htmlUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ r.candidate.fullName }}</a
                  >
                  <span class="muted small">★ {{ r.candidate.stars }}</span>
                </div>
                <span class="score" [attr.data-band]="band(r)"
                  >{{ r.score.percent }}%</span
                >
              </header>

              @if (r.candidate.description) {
                <p class="desc">{{ r.candidate.description }}</p>
              }

              <div class="tags">
                @for (t of r.known; track t) {
                  <span class="tag known">✓ {{ t }}</span>
                }
                @for (t of r.newToYou; track t) {
                  <span class="tag ghost">+ {{ t }}</span>
                }
              </div>

              <ul class="reasons">
                @for (reason of r.reasons; track reason) {
                  <li>{{ reason }}</li>
                }
              </ul>

              <div class="actions">
                <button type="button" class="primary" (click)="useAsTarget(r)">
                  {{ picking() === r.candidate.fullName ? 'Loading…' : 'Score my fit' }}
                </button>
                <button type="button" class="link" (click)="toggleWhy(r)">
                  {{ expanded() === r.candidate.fullName ? 'Hide the why' : 'Why this?' }}
                </button>
              </div>

              @if (expanded() === r.candidate.fullName) {
                <ul class="parts">
                  @for (part of r.score.parts; track part.key) {
                    <li>
                      <span>{{ partLabel(part.key) }}</span>
                      <span class="bar"
                        ><span class="fill" [style.width.%]="part.value * 100"></span
                      ></span>
                      <span class="muted small">{{ part.note }}</span>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>

        @if (rejectedNote(); as note) {
          <p class="muted small">{{ note }}</p>
        }
      } @else if (svc.hasRun() && !svc.running() && !svc.error()) {
        <section class="panel">
          <p class="muted">
            No repositories came back for your profile. That usually means the star and
            activity windows were too tight — try the <strong>Stretch</strong> preset, or
            <a routerLink="/repositories">analyse a repository</a> you already have in
            mind.
          </p>
        </section>
      }
    }
  `,
  styles: [
    `
      h1 {
        margin-top: 0;
      }
      .muted,
      small {
        color: var(--muted);
      }
      .small {
        font-size: 0.8rem;
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem;
        background: var(--panel);
      }
      .notice {
        margin: 1rem 0 0;
      }
      .notice.error {
        color: #f87171;
      }
      .controls {
        margin: 1.5rem 0;
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: flex-end;
        justify-content: space-between;
      }
      fieldset {
        border: none;
        padding: 0;
        margin: 0;
        min-width: min(100%, 20rem);
      }
      legend {
        padding: 0;
        margin-bottom: 0.5rem;
        color: var(--muted);
      }
      .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .preset {
        display: grid;
        gap: 0.1rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.5rem 0.75rem;
        cursor: pointer;
        flex: 1 1 12rem;
      }
      .preset.selected {
        border-color: var(--accent);
      }
      .preset input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
      }
      .primary {
        padding: 0.5rem 1rem;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--accent);
        color: #06131f;
        font-weight: 600;
        cursor: pointer;
      }
      .primary:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .link {
        background: none;
        border: none;
        color: var(--accent);
        text-decoration: underline;
        cursor: pointer;
        padding: 0;
      }
      .plan {
        margin-bottom: 1rem;
      }
      .plan summary {
        cursor: pointer;
        color: var(--muted);
      }
      .plan ul {
        list-style: none;
        margin: 0.75rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.5rem;
      }
      .plan li {
        display: grid;
        gap: 0.15rem;
      }
      .plan code {
        font-size: 0.8rem;
        color: var(--muted);
        overflow-wrap: anywhere;
      }
      .results {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 1rem;
      }
      .rec header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
      }
      .title {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .title a {
        font-weight: 700;
        color: var(--fg);
      }
      .score {
        font-size: 1.5rem;
        font-weight: 700;
      }
      .score[data-band='High'] {
        color: var(--good);
      }
      .score[data-band='Medium'] {
        color: var(--accent);
      }
      .desc {
        margin: 0.5rem 0;
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .tag {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.1rem 0.6rem;
        font-size: 0.8rem;
      }
      .tag.known {
        color: var(--good);
        border-color: var(--good);
      }
      .tag.ghost {
        color: var(--muted);
      }
      .reasons {
        margin: 0.75rem 0 0;
        padding-left: 1.1rem;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-top: 0.85rem;
      }
      .parts {
        list-style: none;
        padding: 0;
        margin: 1rem 0 0;
        display: grid;
        gap: 0.5rem;
      }
      .parts li {
        display: grid;
        grid-template-columns: 9rem 1fr auto;
        align-items: center;
        gap: 0.6rem;
      }
      .bar {
        height: 0.4rem;
        border-radius: 999px;
        background: var(--border);
        overflow: hidden;
      }
      .fill {
        display: block;
        height: 100%;
        background: var(--good);
      }
      @media (max-width: 560px) {
        .parts li {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class DiscoverComponent {
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

import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  repositoryMatch,
  contributionConfidence,
  skillGap,
  type DeveloperSnapshot,
  type RepositorySnapshot,
  type IssueSnapshot,
} from '@cairn/matching';
import { explain } from '@cairn/scoring';
import { contributionReadiness } from '@cairn/profile';
import { ProfileService, profileToSnapshot } from '../core/profile/profile.service';
import { TargetService } from '../core/targets/target.service';

/** Fallback profile for visitors without a connected GitHub identity. */
const DEMO_DEV: DeveloperSnapshot = {
  experience: 'beginner',
  interests: ['web', 'developer-tools'],
  priorContributions: 1,
  skills: [
    { tag: 'typescript', level: 0.5, source: 'github' },
    { tag: 'javascript', level: 0.7, source: 'github' },
    { tag: 'html', level: 0.6, source: 'cv' },
    { tag: 'css', level: 0.5, source: 'cv' },
    { tag: 'git', level: 0.6, source: 'manual' },
  ],
};

/** Fallback scoring target shown until the user picks a real repo + issue. */
const DEMO_REPO: RepositorySnapshot = {
  fullName: 'vercel/swr',
  technologies: ['typescript', 'react', 'javascript'],
  topics: ['data-fetching', 'hooks', 'web'],
  activity: 0.8,
  health: 0.85,
  newcomerFriendliness: 0.65,
  requiredExperience: 'intermediate',
};

const DEMO_ISSUE: IssueSnapshot = {
  number: 100,
  difficulty: 'easy',
  requiredSkills: ['typescript', 'react'],
  scopeClarity: 0.7,
  mentorshipOffered: true,
};

/** Display copy for the readiness score-part keys. */
const PART_LABELS: Readonly<Record<string, string>> = {
  skillDepth: 'Skill depth',
  skillBreadth: 'Skill breadth',
  experience: 'Experience',
  track: 'Track record',
  completeness: 'Sources connected',
};

@Component({
  selector: 'cn-dashboard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Welcome back</h1>
    <p class="muted">
      Deterministic, explainable scores — no AI needed (<a
        href="https://api.github.com"
        rel="noopener noreferrer"
        >GitHub</a
      >
      data only).
    </p>

    @if (profileSvc.error(); as err) {
      <p class="notice error">Couldn't load your GitHub profile: {{ err }}</p>
    } @else if (profileSvc.loading()) {
      <p class="notice muted">Loading your GitHub profile…</p>
    } @else if (!profileSvc.profile()) {
      <p class="notice muted">
        Showing demo data — connect GitHub or import a CV for your real profile.
      </p>
    }

    @if (profile(); as p) {
      <section class="panel profile">
        <h2>Your profile</h2>
        <p class="sub">
          @if (p.displayName) {
            <strong>{{ p.displayName }}</strong> ·
          }
          {{ p.experienceLevel }} · ~{{ p.totalYears }} yrs ·
          {{ profileSvc.priorContributions() }} merged PRs
        </p>
        <div class="tags">
          @for (s of p.skills; track s.tag) {
            <span class="tag">{{ s.tag }} {{ percent(s.level) }}%</span>
          } @empty {
            <span class="muted">No languages detected in your public repos yet.</span>
          }
        </div>
        @if (p.interests.length) {
          <p class="sub">Interests</p>
          <div class="tags">
            @for (t of p.interests; track t) {
              <span class="tag ghost">{{ t }}</span>
            }
          </div>
        }
      </section>
    }

    <section class="panel readiness">
      <h2>Contribution readiness</h2>
      @if (readiness(); as r) {
        <p class="headline">
          <span class="big">{{ r.score.percent }}%</span>
          <span class="band" [attr.data-band]="r.band">{{ r.band }}</span>
        </p>
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
        <p class="sub">Profile sources</p>
        <div class="tags">
          @for (source of r.completeness.have; track source) {
            <span class="tag done">✓ {{ source }}</span>
          }
          @for (source of r.completeness.missing; track source) {
            <span class="tag ghost">+ {{ source }}</span>
          }
        </div>
        @if (r.nextSteps.length) {
          <p class="sub">Next steps</p>
          <ul class="steps">
            @for (step of r.nextSteps; track step.key) {
              <li>
                {{ step.label }} <span class="muted small">+{{ step.impact }} pts</span>
              </li>
            }
          </ul>
        }
      } @else {
        <p class="muted">
          Connect GitHub or import a CV to see how ready you are to contribute.
        </p>
      }
    </section>

    <section class="panel target">
      <h2>Scoring target</h2>
      <form (ngSubmit)="runSearch()">
        <input
          name="repoSearch"
          [(ngModel)]="searchText"
          placeholder="Search repositories — e.g. state machine"
          aria-label="Search repositories"
          autocomplete="off"
        />
        <button type="submit" [disabled]="targetSvc.searching()">
          {{ targetSvc.searching() ? 'Searching…' : 'Search' }}
        </button>
      </form>

      @if (targetSvc.error(); as e) {
        <p class="notice error">{{ e }}</p>
      }

      @if (targetSvc.results().length) {
        <ul class="results">
          @for (r of targetSvc.results(); track r.fullName) {
            <li>
              <button type="button" class="link" (click)="pickRepo(r.fullName)">
                <strong>{{ r.fullName }}</strong>
                <span class="muted small"
                  >★ {{ r.stars }}
                  @if (r.primaryLanguage) {
                    · {{ r.primaryLanguage }}
                  }
                </span>
                @if (r.description) {
                  <span class="muted small block">{{ r.description }}</span>
                }
              </button>
            </li>
          }
        </ul>
      }

      @if (targetSvc.repoName(); as name) {
        <p class="sub">
          Scoring against <strong>{{ name }}</strong>
          <button type="button" class="link inline" (click)="targetSvc.clear()">
            clear
          </button>
        </p>
        @if (targetSvc.issues().length) {
          <label class="issue-pick">
            Issue
            <select
              [ngModel]="targetSvc.issueNumber()"
              (ngModelChange)="pickIssue($event)"
              name="issue"
            >
              <option [ngValue]="null" disabled>Choose an open issue…</option>
              @for (i of targetSvc.issues(); track i.number) {
                <option [ngValue]="i.number">#{{ i.number }} — {{ i.title }}</option>
              }
            </select>
          </label>
        } @else {
          <p class="muted small">No open issues found for this repository.</p>
        }
      } @else {
        <p class="muted small">
          Showing demo target ({{ demoRepo.fullName }}, issue #{{ demoIssue.number }}).
          Search for a repository to score against a real one.
        </p>
      }
    </section>

    <section class="metrics">
      <div class="card">
        <span class="big">{{ match().percent }}%</span>
        Repository match
        <small>{{ targetSvc.repoName() ?? demoRepo.fullName + ' (demo)' }}</small>
      </div>
      <div class="card">
        <span class="big">{{ confidence().percent }}%</span>
        Contribution confidence
        <small>
          @if (targetSvc.issueSnapshot(); as i) {
            issue #{{ i.number }}
          } @else {
            issue #{{ demoIssue.number }} (demo)
          }
        </small>
      </div>
      <div class="card">
        <span class="big">{{ gapCoverage() }}%</span>
        Skill coverage
        <small>{{ gap().missing.length }} to learn</small>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Why this match</h2>
        <pre>{{ matchExplanation() }}</pre>
      </div>
      <div class="panel">
        <h2>Skill gap</h2>
        <ul>
          @for (skill of gap().recommendedOrder; track skill) {
            <li>{{ skill }}</li>
          } @empty {
            <li class="muted">No gaps for this target.</li>
          }
        </ul>
      </div>
    </section>
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
      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
        margin: 1.5rem 0;
      }
      .card {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem;
        background: var(--panel);
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .big {
        font-size: 2rem;
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 1rem;
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem;
        background: var(--panel);
      }
      pre {
        white-space: pre-wrap;
        font-size: 0.85rem;
      }
      .notice {
        margin: 1rem 0 0;
      }
      .notice.error {
        color: #f87171;
      }
      .profile {
        margin-top: 1.5rem;
      }
      .profile h2 {
        margin-top: 0;
      }
      .sub {
        color: var(--muted);
        margin: 0.75rem 0 0.35rem;
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
      .tag.ghost {
        color: var(--muted);
      }
      .readiness {
        margin-top: 1.5rem;
      }
      .readiness h2 {
        margin-top: 0;
      }
      .headline {
        display: flex;
        align-items: baseline;
        gap: 0.6rem;
        margin: 0;
      }
      .band {
        color: var(--muted);
        font-weight: 600;
      }
      .band[data-band='High'] {
        color: var(--good);
      }
      .band[data-band='Medium'] {
        color: var(--accent);
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
        grid-template-columns: 8.5rem 1fr auto;
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
      .tag.done {
        color: var(--good);
        border-color: var(--good);
      }
      .steps {
        margin: 0.35rem 0 0;
        padding-left: 1.1rem;
      }
      .small {
        font-size: 0.8rem;
      }
      .block {
        display: block;
      }
      .target {
        margin-top: 1.5rem;
      }
      .target h2 {
        margin-top: 0;
      }
      .target form {
        display: flex;
        gap: 0.5rem;
        margin: 0.5rem 0;
      }
      .target input {
        flex: 1;
        padding: 0.5rem 0.75rem;
        background: var(--panel);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      .target button[type='submit'] {
        padding: 0.5rem 1rem;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--accent);
        color: #06131f;
        font-weight: 600;
        cursor: pointer;
      }
      .results {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.25rem;
      }
      .link {
        background: none;
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--fg);
        text-align: left;
        padding: 0.5rem 0.7rem;
        cursor: pointer;
        width: 100%;
        display: grid;
        gap: 0.15rem;
      }
      .link.inline {
        display: inline;
        border: none;
        padding: 0 0.3rem;
        width: auto;
        color: var(--accent);
        text-decoration: underline;
      }
      .issue-pick {
        display: block;
        margin-top: 0.5rem;
        color: var(--muted);
      }
      .issue-pick select {
        display: block;
        margin-top: 0.25rem;
        max-width: 100%;
        padding: 0.4rem 0.6rem;
        background: var(--panel);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      @media (max-width: 560px) {
        .parts li {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class DashboardComponent {
  protected readonly demoRepo = DEMO_REPO;
  protected readonly demoIssue = DEMO_ISSUE;
  protected readonly profileSvc = inject(ProfileService);
  protected readonly targetSvc = inject(TargetService);
  protected searchText = '';

  protected runSearch(): void {
    void this.targetSvc.search(this.searchText);
  }

  protected pickRepo(slug: string): void {
    this.searchText = '';
    void this.targetSvc.selectRepo(slug);
  }

  protected pickIssue(issueNumber: number | null): void {
    if (issueNumber !== null) this.targetSvc.selectIssue(issueNumber);
  }

  /** Live target when chosen, else the demo fixtures. */
  private readonly repo = computed<RepositorySnapshot>(
    () => this.targetSvc.repoSnapshot() ?? DEMO_REPO,
  );
  private readonly issue = computed<IssueSnapshot>(
    () => this.targetSvc.issueSnapshot() ?? DEMO_ISSUE,
  );

  private readonly dev = computed<DeveloperSnapshot>(() => {
    const p = this.profileSvc.profile();
    return p ? profileToSnapshot(p, this.profileSvc.priorContributions()) : DEMO_DEV;
  });

  /** The loaded GitHub profile, flattened for the template. */
  protected readonly profile = computed(() => {
    const p = this.profileSvc.profile();
    if (!p) return null;
    return {
      displayName: p.identities.find((i) => i.provider === 'github')?.displayName ?? '',
      experienceLevel: p.experienceLevel,
      totalYears: p.totalYears,
      skills: [...p.skills].sort((a, b) => b.level - a.level),
      interests: p.interests,
    };
  });

  /** Target-free readiness on the merged profile; null until there is one. */
  protected readonly readiness = computed(() => {
    const p = this.profileSvc.profile();
    if (!p) return null;
    return contributionReadiness({
      profile: p,
      priorContributions: this.profileSvc.priorContributions(),
      hasCv: this.profileSvc.hasCv(),
    });
  });

  protected partLabel(key: string): string {
    return PART_LABELS[key] ?? key;
  }

  protected percent(level: number): number {
    return Math.round(level * 100);
  }

  protected readonly match = computed(() => repositoryMatch(this.dev(), this.repo()));
  protected readonly confidence = computed(() =>
    contributionConfidence(this.dev(), this.repo(), this.issue()),
  );
  protected readonly gap = computed(() => skillGap(this.dev(), this.repo().technologies));
  protected readonly gapCoverage = computed(() => Math.round(this.gap().coverage * 100));
  protected readonly matchExplanation = computed(() =>
    explain(this.match(), 'Repository Match'),
  );
}

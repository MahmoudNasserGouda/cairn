import { Component, computed, signal } from '@angular/core';
import {
  repositoryMatch,
  contributionConfidence,
  skillGap,
  type DeveloperSnapshot,
  type RepositorySnapshot,
  type IssueSnapshot,
} from '@osc/matching';
import { explain } from '@osc/scoring';

/** Demo profile until Phase 1 identity + CV flows are wired up. */
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

@Component({
  selector: 'osc-dashboard',
  standalone: true,
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

    <section class="metrics">
      <div class="card">
        <span class="big">{{ match().percent }}%</span>
        Repository match
        <small>{{ demoRepo.fullName }}</small>
      </div>
      <div class="card">
        <span class="big">{{ confidence().percent }}%</span>
        Contribution confidence
        <small>issue #{{ demoIssue.number }}</small>
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
    `,
  ],
})
export class DashboardComponent {
  protected readonly demoRepo = DEMO_REPO;
  protected readonly demoIssue = DEMO_ISSUE;

  private readonly dev = signal<DeveloperSnapshot>(DEMO_DEV);

  protected readonly match = computed(() => repositoryMatch(this.dev(), DEMO_REPO));
  protected readonly confidence = computed(() =>
    contributionConfidence(this.dev(), DEMO_REPO, DEMO_ISSUE),
  );
  protected readonly gap = computed(() => skillGap(this.dev(), DEMO_REPO.technologies));
  protected readonly gapCoverage = computed(() => Math.round(this.gap().coverage * 100));
  protected readonly matchExplanation = computed(() =>
    explain(this.match(), 'Repository Match'),
  );
}

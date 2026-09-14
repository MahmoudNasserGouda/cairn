import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  repositoryMatch,
  contributionConfidence,
  skillGap,
  type DeveloperSnapshot,
} from '@cairn/matching';
import { explain } from '@cairn/scoring';
import { contributionReadiness } from '@cairn/profile';
import { ProfileService, profileToSnapshot } from '../../core/profile/profile.service';
import { TargetService } from '../../core/targets/target.service';
import { ButtonComponent, CardComponent, SectionComponent, TagComponent } from '../../ui';
import { ReadinessPanelComponent } from './panels/readiness.panel';
import { TargetPanelComponent } from './panels/target.panel';
import { ScoresPanelComponent } from './panels/scores.panel';
import { IssueExplainerPanelComponent } from './panels/issue-explainer.panel';

/**
 * The dashboard (ADR-0032).
 *
 * It was 707 lines with template, styles and five panels' worth of logic in one file.
 * The container now owns the scores — everything derived from the profile and the
 * chosen target — and the panels render them. That split is what makes each panel
 * testable through its inputs, which was impossible until the Angular compiler joined
 * the test pipeline: signal inputs did not bind at all.
 *
 * Nothing here computes a score. `repositoryMatch`, `contributionConfidence`,
 * `skillGap` and `contributionReadiness` are the engines; this calls them and passes
 * what they return straight down.
 */
@Component({
  selector: 'cn-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    SectionComponent,
    TagComponent,
    ReadinessPanelComponent,
    TargetPanelComponent,
    ScoresPanelComponent,
    IssueExplainerPanelComponent,
  ],
  template: `
    <header class="head">
      <h1>Welcome back</h1>
      <p class="lead">
        Every number here is computed on this device from named signals. No model is
        involved, and each one shows its working.
      </p>
    </header>

    @if (profileSvc.error(); as err) {
      <p class="notice error" role="alert">
        Couldn't load your GitHub profile: {{ err }} Anything imported from other sources
        is still scored.
      </p>
    } @else if (profileSvc.loading()) {
      <p class="notice" role="status">Loading your GitHub profile…</p>
    }

    @if (profile(); as p) {
      <cn-section heading="Your profile" class="first">
        <a cn-button variant="ghost" size="sm" slot="actions" routerLink="/profile">
          Open your profile
        </a>
        <cn-card>
          <p class="sub">
            @if (p.displayName) {
              <strong>{{ p.displayName }}</strong> ·
            }
            {{ p.experienceLevel }} · ~{{ p.totalYears }} yrs ·
            @if (profileSvc.priorContributionsKnown()) {
              {{ profileSvc.priorContributions() }} merged PRs
            } @else {
              merged PRs unknown
            }
          </p>
          <div class="tags">
            @for (s of p.skills; track s.tag) {
              <cn-tag [source]="s.from.source"
                >{{ s.tag }} {{ percent(s.level) }}%</cn-tag
              >
            } @empty {
              <span class="hint">No skills yet.</span>
            }
          </div>
          @if (p.interests.length) {
            <h3>Interests</h3>
            <div class="tags">
              @for (t of p.interests; track t) {
                <cn-tag>{{ t }}</cn-tag>
              }
            </div>
          }
        </cn-card>
      </cn-section>
    }

    <div class="stack">
      <cn-readiness-panel
        [report]="readiness()"
        [trackRecordKnown]="profileSvc.priorContributionsKnown()"
      />

      <cn-target-panel />

      <cn-scores-panel
        [match]="match()"
        [confidence]="confidence()"
        [gap]="gap()"
        [explanation]="matchExplanation()"
        [repoName]="targetSvc.repoName()"
        [issueNumber]="targetSvc.issueNumber()"
        [hasProfile]="hasProfile()"
      />

      <cn-issue-explainer-panel />
    </div>
  `,
  styles: [
    `
      .head {
        margin-bottom: var(--space-5);
      }
      h1 {
        margin: 0;
      }
      .lead {
        margin: var(--space-2) 0 0;
        color: var(--fg-muted);
        max-width: var(--measure-prose);
      }
      .notice {
        margin: 0 0 var(--space-4);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .notice.error {
        color: var(--bad);
      }
      .first {
        margin-bottom: var(--space-8);
      }
      .stack {
        display: grid;
        gap: var(--space-8);
      }
      .sub {
        margin: 0 0 var(--space-3);
        color: var(--fg-muted);
        font-size: var(--text-sm);
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      h3 {
        margin: var(--space-4) 0 var(--space-2);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .hint {
        font-size: var(--text-sm);
        color: var(--fg-subtle);
      }
    `,
  ],
})
export class DashboardPageComponent {
  protected readonly profileSvc = inject(ProfileService);
  protected readonly targetSvc = inject(TargetService);

  /**
   * The developer being scored, or null when there is no profile yet. There is no
   * demo fallback: scoring a stranger against a fictional beginner and labelling the
   * result with their own percentages is worse than showing nothing.
   */
  private readonly dev = computed<DeveloperSnapshot | null>(() => {
    const p = this.profileSvc.profile();
    return p ? profileToSnapshot(p, this.profileSvc.priorContributions()) : null;
  });

  /** The loaded profile, flattened for the header card. */
  protected readonly profile = computed(() => {
    const p = this.profileSvc.profile();
    if (!p) return null;
    return {
      displayName: p.contact.name?.value ?? '',
      experienceLevel: p.experienceLevel.value,
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

  /** Scores need both halves: a real profile and a real target. */
  protected readonly match = computed(() => {
    const dev = this.dev();
    const repo = this.targetSvc.repoSnapshot();
    return dev && repo ? repositoryMatch(dev, repo) : null;
  });

  protected readonly confidence = computed(() => {
    const dev = this.dev();
    const repo = this.targetSvc.repoSnapshot();
    const issue = this.targetSvc.issueSnapshot();
    return dev && repo && issue ? contributionConfidence(dev, repo, issue) : null;
  });

  protected readonly gap = computed(() => {
    const dev = this.dev();
    const repo = this.targetSvc.repoSnapshot();
    return dev && repo ? skillGap(dev, repo.technologies) : null;
  });

  protected readonly hasProfile = computed(() => this.dev() !== null);

  protected readonly matchExplanation = computed(() => {
    const match = this.match();
    return match ? explain(match, 'Repository Match') : '';
  });

  protected percent(level: number): number {
    return Math.round(level * 100);
  }
}

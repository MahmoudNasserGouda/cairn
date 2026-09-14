import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProfileService } from '../../../core/profile/profile.service';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  SectionComponent,
  TagComponent,
} from '../../../ui';

/**
 * What GitHub observes directly, and no other source can claim.
 *
 * Everything else in the hub is something a person stated; these are counted. That is
 * why GitHub sits last in precedence on biography and alone on this — precedence never
 * comes up, because nothing else measures.
 */
@Component({
  selector: 'cn-profile-open-source',
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
      heading="Open source"
      description="Counted from your GitHub account, not asked for. These are the only
        numbers here that nobody typed."
    >
      @if (stats(); as s) {
        <div class="figures">
          @for (figure of s; track figure.label) {
            <cn-card>
              <p class="label">{{ figure.label }}</p>
              @if (figure.known) {
                <p class="value">{{ figure.value }}</p>
              } @else {
                <p class="unknown">couldn't check</p>
                <p class="why">{{ figure.why }}</p>
              }
            </cn-card>
          }
        </div>

        <p class="from">
          <cn-tag source="github">from</cn-tag>
          Refreshed whenever you load the app with GitHub connected.
        </p>
      } @else {
        <cn-empty-state
          headline="Nothing counted yet"
          detail="GitHub is the one source that measures rather than asks — languages by
            volume, merged pull requests, repositories you have contributed to."
        >
          <a cn-button routerLink="/profile/sources">Connect GitHub</a>
        </cn-empty-state>
      }
    </cn-section>
  `,
  styles: [
    `
      .figures {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: var(--space-3);
      }
      .label {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .value {
        margin: var(--space-2) 0 0;
        font-size: var(--text-3xl);
        font-weight: var(--weight-semibold);
        line-height: 1;
      }
      .unknown {
        margin: var(--space-2) 0 0;
        font-size: var(--text-lg);
        font-weight: var(--weight-medium);
        color: var(--warn);
      }
      .why {
        margin: var(--space-1) 0 0;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
      .from {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin: var(--space-4) 0 0;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
        flex-wrap: wrap;
      }
    `,
  ],
})
export class OpenSourceSectionComponent {
  private readonly profile = inject(ProfileService);

  protected readonly stats = computed(() => {
    const contributions = this.profile.profile()?.contributions;
    if (!contributions) return null;

    /**
     * `known: false` means the figure could not be measured, and it renders as
     * "couldn't check" rather than as a number. A GitHub throttle once made this
     * read as a track record of none, which is the opposite of true for exactly the
     * users most likely to hit it.
     */
    const known = contributions.known;
    return [
      {
        label: 'Merged pull requests',
        value: contributions.mergedPullRequests,
        known,
        why: 'GitHub did not answer that query. It is a rate limit, not a zero.',
      },
      {
        label: 'Repositories contributed to',
        value: contributions.repositoriesContributedTo,
        known,
        why: 'Same request, same limit.',
      },
      {
        label: 'Contributions this year',
        value: contributions.totalContributions,
        known: true,
        why: '',
      },
    ];
  });
}

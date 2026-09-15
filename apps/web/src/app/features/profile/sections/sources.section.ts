import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { ProviderId } from '@cairn/auth';
import { hasSource, type ProfileSource } from '@cairn/profile';
import { ProfileService } from '../../../core/profile/profile.service';
import { AuthService } from '../../../core/auth/auth.service';
import { SignInDialogService } from '../../../core/auth/sign-in-dialog.service';
import { CvImportComponent } from '../../../core/cv/cv-import.component';
import { LinkedinImportComponent } from '../../../core/linkedin/linkedin-import.component';
import {
  ButtonComponent,
  CardComponent,
  SectionComponent,
  TagComponent,
} from '../../../ui';

/**
 * Every source, on one page (ADR-0031, ADR-0032).
 *
 * CV and archive import used to *be* the profile page, with a summary bolted
 * underneath. They are two of four inputs, and this is where inputs belong — the rest
 * of the hub is about what the profile says, not where it came from.
 *
 * Every source can be taken back out. Removal is a demotion rather than a delete: a
 * field a source won falls back to what the others still say, and a hand edit is never
 * touched, because at that point it is the user's and not the importer's.
 */
@Component({
  selector: 'cn-profile-sources',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    SectionComponent,
    TagComponent,
    CvImportComponent,
    LinkedinImportComponent,
  ],
  template: `
    <cn-section
      heading="Where your profile comes from"
      description="Merged into one profile. When two disagree, what you typed wins,
        then LinkedIn, then your CV, then whatever measures your code — and every field
        shows which one it came from."
    >
      <cn-card>
        <ul class="sources">
          @for (source of summary(); track source.key) {
            <li>
              <cn-tag [source]="source.key">from</cn-tag>
              <div class="what">
                <p class="name">{{ source.name }}</p>
                <p class="state">{{ source.state }}</p>
              </div>
              @if (source.connect; as provider) {
                @if (auth.hasIdentity(provider)) {
                  <button
                    cn-button
                    variant="quiet"
                    size="sm"
                    (click)="auth.signOut(provider)"
                  >
                    Disconnect
                  </button>
                } @else {
                  <button cn-button variant="ghost" size="sm" (click)="signIn.show()">
                    Connect
                  </button>
                }
              }
            </li>
          }
        </ul>
      </cn-card>
    </cn-section>

    <div class="importers">
      <cn-cv-import />
      <cn-linkedin-import />
    </div>
  `,
  styles: [
    `
      .sources {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-4);
      }
      .sources li {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
      }
      .what {
        flex: 1 1 auto;
        min-width: 0;
      }
      .name {
        margin: 0;
        font-weight: var(--weight-medium);
        font-size: var(--text-sm);
      }
      .state {
        margin: 2px 0 0;
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .importers {
        margin-top: var(--space-8);
        display: grid;
        gap: var(--space-5);
      }
    `,
  ],
})
export class SourcesSectionComponent {
  protected readonly profile = inject(ProfileService);
  protected readonly auth = inject(AuthService);
  protected readonly signIn = inject(SignInDialogService);

  protected readonly connected = computed(() => this.auth.hasIdentity('github'));

  /**
   * GitLab appears only where a deployment has registered an OAuth application
   * (ADR-0034). A row offering a connection that cannot be made is worse than no row:
   * it reads as broken rather than as unconfigured.
   */
  private readonly gitlabOffered = this.auth.dataProviders.some((p) => p.id === 'gitlab');

  protected readonly summary = computed<
    {
      key: ProfileSource;
      name: string;
      state: string;
      /** The provider this row connects, when it is a connection rather than a file. */
      connect?: ProviderId;
    }[]
  >(() => {
    const p = this.profile.profile();
    const contributing = (source: ProfileSource): boolean =>
      p !== null && hasSource(p, source);

    return [
      {
        key: 'manual',
        name: 'What you typed',
        state: contributing('manual')
          ? 'Contributing. Nothing overwrites it.'
          : 'Nothing yet — every field on this page is editable.',
      },
      {
        key: 'linkedin',
        name: 'LinkedIn archive',
        state: contributing('linkedin')
          ? 'Imported.'
          : 'Not imported. The ZIP LinkedIn emails you, read below.',
      },
      {
        key: 'cv',
        name: 'Your CV',
        state: contributing('cv') ? 'Imported.' : 'Not imported.',
      },
      {
        key: 'github',
        name: 'GitHub',
        connect: 'github',
        state: this.connected()
          ? 'Connected. Languages, contributions and pinned repositories.'
          : 'Not connected. It measures your code rather than asking you about it.',
      },
      ...(this.gitlabOffered
        ? [
            {
              key: 'gitlab' as const,
              name: 'GitLab',
              connect: 'gitlab' as const,
              state: this.auth.hasIdentity('gitlab')
                ? 'Connected. Projects and their language breakdowns.'
                : 'Not connected. Sits beside GitHub, not above it.',
            },
          ]
        : []),
    ];
  });
}

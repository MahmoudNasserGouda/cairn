import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { linkKey, type ContactField, type ProfileLink } from '@cairn/profile';
import { EXPERIENCE_RANK, type ExperienceLevel } from '@cairn/shared';
import { ProfileService } from '../../../core/profile/profile.service';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AvatarComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  SectionComponent,
  TagComponent,
} from '../../../ui';
import { EditableTextComponent } from '../editable-text.component';

const LEVELS = Object.keys(EXPERIENCE_RANK) as ExperienceLevel[];

@Component({
  selector: 'cn-profile-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    AvatarComponent,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    SectionComponent,
    TagComponent,
    EditableTextComponent,
  ],
  template: `
    @if (profile.profile(); as p) {
      <cn-section
        heading="About you"
        description="Click any value to change it. What you type outranks every import
          and is never overwritten."
      >
        <cn-card>
          <div class="identity">
            <cn-avatar
              [name]="p.contact.name?.value ?? 'You'"
              [src]="avatarUrl()"
              size="lg"
            />
            <div class="fields">
              <cn-editable-text
                label="Name"
                [value]="p.contact.name?.value ?? ''"
                [source]="p.contact.name?.from?.source ?? null"
                placeholder="Your name"
                (changed)="setContact('name', $event)"
              />
              <cn-editable-text
                label="Headline"
                [value]="p.contact.headline?.value ?? ''"
                [source]="p.contact.headline?.from?.source ?? null"
                placeholder="One line about what you do"
                (changed)="setContact('headline', $event)"
              />
              <cn-editable-text
                label="Location"
                [value]="p.contact.location?.value ?? ''"
                [source]="p.contact.location?.from?.source ?? null"
                placeholder="City, country"
                (changed)="setContact('location', $event)"
              />
              <cn-editable-text
                label="About"
                multiline
                [value]="p.contact.summary?.value ?? ''"
                [source]="p.contact.summary?.from?.source ?? null"
                placeholder="A paragraph in your own words"
                (changed)="setContact('summary', $event)"
              />
            </div>
          </div>
        </cn-card>
      </cn-section>

      <cn-section heading="Experience level" class="stacked">
        <cn-card>
          <p class="derived">
            Derived from {{ p.totalYears }} years of dated roles.
            <cn-tag [source]="p.experienceLevel.from.source">from</cn-tag>
          </p>
          <div class="levels" role="group" aria-label="Experience level">
            @for (level of levels; track level) {
              <button
                cn-button
                size="sm"
                [variant]="level === p.experienceLevel.value ? 'primary' : 'ghost'"
                [attr.aria-pressed]="level === p.experienceLevel.value"
                (click)="setLevel(level)"
              >
                {{ level }}
              </button>
            }
          </div>
          <p class="hint">
            Set it yourself if your history started before anything here can see it.
          </p>
        </cn-card>
      </cn-section>

      <cn-section
        heading="Links"
        description="Where else you can be found."
        class="stacked"
      >
        @if (p.links.length) {
          <ul class="links">
            @for (link of p.links; track keyOf(link)) {
              <li>
                <a [href]="link.url" target="_blank" rel="noopener noreferrer">
                  {{ link.url }}
                </a>
                <cn-tag [source]="link.from.source">from</cn-tag>
                <button cn-button variant="quiet" size="sm" (click)="removeLink(link)">
                  Remove
                </button>
              </li>
            }
          </ul>
        } @else {
          <cn-empty-state
            headline="No links"
            detail="Connecting GitHub adds your profile and any social accounts you have
              listed there."
            compact
          />
        }
      </cn-section>

      <cn-section heading="Email addresses" class="stacked">
        @if (p.contact.emails.length) {
          <ul class="emails">
            @for (email of p.contact.emails; track email.value) {
              <li>
                {{ email.value }}
                <cn-tag [source]="email.from.source">from</cn-tag>
              </li>
            }
          </ul>
        } @else {
          <cn-empty-state headline="No email addresses" compact />
        }
      </cn-section>
    } @else {
      <cn-empty-state
        headline="Nothing here yet"
        detail="Rujoom builds one profile from GitHub, your CV, a LinkedIn archive and
          whatever you type. Start with any of them."
      >
        <a cn-button routerLink="/profile/sources">Connect a source</a>
      </cn-empty-state>
    }
  `,
  styles: [
    `
      .stacked {
        margin-top: var(--space-8);
      }
      .identity {
        display: flex;
        gap: var(--space-5);
        align-items: flex-start;
      }
      .fields {
        display: grid;
        gap: var(--space-2);
        flex: 1 1 auto;
        min-width: 0;
      }
      .derived {
        margin: 0 0 var(--space-3);
        font-size: var(--text-sm);
        color: var(--fg-muted);
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .levels {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .hint {
        margin: var(--space-3) 0 0;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
      .links,
      .emails {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-2);
      }
      .links li,
      .emails li {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex-wrap: wrap;
        min-width: 0;
      }
      .links a {
        overflow-wrap: anywhere;
      }

      @media (max-width: 36rem) {
        .identity {
          flex-direction: column;
          gap: var(--space-4);
        }
      }
    `,
  ],
})
export class OverviewSectionComponent {
  protected readonly profile = inject(ProfileService);
  private readonly auth = inject(AuthService);

  protected readonly levels = LEVELS;

  /**
   * Only GitHub's avatar can load: `img-src` allows `avatars.githubusercontent.com`
   * and nothing else (ADR-0019), so a LinkedIn or Google picture would be blocked and
   * `cn-avatar` would fall back to initials anyway. Asking for it would just be a
   * blocked request in the console.
   */
  protected readonly avatarUrl = computed(
    () => this.auth.identities().find((i) => i.provider === 'github')?.avatarUrl ?? null,
  );

  protected keyOf = linkKey;

  protected async setContact(field: ContactField, value: string): Promise<void> {
    await this.profile.edit({ kind: 'contact', field, value });
  }

  protected async setLevel(value: ExperienceLevel): Promise<void> {
    await this.profile.edit({ kind: 'experience-level', value });
  }

  protected async removeLink(link: ProfileLink): Promise<void> {
    await this.profile.edit({ kind: 'remove', key: linkKey(link) });
  }
}

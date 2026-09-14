import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProfileService } from '../../core/profile/profile.service';
import { CardComponent } from '../../ui';
import { PROFILE_SECTIONS } from './sections';

/**
 * The profile hub (ADR-0032).
 *
 * `/profile` was a CV uploader with a summary panel bolted underneath — the thing the
 * whole product is built on, rendered as an import form. It is now seven sections with
 * their own URLs, so a section can be linked, bookmarked, and reached with the back
 * button.
 *
 * The container owns almost nothing: the sub-navigation, a one-line state of the
 * profile, and an outlet. Each section injects `ProfileService` itself rather than
 * receiving the profile through inputs, because they all want different slices of it
 * and threading one object through seven components would be ceremony, not structure.
 */
@Component({
  selector: 'cn-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CardComponent],
  template: `
    <header class="head">
      <h1>Your profile</h1>
      <p class="lead">{{ summary() }}</p>
      @if (profile.unreadable()) {
        <cn-card class="warning" role="alert">
          <strong>A stored profile could not be read.</strong>
          It has been left exactly where it is rather than overwritten, so nothing is
          lost. Anything you do here starts from an empty profile.
        </cn-card>
      }
      @if (profile.error(); as message) {
        <cn-card class="warning" role="alert">
          <strong>GitHub did not answer:</strong> {{ message }} Everything imported from
          other sources is still here.
        </cn-card>
      }
    </header>

    <nav class="sections" aria-label="Profile sections">
      <ul>
        @for (section of sections; track section.path) {
          <li>
            <a
              [routerLink]="section.path"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
            >
              {{ section.label }}
            </a>
          </li>
        }
      </ul>
    </nav>

    <router-outlet />
  `,
  styles: [
    `
      :host {
        display: block;
      }
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
      .warning {
        margin-top: var(--space-4);
        border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
        font-size: var(--text-sm);
      }

      .sections {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        margin-bottom: var(--space-6);
      }
      .sections ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        gap: var(--space-1);
        overflow-x: auto;
        /* The tabs scroll sideways on a phone rather than wrapping into three rows
           that push the content off the screen. */
        scrollbar-width: none;
      }
      .sections ul::-webkit-scrollbar {
        display: none;
      }
      .sections a {
        display: block;
        padding: var(--space-3) var(--space-3);
        color: var(--fg-muted);
        text-decoration: none;
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
        white-space: nowrap;
        border-bottom: 2px solid transparent;
      }
      .sections a:hover {
        color: var(--fg);
      }
      .sections a.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }
    `,
  ],
})
export class ProfilePageComponent {
  protected readonly profile = inject(ProfileService);
  protected readonly sections = PROFILE_SECTIONS;

  /** One line saying what the profile currently is, so the page has a state. */
  protected readonly summary = computed(() => {
    const p = this.profile.profile();
    if (this.profile.loading()) return 'Loading your GitHub profile…';
    if (!p) {
      return 'One profile, built from GitHub, your CV, a LinkedIn archive and whatever you type. Nothing here yet.';
    }
    const skills = p.skills.length;
    const roles = p.experience.length;
    return (
      `${p.experienceLevel.value} · ~${p.totalYears} years · ` +
      `${skills} ${skills === 1 ? 'skill' : 'skills'} · ` +
      `${roles} ${roles === 1 ? 'role' : 'roles'}`
    );
  });
}

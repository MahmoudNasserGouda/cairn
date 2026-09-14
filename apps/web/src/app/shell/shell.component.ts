import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { SignInDialogService } from '../core/auth/sign-in-dialog.service';
import { AvatarComponent, ButtonComponent, LogoComponent, SheetComponent } from '../ui';
import { PRIMARY_NAV, SETTINGS_NAV } from './nav';

/**
 * The application shell (ADR-0032).
 *
 * A sidebar, where there used to be a five-item top bar. The reason is not fashion: a
 * horizontal strip has a hard ceiling on destinations, and this product has more
 * coming — additional sources, the architecture explorer, the contribution navigator.
 * A sidebar also has room for a line of explanation under each destination, which a
 * top bar never does, and "Discover" means nothing on its own.
 *
 * Under 768px it becomes a **bottom bar**, which is where a thumb is, with Settings
 * and the account behind a "More" sheet. The two navs are the same list from
 * `nav.ts` rendered twice; only one is ever in the accessibility tree, because the
 * hidden one is `display: none` rather than visually hidden.
 *
 * Accessibility is a gate here, not a pass (`docs/design-system.md`): a skip link
 * ahead of the nav, `aria-current="page"` on the active destination, one `<main>`
 * landmark, and the "More" sheet inherits `cn-sheet`'s focus trap and Escape.
 */
@Component({
  selector: 'cn-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AvatarComponent,
    ButtonComponent,
    LogoComponent,
    SheetComponent,
  ],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>

    <div class="shell">
      <aside class="sidebar">
        <a class="brand" routerLink="/dashboard">
          <cn-logo [size]="26" />
          <span>Rujoom</span>
        </a>

        <nav class="primary" aria-label="Primary">
          <ul>
            @for (item of primary; track item.path) {
              <li>
                <a
                  [routerLink]="item.path"
                  routerLinkActive="active"
                  ariaCurrentWhenActive="page"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      [attr.d]="item.icon"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span class="label">
                    {{ item.label }}
                    <span class="hint">{{ item.hint }}</span>
                  </span>
                </a>
              </li>
            }
          </ul>
        </nav>

        <div class="foot">
          <a
            class="settings"
            [routerLink]="settings.path"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                [attr.d]="settings.icon"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="label">{{ settings.label }}</span>
          </a>

          <div class="account">
            @if (auth.isSignedIn()) {
              @if (auth.primaryIdentity(); as who) {
                <button type="button" class="who" (click)="dialog.show()">
                  <cn-avatar [name]="who.displayName" [src]="who.avatarUrl" size="sm" />
                  <span class="name">{{ who.displayName }}</span>
                </button>
              }
              <button cn-button variant="quiet" size="sm" (click)="auth.signOut()">
                Sign out
              </button>
            } @else if (auth.status() === 'authenticating') {
              <p class="note" role="status">Signing in…</p>
            } @else if (auth.availableProviders.length > 0) {
              <button cn-button variant="ghost" size="sm" block (click)="dialog.show()">
                Sign in
              </button>
            } @else {
              <p class="note">
                Sign-in is not configured — set the OAuth client ids in
                <code>libs/shared</code>.
              </p>
            }
          </div>
        </div>
      </aside>

      <main id="main" tabindex="-1"><router-outlet /></main>
    </div>

    <nav class="bottombar" aria-label="Primary">
      @for (item of primary; track item.path) {
        <a
          [routerLink]="item.path"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              [attr.d]="item.icon"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>{{ item.label }}</span>
        </a>
      }
      <button type="button" class="more" (click)="moreOpen.set(true)">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M5 12h.01M12 12h.01M19 12h.01"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          />
        </svg>
        <span>More</span>
      </button>
    </nav>

    <cn-sheet [(open)]="moreOpen" heading="More" side="bottom">
      <div class="more-body">
        <a
          cn-button
          variant="ghost"
          block
          [routerLink]="settings.path"
          (click)="moreOpen.set(false)"
        >
          {{ settings.label }}
        </a>

        @if (auth.isSignedIn()) {
          @if (auth.primaryIdentity(); as who) {
            <p class="who-line">
              <cn-avatar [name]="who.displayName" [src]="who.avatarUrl" size="sm" />
              <span>{{ who.displayName }}</span>
            </p>
          }
          <button cn-button variant="quiet" block (click)="signOutFromSheet()">
            Sign out
          </button>
        } @else if (auth.availableProviders.length > 0) {
          <button cn-button block (click)="signInFromSheet()">Sign in</button>
        }
      </div>
    </cn-sheet>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .shell {
        display: grid;
        grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
        min-height: 100dvh;
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        padding: var(--space-4);
        border-right: 1px solid var(--border);
        background: var(--surface);
        position: sticky;
        top: 0;
        height: 100dvh;
        overflow-y: auto;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-weight: var(--weight-bold);
        font-size: var(--text-lg);
        letter-spacing: -0.02em;
        color: var(--fg);
        text-decoration: none;
        padding: var(--space-1);
      }

      nav ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-1);
      }

      .primary a,
      .settings {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        color: var(--fg-muted);
        text-decoration: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        .primary a,
        .settings {
          transition:
            background-color var(--dur-fast) var(--ease),
            color var(--dur-fast) var(--ease);
        }
      }
      .primary a:hover,
      .settings:hover {
        background: var(--surface-sunken);
        color: var(--fg);
      }
      .primary a.active,
      .settings.active {
        background: var(--accent-soft);
        color: var(--accent);
      }
      .primary svg,
      .settings svg {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        margin-top: 2px;
      }
      .label {
        display: flex;
        flex-direction: column;
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
        min-width: 0;
      }
      /* The line a top bar never had room for. */
      .hint {
        font-size: var(--text-xs);
        font-weight: var(--weight-normal);
        color: var(--fg-subtle);
        line-height: 1.35;
        margin-top: 1px;
      }
      .primary a.active .hint {
        color: color-mix(in srgb, var(--accent) 70%, var(--fg-subtle));
      }

      .foot {
        margin-top: auto;
        display: grid;
        gap: var(--space-3);
        border-top: 1px solid var(--border);
        padding-top: var(--space-3);
      }
      .account {
        display: grid;
        gap: var(--space-2);
      }
      .who {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-1);
        border: 0;
        border-radius: var(--radius-md);
        background: none;
        color: var(--fg);
        font: inherit;
        font-size: var(--text-sm);
        cursor: pointer;
        text-align: left;
        min-width: 0;
      }
      .who:hover {
        background: var(--surface-sunken);
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .note {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
      code {
        font-family: var(--font-mono);
        font-size: 0.95em;
      }

      main {
        padding: var(--space-6) var(--space-5) var(--space-12);
        max-width: var(--measure-wide);
        width: 100%;
      }
      main:focus {
        outline: none;
      }

      .bottombar {
        display: none;
      }

      /* ------------------------------------------------------------------
       * Under 768px the sidebar becomes a bottom bar — which is where a
       * thumb is. Settings and the account move into a sheet rather than
       * spending one of the four slots on something you visit twice.
       * ---------------------------------------------------------------- */
      @media (max-width: 47.99rem) {
        .shell {
          grid-template-columns: minmax(0, 1fr);
          /* Two rows now, not two columns, and the 100dvh minimum would otherwise
             stretch both of them equally — giving the brand bar a third of the
             screen. The bar takes what it needs; content takes the rest. */
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sidebar {
          position: static;
          height: auto;
          flex-direction: row;
          align-items: center;
          gap: var(--space-3);
          border-right: 0;
          border-bottom: 1px solid var(--border);
          padding: var(--space-3) var(--space-4);
        }
        .sidebar .primary,
        .sidebar .foot {
          display: none;
        }
        main {
          padding: var(--space-5) var(--space-4);
          /* Clear the bottom bar, plus whatever the device puts below it. */
          padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
        }

        .bottombar {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          position: fixed;
          inset: auto 0 0 0;
          z-index: 20;
          background: var(--surface);
          border-top: 1px solid var(--border);
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .bottombar a,
        .bottombar .more {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: var(--space-2) var(--space-1);
          border: 0;
          background: none;
          font: inherit;
          font-size: var(--text-xs);
          color: var(--fg-subtle);
          text-decoration: none;
          cursor: pointer;
          min-height: 3.25rem;
        }
        .bottombar a.active {
          color: var(--accent);
        }
        .bottombar svg {
          width: 20px;
          height: 20px;
        }
      }

      .more-body {
        display: grid;
        gap: var(--space-3);
      }
      .who-line {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin: 0;
        font-size: var(--text-sm);
      }
    `,
  ],
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly dialog = inject(SignInDialogService);

  protected readonly primary = PRIMARY_NAV;
  protected readonly settings = SETTINGS_NAV;
  protected readonly moreOpen = signal(false);

  /**
   * Close the sheet before opening the sign-in dialog.
   *
   * Two modals at once is a focus trap fighting a focus trap: whichever installs
   * second wins the keyboard, and Escape closes the wrong one.
   */
  protected signInFromSheet(): void {
    this.moreOpen.set(false);
    this.dialog.show();
  }

  protected signOutFromSheet(): void {
    this.moreOpen.set(false);
    this.auth.signOut();
  }
}

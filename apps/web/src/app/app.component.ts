import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { SignInDialogComponent } from './core/auth/sign-in-dialog.component';
import { SignInDialogService } from './core/auth/sign-in-dialog.service';

@Component({
  selector: 'cn-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SignInDialogComponent],
  template: `
    <header class="topbar">
      <span class="brand">
        <img src="favicon.svg" alt="" width="22" height="22" />
        Cairn
      </span>
      <nav>
        <a routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
        <a routerLink="/repositories" routerLinkActive="active">Repositories</a>
      </nav>

      <div class="account">
        @if (auth.isSignedIn()) {
          @if (auth.primaryIdentity(); as who) {
            <button type="button" class="who" (click)="dialog.show()">
              @if (who.avatarUrl) {
                <img class="avatar" [src]="who.avatarUrl" alt="" width="24" height="24" />
              }
              {{ who.displayName }}
            </button>
          }
          <button type="button" class="link-btn" (click)="auth.signOut()">
            Sign out
          </button>
        } @else if (auth.status() === 'authenticating') {
          <span class="muted">Signing in…</span>
        } @else if (auth.availableProviders.length > 0) {
          <button type="button" class="signin" (click)="dialog.show()">Sign in</button>
        } @else {
          <span class="muted" title="Set the OAuth client IDs in libs/shared config">
            Sign-in not configured
          </span>
        }
      </div>

      <a class="support" href="https://github.com/sponsors" rel="noopener noreferrer"
        >Sponsor</a
      >
    </header>
    <main><router-outlet /></main>
    <cn-sign-in-dialog />
  `,
  styles: [
    `
      .topbar {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 0.75rem 1.25rem;
        border-bottom: 1px solid var(--border);
        background: var(--panel);
      }
      .brand {
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
      .brand img {
        display: block;
      }
      nav {
        display: flex;
        gap: 1rem;
      }
      nav a {
        color: var(--muted);
        text-decoration: none;
      }
      nav a.active {
        color: var(--fg);
      }
      .account {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.9rem;
      }
      .who {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        color: var(--fg);
        font: inherit;
        cursor: pointer;
        border: 0;
        background: none;
        padding: 0;
      }
      .avatar {
        border-radius: 50%;
        display: block;
      }
      .muted {
        color: var(--muted);
      }
      .signin {
        font: inherit;
        cursor: pointer;
        padding: 0.4rem 0.8rem;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--bg);
        color: var(--fg);
      }
      .link-btn {
        font: inherit;
        cursor: pointer;
        border: 0;
        background: none;
        color: var(--muted);
        padding: 0;
      }
      .link-btn:hover {
        color: var(--fg);
      }
      .support {
        font-size: 0.85rem;
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 1.5rem 1.25rem 4rem;
      }
    `,
  ],
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  protected readonly dialog = inject(SignInDialogService);
}

import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'cn-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
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
      <a class="support" href="https://github.com/sponsors" rel="noopener noreferrer"
        >Sponsor</a
      >
    </header>
    <main><router-outlet /></main>
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
      .support {
        margin-left: auto;
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
export class AppComponent {}

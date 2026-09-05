import { Component, type ElementRef, effect, inject, viewChild } from '@angular/core';
import { AuthService } from './auth.service';
import { SignInDialogService } from './sign-in-dialog.service';

/**
 * Modal sign-in. Keeps the nav bar to a single button and makes the
 * data-vs-identity distinction explicit (ADR-0025): GitHub is a data connection,
 * LinkedIn / Google are sign-in only.
 */
@Component({
  selector: 'cn-sign-in-dialog',
  standalone: true,
  template: `
    @if (dialog.open()) {
      <div class="backdrop" (click)="onBackdrop($event)">
        <div
          #panel
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cn-signin-title"
          (keydown)="onKeydown($event)"
        >
          <button
            #closeBtn
            type="button"
            class="close"
            aria-label="Close"
            (click)="dialog.hide()"
          >
            &times;
          </button>
          <h2 id="cn-signin-title">
            {{ auth.isSignedIn() ? 'Your accounts' : 'Sign in to Cairn' }}
          </h2>

          @if (auth.error(); as message) {
            <p class="error" role="alert">{{ message }}</p>
          }

          @if (auth.availableProviders.length === 0) {
            <p class="muted">Sign-in isn't configured for this deployment yet.</p>
          }

          @if (auth.dataProvider; as gh) {
            <section class="group">
              <h3>Connect your work</h3>
              <p class="muted">
                Cairn reads your public repositories and contribution history from
                {{ gh.label }} — this is where your profile and project matches come from.
              </p>
              @if (auth.identityFor(gh.id); as who) {
                <p class="connected">
                  <span class="dot"></span> Connected as {{ who.displayName }}
                </p>
                <button type="button" class="link" (click)="auth.signOut(gh.id)">
                  Disconnect {{ gh.label }}
                </button>
              } @else {
                <button
                  type="button"
                  class="provider primary"
                  (click)="auth.signIn(gh.id)"
                >
                  Continue with {{ gh.label }}
                </button>
              }
            </section>
          }

          @if (auth.identityProviders.length > 0) {
            <section class="group">
              <h3>Faster sign-in <span class="opt">optional</span></h3>
              <p class="muted">
                Use these only to sign in. Cairn receives your name, email, and photo —
                nothing else, and no repositories or job history. (LinkedIn has no API for
                work history; add that with a CV upload.)
              </p>
              @for (p of auth.identityProviders; track p.id) {
                @if (auth.identityFor(p.id); as who) {
                  <p class="connected">
                    <span class="dot"></span> {{ p.label }} · {{ who.displayName }}
                    <button type="button" class="link" (click)="auth.signOut(p.id)">
                      Disconnect
                    </button>
                  </p>
                } @else {
                  <button type="button" class="provider" (click)="auth.signIn(p.id)">
                    Sign in with {{ p.label }}
                  </button>
                }
              }
            </section>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        z-index: 100;
      }
      .panel {
        position: relative;
        width: 100%;
        max-width: 24rem;
        max-height: calc(100vh - 2rem);
        overflow-y: auto;
        background: var(--panel);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 1.5rem;
      }
      .close {
        position: absolute;
        top: 0.5rem;
        right: 0.6rem;
        font: inherit;
        font-size: 1.4rem;
        line-height: 1;
        background: none;
        border: 0;
        color: var(--muted);
        cursor: pointer;
      }
      .close:hover {
        color: var(--fg);
      }
      h2 {
        margin: 0 0 1rem;
        font-size: 1.15rem;
      }
      h3 {
        margin: 0 0 0.3rem;
        font-size: 0.95rem;
      }
      .group {
        border-top: 1px solid var(--border);
        padding-top: 1rem;
        margin-top: 1rem;
      }
      .group:first-of-type {
        border-top: 0;
        padding-top: 0;
        margin-top: 0;
      }
      .muted {
        color: var(--muted);
        font-size: 0.85rem;
        margin: 0 0 0.75rem;
      }
      .opt {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--muted);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0 0.3rem;
        vertical-align: middle;
      }
      .provider {
        display: block;
        width: 100%;
        font: inherit;
        cursor: pointer;
        padding: 0.6rem 0.9rem;
        border-radius: 9px;
        border: 1px solid var(--border);
        background: var(--bg);
        color: var(--fg);
        margin-bottom: 0.5rem;
      }
      .provider.primary {
        border-color: var(--accent);
        color: var(--accent);
        font-weight: 600;
      }
      .provider:hover {
        border-color: var(--accent);
      }
      .connected {
        font-size: 0.85rem;
        margin: 0 0 0.4rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: var(--good);
        display: inline-block;
      }
      .link {
        font: inherit;
        font-size: 0.8rem;
        background: none;
        border: 0;
        color: var(--muted);
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
      }
      .link:hover {
        color: var(--fg);
      }
      .error {
        color: #f87171;
        font-size: 0.85rem;
        margin: 0 0 1rem;
      }
    `,
  ],
})
export class SignInDialogComponent {
  protected readonly auth = inject(AuthService);
  protected readonly dialog = inject(SignInDialogService);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    // Surface redirect-callback errors in context.
    effect(() => {
      if (this.auth.status() === 'error') this.dialog.show();
    });

    // Move focus into the dialog on open, restore it on close.
    effect(() => {
      if (this.dialog.open()) {
        this.returnFocusTo =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => this.closeBtn()?.nativeElement.focus());
      } else if (this.returnFocusTo !== null) {
        this.returnFocusTo.focus();
        this.returnFocusTo = null;
      }
    });
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.dialog.hide();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.dialog.hide();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = this.panel()?.nativeElement;
    if (panel === undefined) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    const firstEl = focusable.item(0);
    const lastEl = focusable.item(focusable.length - 1);
    if (firstEl === null || lastEl === null) return;

    const active = document.activeElement;
    if (event.shiftKey && active === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && active === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  }
}

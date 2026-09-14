import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from './auth.service';
import { SignInDialogService } from './sign-in-dialog.service';
import { ButtonComponent, SheetComponent } from '../../ui';

/**
 * Modal sign-in (ADR-0025).
 *
 * It makes the data-vs-identity distinction explicit: GitHub is a **data connection**
 * — it is where the profile and the matches come from — while LinkedIn and Google are
 * sign-in only, and the copy says so rather than offering three equivalent buttons.
 *
 * This component used to carry its own backdrop, focus trap, Escape handler and focus
 * restore. `cn-sheet` is that behaviour extracted (ADR-0032), so all of it is gone
 * from here — which was the point of extracting it. The open/closed state still lives
 * in `SignInDialogService`, because other components open this dialog.
 */
@Component({
  selector: 'cn-sign-in-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, SheetComponent],
  template: `
    <cn-sheet
      [(open)]="open"
      [heading]="auth.isSignedIn() ? 'Your accounts' : 'Sign in to Rujoom'"
    >
      <!--
        Guarded, because projected content lives in *this* view: ng-content nodes are
        created by the parent, so every binding below would evaluate on each change
        detection whether or not the sheet is showing.
      -->
      @if (open()) {
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
              Rujoom reads your public repositories and contribution history from
              {{ gh.label }} — this is where your profile and project matches come from.
            </p>
            @if (auth.identityFor(gh.id); as who) {
              <p class="connected">
                <span class="dot"></span> Connected as {{ who.displayName }}
              </p>
              <button cn-button variant="quiet" size="sm" (click)="auth.signOut(gh.id)">
                Disconnect {{ gh.label }}
              </button>
            } @else {
              <button cn-button block (click)="auth.signIn(gh.id)">
                Continue with {{ gh.label }}
              </button>
            }
          </section>
        }

        @if (auth.identityProviders.length > 0) {
          <section class="group">
            <h3>Faster sign-in <span class="opt">optional</span></h3>
            <p class="muted">
              Use these only to sign in. Rujoom receives your name, email, and photo —
              nothing else, and no repositories or job history. (LinkedIn has no API for
              work history; add that with a CV upload.)
            </p>
            @for (p of auth.identityProviders; track p.id) {
              @if (auth.identityFor(p.id); as who) {
                <p class="connected">
                  <span class="dot"></span> {{ p.label }} · {{ who.displayName }}
                  <button
                    cn-button
                    variant="quiet"
                    size="sm"
                    (click)="auth.signOut(p.id)"
                  >
                    Disconnect
                  </button>
                </p>
              } @else {
                <button cn-button variant="ghost" block (click)="auth.signIn(p.id)">
                  Sign in with {{ p.label }}
                </button>
              }
            }
          </section>
        }
      }
    </cn-sheet>
  `,
  styles: [
    `
      .group + .group {
        margin-top: var(--space-6);
        padding-top: var(--space-5);
        border-top: 1px solid var(--border);
      }
      h3 {
        margin: 0 0 var(--space-2);
        font-size: var(--text-sm);
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
      }
      .opt {
        font-size: var(--text-xs);
        font-weight: var(--weight-normal);
        color: var(--fg-subtle);
      }
      .muted {
        color: var(--fg-muted);
        font-size: var(--text-sm);
        margin: 0 0 var(--space-4);
      }
      .error {
        color: var(--bad);
        font-size: var(--text-sm);
      }
      .connected {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin: 0 0 var(--space-2);
        font-size: var(--text-sm);
        flex-wrap: wrap;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: var(--radius-full);
        background: var(--good);
        flex: 0 0 auto;
      }
      section button[cn-button] + button[cn-button] {
        margin-top: var(--space-2);
      }
    `,
  ],
})
export class SignInDialogComponent {
  protected readonly auth = inject(AuthService);
  protected readonly dialog = inject(SignInDialogService);

  /**
   * Mirrors the service's state into something `cn-sheet` can write back to.
   *
   * The sheet closes itself on Escape and on a backdrop click, so it needs a writable
   * signal; the service stays the source of truth because other components open this
   * dialog. Two one-directional effects rather than one that would fight itself.
   */
  protected readonly open = signal(false);

  constructor() {
    effect(() => this.open.set(this.dialog.open()));
    effect(() => {
      // Only when the sheet closed *itself* — Escape, the backdrop, its close button.
      // Without the second half this fires on init, telling the service to hide a
      // dialog that was never shown.
      if (!this.open() && this.dialog.open()) this.dialog.hide();
    });

    // Surface redirect-callback errors in context.
    effect(() => {
      if (this.auth.status() === 'error') this.dialog.show();
    });
  }
}

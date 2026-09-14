import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AI_ENABLED } from './core/features';
import { SignInDialogComponent } from './core/auth/sign-in-dialog.component';
import { AiDisclosureDialogComponent } from './core/ai/ai-disclosure-dialog.component';
import { ShellComponent } from './shell/shell.component';

/**
 * The root component: the shell, plus the dialogs that must outlive any one page.
 *
 * It used to hold the top bar, its markup and a hundred lines of its CSS. The layout
 * moved to `ShellComponent` (ADR-0032) so the root is only what it says on the tin —
 * what is mounted for the whole session and cannot live inside a route.
 */
@Component({
  selector: 'cn-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ShellComponent, SignInDialogComponent, AiDisclosureDialogComponent],
  template: `
    <cn-shell />
    <cn-sign-in-dialog />
    @if (aiEnabled) {
      <cn-ai-disclosure-dialog />
    }
  `,
})
export class AppComponent {
  /** Frozen off by default — nothing can open this dialog (ADR-0033). */
  protected readonly aiEnabled = inject(AI_ENABLED);
}

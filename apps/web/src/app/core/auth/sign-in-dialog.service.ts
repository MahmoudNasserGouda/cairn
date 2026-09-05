import { Injectable, signal } from '@angular/core';

/**
 * Open/close state for the sign-in dialog. Kept out of `AuthService` so the auth
 * layer stays UI-agnostic.
 */
@Injectable({ providedIn: 'root' })
export class SignInDialogService {
  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  show(): void {
    this._open.set(true);
  }

  hide(): void {
    this._open.set(false);
  }

  toggle(): void {
    this._open.update((v) => !v);
  }
}

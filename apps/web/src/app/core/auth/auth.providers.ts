import { type EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Wire the OAuth redirect handler into app startup. It does not block bootstrap:
 * the synchronous part (parse + clean the URL) runs immediately, the token
 * exchange resolves in the background and updates the header when done.
 */
export function provideAuth(): EnvironmentProviders {
  return provideAppInitializer(() => {
    void inject(AuthService).completeSignInFromRedirect();
  });
}

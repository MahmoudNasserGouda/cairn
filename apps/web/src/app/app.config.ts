import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { APP_BASE_HREF } from '@angular/common';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { provideAuth } from './core/auth/auth.providers';

/**
 * Zoneless (no zone.js payload). Hash location keeps deep links working on any
 * static host without SPA-fallback config (ADR-0004).
 *
 * The base href is supplied via APP_BASE_HREF rather than a `<base>` element so
 * the built index.html can honour the CSP `base-uri 'none'` directive — a
 * `<base>` tag would be blocked by the browser (SECURITY.md §8, ADR-0019).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation()),
    { provide: APP_BASE_HREF, useValue: '/' },
    provideAuth(),
  ],
};

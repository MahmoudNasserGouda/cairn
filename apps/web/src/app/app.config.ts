import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

/**
 * Zoneless (no zone.js payload). Hash location keeps deep links working on any
 * static host without SPA-fallback config (ADR-0004).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation()),
  ],
};

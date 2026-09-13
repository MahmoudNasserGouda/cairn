import { InjectionToken } from '@angular/core';
import { FEATURES } from '@cairn/shared';

/**
 * Whether the BYOK AI layer is reachable at all (ADR-0033).
 *
 * The value comes from `FEATURES.ai` in `libs/shared`, which is the real switch. This
 * token exists so a test can supply the other state: ADR-0033 requires both to be
 * covered, because a flag exercised in one state is a flag that breaks in the other.
 *
 * Read it in a component to gate the template, and note that `AiService` guards itself
 * independently — the template gate is what a user sees, the service gate is what
 * actually stops a request.
 */
export const AI_ENABLED = new InjectionToken<boolean>('AI_ENABLED', {
  providedIn: 'root',
  factory: () => FEATURES.ai,
});

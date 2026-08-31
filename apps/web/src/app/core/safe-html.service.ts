import { Injectable, SecurityContext, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { ALLOWED_TAGS, ALLOWED_ATTR, type HtmlSanitizer } from '@osc/shared';

/**
 * The single sanitisation pipeline for rendered untrusted content (ADR-0019).
 * DOMPurify with a strict allowlist, then Angular's own sanitizer as defence in
 * depth. Links are forced to open safely.
 */
@Injectable({ providedIn: 'root' })
export class SafeHtmlService implements HtmlSanitizer {
  private readonly ngSanitizer = inject(DomSanitizer);

  constructor() {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('target', '_blank');
      }
    });
  }

  sanitize(dirtyHtml: string): string {
    const clean = DOMPurify.sanitize(dirtyHtml, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTR],
      ALLOWED_URI_REGEXP: /^(?:https|mailto):/i,
      FORBID_ATTR: ['style', 'srcset'],
    });
    return this.ngSanitizer.sanitize(SecurityContext.HTML, clean) ?? '';
  }

  /** For binding into [innerHTML] after sanitisation. */
  trust(dirtyHtml: string): SafeHtml {
    return this.ngSanitizer.bypassSecurityTrustHtml(this.sanitize(dirtyHtml)); // osc-security-reviewed: input is DOMPurify+Angular sanitised above
  }
}

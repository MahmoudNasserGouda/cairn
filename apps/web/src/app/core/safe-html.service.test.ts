import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SafeHtmlService } from './safe-html.service';

let svc: SafeHtmlService;

beforeEach(() => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  svc = TestBed.inject(SafeHtmlService);
});

describe('SafeHtmlService', () => {
  it('strips script elements', () => {
    expect(svc.sanitize('<p>hi</p><script>steal()</script>')).not.toContain('script');
  });

  it('strips inline event handlers', () => {
    const out = svc.sanitize('<a href="https://x.test" onclick="steal()">x</a>');
    expect(out).not.toContain('onclick');
  });

  it('drops javascript: URLs', () => {
    const out = svc.sanitize('<a href="javascript:steal()">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('drops data: URLs', () => {
    const out = svc.sanitize('<a href="data:text/html,<script>x</script>">x</a>');
    expect(out).not.toContain('data:');
  });

  it('allows https and mailto links', () => {
    expect(svc.sanitize('<a href="https://x.test">x</a>')).toContain('https://x.test');
    expect(svc.sanitize('<a href="mailto:a@b.test">x</a>')).toContain('mailto:');
  });

  it('forces external links to open safely', () => {
    const out = svc.sanitize('<a href="https://x.test">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('strips style attributes', () => {
    const out = svc.sanitize('<p style="position:fixed">x</p>');
    expect(out).not.toContain('style');
  });

  it('removes iframes and objects entirely', () => {
    const out = svc.sanitize('<iframe src="https://x.test"></iframe><object></object>');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('object');
  });

  it('keeps ordinary formatting intact', () => {
    const out = svc.sanitize('<p>a <strong>b</strong> <em>c</em></p>');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<em>c</em>');
  });

  it('survives empty and plain input', () => {
    expect(svc.sanitize('')).toBe('');
    expect(svc.sanitize('just text')).toBe('just text');
  });
});

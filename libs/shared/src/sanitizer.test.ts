import { stripToText, plainTextSanitizer } from './sanitizer';

describe('stripToText', () => {
  it('removes tags including script', () => {
    expect(stripToText('<script>steal()</script>hello <b>world</b>')).toBe(
      'steal()hello world',
    );
  });
  it('decodes basic entities', () => {
    expect(stripToText('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  });
  it('is exposed as plainTextSanitizer.sanitize', () => {
    expect(plainTextSanitizer.sanitize('<img src=x onerror=alert(1)>ok')).toBe('ok');
  });
});

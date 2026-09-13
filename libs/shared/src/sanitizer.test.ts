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

/**
 * CodeQL `js/polynomial-redos` and `js/incomplete-multi-character-sanitization`, both
 * high, both on `stripToText`'s tag strip.
 *
 * This matters more than its "fallback" label suggests: `parseCvText` runs every
 * imported CV through `stripToText` first, so this is a hot path for input SECURITY.md
 * T7 treats as hostile.
 */
describe('stripToText on hostile input', () => {
  /**
   * `/<[^>]*>/g` is quadratic on a run of `<` with no `>`: the engine consumes the
   * rest of the string looking for one, fails, backtracks the whole run, and starts
   * again from the next offset. Measured before the fix: 40k in 871ms, 80k in 3.5s.
   *
   * The bound is loose on purpose — linear is a millisecond or two, quadratic never
   * finishes, and nothing between is worth splitting hairs about.
   */
  it('strips a long run of unclosed angle brackets in linear time', () => {
    const hostile = '<'.repeat(200_000);
    const started = performance.now();
    const out = stripToText(hostile);
    const elapsed = performance.now() - started;

    expect(out).toBe(hostile);
    expect(elapsed).toBeLessThan(1000);
  });

  it('is linear on a long run of complete tags too', () => {
    const hostile = '<b>x</b>'.repeat(50_000);
    const started = performance.now();
    const out = stripToText(hostile);

    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).toBe('x'.repeat(50_000));
  });

  /**
   * The second alert: could a removal splice two halves into a *new* tag? Not with a
   * scanner that always runs from a `<` to the next `>` — any `<` that survives has no
   * `>` after it at all, so it cannot open anything. These are the shapes that break
   * naive single-pass strippers, asserted so the property is a test rather than an
   * argument.
   */
  it.each([
    ['nested open tags', '<scr<script>ipt>alert(1)</script>'],
    ['doubled brackets', '<<script>script>alert(1)<</script>/script>'],
    ['comment splice', '<scri<!-- -->pt>alert(1)</scri<!-- -->pt>'],
    ['unterminated tag', '<img src=x onerror=alert(1)'],
    ['bracket soup', '<<<>>><<img src=x>>>'],
  ])('leaves no reconstructible tag: %s', (_label, dirty) => {
    const out = stripToText(dirty);
    // Nothing that could be parsed as an element: no `<` followed by a name and a `>`.
    expect(out).not.toMatch(/<\s*\/?\s*[a-zA-Z][^>]*>/);
  });

  it('still strips what it is meant to', () => {
    expect(stripToText('<script>steal()</script>hello <b>world</b>')).toBe(
      'steal()hello world',
    );
    expect(stripToText('a<br/>b')).toBe('ab');
  });
});

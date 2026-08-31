import { computeMetrics, type Contribution } from './metrics';
import { generatePortfolio, toHtml } from './generate';
import {
  verifyLicense,
  licenseGrants,
  bytesToB64url,
  type LicensePayload,
} from './license';

const contribs: Contribution[] = [
  {
    repo: 'a/x',
    title: 'Fix bug',
    url: 'https://github.com/a/x/pull/1',
    mergedYear: 2025,
    mergedMonth: 1,
    additions: 20,
    deletions: 4,
    repoStars: 1200,
  },
  {
    repo: 'a/x',
    title: 'Add test',
    url: 'https://github.com/a/x/pull/2',
    mergedYear: 2025,
    mergedMonth: 3,
    additions: 60,
    deletions: 2,
    repoStars: 1200,
  },
  {
    repo: 'b/y',
    title: 'Docs',
    url: 'https://github.com/b/y/pull/9',
    mergedYear: 2025,
    mergedMonth: 4,
    additions: 10,
    deletions: 1,
    repoStars: 40,
  },
];

describe('computeMetrics', () => {
  it('is deterministic and bounded', () => {
    const m1 = computeMetrics(contribs);
    const m2 = computeMetrics(contribs);
    expect(m1).toEqual(m2);
    for (const v of Object.values(m1.headline)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
  it('handles an empty history', () => {
    expect(computeMetrics([]).headline.contribution).toBe(0);
  });
});

describe('portfolio generation', () => {
  const input = {
    name: 'Ada <script>alert(1)</script>',
    headline: 'Frontend engineer',
    bio: 'I like <b>open source</b> & tea.',
    skills: ['typescript', 'angular'],
    contributions: contribs,
    metrics: computeMetrics(contribs),
    links: [{ label: 'GitHub', url: 'https://github.com/ada' }],
  };

  it('strips scripts and markup from user free-text', () => {
    const html = toHtml(input);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Ada');
    expect(html).toContain('open source &amp; tea');
  });

  it('neutralises non-https contribution URLs', () => {
    const html = toHtml({
      ...input,
      contributions: [{ ...contribs[0]!, url: 'javascript:alert(1)' }],
    });
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('href="#"');
  });

  it('emits both index.html and portfolio.md', () => {
    const out = generatePortfolio(input);
    expect(out['index.html']).toContain('<!doctype html>');
    expect(out['portfolio.md']).toContain('## Contributions');
  });
});

describe('license verification (offline Ed25519)', () => {
  it('accepts a validly signed license and rejects tampering', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ]);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const pubB64 = bytesToB64url(pub);

    const payload: LicensePayload = {
      sku: 'themes-pro',
      purchaser: 'ada@example.com',
      issuedAt: '2026-08-30',
      features: ['premium-themes'],
    };
    const payloadPart = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        'Ed25519',
        kp.privateKey,
        new TextEncoder().encode(payloadPart),
      ),
    );
    const license = `${payloadPart}.${bytesToB64url(sig)}`;

    const ok = await verifyLicense(license, pubB64);
    expect(ok.valid).toBe(true);
    expect(licenseGrants(ok, 'premium-themes')).toBe(true);
    expect(licenseGrants(ok, 'nonexistent')).toBe(false);

    const tampered = await verifyLicense(
      `${payloadPart}x.${license.split('.')[1]}`,
      pubB64,
    );
    expect(tampered.valid).toBe(false);
  });

  it('rejects a malformed license without throwing', async () => {
    expect((await verifyLicense('garbage', 'AAAA')).valid).toBe(false);
  });
});

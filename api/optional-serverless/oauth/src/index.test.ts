import { describe, expect, it, vi, afterEach } from 'vitest';
import worker, { type Env } from './index';

const ENV: Env = {
  ALLOWED_ORIGIN: 'https://app.example, http://localhost:4200',
  GITHUB_CLIENT_ID: 'gh-id',
  GITHUB_CLIENT_SECRET: 'gh-secret',
  LINKEDIN_CLIENT_ID: 'li-id',
  LINKEDIN_CLIENT_SECRET: 'li-secret',
};

const APP = 'https://app.example';

function post(path: string, body: unknown, origin: string | null = APP): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin !== null) headers['Origin'] = origin;
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function upstreamOk(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('origin allowlist', () => {
  it('rejects a request with no Origin header', async () => {
    // The old check only rejected a *present and wrong* origin, so curl walked in.
    const res = await worker.fetch(post('/github/token', { code: 'c' }, null), ENV);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'origin_not_allowed' });
  });

  it('rejects an origin that is not on the list', async () => {
    const res = await worker.fetch(
      post('/github/token', { code: 'c' }, 'https://evil.example'),
      ENV,
    );
    expect(res.status).toBe(403);
  });

  it('accepts any origin on the comma-separated list and reflects it', async () => {
    upstreamOk({ access_token: 't', token_type: 'bearer', scope: 'read:user' });
    const res = await worker.fetch(
      post('/github/token', { code: 'c' }, 'http://localhost:4200'),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4200');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('rejects an unlisted origin on the identity relay too', async () => {
    const res = await worker.fetch(
      post('/linkedin/identity', { token: 't' }, 'https://evil.example'),
      ENV,
    );
    expect(res.status).toBe(403);
  });
});

describe('redirect_uri allowlist', () => {
  it('rejects a redirect_uri off the allowed origins', async () => {
    const res = await worker.fetch(
      post('/github/token', { code: 'c', redirect_uri: 'https://evil.example/' }, APP),
      ENV,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'redirect_uri_not_allowed' });
  });

  it('accepts a redirect_uri on an allowed origin', async () => {
    upstreamOk({ access_token: 't', token_type: 'bearer' });
    const res = await worker.fetch(
      post('/github/token', { code: 'c', redirect_uri: `${APP}/` }, APP),
      ENV,
    );
    expect(res.status).toBe(200);
  });

  it('rejects a malformed redirect_uri', async () => {
    const res = await worker.fetch(
      post('/github/token', { code: 'c', redirect_uri: 'not-a-url' }, APP),
      ENV,
    );
    expect(res.status).toBe(400);
  });
});

describe('routing and configuration', () => {
  it('404s an unknown route', async () => {
    const res = await worker.fetch(post('/nope/token', {}, APP), ENV);
    expect(res.status).toBe(404);
  });

  it('404s identity for a provider that is not relayed', async () => {
    const res = await worker.fetch(post('/google/identity', { token: 't' }, APP), ENV);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_relayed' });
  });

  it('501s a provider with no secret configured', async () => {
    const res = await worker.fetch(post('/google/token', { code: 'c' }, APP), ENV);
    expect(res.status).toBe(501);
  });

  it('405s a non-POST', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/github/token', {
        method: 'GET',
        headers: { Origin: APP },
      }),
      ENV,
    );
    expect(res.status).toBe(405);
  });

  it('answers preflight with the reflected origin', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/github/token', {
        method: 'OPTIONS',
        headers: { Origin: APP },
      }),
      ENV,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
  });

  it('never echoes the client secret back to the caller', async () => {
    upstreamOk({ access_token: 't', token_type: 'bearer', scope: 's' });
    const res = await worker.fetch(post('/github/token', { code: 'c' }, APP), ENV);
    expect(await res.text()).not.toContain('gh-secret');
  });
});

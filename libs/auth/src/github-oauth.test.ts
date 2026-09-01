import {
  AuthError,
  buildAuthorizeUrl,
  createStateToken,
  exchangeCodeForToken,
  fetchViewer,
  parseCallbackParams,
  type GithubOAuthConfig,
} from './github-oauth';

const CONFIG: GithubOAuthConfig = {
  clientId: 'Iv1.test',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenExchangeUrl: 'https://auth.example.test/github/token',
  redirectUri: 'https://app.example.test/',
  scopes: ['read:user'],
};

function json(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createStateToken', () => {
  it('is 32 hex chars and single-use random', () => {
    const a = createStateToken();
    const b = createStateToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toEqual(b);
  });

  it('is deterministic given the byte source (for tests)', () => {
    const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(0xab);
    expect(createStateToken(bytes)).toBe('ab'.repeat(16));
  });
});

describe('buildAuthorizeUrl', () => {
  it('sets client_id, redirect_uri, scope, state, allow_signup', () => {
    const url = new URL(buildAuthorizeUrl(CONFIG, 'st4te'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.test');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/');
    expect(url.searchParams.get('scope')).toBe('read:user');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('allow_signup')).toBe('true');
  });

  it('space-joins multiple scopes', () => {
    const url = new URL(
      buildAuthorizeUrl({ ...CONFIG, scopes: ['read:user', 'read:org'] }, 's'),
    );
    expect(url.searchParams.get('scope')).toBe('read:user read:org');
  });
});

describe('parseCallbackParams', () => {
  it('classifies a code + state', () => {
    expect(parseCallbackParams('?code=abc&state=xyz')).toEqual({
      kind: 'code',
      code: 'abc',
      state: 'xyz',
    });
  });

  it('classifies an error with description', () => {
    expect(parseCallbackParams('?error=access_denied&error_description=No')).toEqual({
      kind: 'error',
      error: 'access_denied',
      description: 'No',
    });
  });

  it('is "none" when there is nothing to act on', () => {
    expect(parseCallbackParams('').kind).toBe('none');
    expect(parseCallbackParams('?foo=bar').kind).toBe('none');
    expect(parseCallbackParams('?code=abc').kind).toBe('none');
  });
});

describe('exchangeCodeForToken', () => {
  it('sends the code to the endpoint and returns the parsed token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({
        access_token: 'gho_x',
        token_type: 'bearer',
        scope: 'read:user,read:org',
      }),
    );
    const token = await exchangeCodeForToken({
      endpoint: CONFIG.tokenExchangeUrl,
      code: 'the-code',
      redirectUri: CONFIG.redirectUri,
      fetchImpl: fetchImpl,
    });
    expect(token).toEqual({
      accessToken: 'gho_x',
      tokenType: 'bearer',
      scopes: ['read:user', 'read:org'],
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONFIG.tokenExchangeUrl);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'the-code',
      redirect_uri: CONFIG.redirectUri,
    });
  });

  it('throws AuthError on an error body, without leaking the code', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ error: 'bad_verification_code' }, { status: 200 }));
    await expect(
      exchangeCodeForToken({
        endpoint: CONFIG.tokenExchangeUrl,
        code: 'secret-code',
        redirectUri: CONFIG.redirectUri,
        fetchImpl: fetchImpl,
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && !e.message.includes('secret-code'),
    );
  });

  it('throws AuthError on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'));
    await expect(
      exchangeCodeForToken({
        endpoint: CONFIG.tokenExchangeUrl,
        code: 'c',
        redirectUri: CONFIG.redirectUri,
        fetchImpl: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('fetchViewer', () => {
  it('maps the GitHub user payload and sends a Bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        html_url: 'https://github.com/octocat',
        email: null,
      }),
    );
    const viewer = await fetchViewer({
      token: 'gho_x',
      fetchImpl: fetchImpl,
    });
    expect(viewer).toEqual({
      login: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      htmlUrl: 'https://github.com/octocat',
      email: null,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer gho_x',
    );
  });

  it('throws AuthError on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, { status: 401 }));
    await expect(
      fetchViewer({ token: 'bad', fetchImpl: fetchImpl }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

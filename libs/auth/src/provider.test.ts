import {
  AuthError,
  buildAuthorizeUrl,
  createStateToken,
  exchangeCodeForToken,
  isProviderConfigured,
  parseCallbackParams,
  type OAuthProvider,
} from './provider';

const GITHUB: OAuthProvider = {
  id: 'github',
  label: 'GitHub',
  kind: 'github',
  clientId: 'Iv1.real',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenExchangeUrl: 'https://auth.example.test/github/token',
  userInfoUrl: 'https://api.github.com/user',
  redirectUri: 'https://app.example.test/',
  scopes: ['read:user'],
};

const GOOGLE: OAuthProvider = {
  ...GITHUB,
  id: 'google',
  label: 'Google',
  kind: 'oidc',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenExchangeUrl: 'https://auth.example.test/google/token',
  userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  scopes: ['openid', 'profile', 'email'],
};

function json(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('isProviderConfigured', () => {
  it('rejects empty and placeholder client ids', () => {
    expect(isProviderConfigured({ ...GITHUB, clientId: '' })).toBe(false);
    expect(isProviderConfigured({ ...GITHUB, clientId: '0000000000000000' })).toBe(false);
    expect(isProviderConfigured({ ...GITHUB, clientId: 'set-at-deploy-time' })).toBe(
      false,
    );
    expect(isProviderConfigured(GITHUB)).toBe(true);
  });
});

describe('createStateToken', () => {
  it('is 32 hex chars and single-use random', () => {
    expect(createStateToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(createStateToken()).not.toEqual(createStateToken());
  });

  it('is deterministic given the byte source', () => {
    expect(createStateToken((n) => new Uint8Array(n).fill(0xab))).toBe('ab'.repeat(16));
  });
});

describe('buildAuthorizeUrl', () => {
  it('sets the common params and github extras', () => {
    const url = new URL(buildAuthorizeUrl(GITHUB, 'st4te'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.real');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/');
    expect(url.searchParams.get('scope')).toBe('read:user');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('allow_signup')).toBe('true');
  });

  it('adds account-picker params for google, not for github', () => {
    const google = new URL(buildAuthorizeUrl(GOOGLE, 's'));
    expect(google.searchParams.get('prompt')).toBe('select_account');
    expect(google.searchParams.get('access_type')).toBe('online');
    expect(google.searchParams.get('scope')).toBe('openid profile email');
    expect(new URL(buildAuthorizeUrl(GITHUB, 's')).searchParams.get('prompt')).toBeNull();
  });
});

describe('parseCallbackParams', () => {
  it('classifies code, error, and none', () => {
    expect(parseCallbackParams('?code=abc&state=xyz')).toEqual({
      kind: 'code',
      code: 'abc',
      state: 'xyz',
    });
    expect(parseCallbackParams('?error=access_denied&error_description=No')).toEqual({
      kind: 'error',
      error: 'access_denied',
      description: 'No',
    });
    expect(parseCallbackParams('?code=abc').kind).toBe('none');
    expect(parseCallbackParams('').kind).toBe('none');
  });
});

describe('exchangeCodeForToken', () => {
  it('posts the code to the provider route and parses the token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        json({ access_token: 'tok', token_type: 'bearer', scope: 'openid profile' }),
      );
    const token = await exchangeCodeForToken({
      provider: GOOGLE,
      code: 'the-code',
      fetchImpl,
    });
    expect(token).toEqual({
      accessToken: 'tok',
      tokenType: 'bearer',
      scopes: ['openid', 'profile'],
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://auth.example.test/google/token');
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'the-code',
      redirect_uri: 'https://app.example.test/',
    });
  });

  it('throws AuthError on an error body without leaking the code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'bad_code' }));
    await expect(
      exchangeCodeForToken({ provider: GITHUB, code: 'secret', fetchImpl }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && !e.message.includes('secret'),
    );
  });

  it('throws AuthError when the service is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'));
    await expect(
      exchangeCodeForToken({ provider: GITHUB, code: 'c', fetchImpl }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

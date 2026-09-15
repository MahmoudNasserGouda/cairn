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
  role: 'data',
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
  role: 'identity',
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

const GITLAB: OAuthProvider = {
  id: 'gitlab',
  label: 'GitLab',
  role: 'data',
  kind: 'gitlab',
  pkce: true,
  clientId: 'gl-real',
  authorizeUrl: 'https://gitlab.com/oauth/authorize',
  // Not a `cairn-auth` route: with PKCE this is the provider's own endpoint.
  tokenExchangeUrl: 'https://gitlab.com/oauth/token',
  userInfoUrl: 'https://gitlab.com/api/v4/user',
  redirectUri: 'https://app.example.test/',
  scopes: ['read_user', 'read_api'],
};

/**
 * The PKCE path (ADR-0034). Everything here is about one property: **no secret, and
 * therefore no server**. The tests that matter are the ones that would still pass if
 * the flow quietly fell back to the Worker, so each states the negative too.
 */
describe('PKCE providers', () => {
  it('sends the challenge and the method, never the verifier', () => {
    const url = new URL(buildAuthorizeUrl(GITLAB, 'st4te', 'chall3nge'));
    expect(url.searchParams.get('code_challenge')).toBe('chall3nge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // The verifier is the secret. If it ever reaches the URL, PKCE has bought nothing.
    expect(url.toString()).not.toContain('code_verifier');
  });

  it('leaves non-PKCE providers exactly as they were', () => {
    const url = new URL(buildAuthorizeUrl(GITHUB, 'st4te', 'chall3nge'));
    expect(url.searchParams.get('code_challenge')).toBeNull();
    expect(url.searchParams.get('code_challenge_method')).toBeNull();
  });

  it('posts form-encoded, straight to the provider, with no worker in the path', async () => {
    let seenUrl = '';
    let seenBody = '';
    let seenContentType: string | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenBody = init.body as string;
      seenContentType = new Headers(init.headers).get('content-type');
      return json({
        access_token: 'glpat-x',
        token_type: 'bearer',
        scope: 'read_user read_api',
      });
    }) as unknown as typeof fetch;

    const token = await exchangeCodeForToken({
      provider: GITLAB,
      code: 'the-code',
      verifier: 'the-verifier',
      fetchImpl,
    });

    expect(seenUrl).toBe('https://gitlab.com/oauth/token');
    // Form encoding is not a style choice: it is CORS-safelisted, so the exchange is a
    // simple request and costs no preflight. JSON would add a round trip.
    expect(seenContentType).toBe('application/x-www-form-urlencoded');

    const body = new URLSearchParams(seenBody);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('client_id')).toBe('gl-real');
    expect(body.get('redirect_uri')).toBe('https://app.example.test/');
    // The whole point. A secret in a static bundle is a published secret.
    expect(body.get('client_secret')).toBeNull();

    expect(token.accessToken).toBe('glpat-x');
    expect(token.scopes).toEqual(['read_user', 'read_api']);
  });

  it('refuses to exchange without a verifier rather than sending a weaker request', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return json({ access_token: 'x' });
    }) as unknown as typeof fetch;

    await expect(
      exchangeCodeForToken({ provider: GITLAB, code: 'c', fetchImpl }),
    ).rejects.toThrow(AuthError);
    // A downgrade to a plain code exchange would very likely succeed at the provider,
    // which is exactly why this has to fail here instead.
    expect(called).toBe(false);
  });

  it('still keeps the code out of the error message', async () => {
    const fetchImpl = (async () =>
      json(
        { error: 'invalid_grant', error_description: 'bad verifier' },
        { status: 400 },
      )) as unknown as typeof fetch;

    await expect(
      exchangeCodeForToken({
        provider: GITLAB,
        code: 'secret-code',
        verifier: 'v',
        fetchImpl,
      }),
    ).rejects.toThrow(/bad verifier/);
    await expect(
      exchangeCodeForToken({
        provider: GITLAB,
        code: 'secret-code',
        verifier: 'v',
        fetchImpl,
      }),
    ).rejects.not.toThrow(/secret-code/);
  });

  it('sends JSON to the worker for providers that need one, unchanged', async () => {
    let seenContentType: string | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seenContentType = new Headers(init.headers).get('content-type');
      return json({ access_token: 'gho_x' });
    }) as unknown as typeof fetch;

    await exchangeCodeForToken({ provider: GITHUB, code: 'c', fetchImpl });
    expect(seenContentType).toBe('application/json');
  });
});

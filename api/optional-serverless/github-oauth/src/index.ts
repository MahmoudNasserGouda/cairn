/**
 * Stateless GitHub OAuth token-exchange Worker (ADR-0016, ADR-0024).
 *
 * The one job: turn an authorization `code` into an access token, because GitHub
 * does not support Authorization Code + PKCE and the exchange needs the client
 * secret. Holds `GITHUB_CLIENT_ID` (var) and `GITHUB_CLIENT_SECRET` (secret) in the
 * Worker environment. Stores nothing, logs nothing about the request body, sets no
 * cookies. If it is down, sign-in fails and the rest of the app still works.
 */

export interface Env {
  /** Public OAuth App client ID. */
  readonly GITHUB_CLIENT_ID: string;
  /** OAuth App client secret. Set with `wrangler secret put GITHUB_CLIENT_SECRET`. */
  readonly GITHUB_CLIENT_SECRET: string;
  /** Exact browser origin allowed to call this Worker, e.g. https://cairn.<sub>.workers.dev */
  readonly ALLOWED_ORIGIN: string;
}

interface ExchangeRequest {
  readonly code?: unknown;
  readonly redirect_uri?: unknown;
}

interface GithubTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...corsHeaders(env),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, env);
    }
    if (origin !== null && origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: 'origin_not_allowed' }, 403, env);
    }
    const url = new URL(request.url);
    if (url.pathname !== '/github/token') {
      return jsonResponse({ error: 'not_found' }, 404, env);
    }

    let payload: ExchangeRequest;
    try {
      payload = (await request.json()) as ExchangeRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400, env);
    }
    if (typeof payload.code !== 'string' || payload.code.length === 0) {
      return jsonResponse({ error: 'missing_code' }, 400, env);
    }

    const body: Record<string, string> = {
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: payload.code,
    };
    if (typeof payload.redirect_uri === 'string' && payload.redirect_uri.length > 0) {
      body['redirect_uri'] = payload.redirect_uri;
    }

    let ghRes: Response;
    try {
      ghRes = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return jsonResponse({ error: 'github_unreachable' }, 502, env);
    }

    let gh: GithubTokenResponse;
    try {
      gh = (await ghRes.json()) as GithubTokenResponse;
    } catch {
      return jsonResponse({ error: 'github_bad_response' }, 502, env);
    }

    if (gh.error !== undefined || gh.access_token === undefined) {
      // Pass GitHub's own error code through; it is not sensitive.
      return jsonResponse(
        { error: gh.error ?? 'exchange_failed', error_description: gh.error_description },
        400,
        env,
      );
    }

    return jsonResponse(
      {
        access_token: gh.access_token,
        token_type: gh.token_type ?? 'bearer',
        scope: gh.scope ?? '',
      },
      200,
      env,
    );
  },
};

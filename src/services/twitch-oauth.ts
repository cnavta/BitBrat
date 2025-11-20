import crypto from 'crypto';
import { IConfig, ITokenStore, TwitchTokenData } from '../types';
import { logger } from '../common/logging';
import { BaseServer } from '../common/base-server';

function hmacSHA256(secret: string, data: string) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function buildAuthUrl(cfg: IConfig, state: string, redirectUri: string): string {
  const defaultScopes = ['chat:read','chat:edit','channel:read:subscriptions','user:read:follows','moderator:read:followers','channel:read:vips', 'channel:read:redemptions'];
  const scopes = (cfg.twitchScopes && cfg.twitchScopes.length ? cfg.twitchScopes : defaultScopes).join(' ');
  const params = new URLSearchParams({
    client_id: cfg.twitchClientId || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state,
    force_verify: 'true',
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

export function generateState(cfg: IConfig, nonce?: string): string {
  const secret = cfg.oauthStateSecret || 'dev-secret';
  const n = nonce || crypto.randomBytes(8).toString('hex');
  const ts = Date.now().toString();
  const sig = hmacSHA256(secret, `${n}.${ts}`);
  return `${n}.${ts}.${sig}`;
}

export function verifyState(cfg: IConfig, state?: string, maxAgeMs = 10 * 60 * 1000): boolean {
  if (!state) return false;
  const secret = cfg.oauthStateSecret || 'dev-secret';
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [n, ts, sig] = parts;
  const expected = hmacSHA256(secret, `${n}.${ts}`);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age <= maxAgeMs;
}

function computeBaseUrl(req: import('express').Request): string {
  const xfProto = req.get('x-forwarded-proto');
  const xfHost = req.get('x-forwarded-host');
  const proto = (xfProto || req.protocol || 'http').split(',')[0].trim();
  const host = (xfHost || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function interpolateEnv(str: string): string {
  if (!str) return str;
  // Supports ${VAR} and ${VAR:-default}
  return str.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/gi, (_m, varName: string, defVal?: string) => {
    const v = process.env[varName];
    if (v == null || v === '') return defVal ?? '';
    return String(v);
  });
}

function resolveLbBaseUrl(): string | null {
  try {
    const arch: any = BaseServer.loadArchitectureYaml?.();
    const domainRaw: string | undefined = arch?.infrastructure?.['main-load-balancer']?.routing?.default_domain;
    if (domainRaw && typeof domainRaw === 'string') {
      const domain = interpolateEnv(domainRaw);
      if (domain) {
        // Assume HTTPS for public LB
        return `https://${domain}`;
      }
    }
  } catch (e: any) {
    // Do not log loudly here; fall back to header-derived computation
  }
  return null;
}

function computeRedirectUri(cfg: IConfig, req: import('express').Request, basePath: string): string {
  // Explicit override wins fully (treat as complete callback URL)
  if (cfg.twitchRedirectUri) return cfg.twitchRedirectUri;
  // Prefer architecture.yaml load balancer default domain when available
  const lbBase = resolveLbBaseUrl();
  if (lbBase) return `${lbBase}${basePath}/callback`;
  // Fallback to request headers / x-forwarded
  const baseUrl = computeBaseUrl(req);
  return `${baseUrl}${basePath}/callback`;
}

export function getAuthUrl(cfg: IConfig, req: import('express').Request, basePath: string = '/oauth/twitch'): string {
  if (!cfg.twitchClientId) {
    throw new Error('Missing TWITCH_CLIENT_ID');
  }
  const redirectUri = computeRedirectUri(cfg, req, basePath);
  const state = generateState(cfg);
  return buildAuthUrl(cfg, state, redirectUri);
}

export async function exchangeCodeForToken(cfg: IConfig, code: string, redirectUri: string): Promise<TwitchTokenData> {
  if (!cfg.twitchClientId || !cfg.twitchClientSecret) {
    throw new Error('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET');
  }
  const params = new URLSearchParams({
    client_id: cfg.twitchClientId,
    client_secret: cfg.twitchClientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const resp = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed: ${resp.status} ${text}`);
  }
  const body = await resp.json() as Record<string, any>;
  const token: TwitchTokenData = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresIn: body.expires_in ?? null,
    obtainmentTimestamp: Date.now(),
    scope: Array.isArray(body.scope) ? body.scope : [],
    userId: null,
  };
  // Attempt to validate the token to retrieve the user_id (Twitc h validate endpoint)
  try {
    const vResp = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token.accessToken}` },
    });
    if (vResp.ok) {
      const v = await vResp.json() as Record<string, any>;
      if (v && v.user_id) {
        token.userId = String(v.user_id);
      }
    } else {
      const vText = await vResp.text();
      logger.warn('oauth.token_validate_failed', { status: vResp.status, body: vText });
    }
  } catch (err: any) {
    logger.warn('oauth.token_validate_error', { error: err?.message });
  }
  return token;
}

export function mountTwitchOAuthRoutes(app: import('express').Express, cfg: IConfig, tokenStore: ITokenStore, basePath: string = '/oauth/twitch') {
  app.get(`${basePath}/start`, (req, res) => {
    try {
      const url = getAuthUrl(cfg, req, basePath);
      // If the client explicitly asks for JSON (e.g., API client), honor it
      const wantsJson = (req.query as any).mode === 'json' || (req.headers.accept || '').includes('application/json');
      if (wantsJson) {
        return res.status(200).json({ url });
      }
      // Default behavior: redirect the user agent to Twitch authorization URL
      res.redirect(302, url);
    } catch (e: any) {
      logger.error('Failed to build Twitch auth URL', { error: e?.message });
      res.status(500).json({ error: 'failed_to_build_url' });
    }
  });

  app.get(`${basePath}/callback`, async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) {
      logger.warn('OAuth callback error', { error });
      return res.status(400).send('OAuth error');
    }
    if (!verifyState(cfg, state)) {
      return res.status(400).send('Invalid state');
    }
    if (!code) return res.status(400).send('Missing code');
    try {
      const redirectUri = computeRedirectUri(cfg, req, basePath);
      const token = await exchangeCodeForToken(cfg, code, redirectUri);
      await tokenStore.setToken(token);
      res.status(200).send('Twitch authentication successful. You can close this window.');
    } catch (e: any) {
      logger.error('Token exchange/store failed', { error: e?.message });
      res.status(500).send('Token exchange failed');
    }
  });
}

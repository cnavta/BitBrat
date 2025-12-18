import { OAuthProvider, TokenPayload } from '../types';
import type { IConfig } from '../../../types';
import { exchangeCodeForToken as twitchExchange } from '../../twitch-oauth';

function interpolateEnv(str: string): string {
  if (!str) return str;
  return str.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/gi, (_m, varName: string, defVal?: string) => {
    const v = process.env[varName];
    if (v == null || v === '') return defVal ?? '';
    return String(v);
  });
}

function resolveLbBaseUrl(): string | null {
  try {
    // Lazy import to avoid circulars
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BaseServer } = require('../../../common/base-server');
    const arch: any = BaseServer.loadArchitectureYaml?.();
    const domainRaw: string | undefined = arch?.infrastructure?.resources?.['main-load-balancer']?.routing?.default_domain;
    if (domainRaw && typeof domainRaw === 'string') {
      const domain = interpolateEnv(domainRaw);
      if (domain) return `https://${domain}`;
    }
  } catch {}
  return null;
}

function defaultTwitchScopes(cfg: IConfig): string[] {
  return (cfg.twitchScopes && cfg.twitchScopes.length
    ? cfg.twitchScopes
    : [
        'chat:read',
        'chat:edit',
        'channel:read:subscriptions',
        'user:read:follows',
        'moderator:read:followers',
        'channel:read:vips',
        'channel:read:redemptions',
      ]);
}

export class TwitchAdapter implements OAuthProvider {
  readonly key = 'twitch';
  readonly displayName = 'Twitch';

  constructor(private readonly cfg: IConfig) {}

  private computeRedirectUri(identity: string): string {
    if (this.cfg.twitchRedirectUri) return this.cfg.twitchRedirectUri;
    const lb = resolveLbBaseUrl();
    if (lb) return `${lb}/oauth/twitch/${identity}/callback`;
    // Cannot infer without request context; require explicit override or LB
    throw new Error('twitch_redirect_uri_unresolved');
  }

  async getAuthorizeUrl(params: { identity: string; state: string; mode?: 'json' | 'redirect'; scopes?: string[]; redirectUri?: string }): Promise<string> {
    const { identity, state } = params;
    if (!this.cfg.twitchClientId) throw new Error('Missing TWITCH_CLIENT_ID');
    const redirectUri = params.redirectUri || this.computeRedirectUri(identity);
    const scopes = (params.scopes && params.scopes.length ? params.scopes : defaultTwitchScopes(this.cfg)).join(' ');
    const qs = new URLSearchParams({
      client_id: this.cfg.twitchClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state,
      force_verify: 'true',
    });
    return `https://id.twitch.tv/oauth2/authorize?${qs.toString()}`;
  }

  async exchangeCodeForToken(params: { code: string; redirectUri: string; identity: string }): Promise<TokenPayload> {
    const redirectUri = params.redirectUri || this.computeRedirectUri(params.identity);
    const t = await twitchExchange(this.cfg, params.code, redirectUri);
    const expiresAt = t.expiresIn && t.obtainmentTimestamp
      ? new Date(t.obtainmentTimestamp + t.expiresIn * 1000).toISOString()
      : undefined;
    const payload: TokenPayload = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken || undefined,
      scope: t.scope || [],
      expiresAt,
      tokenType: 'oauth',
      providerUserId: t.userId || undefined,
    };
    return payload;
  }

  async refreshAccessToken(token: TokenPayload): Promise<TokenPayload> {
    if (!token?.refreshToken) throw new Error('refresh_not_supported');
    if (!this.cfg.twitchClientId || !this.cfg.twitchClientSecret) throw new Error('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET');
    const body = new URLSearchParams({
      client_id: this.cfg.twitchClientId,
      client_secret: this.cfg.twitchClientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });
    const resp = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`refresh_failed:${resp.status}:${text}`);
    }
    const bodyJson = (await resp.json()) as any;
    const accessToken: string = bodyJson.access_token;
    const refreshToken: string | undefined = bodyJson.refresh_token || token.refreshToken;
    const expiresIn: number | undefined = bodyJson.expires_in;
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : token.expiresAt;
    return {
      accessToken,
      refreshToken,
      scope: Array.isArray(bodyJson.scope) ? bodyJson.scope : token.scope,
      expiresAt,
      tokenType: 'oauth',
      providerUserId: token.providerUserId,
    };
  }
}

export default TwitchAdapter;

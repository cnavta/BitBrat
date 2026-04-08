import type { OAuthProvider } from '../types';
import type { IConfig } from '../../../types';

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

export class DiscordAdapter implements OAuthProvider {
  readonly key = 'discord';
  readonly displayName = 'Discord';

  constructor(private readonly cfg: IConfig) {}

  private computeRedirectUri(identity: string): string {
    if (this.cfg.discordRedirectUri) return this.cfg.discordRedirectUri;
    const lb = resolveLbBaseUrl();
    if (lb) return `${lb}/oauth/discord/${identity}/callback`;
    throw new Error('discord_redirect_uri_unresolved');
  }

  async getAuthorizeUrl(params: { identity: string; state: string; mode?: 'json' | 'redirect'; scopes?: string[]; redirectUri?: string }): Promise<string> {
    const { identity, state } = params;
    if (!this.cfg.discordClientId) throw new Error('Missing DISCORD_CLIENT_ID');
    const redirectUri = params.redirectUri || this.computeRedirectUri(identity);
    // Use the provided scopes or the default bot/application command scopes
    const scopes = (params.scopes && params.scopes.length ? params.scopes : (this.cfg.discordOauthScopes && this.cfg.discordOauthScopes.length ? this.cfg.discordOauthScopes : ['bot', 'applications.commands', 'identify'])).join(' ');
    const permissions = this.cfg.discordOauthPermissions || 379968; 
    const qs = new URLSearchParams({
      client_id: this.cfg.discordClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state,
    });
    // Add permissions if the scope includes 'bot'
    if (scopes.includes('bot')) {
      qs.set('permissions', String(permissions));
    }
    return `https://discord.com/oauth2/authorize?${qs.toString()}`;
  }

  async exchangeCodeForToken(params: { code: string; redirectUri: string; identity: string }): Promise<any> {
    if (!this.cfg.discordClientId || !this.cfg.discordClientSecret) {
      throw new Error('Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET');
    }
    const redirectUri = params.redirectUri || this.computeRedirectUri(params.identity);
    const body = new URLSearchParams({
      client_id: this.cfg.discordClientId,
      client_secret: this.cfg.discordClientSecret,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirectUri,
    });

    const resp = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`discord_token_exchange_failed:${resp.status}:${text}`);
    }

    const data = (await resp.json()) as any;
    // Discord returns access_token, expires_in, refresh_token, scope, token_type
    // If it's a bot flow, it also returns 'guild' object and 'permissions'

    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      scope: data.scope ? data.scope.split(' ') : [],
      tokenType: 'oauth',
      providerUserId: data.user?.id, // Discord doesn't always return 'user' in the token response unless 'identify' scope is used
      metadata: {
        guildId: data.guild?.id,
        permissions: data.permissions,
        webhook: data.webhook,
      },
    };
  }
}

export default DiscordAdapter;

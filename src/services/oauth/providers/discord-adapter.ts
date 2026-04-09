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
      if (domain && domain.includes('localhost')) {
        return `http://${domain}`;
      } else if (domain) return `https://${domain}`;
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
    // Include 'identify' scope if not present
    const rawScopes = params.scopes && params.scopes.length ? params.scopes : (this.cfg.discordOauthScopes && this.cfg.discordOauthScopes.length ? this.cfg.discordOauthScopes : ['bot', 'applications.commands']);
    if (!rawScopes.includes('identify')) rawScopes.push('identify');
    const scopes = rawScopes.join(' ');
    const permissions = this.cfg.discordOauthPermissions || 379968; // Default: view channels, send messages, read history, embed links, attach files, add reactions, use external emojis
    const qs = new URLSearchParams({
      client_id: this.cfg.discordClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state,
    });
    // Add permissions only if 'bot' scope is present
    if (scopes.includes('bot')) {
      qs.set('permissions', String(permissions));
    }
    return `https://discord.com/oauth2/authorize?${qs.toString()}`;
  }

  async exchangeCodeForToken(params: { code: string; redirectUri: string; identity: string }): Promise<any> {
    const { code, identity } = params;
    if (!this.cfg.discordClientId || !this.cfg.discordClientSecret) {
      throw new Error('Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET');
    }
    const redirectUri = params.redirectUri || this.computeRedirectUri(identity);

    const body = new URLSearchParams({
      client_id: this.cfg.discordClientId,
      client_secret: this.cfg.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const resp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Token exchange failed: ${resp.status} ${text}`);
    }

    const json = (await resp.json()) as any;
    const expiresAt = json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined;

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt,
      scope: json.scope ? json.scope.split(' ') : [],
      tokenType: 'oauth',
      metadata: {
        guildId: json.guild?.id,
        permissions: json.guild?.permissions,
      },
    };
  }
}

export default DiscordAdapter;

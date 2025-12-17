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
    const domainRaw: string | undefined = arch?.infrastructure?.['main-load-balancer']?.routing?.default_domain;
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
    const scopes = (params.scopes && params.scopes.length ? params.scopes : (this.cfg.discordOauthScopes || ['bot'])).join(' ');
    const qs = new URLSearchParams({
      client_id: this.cfg.discordClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state,
    });
    return `https://discord.com/oauth2/authorize?${qs.toString()}`;
  }

  async exchangeCodeForToken(): Promise<any> {
    // Not required for this sprint (bot flow uses a token, not code grant). Implement later.
    throw new Error('not_supported');
  }
}

export default DiscordAdapter;

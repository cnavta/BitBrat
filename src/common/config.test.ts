import { buildConfig, safeConfig, assertRequiredSecrets, getConfig, overrideConfig, resetConfig } from './config';
import type { IConfig } from '../types';

describe('config framework', () => {
  it('maps environment variables to IConfig with proper parsing', () => {
    const env = {
      SERVICE_PORT: '8080',
      LOG_LEVEL: 'debug',
      TWITCH_ENABLED: 'false',
      TWITCH_CLIENT_ID: 'cid',
      TWITCH_CLIENT_SECRET: 'csecret',
      OAUTH_STATE_SECRET: 'osecret',
      TWITCH_REDIRECT_URI: 'https://example.com/cb',
      TWITCH_OAUTH_SCOPES: 'chat:read, chat:edit',
      TWITCH_CHANNELS: 'chan1 chan2',
      COMMAND_WHITELIST: '!help,!uptime',
      FIRESTORE_ENABLED: 'false',
      TOKEN_DOC_PATH: 'oauth/twitch/bot',
      BROADCASTER_TOKEN_DOC_PATH: 'oauth/twitch/broadcaster',
    } as any;

    const cfg = buildConfig(env);
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe('debug');
    expect(cfg.twitchEnabled).toBe(false);
    expect(cfg.twitchClientId).toBe('cid');
    expect(cfg.twitchClientSecret).toBe('csecret');
    expect(cfg.oauthStateSecret).toBe('osecret');
    expect(cfg.twitchRedirectUri).toBe('https://example.com/cb');
    expect(cfg.twitchScopes).toEqual(['chat:read', 'chat:edit']);
    expect(cfg.twitchChannels).toEqual(['chan1', 'chan2']);
    expect(cfg.commandWhitelist).toEqual(['!help', '!uptime']);
    expect(cfg.firestoreEnabled).toBe(false);
    expect(cfg.tokenDocPath).toBe('oauth/twitch/bot');
    expect(cfg.broadcasterTokenDocPath).toBe('oauth/twitch/broadcaster');
  });

  it('applies sensible defaults when env is missing', () => {
    const cfg = buildConfig({} as any);
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe('info');
    // defaults in buildConfig: TWITCH_ENABLED true, FIRESTORE_ENABLED true
    expect(cfg.twitchEnabled).toBe(true);
    expect(cfg.firestoreEnabled).toBe(true);
    expect(cfg.twitchScopes).toEqual([]);
    expect(cfg.twitchChannels).toEqual([]);
  });

  it('redacts secrets in safeConfig()', () => {
    const env = {
      TWITCH_CLIENT_ID: 'cid',
      TWITCH_CLIENT_SECRET: 'csecret',
      OAUTH_STATE_SECRET: 'osecret',
    } as any;
    const cfg = buildConfig(env);
    const safe = safeConfig(cfg);
    expect(safe.twitchClientSecret).toBe('***REDACTED***');
    expect(safe.oauthStateSecret).toBe('***REDACTED***');
  });

  it('assertRequiredSecrets throws when required secrets are missing', () => {
    const cfg = buildConfig({} as any);
    expect(() => assertRequiredSecrets(cfg)).toThrow(/Missing required environment variables/);
    const ok = buildConfig({ TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b', OAUTH_STATE_SECRET: 'c' } as any);
    expect(() => assertRequiredSecrets(ok)).not.toThrow();
  });

  it('supports override and reset of singleton config', () => {
    const originalPort = process.env.PORT;
    try {
      resetConfig();
      process.env.PORT = '9999';
      expect(getConfig().port).toBe(9999);
      overrideConfig({ port: 4321 });
      expect(getConfig().port).toBe(4321);
      resetConfig();
      expect(getConfig().port).toBe(9999);
    } finally {
      resetConfig();
      if (originalPort === undefined) delete (process.env as any).PORT; else process.env.PORT = originalPort;
    }
  });
});

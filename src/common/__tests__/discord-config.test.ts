import { buildConfig } from '../config';

describe('Discord Config Parsing', () => {
  it('parses DISCORD_OAUTH_PERMISSIONS and DISCORD_OAUTH_SCOPES', () => {
    const env = {
      DISCORD_OAUTH_PERMISSIONS: '1024',
      DISCORD_OAUTH_SCOPES: 'bot,applications.commands',
      TWITCH_CLIENT_ID: 'tc',
      TWITCH_CLIENT_SECRET: 'ts',
      OAUTH_STATE_SECRET: 'oss'
    };
    const cfg = buildConfig(env);
    expect(cfg.discordOauthPermissions).toBe(1024);
    expect(cfg.discordOauthScopes).toEqual(['bot', 'applications.commands']);
  });

  it('handles missing Discord oauth env vars with defaults', () => {
    const env = {
      TWITCH_CLIENT_ID: 'tc',
      TWITCH_CLIENT_SECRET: 'ts',
      OAUTH_STATE_SECRET: 'oss'
    };
    const cfg = buildConfig(env);
    expect(cfg.discordOauthPermissions).toBeUndefined();
    expect(cfg.discordOauthScopes).toEqual([]);
  });
});

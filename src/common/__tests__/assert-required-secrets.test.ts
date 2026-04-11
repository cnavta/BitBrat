import { assertRequiredSecrets, buildConfig } from '../config';

describe('assertRequiredSecrets', () => {
  const validBaseEnv = {
    TWITCH_CLIENT_ID: 'tc',
    TWITCH_CLIENT_SECRET: 'ts',
    OAUTH_STATE_SECRET: 'oss'
  };

  it('passes when basic secrets are present', () => {
    const cfg = buildConfig(validBaseEnv);
    expect(() => assertRequiredSecrets(cfg)).not.toThrow();
  });

  it('throws when basic secrets are missing', () => {
    const cfg = buildConfig({});
    expect(() => assertRequiredSecrets(cfg)).toThrow(/Missing required environment variables: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, OAUTH_STATE_SECRET/);
  });

  describe('Discord validation', () => {
    it('passes if Discord is disabled and bot token is missing', () => {
      const cfg = buildConfig({
        ...validBaseEnv,
        DISCORD_ENABLED: 'false',
        DISCORD_USE_TOKEN_STORE: 'false'
        // No DISCORD_BOT_TOKEN
      });
      expect(() => assertRequiredSecrets(cfg)).not.toThrow();
    });

    it('throws if Discord is enabled, store is disabled, and bot token is missing', () => {
      const cfg = buildConfig({
        ...validBaseEnv,
        DISCORD_ENABLED: 'true',
        DISCORD_USE_TOKEN_STORE: 'false'
        // No DISCORD_BOT_TOKEN
      });
      expect(() => assertRequiredSecrets(cfg)).toThrow(/Missing required environment variables: DISCORD_BOT_TOKEN \(required when DISCORD_USE_TOKEN_STORE is false\)/);
    });

    it('passes if Discord is enabled, store is disabled, and bot token is present', () => {
      const cfg = buildConfig({
        ...validBaseEnv,
        DISCORD_ENABLED: 'true',
        DISCORD_USE_TOKEN_STORE: 'false',
        DISCORD_BOT_TOKEN: 'my-token'
      });
      expect(() => assertRequiredSecrets(cfg)).not.toThrow();
    });

    it('passes if Discord is enabled, store is enabled, and bot token is missing', () => {
      const cfg = buildConfig({
        ...validBaseEnv,
        DISCORD_ENABLED: 'true',
        DISCORD_USE_TOKEN_STORE: 'true'
        // No DISCORD_BOT_TOKEN (since it will be read from store)
      });
      expect(() => assertRequiredSecrets(cfg)).not.toThrow();
    });
  });

  describe('Twilio validation', () => {
    it('throws if Twilio is enabled and its secrets are missing', () => {
      const cfg = buildConfig({
        ...validBaseEnv,
        TWILIO_ENABLED: 'true'
      });
      expect(() => assertRequiredSecrets(cfg)).toThrow(/TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_CHAT_SERVICE_SID/);
    });
  });
});

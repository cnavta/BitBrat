import { z } from 'zod';
import type { IConfig, LogLevel } from '../types';

// Helpers
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

function parseBool(val: string | undefined, fallback = false): boolean {
  if (val == null) return fallback;
  const v = String(val).trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return fallback;
}

function parseList(val: string | undefined): string[] {
  if (!val) return [];
  return val
    .split(/[ ,\n\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseLogLevel(val: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  const v = (val || '').toLowerCase();
  return (['error', 'warn', 'info', 'debug'] as LogLevel[]).includes(v as LogLevel)
    ? (v as LogLevel)
    : fallback;
}

// Zod schema for final validation/coercion
const ConfigSchema = z.object({
  // Allow 0 for ephemeral ports in tests; default remains 3000
  port: z.coerce.number().int().min(0).default(3000),
  logLevel: z.custom<LogLevel>().default('info'),

  commandSigil: z.string().optional(),
  twitchEnabled: z.boolean().optional(),
  twitchDisableConnect: z.boolean().optional(),
  twitchBotUsername: z.string().optional(),
  twitchBotAccessToken: z.string().optional(),
  twitchBotUserId: z.string().optional(),
  twitchClientId: z.string().optional(),
  twitchClientSecret: z.string().optional(),
  twitchRedirectUri: z.string().optional(),
  twitchScopes: z.array(z.string()).default([]),
  twitchChannels: z.array(z.string()).default([]),
  commandWhitelist: z.array(z.string()).optional(),
  oauthStateSecret: z.string().optional(),

  firestoreEnabled: z.boolean().optional(),
  tokenDocPath: z.string().optional(),
  broadcasterTokenDocPath: z.string().optional(),

  busPrefix: z.string().optional(),
  publishMaxRetries: z.coerce.number().int().min(1).optional(),

  // Discord configuration
  discordEnabled: z.boolean().optional(),
  discordBotToken: z.string().optional(),
  discordGuildId: z.string().optional(),
  discordChannels: z.array(z.string()).default([]),
  discordUseTokenStore: z.boolean().optional(),
  discordAllowEnvFallback: z.boolean().optional(),
  discordTokenPollMs: z.coerce.number().int().min(0).optional(),
  discordClientId: z.string().optional(),
  discordClientSecret: z.string().optional(),
  discordRedirectUri: z.string().optional(),
  discordOauthScopes: z.array(z.string()).default([]),
  discordOauthPermissions: z.coerce.number().int().min(0).optional(),

  // Twilio configuration
  twilioEnabled: z.boolean().optional(),
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  twilioApiKey: z.string().optional(),
  twilioApiSecret: z.string().optional(),
  twilioChatServiceSid: z.string().optional(),
  twilioIdentity: z.string().optional(),
});

let cachedConfig: IConfig | null = null;

/** Build a config object from an env provider and optional overrides. */
export function buildConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<IConfig> = {}): IConfig {
  const base = {
    port: Number(env.SERVICE_PORT || env.PORT || 3000),
    logLevel: parseLogLevel(env.LOG_LEVEL, 'info'),

    commandSigil: (env.COMMAND_SIGIL || '!').slice(0, 1),
    twitchEnabled: parseBool(env.TWITCH_ENABLED, true),
    twitchDisableConnect: parseBool(env.TWITCH_DISABLE_CONNECT, false),
    twitchBotUsername: env.TWITCH_BOT_USERNAME,
    twitchBotAccessToken: env.TWITCH_BOT_ACCESS_TOKEN,
    twitchBotUserId: env.TWITCH_BOT_USER_ID,
    twitchClientId: env.TWITCH_CLIENT_ID,
    twitchClientSecret: env.TWITCH_CLIENT_SECRET,
    twitchRedirectUri: env.TWITCH_REDIRECT_URI,
    twitchScopes: parseList(env.TWITCH_OAUTH_SCOPES),
    twitchChannels: parseList(env.TWITCH_CHANNELS),
    commandWhitelist: parseList(env.COMMAND_WHITELIST),
    oauthStateSecret: env.OAUTH_STATE_SECRET,

    firestoreEnabled: parseBool(env.FIRESTORE_ENABLED, true),
    tokenDocPath: env.TOKEN_DOC_PATH || 'oauth/twitch/bot',
    broadcasterTokenDocPath: env.BROADCASTER_TOKEN_DOC_PATH || 'oauth/twitch/broadcaster',

    busPrefix: env.BUS_PREFIX,
    publishMaxRetries: env.PUBLISH_MAX_RETRIES ? Number(env.PUBLISH_MAX_RETRIES) : undefined,

    // Discord
    discordEnabled: parseBool(env.DISCORD_ENABLED, false),
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordGuildId: env.DISCORD_GUILD_ID,
    discordChannels: parseList(env.DISCORD_CHANNELS),
    discordUseTokenStore: parseBool(env.DISCORD_USE_TOKEN_STORE, false),
    discordAllowEnvFallback: parseBool(env.DISCORD_ALLOW_ENV_FALLBACK, true),
    discordTokenPollMs: env.DISCORD_TOKEN_POLL_MS ? Number(env.DISCORD_TOKEN_POLL_MS) : undefined,
    discordClientId: env.DISCORD_CLIENT_ID,
    discordClientSecret: env.DISCORD_CLIENT_SECRET,
    discordRedirectUri: env.DISCORD_REDIRECT_URI,
    discordOauthScopes: parseList(env.DISCORD_OAUTH_SCOPES),
    discordOauthPermissions: env.DISCORD_OAUTH_PERMISSIONS ? Number(env.DISCORD_OAUTH_PERMISSIONS) : undefined,

    // Twilio
    twilioEnabled: parseBool(env.TWILIO_ENABLED, false),
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    twilioApiKey: env.TWILIO_API_KEY,
    twilioApiSecret: env.TWILIO_API_SECRET,
    twilioChatServiceSid: env.TWILIO_CHAT_SERVICE_SID,
    twilioIdentity: env.TWILIO_IDENTITY,
  } satisfies Partial<IConfig> as IConfig;

  // Apply overrides last
  const merged = { ...base, ...overrides } as IConfig;
  const parsed = ConfigSchema.parse(merged);
  return parsed as IConfig;
}

/** Returns a cached singleton config built from process.env. */
export function getConfig(): IConfig {
  if (!cachedConfig) {
    cachedConfig = buildConfig(process.env);
  }
  return cachedConfig;
}

/** Replace the cached config with provided partial overrides merged over env-derived base. */
export function overrideConfig(overrides: Partial<IConfig>): IConfig {
  cachedConfig = buildConfig(process.env, overrides);
  return cachedConfig;
}

/** Clears the cached config; next getConfig() will rebuild from env. */
export function resetConfig(): void {
  cachedConfig = null;
}

/** Safe representation of config for logging: redacts secrets. */
export function safeConfig(cfg: IConfig = getConfig()): Record<string, unknown> {
  const {
    twitchClientSecret,
    oauthStateSecret,
    twitchBotAccessToken,
    discordBotToken,
    discordClientSecret,
    twilioAuthToken,
    twilioApiSecret,
    ...rest
  } = cfg;
  return {
    ...rest,
    twitchClientSecret: twitchClientSecret ? '***REDACTED***' : undefined,
    oauthStateSecret: oauthStateSecret ? '***REDACTED***' : undefined,
    twitchBotAccessToken: twitchBotAccessToken ? '***REDACTED***' : undefined,
    discordBotToken: discordBotToken ? '***REDACTED***' : undefined,
    discordClientSecret: discordClientSecret ? '***REDACTED***' : undefined,
    twilioAuthToken: twilioAuthToken ? '***REDACTED***' : undefined,
    twilioApiSecret: twilioApiSecret ? '***REDACTED***' : undefined,
  };
}

/** Utility: ensure required secrets are present; throws otherwise. */
export function assertRequiredSecrets(cfg: IConfig = getConfig()): void {
  const missing: string[] = [];
  if (!cfg.twitchClientId) missing.push('TWITCH_CLIENT_ID');
  if (!cfg.twitchClientSecret) missing.push('TWITCH_CLIENT_SECRET');
  if (!cfg.oauthStateSecret) missing.push('OAUTH_STATE_SECRET');

  if (cfg.twilioEnabled) {
    if (!cfg.twilioAccountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!cfg.twilioAuthToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!cfg.twilioApiKey) missing.push('TWILIO_API_KEY');
    if (!cfg.twilioApiSecret) missing.push('TWILIO_API_SECRET');
    if (!cfg.twilioChatServiceSid) missing.push('TWILIO_CHAT_SERVICE_SID');
  }

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

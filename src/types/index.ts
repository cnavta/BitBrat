/**
 * Shared types for BitBrat
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Central application configuration object.
 * All services should obtain runtime configuration via the config framework (src/common/config.ts)
 * and use this interface to ensure type safety and traceability.
 */
export interface IConfig {
  /** Service HTTP port */
  port: number;
  /** Log verbosity */
  logLevel: LogLevel;

  /** Command Processor: leading character to denote a command (default '!') */
  commandSigil?: string;
  /** Command Processor: whitelist of allowed sigils to consider during parsing/matching (supports multi-char) */
  allowedSigils?: string[];
  /** Command Processor: bot display name used in templates */
  botUsername?: string;
  /** Command Processor: Firestore collection for commands (default 'commands') */
  commandsCollection?: string;
  /** Command Processor: default global cooldown ms (0 disables) */
  defaultGlobalCooldownMs?: number;
  /** Command Processor: default per-user cooldown ms (0 disables) */
  defaultUserCooldownMs?: number;
  /** Command Processor: default max executions per window (0 disables) */
  defaultRateMax?: number;
  /** Command Processor: default window size in ms for rate limiting (default 60000) */
  defaultRatePerMs?: number;

  /** Regex cache: optional cap on number of regex commands to cache */
  regexMaxCommands?: number;
  /** Regex cache: optional cap on patterns compiled per command */
  regexMaxPatternsPerCommand?: number;
  /** Regex evaluation: optional max message length considered for regex matching */
  regexMaxMessageLength?: number;

  /** Twitch integration master switch */
  twitchEnabled?: boolean;
  /** Disable live Twitch connections (useful for tests/CI) */
  twitchDisableConnect?: boolean;
  /** Optional bot username (IRC) */
  twitchBotUsername?: string;
  /** Bot access token for IRC-capable identity (secret) */
  twitchBotAccessToken?: string; // secret
  /** Bot Twitch user id */
  twitchBotUserId?: string;
  /** Twitch application client id */
  twitchClientId?: string;
  /** Twitch application client secret (sensitive) */
  twitchClientSecret?: string; // secret
  /** Explicit redirect URI override for OAuth callbacks */
  twitchRedirectUri?: string;
  /** Requested OAuth scopes for Twitch authorization */
  twitchScopes: string[]; // for OAuth
  /** Twitch channel list (e.g., ["#mychannel"]) */
  twitchChannels: string[];

  /** Whitelisted commands (if permissions are enforced upstream) */
  commandWhitelist?: string[];

  /** Secret used to sign OAuth state HMAC */
  oauthStateSecret?: string; // secret for state HMAC

  /** Enable Firestore usage for token storage and other persistence */
  firestoreEnabled?: boolean;
  /** Firestore logical document path for the bot token (without trailing '/token') */
  tokenDocPath?: string;
  /** Firestore logical document path for the broadcaster token (without trailing '/token') */
  broadcasterTokenDocPath?: string;

  /** Message bus prefix, e.g., "dev." */
  busPrefix?: string;
  /** Default max retries for publishers */
  publishMaxRetries?: number;

  /** Discord integration master switch */
  discordEnabled?: boolean;
  /** Discord bot token (sensitive) */
  discordBotToken?: string; // secret
  /** Single Discord guild (server) to operate in */
  discordGuildId?: string;
  /** Allowlisted Discord channel IDs to listen in */
  discordChannels?: string[];
  /** If true, Discord ingress will read bot token from token store V2 (authTokens/discord/bot) */
  discordUseTokenStore?: boolean;
  /** If true, and store does not have a token, fallback to env discordBotToken */
  discordAllowEnvFallback?: boolean;
  /** Optional poll interval in ms to check for Discord bot token rotation; default 60000 */
  discordTokenPollMs?: number;

  /** Optional Discord OAuth client id (used for adapter skeleton) */
  discordClientId?: string;
  /** Optional Discord OAuth client secret (used for adapter skeleton) */
  discordClientSecret?: string;
  /** Optional Discord OAuth redirect URI (used for adapter skeleton) */
  discordRedirectUri?: string;
  /** Optional Discord OAuth scopes (used for adapter skeleton) */
  discordOauthScopes?: string[];
  /** Optional Discord OAuth permissions (bitmask, used for bot authorization) */
  discordOauthPermissions?: number;

  /** Twilio integration master switch */
  twilioEnabled?: boolean;
  /** Twilio Account SID */
  twilioAccountSid?: string;
  /** Twilio Auth Token */
  twilioAuthToken?: string;
  /** Twilio API Key */
  twilioApiKey?: string;
  /** Twilio API Secret */
  twilioApiSecret?: string;
  /** Twilio Conversations Service SID */
  twilioConversationsServiceSid?: string;
  /** Twilio Identity */
  twilioIdentity?: string;
}

export interface TwitchTokenData {
  accessToken: string;
  refreshToken?: string | null;
  scope?: string[];
  expiresIn?: number | null; // seconds
  obtainmentTimestamp?: number | null; // epoch ms
  userId?: string | null; // Twitch user ID associated with the token
}

export interface ITokenStore {
  getToken(): Promise<TwitchTokenData | null>;
  setToken(token: TwitchTokenData): Promise<void>;
}


//export * from './gateways';
export * from './events';

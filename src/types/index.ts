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

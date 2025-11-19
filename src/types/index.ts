/**
 * Shared types for BitBrat
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface IConfig {
  port: number;
  logLevel: LogLevel;
  // Twitch config (Epic 2)
  twitchEnabled: boolean;
  twitchBotUsername?: string;
  twitchClientId?: string;
  twitchClientSecret?: string; // secret
  twitchRedirectUri?: string;
  twitchScopes: string[]; // for OAuth
  twitchChannels: string[];
  commandWhitelist: string[];
  oauthStateSecret?: string; // secret for state HMAC
  // Firestore usage and OAuth token persistence
  firestoreEnabled: boolean;
  tokenDocPath?: string; // e.g., oauth/twitch/bot (bot chat identity)
  broadcasterTokenDocPath?: string; // e.g., oauth/twitch/broadcaster (EventSub identity)
  // Event Router
  eventRouterMode?: 'inprocess' | 'pubsub';
  eventRouterTopic?: string;
  // Epic 3 – Orchestration knobs
  dryRun?: boolean;
  responseRate?: number;
  triggerKeywords?: string[];
  contextWindowSize?: number;
  maxReplyLength?: number; // overall cap of a single reply text before splitting
  ragMaxHighlights?: number; // max number of RAG highlight snippets to include in prompt
  ragMaxFacts?: number; // max number of user/channel facts to include in prompt
  rateLimitWindowMs?: number;
  rateLimitMaxResponses?: number;
  userCooldownMs?: number;
  blocklistTerms?: string[];
  // Twitch message constraints
  twitchMaxMessageLength?: number; // per-message cap for Twitch chat (default ~480)
  replyChunkDelayMs?: number; // small delay between multi-message sends
  // Epic 4 – LLM settings
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTimeoutMs?: number;
  openaiMaxRetries?: number;
  botPersonalityName?: string;
  // Fallback replies used when LLM errors out
  fallbackReplies?: string[];
  // Moderation / Spam Guard
  spamGuardEnabled?: boolean;
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

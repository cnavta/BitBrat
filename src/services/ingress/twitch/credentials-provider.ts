/**
 * Twitch Credentials Provider
 * llm_prompt: Define a minimal, pluggable interface for resolving chat auth without side effects.
 *
 * Architectural intent:
 * - Primary source of truth: Firestore docs written by oauth-flow (future implementation).
 * - For scaffolding, provide only the interface and a safe no-op provider.
 * - Never log secrets; do not perform network calls in this module for scaffolding (INEG-01).
 */

import type { IConfig, TwitchTokenData } from '../../../types';
import { FirestoreTokenStore } from '../../firestore-token-store';

export interface TwitchChatAuth {
  accessToken: string; // OAuth access token for IRC-capable identity (bot or broadcaster)
  userId?: string;     // Twitch user id for the identity (optional for IRC auth)
  login: string;       // Twitch login (lowercase)
  // Optional refreshable token fields (when using full OAuth via Firestore)
  refreshToken?: string | null;
  scope?: string[];
  expiresIn?: number | null;           // seconds
  obtainmentTimestamp?: number | null; // epoch ms
}

/**
 * Provider interface for retrieving Twitch chat authentication details.
 */
export interface ITwitchCredentialsProvider {
  /** Resolve chat auth for the given channel login or id. Implementation may accept either. */
  getChatAuth(loginOrChannel: string): Promise<TwitchChatAuth>;
  /** Resolve broadcaster auth from a known path (e.g., /oauth/twitch/broadcaster/token) if available. */
  getBroadcasterAuth?(loginOrChannel: string): Promise<TwitchChatAuth | null>;
  /** Optional hook for persisting refreshed tokens (used with Twurple RefreshingAuthProvider). */
  saveRefreshedToken?(token: TwitchTokenData): Promise<void>;
}

/**
 * No-op credentials provider used during scaffolding. Always rejects.
 * Replace with Firestore/env-backed provider in INEG-03.
 */
export class NoopTwitchCredentialsProvider implements ITwitchCredentialsProvider {
  async getChatAuth(_loginOrChannel: string): Promise<TwitchChatAuth> {
    throw new Error('TwitchCredentialsProvider not implemented yet (INEG-03)');
  }
}

/**
 * Env-backed credentials provider (INEG-03)
 * - Reads optional values from environment for scaffolding/testing.
 * - Does NOT log secrets.
 *
 * Environment (optional):
 * - TWITCH_BOT_ACCESS_TOKEN
 * - TWITCH_BOT_USER_ID
 * - TWITCH_BOT_USERNAME
 */
export class EnvTwitchCredentialsProvider implements ITwitchCredentialsProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getChatAuth(loginOrChannel: string): Promise<TwitchChatAuth> {
    const accessToken = String(this.env.TWITCH_BOT_ACCESS_TOKEN || '').trim();
    const userId = String(this.env.TWITCH_BOT_USER_ID || '').trim();
    const login = String(this.env.TWITCH_BOT_USERNAME || loginOrChannel || '').trim().toLowerCase();

    if (!accessToken) {
      throw new Error('EnvTwitchCredentialsProvider: missing token');
    }
    if (!login) {
      throw new Error('EnvTwitchCredentialsProvider: missing login');
    }
    return { accessToken, userId: userId || undefined, login };
  }

  async getBroadcasterAuth(_loginOrChannel: string): Promise<TwitchChatAuth | null> {
    // Env provider doesn't currently distinguish broadcaster tokens in env
    return null;
  }
}

/**
 * Config-backed credentials provider
 * - Uses centralized IConfig object to resolve credentials and avoids direct env usage in app code.
 * - Never logs secrets.
 */
export class ConfigTwitchCredentialsProvider implements ITwitchCredentialsProvider {
  constructor(private readonly cfg: IConfig) {}

  async getChatAuth(loginOrChannel: string): Promise<TwitchChatAuth> {
    const accessToken = String(this.cfg.twitchBotAccessToken || '').trim();
    const userId = String(this.cfg.twitchBotUserId || '').trim();
    const login = String(this.cfg.twitchBotUsername || loginOrChannel || '').trim().toLowerCase();

    if (!accessToken) {
      throw new Error('ConfigTwitchCredentialsProvider: missing token');
    }
    if (!login) {
      throw new Error('ConfigTwitchCredentialsProvider: missing login');
    }
    return { accessToken, userId: userId || undefined, login };
  }

  async getBroadcasterAuth(_loginOrChannel: string): Promise<TwitchChatAuth | null> {
    return null;
  }
}

/**
 * Firestore-backed credentials provider
 * - Reads the bot (or broadcaster) token from Firestore via FirestoreTokenStore
 * - Exposes refresh metadata so callers can create a RefreshingAuthProvider
 * - Persists refreshed tokens via saveRefreshedToken()
 */
export class FirestoreTwitchCredentialsProvider implements ITwitchCredentialsProvider {
  private readonly store: FirestoreTokenStore;
  private readonly broadcasterStore: FirestoreTokenStore;
  private readonly loginHint?: string;
  private botUserId?: string;
  private broadcasterUserId?: string;

  constructor(private readonly cfg: IConfig, store?: FirestoreTokenStore) {
    this.store = store || new FirestoreTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot');
    this.broadcasterStore = new FirestoreTokenStore('oauth/twitch/broadcaster');
    this.loginHint = cfg.twitchBotUsername;
  }

  async getChatAuth(loginOrChannel: string): Promise<TwitchChatAuth> {
    const token = await this.store.getToken();
    const login = (this.loginHint || loginOrChannel || '').toLowerCase();
    if (!token || !token.accessToken) {
      throw new Error('FirestoreTwitchCredentialsProvider: no token in store');
    }
    if (token.userId) {
      this.botUserId = token.userId;
    }
    return {
      accessToken: token.accessToken,
      userId: token.userId ?? undefined,
      login,
      refreshToken: token.refreshToken ?? null,
      scope: token.scope ?? [],
      expiresIn: token.expiresIn ?? null,
      obtainmentTimestamp: token.obtainmentTimestamp ?? null,
    };
  }

  async getBroadcasterAuth(loginOrChannel: string): Promise<TwitchChatAuth | null> {
    const token = await this.broadcasterStore.getToken();
    if (!token || !token.accessToken) {
      return null;
    }
    if (token.userId) {
      this.broadcasterUserId = token.userId;
    }
    return {
      accessToken: token.accessToken,
      userId: token.userId ?? undefined,
      login: loginOrChannel.toLowerCase(),
      refreshToken: token.refreshToken ?? null,
      scope: token.scope ?? [],
      expiresIn: token.expiresIn ?? null,
      obtainmentTimestamp: token.obtainmentTimestamp ?? null,
    };
  }

  async saveRefreshedToken(token: TwitchTokenData): Promise<void> {
    const botId = this.cfg.twitchBotUserId || this.botUserId;
    if (token.userId && token.userId === this.broadcasterUserId) {
      await this.broadcasterStore.setToken(token);
    } else if (botId) {
      // If we know the bot's userId, ensure we don't overwrite it with an aliased ID
      await this.store.setToken({
        ...token,
        userId: botId,
      });
    } else {
      // Fallback: save as is if we haven't loaded the bot token yet
      await this.store.setToken(token);
    }
  }
}

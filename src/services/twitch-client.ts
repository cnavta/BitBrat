/**
 * Twitch Chat Client Wrapper
 *
 * Purpose
 * - Provide a small, typed facade over Twurple's ChatClient tailored for BitBrat.
 * - Manage OAuth via a pluggable ITokenStore; persist refreshed tokens with userId and scope.
 * - Normalize inbound messages into a stable internal shape (IChatMessageEvent).
 * - Apply a lightweight command whitelist filter (with feature-flagged bypass for Custom Commands).
 * - Offer safe sendReply() with transient retry policy and structured error logging.
 * - Expose minimal lifecycle observers (onConnected/onDisconnected/onJoined/onParted) for orchestration.
 *
 * Design notes
 * - Auth uses Twurple RefreshingAuthProvider. On refresh, we validate the token to resolve userId then
 *   persist to Firestore (or any ITokenStore) so downstream components can rely on userId being present.
 * - Command filtering drops unknown "!command" invocations unless they are whitelisted or a bypass feature
 *   flag is enabled for the Custom Commands subsystem.
 * - sendReply() retries transient failures and 429, but will not retry client mistakes (4xx other than 429).
 *
 * llm_prompt: Keep this wrapper transport-focused. Avoid business logic here; prefer event routers/services.
 */
import { ChatClient } from '@twurple/chat';
import { RefreshingAuthProvider } from '@twurple/auth';
import { logger } from '../common/logging';
import { ITokenStore, TwitchTokenData } from '../types';

/**
 * Normalized chat message event emitted by TwitchClient.
 */
export interface IChatMessageEvent {
  /** Channel name including leading # (e.g., "#bitbrat"). */
  channel: string;
  /** User login name in lowercase per Twurple conventions. */
  user: string;
  /** Raw text as received from Twitch. */
  text: string;
  /** True if the message is an IRC /me (action) message. */
  isAction: boolean;
  /** True if the bot was mentioned via @<botUsername> in the text. */
  isMention: boolean;
  /** VIP badge present for the user, if determinable from tags. */
  isVip?: boolean;
  /** Twitch IRC message id when available (for replies, moderation, dedupe). */
  messageId?: string;
  /** Epoch milliseconds when the event was created by this client. */
  timestamp: number;
}

/**
 * Minimal surface for Twitch chat operations used by higher-level services.
 */
export interface ITwitchClient {
  /**
   * Establish IRC connection. Safe to call once; subsequent calls are no-ops.
   * Throws when no token is available in the configured tokenStore.
   */
  connect(): Promise<void>;
  /** Gracefully disconnect from IRC. */
  disconnect(): Promise<void>;
  /**
   * Join the given channels. Channel names may include or omit the leading '#'.
   * Logs failures per channel, but does not throw for the entire batch.
   */
  joinChannels(channels: string[]): Promise<void>;
  /** Register a single message callback (last set wins). */
  onMessage(cb: (evt: IChatMessageEvent) => void): void;
  /**
   * Send a reply to a channel with transient retries.
   * - Retries on 5xx/transport errors and 429 (rate limit), up to 3 attempts with jitter.
   * - Does not retry other 4xx (client errors) to avoid duplication.
   * - correlationId is included in error logs for end-to-end traceability.
   */
  sendReply(channel: string, message: string, correlationId?: string): Promise<void>;
}

/**
 * Construction options for TwitchClient.
 */
export interface TwitchClientOptions {
  /** Registered Twitch application client id. */
  clientId: string;
  /** Registered Twitch application client secret. */
  clientSecret: string;
  /** Bot login name (used for self-filtering and lifecycle events). */
  botUsername: string;
  /** Initial desired channels (note: connect() joins none by default; call joinChannels()). */
  channels: string[];
  /** Lowercased list of allowed commands (without leading '!') for whitelist filter. */
  commandWhitelist: string[];
  /** Backing store for OAuth tokens (Firestore or other implementation). */
  tokenStore: ITokenStore;
}

/**
 * Twurple-based chat client with token persistence and safe messaging.
 */
export class TwitchClient implements ITwitchClient {
  private chat?: ChatClient;
  private onMessageCb?: (evt: IChatMessageEvent) => void;
  // Lifecycle observers (optional)
  private onConnectedCbs: Array<() => void> = [];
  private onDisconnectedCbs: Array<(manually: boolean, reason?: any) => void> = [];
  private onJoinedCbs: Array<(channel: string) => void> = [];
  private onPartedCbs: Array<(channel: string) => void> = [];

  // Diagnostics for observability
  /** Internal counters/timestamps for health/debug endpoints. */
  private diag: {
    droppedByFilter: number;
    tokenLastRefreshTs: number | null;
    tokenLastValidateTs: number | null;
    tokenLastValidateError: string | null;
  } = {
    droppedByFilter: 0,
    tokenLastRefreshTs: null,
    tokenLastValidateTs: null,
    tokenLastValidateError: null,
  };

  constructor(private opts: TwitchClientOptions) {}

  /**
   * Build a Twurple RefreshingAuthProvider from the stored token and attach a
   * refresh handler that validates and persists updated tokens.
   *
   * Throws when no access token is available (user must complete OAuth flow).
   */
  private async createAuthProvider(): Promise<RefreshingAuthProvider> {
    const tokenData = await this.opts.tokenStore.getToken();
    if (!tokenData || !tokenData.accessToken) {
      throw new Error('No OAuth token available. Run OAuth flow and store token in Firestore.');
    }

    const provider = new RefreshingAuthProvider({ clientId: this.opts.clientId, clientSecret: this.opts.clientSecret });
    await provider.addUserForToken(
      {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken ?? null,
        expiresIn: tokenData.expiresIn ?? null,
        obtainmentTimestamp: (tokenData.obtainmentTimestamp ?? Date.now()),
      },
      ['chat']
    );

    // Persist every refresh so other subsystems (e.g., EventSub) see fresh tokens and userId.
    provider.onRefresh(async (userId, newTokenData) => {
      this.diag.tokenLastRefreshTs = Date.now();
      let validatedUserId: string | null = null;
      try {
        // Validate to record last validation status for diagnostics.
        const vResp = await fetch('https://id.twitch.tv/oauth2/validate', {
          headers: { Authorization: `OAuth ${newTokenData.accessToken}` },
        });
        this.diag.tokenLastValidateTs = Date.now();
        if (vResp.ok) {
          const v = await vResp.json() as Record<string, any>;
          validatedUserId = v?.user_id ? String(v.user_id) : null;
          this.diag.tokenLastValidateError = null;
        } else {
          const vText = await vResp.text();
          this.diag.tokenLastValidateError = `status ${vResp.status}: ${vText?.slice(0,200)}`;
        }
      } catch (err:any) {
        this.diag.tokenLastValidateTs = Date.now();
        this.diag.tokenLastValidateError = err?.message || 'validate_error';
      }
      const updated: TwitchTokenData = {
        accessToken: newTokenData.accessToken,
        refreshToken: newTokenData.refreshToken ?? null,
        expiresIn: newTokenData.expiresIn ?? null,
        obtainmentTimestamp: newTokenData.obtainmentTimestamp ?? null,
        scope: newTokenData.scope ?? [],
        userId: validatedUserId || userId || null,
      };
      await this.opts.tokenStore.setToken(updated);
      logger.info('Twitch token refreshed and stored');
    });

    return provider;
  }

  /**
   * Connect to Twitch IRC via Twurple and wire message + lifecycle handlers.
   * Note: channels are not auto-joined; invoke joinChannels() after connect.
   */
  async connect(): Promise<void> {
    const authProvider = await this.createAuthProvider();

    this.chat = new ChatClient({
      authProvider,
      channels: [], // join later via joinChannels
      logger: { minLevel: 'warning' },
      requestMembershipEvents: true,
    });

    this.chat.onConnect(() => {
      logger.info('Twitch connected');
      try { this.onConnectedCbs.forEach(cb => cb()); } catch {}
    });

    this.chat.onDisconnect((manually, reason) => {
      logger.warn('Twitch disconnected', { manually, reason });
      try { this.onDisconnectedCbs.forEach(cb => cb(!!manually, reason)); } catch {}
    });

    // Twurple v7 ChatClient does not expose onReconnect; rely on onDisconnect and automatic reconnects.

    this.chat.onJoin((channel, user) => {
      if (user.toLowerCase() === this.opts.botUsername.toLowerCase()) {
        logger.info('Joined channel', { channel });
        try { this.onJoinedCbs.forEach(cb => cb(channel)); } catch {}
      }
    });

    // onPart may not exist in some versions; guard accordingly
    if (typeof (this.chat as any).onPart === 'function') {
      (this.chat as any).onPart((channel: string, user: string) => {
        if (user.toLowerCase() === this.opts.botUsername.toLowerCase()) {
          logger.info('Parted channel', { channel });
          try { this.onPartedCbs.forEach(cb => cb(channel)); } catch {}
        }
      });
    }

    this.chat.onMessage((channel, user, text, msg) => {
      if (!this.onMessageCb) return;
      // Ignore self
      if (user.toLowerCase() === this.opts.botUsername.toLowerCase()) return;
      // Filter commands unless whitelisted; optionally bypass when Custom Commands are enabled.
      // This keeps unsolicited !commands from triggering in production unless explicitly allowed.
      try {
        const { features } = require('../common/feature-flags');
        const { shouldDropCommand } = require('./filters/command-whitelist');
        const bypass = features.enabled('bot.customCommands.enabled', false) && features.enabled('bot.customCommands.bypassWhitelist', false);
        if (shouldDropCommand(text, this.opts.commandWhitelist, bypass)) {
          const cmd = text.startsWith('!') ? text.split(/\s+/)[0].slice(1).toLowerCase() : undefined;
          this.diag.droppedByFilter++;
          logger.debug('chat.drop.filtered_command', { channel, cmd, bypass });
          return;
        }
      } catch {
        // Fallback to legacy behavior if helper/features not available
        if (text.startsWith('!')) {
          const cmd = text.split(/\s+/)[0].slice(1).toLowerCase();
          if (!this.opts.commandWhitelist.map((c) => c.toLowerCase()).includes(cmd)) {
            this.diag.droppedByFilter++;
            logger.debug('chat.drop.filtered_command', { channel, cmd });
            return;
          }
        }
      }
      // Heuristic mention detection; safe for routing/priority decisions.
      const isMention = text.toLowerCase().includes(`@${this.opts.botUsername.toLowerCase()}`);
      const uinfo: any = (msg as any)?.userInfo;
      const badges: any[] = Array.isArray(uinfo?.badges) ? uinfo.badges : [];
      // Robust VIP detection across Twurple versions by checking both helper and raw badge id.
      const isVip = Boolean(uinfo?.isVip || badges.some((b: any) => b?.id === 'vip'));
      const evt: IChatMessageEvent = {
        channel,
        user,
        text,
        isAction: (msg as any)?.messageType === 'action',
        isMention,
        isVip,
        messageId: (msg as any)?.id || (msg as any)?.tags?.id,
        timestamp: Date.now(),
      };
      this.onMessageCb(evt);
    });

    await this.chat.connect();
  }

  /** Close IRC connection. */
  async disconnect(): Promise<void> {
    await this.chat?.quit();
  }

  /**
   * Join the provided channels sequentially, logging per-channel outcomes.
   * Errors (network/permission) are logged with best-effort status codes.
   */
  async joinChannels(channels: string[]): Promise<void> {
    if (!this.chat) throw new Error('Chat client not connected');
    for (const ch of channels) {
      const channel = ch.startsWith('#') ? ch : `#${ch}`;
      try {
        await this.chat.join(channel);
        logger.info('twitch.join_success', { channel });
      } catch (err: any) {
        const status = err?.status || err?.statusCode || err?.code;
        logger.warn('Failed to join channel', { channel, error: err?.message, status });
      }
    }
  }

  // Observer registration
  onConnected(cb: () => void): void { this.onConnectedCbs.push(cb); }
  onDisconnected(cb: (manually: boolean, reason?: any) => void): void { this.onDisconnectedCbs.push(cb); }
  onJoined(cb: (channel: string) => void): void { this.onJoinedCbs.push(cb); }
  onParted(cb: (channel: string) => void): void { this.onPartedCbs.push(cb); }

  onMessage(cb: (evt: IChatMessageEvent) => void): void {
    this.onMessageCb = cb;
  }

  /**
   * Send a message to a channel with transient retry policy.
   * Retries up to 3 times with small backoff+jitter on transient errors and 429.
   * Client errors (4xx other than 429) are not retried.
   */
  async sendReply(channel: string, message: string, correlationId?: string): Promise<void> {
    if (!this.chat) throw new Error('Chat client not connected');
    const ch = channel.startsWith('#') ? channel : `#${channel}`;
    const { retryAsync, isTransientError } = await import('../common/retry');

    return retryAsync(async () => {
      try {
        await this.chat!.say(ch, message);
      } catch (err: any) {
        // Re-throw to trigger retry handler
        throw err;
      }
    }, {
      attempts: 3,
      baseDelayMs: 250,
      jitterMs: 100,
      shouldRetry: (err: any) => {
        const code = err?.status || err?.statusCode || err?.code;
        // Abort on 4xx except 429
        if (code && Number(code) >= 400 && Number(code) < 500 && Number(code) !== 429) return false;
        return isTransientError(err);
      },
    }).catch((err: any) => {
      logger.error('twitch.send_failed', { channel: ch, error: err?.message, correlationId });
      throw err;
    });
  }

  // Expose diagnostics for observability
  getDiagnostics() {
    return { ...this.diag };
  }
}

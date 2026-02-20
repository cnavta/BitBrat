/**
 * Twitch IRC Client — Full Twurple Chat integration with safe test guards
 * llm_prompt: Implement a production-ready IRC client that connects using Twurple Chat,
 * normalizes messages via EnvelopeBuilder, and publishes to the internal bus. Avoid
 * network connections during tests or when explicitly disabled via env.
 */

import { IEnvelopeBuilder, IrcMessageMeta } from './envelope-builder';
import { ITwitchIngressPublisher } from './publisher';
import type { ITwitchCredentialsProvider, TwitchChatAuth } from './credentials-provider';
import type { IConfig } from '../../../types';
import {logger} from "../../../common/logging";
import { startActiveSpan } from '../../../common/tracing';
import { InternalEventV2 } from '../../../types/events';

export type TwitchConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

export interface TwitchIrcDebugSnapshot {
  state: TwitchConnectionState;
  userId?: string;
  displayName?: string;
  joinedChannels: string[];
  lastMessageAt?: string; // ISO
  lastError?: { code?: string; message: string } | null;
  reconnects?: number;
  counters?: { received?: number; published?: number; failed?: number };
}

export interface ITwitchIrcClient {
  /** Returns the latest debug snapshot of the IRC connection. */
  getSnapshot(): TwitchIrcDebugSnapshot;
  /** Start the client (connect to Twitch unless disabled). */
  start(): Promise<void>;
  /** Stop the client (disconnect). */
  stop(): Promise<void>;
  /** Send a text message to a channel via IRC (egress helper). */
  sendText(text: string, channel?: string): Promise<void>;
  /** Send a whisper (DM) to a user via Helix API. */
  sendWhisper(text: string, userId: string): Promise<void>;
}

/**
 * No-op implementation used during scaffolding. It only tracks in-memory snapshot fields.
 * Retained for potential fallback, but not exported by default.
 */
class NoopTwitchIrcClient implements ITwitchIrcClient {
  protected snapshot: TwitchIrcDebugSnapshot = {
    state: 'DISCONNECTED',
    joinedChannels: [],
    reconnects: 0,
    counters: { received: 0, published: 0, failed: 0 },
  };

  getSnapshot(): TwitchIrcDebugSnapshot {
    return { ...this.snapshot, joinedChannels: [...this.snapshot.joinedChannels] };
  }

  async start(): Promise<void> {
    this.snapshot.state = 'DISCONNECTED';
  }

  async stop(): Promise<void> {
    this.snapshot.state = 'DISCONNECTED';
  }

  async sendText(_text: string, _channel?: string): Promise<void> {
    // no-op in tests/disabled mode
    return;
  }

  async sendWhisper(_text: string, _userId: string): Promise<void> {
    // no-op in tests/disabled mode
    return;
  }
}

/**
 * TwitchIrcClient — Twurple-backed client with message normalization & publish
 */
export class TwitchIrcClient extends NoopTwitchIrcClient implements ITwitchIrcClient {
  private chat: any | null = null;
  private helix: any | null = null;
  private disconnecting = false;
  private readonly cfg?: IConfig;
  private readonly credentialsProvider?: ITwitchCredentialsProvider;
  private readonly egressDestinationTopic?: string;

  constructor(
    private readonly builder: IEnvelopeBuilder,
    private readonly publisher: ITwitchIngressPublisher,
    private readonly channels: string[] = [],
    options?: { cfg?: IConfig; credentialsProvider?: ITwitchCredentialsProvider; disableConnect?: boolean; egressDestinationTopic?: string }
  ) {
    super();
    this.cfg = options?.cfg;
    this.credentialsProvider = options?.credentialsProvider;
    this.egressDestinationTopic = options?.egressDestinationTopic;
    // Normalize channels: prefer explicit parameter, otherwise from config, otherwise env (for backward-compatible tests)
    const fromCfg = this.cfg?.twitchChannels || [];
    const fromEnv = parseChannels(process.env.TWITCH_CHANNELS);
    this.snapshot.joinedChannels = [];
    (this as any).channels = (channels && channels.length > 0 ? channels : (fromCfg.length > 0 ? fromCfg : fromEnv));
    // Store disable flag on instance if provided (used in start())
    (this as any)._disableConnect = options?.disableConnect;
  }

  getSnapshot(): TwitchIrcDebugSnapshot {
    return { ...this.snapshot, joinedChannels: [...this.snapshot.joinedChannels] };
  }

  /** Start: connect to Twitch unless disabled. */
  async start(): Promise<void> {
    const channels: string[] = ((this as any).channels || []).slice();
    const normalized = channels.map((c) => (c.startsWith('#') ? c : `#${c}`));
    const disableFlag: boolean | undefined = (this as any)._disableConnect;
    const disabled =
      disableFlag === true ||
      process.env.NODE_ENV === 'test' ||
      this.cfg?.twitchEnabled === false ||
      this.cfg?.twitchDisableConnect === true;

    logger.debug('Twitch IRC client starting', {normalized, disable: disableFlag, env: process.env.NODE_ENV});

    if (disabled) {
      logger.debug('Twitch IRC client disabled');
      // Test or explicit disable: emulate a connected state without network IO
      this.snapshot.state = 'CONNECTED';
      this.snapshot.joinedChannels = normalized;
      return;
    }

    // Attempt to load Twurple Chat/Auth dynamically to avoid hard coupling in tests
    let ChatClient: any;
    let ApiClient: any;
    let StaticAuthProvider: any;
    let RefreshingAuthProvider: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ChatClient = require('@twurple/chat').ChatClient;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ApiClient = require('@twurple/api').ApiClient;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      StaticAuthProvider = require('@twurple/auth').StaticAuthProvider;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      RefreshingAuthProvider = require('@twurple/auth').RefreshingAuthProvider;
    } catch (e: any) {
      // Fallback: pretend connected but note the error
      logger.error('Failed to load Twurple packages', e);
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: 'Twurple packages not available: ' + (e?.message || String(e)) };
      throw e;
    }

    // Resolve client credentials from Config/provider
    const clientId = (this.cfg?.twitchClientId || '').trim();
    const clientSecret = (this.cfg?.twitchClientSecret || '').trim();
    let accessToken = '';
    let authData: TwitchChatAuth | null = null;
    try {
      if (this.credentialsProvider && normalized.length > 0) {
        const login = normalized[0].replace(/^#/, '');
        authData = await this.credentialsProvider.getChatAuth(login);
        accessToken = authData.accessToken || '';
        this.snapshot.userId = authData.userId || this.cfg?.twitchBotUserId;
        this.snapshot.displayName = authData.login || login;
      }
    } catch (e) {
      // fallthrough; error handled below
      logger.error('Failed to retrieve Twitch credentials', { error: (e as any)?.message || String(e) });
    }

    // Resolve broadcaster credentials if supported (Sprint 152/Generic Egress Alignment)
    let broadcasterAuth: TwitchChatAuth | null = null;
    try {
      if (this.credentialsProvider?.getBroadcasterAuth && normalized.length > 0) {
        broadcasterAuth = await this.credentialsProvider.getBroadcasterAuth(normalized[0].replace(/^#/, ''));
      }
    } catch (e) {
      logger.debug('Failed to retrieve broadcaster credentials', { error: (e as any)?.message || String(e) });
    }

    // Fallback: allow direct config-provided token if provider was not configured or failed
    if (!accessToken && this.cfg?.twitchBotAccessToken) {
      accessToken = String(this.cfg.twitchBotAccessToken).trim();
    }
    if (!clientId || !accessToken) {
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: 'Missing twitch clientId or access token (config/provider)' };
      throw new Error('twitch_auth_missing');
    }

    // Prefer RefreshingAuthProvider if we have clientSecret and refresh token metadata
    let authProvider: any;
    if (RefreshingAuthProvider && clientSecret && authData && authData.refreshToken) {
      try {
        authProvider = new RefreshingAuthProvider({
          clientId,
          clientSecret,
        });
        authProvider.onRefresh(async (userId: string, newToken: any) => {
          try {
            if (this.credentialsProvider?.saveRefreshedToken) {
              await this.credentialsProvider.saveRefreshedToken({
                accessToken: newToken.accessToken,
                refreshToken: newToken.refreshToken,
                scope: newToken.scope,
                expiresIn: newToken.expiresIn,
                obtainmentTimestamp: newToken.obtainmentTimestamp,
                userId,
              });
            }
          } catch (err: any) {
            logger.warn('Failed to persist refreshed Twitch token', { error: err?.message || String(err) });
          }
        });
        // add the user token to provider for chat scope
        const tokenData = {
          accessToken: authData.accessToken,
          refreshToken: authData.refreshToken,
          scope: authData.scope ?? [],
          expiresIn: authData.expiresIn ?? null,
          obtainmentTimestamp: authData.obtainmentTimestamp ?? null,
        };
        const botId = authData.userId || this.cfg?.twitchBotUserId;
        if (botId) {
          authProvider.addUser(botId, tokenData, ['chat']);
        } else {
          await authProvider.addUserForToken(tokenData, ['chat']);
        }

        // Optionally add broadcaster credentials to the auth provider. By default, we DO NOT attach
        // broadcaster credentials for chat to ensure all IRC messages are sent via the bot identity.
        // Enable via cfg.twitchChatUseBotOnly=false or env TWITCH_CHAT_USE_BOT_ONLY=false if needed.
        const chatUseBotOnly = (this.cfg as any)?.twitchChatUseBotOnly ?? (process.env.TWITCH_CHAT_USE_BOT_ONLY !== 'false');
        if (!chatUseBotOnly && broadcasterAuth) {
          const bTokenData = {
            accessToken: broadcasterAuth.accessToken,
            refreshToken: broadcasterAuth.refreshToken,
            scope: broadcasterAuth.scope ?? [],
            expiresIn: broadcasterAuth.expiresIn ?? null,
            obtainmentTimestamp: broadcasterAuth.obtainmentTimestamp ?? null,
          };
          if (broadcasterAuth.userId) {
            authProvider.addUser(broadcasterAuth.userId, bTokenData, ['chat']);
          } else {
            await authProvider.addUserForToken(bTokenData, ['chat']);
          }
        }
      } catch (e: any) {
        logger.warn('Falling back to StaticAuthProvider due to RefreshingAuthProvider init failure', { error: e?.message || String(e) });
        authProvider = new StaticAuthProvider(clientId, accessToken);
      }
    } else {
      authProvider = new StaticAuthProvider(clientId, accessToken);
    }

    this.snapshot.state = 'CONNECTING';
    this.disconnecting = false;

    try {
      // Construct chat client
      this.chat = new ChatClient({
        authProvider,
        channels: normalized,
        requestMembershipEvents: true,
        // Twurple auto-reconnects by default, but keep defaults. We monitor events below.
      });

      if (ApiClient) {
        this.helix = new ApiClient({ authProvider });
      }
    } catch (e: any) {
      logger.error('Twitch client initialization error', e);
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: e?.message || String(e) };
      throw e;
    }

    // Wire events
    this.chat.onConnect(() => {
      this.snapshot.state = 'CONNECTED';
      this.snapshot.lastError = null;
      this.snapshot.joinedChannels = normalized;
      try {
        const nick = (this.chat as any)?.currentNick || '(unknown)';
        logger.info('twitch.irc.connected', { channels: normalized, nick });
      } catch {
        logger.debug('Twitch IRC connected to channels:', { normalized });
      }
    });
    this.chat.onDisconnect((manually: boolean, reason: unknown) => {
      this.snapshot.state = this.disconnecting ? 'DISCONNECTED' : 'ERROR';
      this.snapshot.lastError = reason ? { message: String(reason) } : this.snapshot.lastError || null;
      logger.debug('Twitch IRC disconnected', {manually, reason, snapshot: this.snapshot});
    });
    this.chat.onJoin((channel: string, user: string) => {
      if (user && this.chat?.currentNick && user.toLowerCase() === this.chat.currentNick.toLowerCase()) {
        if (!this.snapshot.joinedChannels.includes(channel)) {
          this.snapshot.joinedChannels.push(channel);
          logger.debug('Twitch IRC joined channel:', {channel});
        }
      }
    });
    this.chat.onPart((channel: string, user: string) => {
      if (user && this.chat?.currentNick && user.toLowerCase() === this.chat.currentNick.toLowerCase()) {
        this.snapshot.joinedChannels = this.snapshot.joinedChannels.filter((c) => c !== channel);
        logger.debug('Twitch IRC left channel:', {channel});
      }
    });

    // Message handler → normalize and publish
    this.chat.onMessage(async (channel: string, user: string, text: string, msg: any) => {
      try {
        logger.debug('Received Twitch IRC message:', {channel, user, text});
        await this.handleMessage(channel, user, text, twurpleToMeta(msg, user));
      } catch (e: any) {
        // swallow to not crash listener; snapshot will be updated in handleMessage
        logger.error('Failed to handle Twitch IRC message', {channel, user, text, msg, error: e as Record<string, any>});
      }
    });

    // Connect and join channels
    await this.chat.connect();
    // Twurple should auto-join specified channels; ensure state reflects intent
    this.snapshot.joinedChannels = normalized;
  }

  async stop(): Promise<void> {
    this.disconnecting = true;
    if (this.chat) {
      try {
        await this.chat.quit();
      } catch {
        // ignore
      }
      this.chat = null;
    }
    this.snapshot.state = 'DISCONNECTED';
    logger.debug('Twitch IRC stopped');
  }

  /**
   * Send a chat message out to Twitch IRC. If no channel is provided, uses the first configured channel if available.
   * In disabled/test mode where chat is not connected, this is a no-op that logs at debug level.
   */
  async sendText(text: string, channel?: string): Promise<void> {
    const channels: string[] = ((this as any).channels || []).slice();
    const target = channel || (channels[0] ? (channels[0].startsWith('#') ? channels[0] : `#${channels[0]}`) : undefined);
    if (!text || !text.trim()) return;
    if (!target) {
      logger.warn('twitch.egress.no_channel', { text });
      return;
    }
    if (this.chat && typeof this.chat.say === 'function') {
      try {
        const nick = (this.chat as any)?.currentNick || '(unknown)';
        await this.chat.say(target, text);
        logger.info('twitch.egress.sent', { channel: target, nick });
      } catch (e: any) {
        logger.error('twitch.egress.send_error', { channel: target, error: e?.message || String(e) });
        throw e;
      }
    } else {
      // No live connection (tests/disabled). Treat as no-op.
      logger.debug('twitch.egress.noop', { channel: target, reason: 'chat_not_connected' });
    }
  }

  /**
   * Send a whisper (DM) to a user via Helix API.
   * Requires 'user:manage:whispers' scope.
   */
  async sendWhisper(text: string, userId: string): Promise<void> {
    if (!text || !text.trim()) return;
    if (!userId) {
      logger.warn('twitch.whisper.no_userId', { text });
      return;
    }

    // Strip platform prefix if present (e.g. "twitch:12345")
    const cleanUserId = userId.includes(':') ? userId.split(':')[1] : userId;

    if (this.helix) {
      try {
        const fromUserId = this.cfg?.twitchBotUserId || this.snapshot.userId;
        if (!fromUserId) {
          throw new Error('bot_user_id_unknown');
        }
        // Twitch Helix Whisper API: POST /whispers?from_user_id=...&to_user_id=...
        // Twurple: helix.whispers.sendWhisper(from, to, text)
        logger.debug('twitch.whisper.send', { to: cleanUserId, from: fromUserId  });
        await this.helix.whispers.sendWhisper(fromUserId, cleanUserId, text);
        logger.info('twitch.whisper.sent', { to: cleanUserId, from: fromUserId });
      } catch (e: any) {
        logger.error('twitch.whisper.error', { to: cleanUserId, error: e });
        throw e;
      }
    } else {
      logger.debug('twitch.whisper.noop', { to: cleanUserId, reason: 'helix_not_connected' });
    }
  }

  /**
   * Ban a user from the broadcaster's channel.
   * Note: This requires the bot to be a moderator in the channel.
   * It uses the first configured channel if none specified.
   */
  async banUser(platformUserId: string, reason?: string): Promise<void> {
    const channels: string[] = ((this as any).channels || []).slice();
    const target = channels[0] ? (channels[0].startsWith('#') ? channels[0].slice(1) : channels[0]) : undefined;
    
    if (!target) {
      logger.warn('twitch.ban.no_channel', { platformUserId });
      return;
    }

    if (this.chat && typeof (this.chat as any).ban === 'function') {
      try {
        // Twurple chat client 'ban' method takes (channel, user, reason)
        await (this.chat as any).ban(target, platformUserId, reason || '');
        logger.info('twitch.ban.sent', { channel: target, platformUserId });
      } catch (e: any) {
        logger.error('twitch.ban.error', { channel: target, platformUserId, error: e?.message || String(e) });
        throw e;
      }
    } else if (this.chat && typeof this.chat.say === 'function') {
      // Fallback to /ban command if explicit .ban() is missing or fails (some older twurple versions)
      try {
        await this.chat.say(`#${target}`, `/ban ${platformUserId} ${reason || ''}`);
        logger.info('twitch.ban.command_sent', { channel: target, platformUserId });
      } catch (e: any) {
        logger.error('twitch.ban.command_error', { channel: target, platformUserId, error: e?.message || String(e) });
        throw e;
      }
    } else {
      logger.debug('twitch.ban.noop', { platformUserId, reason: 'chat_not_connected' });
    }
  }

  /**
   * Public handler also used by Twurple onMessage wiring; can be invoked by tests.
   */
  async handleMessage(
    channel: string,
    userLogin: string,
    text: string,
    meta?: Partial<Omit<IrcMessageMeta, 'channel' | 'userLogin' | 'text'>>
  ): Promise<void> {
    this.snapshot.counters = this.snapshot.counters || {};
    // Capture a stable reference so TS understands defined-ness across async boundaries
    const counters = (this.snapshot.counters = this.snapshot.counters || {});
    counters.received = (counters.received || 0) + 1;
    this.snapshot.lastMessageAt = new Date().toISOString();

    const msg: IrcMessageMeta = {
      channel,
      userLogin,
      text,
      userDisplayName: meta?.userDisplayName,
      userId: meta?.userId,
      roomId: meta?.roomId,
      messageId: meta?.messageId,
      color: meta?.color,
      badges: meta?.badges,
      isMod: meta?.isMod,
      isSubscriber: meta?.isSubscriber,
      emotes: meta?.emotes,
      raw: meta?.raw,
    } as IrcMessageMeta;

    logger.debug('Twitch IRC message received', {msg});

    try {
      await startActiveSpan('ingress-receive', async () => {
        const evtV2: InternalEventV2 = this.builder.build(msg);
        // Ensure egress metadata is set for downstream responses to route back to this instance
        if ((!evtV2.egress || !evtV2.egress.destination) && this.egressDestinationTopic) {
          evtV2.egress = {
            destination: this.egressDestinationTopic,
            type: 'chat'
          };
        }
        await this.publisher.publish(evtV2);
        counters.published = (counters.published || 0) + 1;
      });
    } catch (e: any) {
      counters.failed = (counters.failed || 0) + 1;
      this.snapshot.lastError = { message: e?.message || String(e) };
      throw e;
    }
  }
}

function parseChannels(csv?: string): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function twurpleToMeta(msg: any, userLogin: string): Partial<Omit<IrcMessageMeta, 'channel' | 'userLogin' | 'text'>> {
  try {
    const userInfo = msg?.userInfo || {};
    const tags = msg?.tags || msg?.ircTags || {};
    const get = (k: string) => (typeof tags.get === 'function' ? tags.get(k) : tags[k]);
    return {
      userDisplayName: userInfo.displayName || userLogin,
      userId: userInfo.userId || get('user-id') || undefined,
      roomId: get('room-id') || undefined,
      messageId: msg?.id || get('id') || undefined,
      color: userInfo.color?.hex || undefined,
      badges: Array.isArray(userInfo.badges) ? userInfo.badges : undefined,
      isMod: Boolean(userInfo.isMod),
      isSubscriber: Boolean(userInfo.isSubscriber),
      raw: { tags: Object.fromEntries(typeof tags.entries === 'function' ? tags.entries() : Object.entries(tags)) },
    };
  } catch {
    return {};
  }
}

import { logger } from '../../../common/logging';
import type { ConnectorSnapshot, IngressPublisher } from '../core';
import type { IConfig } from '../../../types';
import { startActiveSpan } from '../../../common/tracing';
import type { IAuthTokenStoreV2 } from '../../oauth/auth-token-store';
import type { DiscordMessageMeta } from './envelope-builder';
import type { InternalEventV2, DebugMetadata } from '../../../types/events';

export type DiscordConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export type DiscordIngressSnapshot = ConnectorSnapshot & {
  guildId?: string;
  channelIds?: string[];
};

/**
 * Discord Ingress Client (Pure Client)
 *
 * Low-level Discord.js client wrapper without framework interfaces.
 * Handles Discord Gateway connection, message reception, and token rotation.
 *
 * This client is wrapped by DiscordConnectorAdapter which implements
 * IngressConnector and WebhookConnector interfaces.
 *
 * Sprint 11: Discord Integration Modernization (DISC-004)
 *
 * @since Sprint 11
 */
export class DiscordIngressClient {
  private client: any | null = null;
  private disconnecting = false;
  private snapshot: ConnectorSnapshot = { state: 'DISCONNECTED', counters: { received: 0, published: 0, failed: 0 } };
  private tokenPollTimer: NodeJS.Timeout | null = null;
  private currentToken: string | null = null;

  private readonly identity: string;
  private readonly debugAuthorizedUsers: Set<string>;
  private readonly processedMessageIds: Set<string> = new Set();
  private deduplicationCleanupInterval?: NodeJS.Timeout;

  /**
   * Create Discord Ingress Client
   *
   * @param buildEnvelope - Functional envelope builder (buildDiscordEnvelope)
   * @param publisher - Event publisher
   * @param cfg - Configuration
   * @param options - Optional settings (egressDestinationTopic, identity, disableIngress)
   * @param tokenStore - Optional token store for OAuth token rotation
   */
  constructor(
    private readonly buildEnvelope: (
      event: DiscordMessageMeta,
      opts?: {
        uuid?: () => string;
        nowIso?: () => string;
        egressDestination?: string;
        correlationId?: string;
        debugMetadata?: DebugMetadata;
      }
    ) => InternalEventV2,
    private readonly publisher: IngressPublisher,
    private readonly cfg: IConfig,
    private readonly options: { egressDestinationTopic?: string; identity?: string; disableIngress?: boolean } = {},
    private readonly tokenStore?: IAuthTokenStoreV2
  ) {
    this.identity = options.identity || 'bot';
    this.snapshot.guildId = cfg.discordGuildId;
    this.snapshot.channelIds = (cfg.discordChannels || []).slice();

    // Parse debug authorized users from comma-separated string
    const debugUsersStr = cfg.debugUsersDiscord || '';
    this.debugAuthorizedUsers = new Set(
      debugUsersStr.split(',').map((u) => u.trim()).filter(Boolean)
    );

    if (this.debugAuthorizedUsers.size > 0) {
      logger.info('discord.client.debug.initialized', {
        authorizedUserCount: this.debugAuthorizedUsers.size,
      });
    }
  }

  async sendText(text: string, channelId?: string): Promise<void> {
    if (!this.client || this.snapshot.state !== 'CONNECTED') {
      logger.warn('ingress-egress.discord.egress.failed_client_not_connected', { state: this.snapshot.state });
      throw new Error('discord_client_not_connected');
    }
    const targetId = channelId || (this.cfg.discordChannels && this.cfg.discordChannels[0]);
    if (!targetId) {
      logger.warn('ingress-egress.discord.egress.failed_no_target_channel');
      throw new Error('discord_no_target_channel');
    }
    try {
      const channel = await this.client.channels.fetch(targetId);
      if (!channel || !('send' in channel)) {
        logger.warn('ingress-egress.discord.egress.failed_channel_not_found', { channelId: targetId });
        throw new Error('discord_channel_not_found_or_no_send_perm');
      }
      await (channel as any).send(text);
      logger.debug('ingress-egress.discord.egress.sent', { channelId: targetId, length: text.length });
    } catch (e: any) {
      logger.error('ingress-egress.discord.egress.error', { channelId: targetId, error: e?.message || String(e) });
      throw e;
    }
  }

  /**
   * Send direct message to a Discord user
   *
   * Creates a DM channel with the user and sends the message.
   * Discord automatically creates/reuses DM channels.
   *
   * @param text - Message content
   * @param userId - Discord user ID (e.g., '123456789012345678')
   * @throws Error if client not connected
   * @throws Error if user not found
   * @throws Error if user has DMs disabled
   * @throws Error if Discord API call fails
   *
   * @example
   * ```typescript
   * await client.sendDM('Hello!', '123456789012345678');
   * ```
   *
   * @since Sprint 13
   */
  async sendDM(text: string, userId: string): Promise<void> {
    if (!this.client || this.snapshot.state !== 'CONNECTED') {
      logger.warn('discord.dm.failed_client_not_connected', { state: this.snapshot.state });
      throw new Error('discord_client_not_connected');
    }

    if (!userId || typeof userId !== 'string') {
      logger.warn('discord.dm.invalid_user_id', { userId });
      throw new Error('discord_invalid_user_id');
    }

    try {
      // Fetch the user object
      logger.debug('discord.dm.fetching_user', { userId });
      const user = await this.client.users.fetch(userId);

      if (!user) {
        logger.warn('discord.dm.user_not_found', { userId });
        throw new Error('discord_user_not_found');
      }

      // Create/get DM channel with the user
      logger.debug('discord.dm.creating_channel', { userId, username: user.username });
      const dmChannel = await user.createDM();

      if (!dmChannel || !('send' in dmChannel)) {
        logger.error('discord.dm.channel_creation_failed', { userId });
        throw new Error('discord_dm_channel_creation_failed');
      }

      // Send the message
      await dmChannel.send(text);

      logger.info('discord.dm.sent', {
        userId,
        username: user.username,
        textLength: text.length,
        channelId: dmChannel.id,
      });
    } catch (err: any) {
      const errorCode = err.code || 'unknown';
      const errorMessage = err.message || String(err);

      // Discord error codes:
      // 50007 = Cannot send messages to this user (DMs disabled)
      // 10013 = Unknown User
      // 50001 = Missing Access
      if (errorCode === 50007) {
        logger.warn('discord.dm.user_dms_disabled', { userId, error: errorMessage });
        throw new Error('discord_user_dms_disabled');
      } else if (errorCode === 10013) {
        logger.warn('discord.dm.user_not_found', { userId, error: errorMessage });
        throw new Error('discord_user_not_found');
      } else if (errorCode === 50001) {
        logger.warn('discord.dm.missing_access', { userId, error: errorMessage });
        throw new Error('discord_missing_access');
      }

      logger.error('discord.dm.send_failed', {
        userId,
        error: errorMessage,
        errorCode,
        stack: err.stack,
      });
      throw err;
    }
  }

  /**
   * Ban a user from the Discord server.
   * Note: This requires the bot to have BAN_MEMBERS permission.
   * Since Discord bans are guild-scoped, we attempt to ban from all guilds the bot is currently in.
   */
  async banUser(platformUserId: string, reason?: string): Promise<void> {
    if (!this.client || !this.client.isReady()) {
      logger.warn('discord.ban.client_not_ready', { platformUserId });
      return;
    }

    try {
      const guilds = this.client.guilds.cache;
      if (guilds.size === 0) {
        logger.warn('discord.ban.no_guilds', { platformUserId });
        return;
      }

      for (const [guildId, guild] of guilds) {
        try {
          await guild.members.ban(platformUserId, { reason: reason || 'Banned by administrative tool' });
          logger.info('discord.ban.success', { guildId, platformUserId });
        } catch (e: any) {
          logger.error('discord.ban.guild_error', { guildId, platformUserId, error: e?.message || String(e) });
          // Continue to next guild if any
        }
      }
    } catch (e: any) {
      logger.error('discord.ban.error', { platformUserId, error: e?.message || String(e) });
      throw e;
    }
  }

  getSnapshot(): ConnectorSnapshot {
    const snap: any = this.snapshot as any;
    if (Array.isArray(snap.channelIds)) {
      return { ...snap, channelIds: [...snap.channelIds] } as ConnectorSnapshot;
    }
    return { ...snap } as ConnectorSnapshot;
  }

  async start(): Promise<void> {
    const disabled = !this.cfg.discordEnabled || process.env.NODE_ENV === 'test';
    if (disabled) {
      logger.debug('ingress-egress.discord.disabled');
      // Emulate ready state without network I/O
      this.snapshot.state = 'CONNECTED';
      return;
    }

    const token = await this.resolveToken();
    const guildId = (this.cfg.discordGuildId || '').trim();
    const channels = (this.cfg.discordChannels || []).slice();
    if (!token || !guildId || channels.length === 0) {
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: 'Missing Discord configuration (token/guildId/channels)' };
      throw new Error('discord_config_missing');
    }

    // dynamic import to avoid type coupling in tests
    let Client: any, GatewayIntentBits: any, Partials: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('discord.js');
      Client = mod.Client;
      GatewayIntentBits = mod.GatewayIntentBits;
      Partials = mod.Partials;
    } catch (e: any) {
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: 'discord.js not available: ' + (e?.message || String(e)) };
      throw e;
    }

    this.snapshot.state = 'CONNECTING';
    logger.info('ingress-egress.discord.start', { guildId, channelsCount: channels.length });
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages, // Sprint 13: Required for receiving DM events
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.once('ready', () => {
      this.snapshot.state = 'CONNECTED';
      this.snapshot.lastError = null;
      logger.info('ingress-egress.discord.ready', { guildId, channelsCount: channels.length });

      // Start deduplication cache cleanup (clear entries every 60 seconds)
      this.deduplicationCleanupInterval = setInterval(() => {
        const size = this.processedMessageIds.size;
        this.processedMessageIds.clear();
        logger.debug('discord.client.dedup_cache_cleared', { previousSize: size });
      }, 60000); // Clear every 60 seconds
    });

    this.client.on('error', (err: any) => {
      this.snapshot.state = this.disconnecting ? 'DISCONNECTED' : 'ERROR';
      this.snapshot.lastError = { message: err?.message || String(err) };
      logger.error('ingress-egress.discord.error', { error: err?.message || String(err) });
    });

    this.client.on('messageCreate', async (msg: any) => {
      try {
        if (this.options.disableIngress) {
          return;
        }
        // Filters: guild, channels, bot ignore, require text content
        const chId = String(msg?.channel?.id || '');
        const auId = String(msg?.author?.id || '');
        const channelType = msg?.channel?.type;
        const isDM = channelType === 1; // ChannelType.DM = 1

        logger.debug('ingress-egress.discord.message.received', {
          guildId,
          channelId: chId,
          authorId: auId,
          channelType,
          isDM,
          length: (msg?.content?.length || 0)
        });

        // Sprint 13: Allow DM messages (skip guild/channel filters for DMs)
        if (!isDM) {
          // Guild channel filters (only apply to non-DM messages)
          if (!msg?.guild || msg.guild.id !== guildId) {
            this.snapshot.counters = this.snapshot.counters || {};
            (this.snapshot.counters as any).filtered = ((this.snapshot.counters as any).filtered || 0) + 1;
            logger.debug('ingress-egress.discord.message.filtered', { reason: 'guild_mismatch', guildId: msg?.guild?.id, expectedGuildId: guildId });
            return;
          }
          if (!channels.includes(msg.channel?.id)) {
            this.snapshot.counters = this.snapshot.counters || {};
            (this.snapshot.counters as any).filtered = ((this.snapshot.counters as any).filtered || 0) + 1;
            logger.debug('ingress-egress.discord.message.filtered', { reason: 'channel_not_allowed', channelId: chId });
            return;
          }
        }
        if (!msg.content || typeof msg.content !== 'string') {
          this.snapshot.counters = this.snapshot.counters || {};
          (this.snapshot.counters as any).filtered = ((this.snapshot.counters as any).filtered || 0) + 1;
          logger.debug('ingress-egress.discord.message.filtered', { reason: 'non_text' });
          return;
        }
        if (msg.author?.bot) {
          this.snapshot.counters = this.snapshot.counters || {};
          (this.snapshot.counters as any).filtered = ((this.snapshot.counters as any).filtered || 0) + 1;
          logger.debug('ingress-egress.discord.message.filtered', { reason: 'bot' });
          return;
        }

        // Deduplicate by Discord message ID (Discord may send duplicate events on reconnect/resume)
        const messageId = String(msg.id || '');
        if (messageId && this.processedMessageIds.has(messageId)) {
          logger.warn('discord.client.message_deduplicated', {
            messageId,
            user: msg.author?.id,
            channel: chId,
            textPreview: msg.content?.substring(0, 50),
          });
          this.snapshot.counters = this.snapshot.counters || {};
          (this.snapshot.counters as any).deduplicated = ((this.snapshot.counters as any).deduplicated || 0) + 1;
          return;
        }
        if (messageId) {
          this.processedMessageIds.add(messageId);
        }

        // Sprint 11: Detect debug mode command (!debug <message>)
        // Strip prefix and perform RBAC check BEFORE envelope creation
        let messageText = String(msg.content || '');
        let debugCorrelationId: string | undefined;
        let debugMetadata: DebugMetadata | undefined;
        const debugMatch = messageText.match(/^!debug\s+/i);

        if (debugMatch) {
          // Strip debug prefix from message text
          messageText = messageText.slice(debugMatch[0].length);

          // RBAC: Check if user is authorized for debug mode
          const userId = String(msg.author?.id || 'unknown');
          const debugAuthorized = this.debugAuthorizedUsers.has(userId);

          if (debugAuthorized) {
            // Generate correlation ID early for confirmation message and envelope
            const { randomUUID } = await import('crypto');
            debugCorrelationId = randomUUID();

            logger.info('discord.debug.authorized', {
              user: userId,
              channel: chId,
              originalText: msg.content,
              strippedText: messageText,
              prefixLength: debugMatch[0].length,
              correlationId: debugCorrelationId,
            });

            // Send activation confirmation BEFORE publishing envelope
            // This proves egress path works before event enters routing flow
            try {
              await this.sendText(
                `🔍 **Debug mode ON**\n\`Correlation ID:\` \`${debugCorrelationId}\`\n_Watching event flow..._`,
                chId
              );

              logger.info('discord.debug.activation_sent', {
                user: userId,
                channel: chId,
                correlationId: debugCorrelationId,
              });
            } catch (err: any) {
              logger.error('discord.debug.activation_failed', {
                error: err.message,
                correlationId: debugCorrelationId,
              });
              // Continue processing even if confirmation fails
            }

            // Create debug metadata for envelope
            debugMetadata = {
              enabled: true,
              initiatedBy: userId,
              feedbackChannel: chId,
              startedAt: new Date().toISOString(),
            };
          } else {
            logger.warn('discord.debug.unauthorized', {
              user: userId,
              channel: chId,
              authorizedUsers: Array.from(this.debugAuthorizedUsers),
            });
            // Reject unauthorized debug requests - don't publish envelope
            return;
          }
        }

        const meta: DiscordMessageMeta = {
          guildId: isDM ? '' : guildId, // Sprint 13: DMs don't have guilds
          channelId: String(msg.channel?.id || ''),
          messageId: String(msg.id || ''),
          authorId: String(msg.author?.id || ''),
          authorName: String(msg.author?.username || msg.author?.displayName || msg.author?.tag || ''),
          content: messageText, // Use stripped text if debug mode detected
          createdAt: msg.createdAt ? new Date(msg.createdAt).toISOString() : new Date().toISOString(),
          mentions: Array.isArray(msg.mentions?.users ? [...msg.mentions.users.keys()] : []) ? [...msg.mentions.users.keys()] : undefined,
          // Sprint 13: DM fix - msg.member is null for DMs, so use safe navigation throughout
          roles: msg.member?.roles?.cache ? [...msg.member.roles.cache.keys()] : undefined,
          isOwner: msg.guild?.ownerId === msg.author?.id,
          channelType: msg.channel?.type, // Sprint 13: DM detection
          raw: undefined,
        };

        this.snapshot.counters = this.snapshot.counters || {};
        this.snapshot.counters.received = (this.snapshot.counters.received || 0) + 1;

        await startActiveSpan('discord-ingress-receive', async () => {
          // Sprint 13: Support both sync and async envelope builders
          // TranslationEngine.translateInbound is async, but custom builders are sync
          const envelopeOrPromise = this.buildEnvelope(meta, {
            egressDestination: this.options.egressDestinationTopic,
            correlationId: debugCorrelationId,
            debugMetadata,
          });

          // Check if result is a Promise and await if necessary
          const evt = envelopeOrPromise instanceof Promise
            ? await envelopeOrPromise
            : envelopeOrPromise;

          await this.publisher.publish(evt);
          this.snapshot.counters!.published = (this.snapshot.counters!.published || 0) + 1;
          try {
            logger.info('ingress-egress.discord.message.published', { correlationId: (evt as any)?.correlationId, channelId: meta.channelId });
          } catch {}
        });
      } catch (e: any) {
        this.snapshot.counters = this.snapshot.counters || {};
        this.snapshot.counters.failed = (this.snapshot.counters.failed || 0) + 1;
        this.snapshot.lastError = { message: e?.message || String(e) };
        logger.error('ingress-egress.discord.message.error', { error: e?.message || String(e) });
      }
    });

    this.currentToken = token;
    this.startTokenPoll();

    try {
      logger.debug('ingress-egress.discord.login', { token: token.substring(0, 4) + '...' });
      await this.client.login(token);
    } catch (err: any) {
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: err?.message || String(err) };
      logger.error('ingress-egress.discord.login.error', { error: err?.message || String(err) });
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.disconnecting = true;
    try {
      // Clear deduplication cleanup interval
      if (this.deduplicationCleanupInterval) {
        clearInterval(this.deduplicationCleanupInterval);
        this.deduplicationCleanupInterval = undefined;
      }

      if (this.tokenPollTimer) {
        clearInterval(this.tokenPollTimer);
        this.tokenPollTimer = null;
      }
      if (this.client && typeof this.client.destroy === 'function') {
        await this.client.destroy();
      }
    } catch {}
    this.client = null;
    this.snapshot.state = 'DISCONNECTED';
    logger.debug('ingress-egress.discord.stopped');
  }

  private async resolveToken(): Promise<string> {
    const useStore = !!this.cfg.discordUseTokenStore;
    if (useStore && this.tokenStore) {
      try {
        const doc = await this.tokenStore.getAuthToken('discord', this.identity);
        const tok = (doc?.accessToken || '').trim();
        if (tok) return tok;
      } catch (e: any) {
        logger.error('ingress-egress.discord.token.resolve.error', { error: e?.message || String(e), identity: this.identity });
      }
      if (!this.cfg.discordAllowEnvFallback || this.identity !== 'bot') {
        this.snapshot.state = 'ERROR';
        this.snapshot.lastError = { message: `discord_token_missing_in_store_for_${this.identity}` } as any;
        throw new Error(`discord_token_missing_in_store_for_${this.identity}`);
      }
    }
    if (this.identity !== 'bot') {
      throw new Error(`discord_token_unavailable_for_${this.identity}`);
    }
    return (this.cfg.discordBotToken || '').trim();
  }

  private startTokenPoll() {
    if (!this.cfg.discordUseTokenStore || !this.tokenStore) return;
    const intervalMs = Math.max(10_000, Number(this.cfg.discordTokenPollMs || 60_000));
    this.tokenPollTimer = setInterval(async () => {
      try {
        const doc = await this.tokenStore!.getAuthToken('discord', this.identity);
        const next = (doc?.accessToken || '').trim();
        if (next && this.currentToken && next !== this.currentToken) {
          logger.info('ingress-egress.discord.token.rotated');
          await this.reconnect(next);
        }
      } catch (e: any) {
        logger.warn('ingress-egress.discord.token.poll_error', { error: e?.message || String(e) });
      }
    }, intervalMs);
  }

  private async reconnect(newToken: string) {
    try {
      this.disconnecting = true;
      if (this.client) {
        try { await this.client.destroy(); } catch {}
      }
      this.disconnecting = false;
      // Recreate client and re-login with new token
      const Client = require('discord.js').Client;
      const GatewayIntentBits = require('discord.js').GatewayIntentBits;
      const Partials = require('discord.js').Partials;
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
        partials: [Partials.Channel, Partials.Message],
      });
      this.currentToken = newToken;
      await this.client.login(newToken);
      logger.info('ingress-egress.discord.reconnected');
    } catch (e: any) {
      this.snapshot.lastError = { message: e?.message || String(e) } as any;
      logger.error('ingress-egress.discord.reconnect.error', { error: e?.message || String(e) });
    }
  }
}

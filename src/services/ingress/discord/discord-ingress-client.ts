import { logger } from '../../../common/logging';
import type { ConnectorSnapshot, EnvelopeBuilder, IngressConnector, IngressPublisher, EgressConnector } from '../core';
import type { IConfig } from '../../../types';
import { startActiveSpan } from '../../../common/tracing';
import type { IAuthTokenStoreV2 } from '../../oauth/auth-token-store';

export type DiscordConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export type DiscordIngressSnapshot = ConnectorSnapshot & {
  guildId?: string;
  channelIds?: string[];
};

export interface DiscordMessageMeta {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt?: string;
  mentions?: string[];
  roles?: string[];
  isOwner?: boolean;
  raw?: Record<string, unknown>;
}

export class DiscordIngressClient implements IngressConnector, EgressConnector {
  private client: any | null = null;
  private disconnecting = false;
  private snapshot: ConnectorSnapshot = { state: 'DISCONNECTED', counters: { received: 0, published: 0, failed: 0 } };
  private tokenPollTimer: NodeJS.Timeout | null = null;
  private currentToken: string | null = null;

  constructor(
    private readonly builder: EnvelopeBuilder<DiscordMessageMeta>,
    private readonly publisher: IngressPublisher,
    private readonly cfg: IConfig,
    private readonly options: { egressDestinationTopic?: string } = {},
    private readonly tokenStore?: IAuthTokenStoreV2
  ) {
    this.snapshot.guildId = cfg.discordGuildId;
    this.snapshot.channelIds = (cfg.discordChannels || []).slice();
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
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.once('ready', () => {
      this.snapshot.state = 'CONNECTED';
      this.snapshot.lastError = null;
      logger.info('ingress-egress.discord.ready', { guildId, channelsCount: channels.length });
    });

    this.client.on('error', (err: any) => {
      this.snapshot.state = this.disconnecting ? 'DISCONNECTED' : 'ERROR';
      this.snapshot.lastError = { message: err?.message || String(err) };
      logger.error('ingress-egress.discord.error', { error: err?.message || String(err) });
    });

    this.client.on('messageCreate', async (msg: any) => {
      try {
        // Filters: guild, channels, bot ignore, require text content
        const chId = String(msg?.channel?.id || '');
        const auId = String(msg?.author?.id || '');
        logger.debug('ingress-egress.discord.message.received', { guildId, channelId: chId, authorId: auId, length: (msg?.content?.length || 0) });
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

        const meta: DiscordMessageMeta = {
          guildId,
          channelId: String(msg.channel?.id || ''),
          messageId: String(msg.id || ''),
          authorId: String(msg.author?.id || ''),
          authorName: String(msg.author?.username || msg.author?.displayName || msg.author?.tag || ''),
          content: String(msg.content || ''),
          createdAt: msg.createdAt ? new Date(msg.createdAt).toISOString() : new Date().toISOString(),
          mentions: Array.isArray(msg.mentions?.users ? [...msg.mentions.users.keys()] : []) ? [...msg.mentions.users.keys()] : undefined,
          roles: Array.isArray(msg.member?.roles ? [...msg.member.roles.cache.keys()] : []) ? [...msg.member.roles.cache.keys()] : undefined,
          isOwner: msg.guild?.ownerId === msg.author?.id,
          raw: undefined,
        };

        this.snapshot.counters = this.snapshot.counters || {};
        this.snapshot.counters.received = (this.snapshot.counters.received || 0) + 1;

        await startActiveSpan('discord-ingress-receive', async () => {
          const evt = this.builder.build(meta, { egressDestination: this.options.egressDestinationTopic });
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

    await this.client.login(token);
    this.currentToken = token;
    this.startTokenPoll();
  }

  async stop(): Promise<void> {
    this.disconnecting = true;
    try {
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
        const doc = await this.tokenStore.getAuthToken('discord', 'bot');
        const tok = (doc?.accessToken || '').trim();
        if (tok) return tok;
      } catch (e: any) {
        logger.error('ingress-egress.discord.token.resolve.error', { error: e?.message || String(e) });
      }
      if (!this.cfg.discordAllowEnvFallback) {
        this.snapshot.state = 'ERROR';
        this.snapshot.lastError = { message: 'discord_token_missing_in_store' } as any;
        throw new Error('discord_token_missing_in_store');
      }
    }
    return (this.cfg.discordBotToken || '').trim();
  }

  private startTokenPoll() {
    if (!this.cfg.discordUseTokenStore || !this.tokenStore) return;
    const intervalMs = Math.max(10_000, Number(this.cfg.discordTokenPollMs || 60_000));
    this.tokenPollTimer = setInterval(async () => {
      try {
        const doc = await this.tokenStore!.getAuthToken('discord', 'bot');
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
      if (!this.client) return;
      this.disconnecting = true;
      try { await this.client.destroy(); } catch {}
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

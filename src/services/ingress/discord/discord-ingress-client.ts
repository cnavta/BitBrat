import { logger } from '../../../common/logging';
import type { ConnectorSnapshot, EnvelopeBuilder, IngressConnector, IngressPublisher } from '../core';
import type { IConfig } from '../../../types';
import { startActiveSpan } from '../../../common/tracing';

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
  raw?: Record<string, unknown>;
}

export class DiscordIngressClient implements IngressConnector {
  private client: any | null = null;
  private disconnecting = false;
  private snapshot: ConnectorSnapshot = { state: 'DISCONNECTED', counters: { received: 0, published: 0, failed: 0 } };

  constructor(
    private readonly builder: EnvelopeBuilder<DiscordMessageMeta>,
    private readonly publisher: IngressPublisher,
    private readonly cfg: IConfig,
    private readonly options: { egressDestinationTopic?: string } = {}
  ) {
    this.snapshot.guildId = cfg.discordGuildId;
    this.snapshot.channelIds = (cfg.discordChannels || []).slice();
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
      logger.debug('discord.ingress.disabled');
      // Emulate ready state without network I/O
      this.snapshot.state = 'CONNECTED';
      return;
    }

    const token = (this.cfg.discordBotToken || '').trim();
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
      logger.info('discord.ingress.ready', { guildId, channelsCount: channels.length });
    });

    this.client.on('error', (err: any) => {
      this.snapshot.state = this.disconnecting ? 'DISCONNECTED' : 'ERROR';
      this.snapshot.lastError = { message: err?.message || String(err) };
      logger.error('discord.ingress.error', { error: err?.message || String(err) });
    });

    this.client.on('messageCreate', async (msg: any) => {
      try {
        // Filters: guild, channels, bot ignore, require text content
        if (!msg?.guild || msg.guild.id !== guildId) return;
        if (!channels.includes(msg.channel?.id)) return;
        if (!msg.content || typeof msg.content !== 'string') return;
        if (msg.author?.bot) return;

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
          raw: undefined,
        };

        this.snapshot.counters = this.snapshot.counters || {};
        this.snapshot.counters.received = (this.snapshot.counters.received || 0) + 1;

        await startActiveSpan('discord-ingress-receive', async () => {
          const evt = this.builder.build(meta);
          if (!evt.egressDestination && this.options.egressDestinationTopic) {
            (evt as any).egressDestination = this.options.egressDestinationTopic;
          }
          await this.publisher.publish(evt);
          this.snapshot.counters!.published = (this.snapshot.counters!.published || 0) + 1;
        });
      } catch (e: any) {
        this.snapshot.counters = this.snapshot.counters || {};
        this.snapshot.counters.failed = (this.snapshot.counters.failed || 0) + 1;
        this.snapshot.lastError = { message: e?.message || String(e) };
        logger.error('discord.ingress.handle_error', { error: e?.message || String(e) });
      }
    });

    await this.client.login(token);
  }

  async stop(): Promise<void> {
    this.disconnecting = true;
    try {
      if (this.client && typeof this.client.destroy === 'function') {
        await this.client.destroy();
      }
    } catch {}
    this.client = null;
    this.snapshot.state = 'DISCONNECTED';
    logger.debug('discord.ingress.stopped');
  }
}

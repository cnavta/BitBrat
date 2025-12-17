import { logger } from '../../../common/logging';
import type { EgressConnector } from '../core';
import type { IConfig } from '../../../types';

/**
 * DiscordEgressConnector (stub)
 * - Optional egress adapter behind feature flag.
 * - Resolves default target channel from cfg.discordChannels[0] if not provided.
 * - No network I/O performed in this sprint; logs intent and no-ops safely.
 */
export class DiscordEgressConnector implements EgressConnector {
  constructor(private readonly cfg: IConfig) {}

  async sendText(text: string, channelId?: string): Promise<void> {
    if (!text || !text.trim()) return;
    if (!this.cfg?.discordEnabled) {
      logger.debug('ingress-egress.discord.egress.disabled');
      return;
    }
    const defaultChannel = Array.isArray(this.cfg?.discordChannels) && this.cfg.discordChannels.length > 0
      ? this.cfg.discordChannels[0]
      : undefined;
    const target = channelId || defaultChannel;
    if (!target) {
      logger.debug('ingress-egress.discord.egress.no_channel');
      return;
    }
    // Stub/no-op: In a future sprint, this will call discord.js Channel#send.
    logger.debug('ingress-egress.discord.egress.noop', { channelId: target, length: text.length });
  }
}

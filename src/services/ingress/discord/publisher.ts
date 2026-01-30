import { INTERNAL_INGRESS_V1, InternalEventV2 } from '../../../types/events';
import type { IConfig } from '../../../types';
import { MessagePublisher, createMessagePublisher } from '../../message-bus';
import type { IngressPublisher } from '../core';

export interface DiscordIngressPublisherOptions {
  busPrefix?: string;
  publisherFactory?: (subject: string) => MessagePublisher;
}

export class DiscordIngressPublisher implements IngressPublisher {
  private readonly subject: string;
  private readonly pub: MessagePublisher;
  constructor(options: DiscordIngressPublisherOptions = {}) {
    const prefix = (options.busPrefix ?? process.env.BUS_PREFIX ?? '').toString();
    this.subject = `${prefix}${INTERNAL_INGRESS_V1}`;
    const factory = options.publisherFactory || createMessagePublisher;
    this.pub = factory(this.subject);
  }

  async publish(evt: InternalEventV2): Promise<void> {
    await this.pub.publishJson(evt, {
      type: evt.type,
      correlationId: evt.correlationId,
      source: evt.ingress.source,
    });
  }
}

export function createDiscordIngressPublisherFromConfig(cfg: IConfig, publisherFactory?: (subject: string) => MessagePublisher): DiscordIngressPublisher {
  return new DiscordIngressPublisher({ busPrefix: cfg.busPrefix, publisherFactory });
}

import { INTERNAL_INGRESS_V1, InternalEventV2 } from '../../../types/events';
import type { IConfig } from '../../../types';
import { MessagePublisher, createMessagePublisher } from '../../message-bus';
import type { IngressPublisher } from '../core';

export interface TwilioIngressPublisherOptions {
  busPrefix?: string;
  publisherFactory?: (subject: string) => MessagePublisher;
}

export class TwilioIngressPublisher implements IngressPublisher {
  private readonly subject: string;
  private readonly pub: MessagePublisher;
  constructor(options: TwilioIngressPublisherOptions = {}) {
    const prefix = (options.busPrefix ?? process.env.BUS_PREFIX ?? '').toString();
    this.subject = `${prefix}${INTERNAL_INGRESS_V1}`;
    const factory = options.publisherFactory || createMessagePublisher;
    this.pub = factory(this.subject);
  }

  async publish(evt: InternalEventV2): Promise<void> {
    await this.pub.publishJson(evt, {
      type: evt.type,
      correlationId: evt.correlationId,
      source: evt.source,
    });
  }
}

export function createTwilioIngressPublisherFromConfig(cfg: IConfig, publisherFactory?: (subject: string) => MessagePublisher): TwilioIngressPublisher {
  return new TwilioIngressPublisher({ busPrefix: cfg.busPrefix, publisherFactory });
}

import { INTERNAL_INGRESS_V1, InternalEventV2 } from '../../../types/events';
import type { IConfig } from '../../../types';
import { MessagePublisher, createMessagePublisher } from '../../message-bus';
import type { IngressPublisher } from '../core';

export interface DiscordIngressPublisherOptions {
  busPrefix?: string;
  publisherFactory?: (subject: string) => MessagePublisher;
  /** Optional callback invoked after successful publish (Sprint 24: for snapshot publishing) */
  onPublished?: (event: InternalEventV2) => Promise<void>;
}

export class DiscordIngressPublisher implements IngressPublisher {
  private readonly subject: string;
  private readonly pub: MessagePublisher;
  private readonly onPublished?: (event: InternalEventV2) => Promise<void>;

  constructor(options: DiscordIngressPublisherOptions = {}) {
    const prefix = (options.busPrefix ?? process.env.BUS_PREFIX ?? '').toString();
    this.subject = `${prefix}${INTERNAL_INGRESS_V1}`;
    const factory = options.publisherFactory || createMessagePublisher;
    this.pub = factory(this.subject);
    this.onPublished = options.onPublished;
  }

  async publish(evt: InternalEventV2): Promise<void> {
    await this.pub.publishJson(evt, {
      type: evt.type,
      correlationId: evt.correlationId,
      source: evt.ingress.source,
    });

    // Sprint 24: Call onPublished callback after successful publish (fail-open)
    if (this.onPublished) {
      try {
        await this.onPublished(evt);
      } catch (error) {
        // Fail-open: Already published successfully, log warning only
        console.warn('Discord publisher callback failed:', error);
      }
    }
  }
}

export function createDiscordIngressPublisherFromConfig(
  cfg: IConfig,
  publisherFactory?: (subject: string) => MessagePublisher,
  onPublished?: (event: InternalEventV2) => Promise<void>
): DiscordIngressPublisher {
  return new DiscordIngressPublisher({ busPrefix: cfg.busPrefix, publisherFactory, onPublished });
}

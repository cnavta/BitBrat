import { INTERNAL_INGRESS_V1, InternalEventV2 } from '../../../types/events';
import type { IConfig } from '../../../types';
import { AttributeMap, MessagePublisher, createMessagePublisher } from '../../message-bus';
import { retryAsync } from '../../../common/retry';
import { busAttrsFromEvent } from '../../../common/events/adapters';

export interface TwitchIngressPublisherOptions {
  busPrefix?: string; // e.g., "dev." or ""
  maxRetries?: number; // total attempts including first (default 5)
  baseDelayMs?: number; // default 250
  maxDelayMs?: number; // default 5000
  jitterMs?: number; // 0 => disable jitter (deterministic tests)
}

export interface ITwitchIngressPublisher {
  publish(evt: InternalEventV2): Promise<string | null>;
}

/**
 * TwitchIngressPublisher
 * - Publishes normalized InternalEventV2 to ${BUS_PREFIX}internal.ingress.v1
 * - Uses message-bus abstraction and bounded retry with backoff
 */
export class TwitchIngressPublisher implements ITwitchIngressPublisher {
  private readonly subject: string;
  private readonly pub: MessagePublisher;
  private readonly opts: Required<Pick<TwitchIngressPublisherOptions, 'maxRetries' | 'baseDelayMs' | 'maxDelayMs' | 'jitterMs'>>;

  constructor(options: TwitchIngressPublisherOptions = {}) {
    const prefix = (options.busPrefix ?? process.env.BUS_PREFIX ?? '').toString();
    this.subject = `${prefix}${INTERNAL_INGRESS_V1}`;
    this.pub = createMessagePublisher(this.subject);
    this.opts = {
      maxRetries: options.maxRetries ?? 5,
      baseDelayMs: options.baseDelayMs ?? 250,
      maxDelayMs: options.maxDelayMs ?? 5000,
      jitterMs: options.jitterMs ?? 50,
    };
  }

  async publish(evt: InternalEventV2): Promise<string | null> {
    const attrs: AttributeMap = busAttrsFromEvent(evt);

    const res = await retryAsync(async () => {
      return await this.pub.publishJson(evt, attrs);
    }, {
      attempts: this.opts.maxRetries,
      baseDelayMs: this.opts.baseDelayMs,
      maxDelayMs: this.opts.maxDelayMs,
      jitterMs: this.opts.jitterMs,
    });
    return res;
  }
}

export function createTwitchIngressPublisherFromEnv(): TwitchIngressPublisher {
  return new TwitchIngressPublisher({
    busPrefix: process.env.BUS_PREFIX,
    // allow optional env overrides if present
    maxRetries: process.env.PUBLISH_MAX_RETRIES ? Number(process.env.PUBLISH_MAX_RETRIES) : undefined,
  });
}

export function createTwitchIngressPublisherFromConfig(cfg: IConfig): TwitchIngressPublisher {
  return new TwitchIngressPublisher({
    busPrefix: cfg.busPrefix,
    maxRetries: cfg.publishMaxRetries,
  });
}

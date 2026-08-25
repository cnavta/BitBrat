import { INTERNAL_INGRESS_V1, InternalEventV2 } from '../../../types/events';
import type { IConfig } from '../../../types';
import { AttributeMap, MessagePublisher, createMessagePublisher } from '../../message-bus';
import { retryAsync } from '../../../common/retry';
import { busAttrsFromEvent } from '../../../common/events/attributes';
import { logger } from '../../../common/logging';

export interface TwilioIngressPublisherOptions {
  busPrefix?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  publisherFactory?: (subject: string) => MessagePublisher;
  /** Optional callback invoked after successful publish (Sprint 24: for snapshot publishing) */
  onPublished?: (event: InternalEventV2) => Promise<void>;
}

export interface ITwilioIngressPublisher {
  publish(evt: InternalEventV2): Promise<string | null>;
}

export class TwilioIngressPublisher implements ITwilioIngressPublisher {
  private readonly subject: string;
  private readonly pub: MessagePublisher;
  private readonly opts: Required<Pick<TwilioIngressPublisherOptions, 'maxRetries' | 'baseDelayMs' | 'maxDelayMs' | 'jitterMs'>>;
  private readonly onPublished?: (event: InternalEventV2) => Promise<void>;

  constructor(options: TwilioIngressPublisherOptions = {}) {
    const prefix = (options.busPrefix ?? process.env.BUS_PREFIX ?? '').toString();
    this.subject = `${prefix}${INTERNAL_INGRESS_V1}`;
    const factory = options.publisherFactory || createMessagePublisher;
    this.pub = factory(this.subject);
    this.opts = {
      maxRetries: options.maxRetries ?? 5,
      baseDelayMs: options.baseDelayMs ?? 250,
      maxDelayMs: options.maxDelayMs ?? 5000,
      jitterMs: options.jitterMs ?? 50,
    };
    this.onPublished = options.onPublished;
  }

  async publish(evt: InternalEventV2): Promise<string | null> {
    const attrs: AttributeMap = busAttrsFromEvent(evt);
    let attempt = 0;
    const res = await retryAsync(async () => {
      attempt++;
      logger.debug('twilio.ingress.publish.attempt', {
        subject: this.subject,
        attempt,
        maxAttempts: this.opts.maxRetries,
        attrsCount: Object.keys(attrs || {}).length,
      });
      return await this.pub.publishJson(evt, attrs);
    }, {
      attempts: this.opts.maxRetries,
      baseDelayMs: this.opts.baseDelayMs,
      maxDelayMs: this.opts.maxDelayMs,
      jitterMs: this.opts.jitterMs,
      shouldRetry: (err) => {
        const code = Number(err?.code ?? err?.status);
        // Retry only transient transport/server errors
        return code === 14 /* UNAVAILABLE */
          || code === 13 /* INTERNAL */
          || code === 8  /* RESOURCE_EXHAUSTED */
          || code === 10 /* ABORTED */;
      }
    });

    // Sprint 24: Call onPublished callback after successful publish (fail-open)
    if (this.onPublished && res) {
      try {
        await this.onPublished(evt);
      } catch (error) {
        logger.warn('twilio.ingress.publish.callback_failed', {
          correlationId: evt.correlationId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fail-open: Don't throw, already published successfully
      }
    }

    return res;
  }
}

export function createTwilioIngressPublisherFromConfig(
  cfg: IConfig,
  publisherFactory?: (subject: string) => MessagePublisher,
  onPublished?: (event: InternalEventV2) => Promise<void>
): TwilioIngressPublisher {
  return new TwilioIngressPublisher({
    busPrefix: cfg.busPrefix,
    maxRetries: cfg.publishMaxRetries,
    publisherFactory,
    onPublished,
  });
}

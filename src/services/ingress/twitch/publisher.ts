import { INTERNAL_INGRESS_V1, InternalEventV2 } from '../../../types/events';
import type { IConfig } from '../../../types';
import { AttributeMap, MessagePublisher, createMessagePublisher } from '../../message-bus';
import { retryAsync } from '../../../common/retry';
import { busAttrsFromEvent } from '../../../common/events/attributes';
import { logger } from '../../../common/logging';

export interface TwitchIngressPublisherOptions {
  busPrefix?: string; // e.g., "dev." or ""
  maxRetries?: number; // total attempts including first (default 5)
  baseDelayMs?: number; // default 250
  maxDelayMs?: number; // default 5000
  jitterMs?: number; // 0 => disable jitter (deterministic tests)
  /** Optional factory to create a MessagePublisher for a subject (e.g., BaseServer resources.publisher.create) */
  publisherFactory?: (subject: string) => MessagePublisher;
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
    const factory = options.publisherFactory || createMessagePublisher;
    this.pub = factory(this.subject);
    this.opts = {
      maxRetries: options.maxRetries ?? 5,
      baseDelayMs: options.baseDelayMs ?? 250,
      maxDelayMs: options.maxDelayMs ?? 5000,
      jitterMs: options.jitterMs ?? 50,
    };
  }

  async publish(evt: InternalEventV2): Promise<string | null> {
    const attrs: AttributeMap = busAttrsFromEvent(evt);
    let attempt = 0;
    const res = await retryAsync(async () => {
      attempt++;
      logger.debug('ingress.publish.attempt', {
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
      shouldRetry: (err, a) => {
        const code = Number(err?.code ?? err?.status);
        const reason = (err && (err.reason || err.errorReason)) || undefined;
        // Do not retry our own local publish timeout wrapper — likely to duplicate
        if (code === 4 && String(reason).toLowerCase() === 'publish_timeout') {
          logger.warn('ingress.publish.no_retry_on_timeout', { subject: this.subject, attempt: a, code, reason });
          return false;
        }
        // Retry only transient transport/server errors
        const retryable = code === 14 /* UNAVAILABLE */
          || code === 13 /* INTERNAL */
          || code === 8  /* RESOURCE_EXHAUSTED */
          || code === 10 /* ABORTED */;
        if (!retryable) {
          logger.warn('ingress.publish.no_retry', { subject: this.subject, attempt: a, code, reason });
        } else {
          logger.warn('ingress.publish.retry', { subject: this.subject, attempt: a, code, reason });
        }
        return retryable;
      }
    });
    return res;
  }
}

export function createTwitchIngressPublisherFromEnv(publisherFactory?: (subject: string) => MessagePublisher): TwitchIngressPublisher {
  return new TwitchIngressPublisher({
    busPrefix: process.env.BUS_PREFIX,
    // allow optional env overrides if present
    maxRetries: process.env.PUBLISH_MAX_RETRIES ? Number(process.env.PUBLISH_MAX_RETRIES) : undefined,
    publisherFactory,
  });
}

export function createTwitchIngressPublisherFromConfig(cfg: IConfig, publisherFactory?: (subject: string) => MessagePublisher): TwitchIngressPublisher {
  return new TwitchIngressPublisher({
    busPrefix: cfg.busPrefix,
    maxRetries: cfg.publishMaxRetries,
    publisherFactory,
  });
}

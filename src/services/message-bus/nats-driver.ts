/**
 * NATS JetStream Driver
 *
 * Purpose:
 * - Implements the MessagePublisher and MessageSubscriber interfaces on top of NATS + JetStream.
 * - Supports BUS_PREFIX for subject namespacing and optional queue groups for competing consumers.
 *
 * Key environment variables:
 * - NATS_URL: connection URL (e.g., nats://localhost:4222).
 * - BUS_PREFIX: optional subject prefix, e.g., "dev." so subjects become dev.internal.bot.requests.v1
 *
 * Notes for LLM agents:
 * - Use '../services/message-bus' factories; do not import this file directly from business logic.
 * - Delivery is at-least-once; keep handlers idempotent. JetStream durable consumers are used by default.
 */
import { connect, StringCodec, NatsConnection, JetStreamClient, consumerOpts, createInbox, headers as natsHeaders } from 'nats';
import { logger } from '../../common/logging';
import type { AttributeMap, MessageHandler, MessagePublisher, MessageSubscriber, SubscribeOptions, UnsubscribeFn } from './index';
import { normalizeAttributes } from './attributes';

// NATS string codec used for JSON payload encoding/decoding
const sc = StringCodec();

/** Get BUS_PREFIX if configured. */
function getPrefix(): string {
  return process.env.BUS_PREFIX || '';
}

/** Prepend BUS_PREFIX to a subject if not already present. */
export function withPrefix(subject: string): string {
  const p = getPrefix();
  if (!p) return subject;
  return subject.startsWith(p) ? subject : `${p}${subject}`;
}

/** Publisher implementation for NATS JetStream. */
export class NatsPublisher implements MessagePublisher {
  private connPromise: Promise<NatsConnection>;
  private jsPromise: Promise<JetStreamClient>;
  private readonly subject: string;

  constructor(subject: string) {
    this.subject = subject;
    this.connPromise = connect({ servers: process.env.NATS_URL || 'nats://localhost:4222' });
    this.jsPromise = this.connPromise.then((c) => c.jetstream());
  }

  /** Serialize payload to JSON and publish to JetStream with optional headers. */
  async publishJson(data: unknown, attributes: AttributeMap = {}): Promise<string | null> {
    const js = await this.jsPromise;
    const payload = sc.encode(JSON.stringify(data));
    const headers = mapToHeaders(normalizeAttributes(attributes as any));
    const subj = withPrefix(this.subject);
    try {
      logger.debug('message_publisher.publish.start', {
        driver: 'nats',
        subject: subj,
        attrCount: attributes ? Object.keys(attributes).length : 0,
        bytes: payload.byteLength,
      });
      const pa = await js.publish(subj, payload, { headers });
      const id = pa.seq ? String(pa.seq) : null;
      logger.debug('message_publisher.publish.ok', { driver: 'nats', subject: subj, messageId: id });
      return id;
    } catch (e: any) {
      logger.error('message_publisher.publish.error', {
        driver: 'nats',
        subject: subj,
        error: e?.message || String(e),
      });
      throw e;
    }
  }

  /** Flush pending data to the server (uses NATS flush). */
  async flush(): Promise<void> {
    try {
      const subj = withPrefix(this.subject);
      logger.debug('message_publisher.flush.start', { driver: 'nats', subject: subj });
      const conn = await this.connPromise;
      await conn.flush();
      logger.debug('message_publisher.flush.ok', { driver: 'nats', subject: subj });
    } catch (e: any) {
      logger.error('message_publisher.flush.error', {
        driver: 'nats',
        subject: withPrefix(this.subject),
        error: e?.message || String(e),
      });
      throw e;
    }
  }
}

/** Subscriber implementation using JetStream durable consumers. */
export class NatsSubscriber implements MessageSubscriber {
  private connPromise: Promise<NatsConnection>;
  private jsPromise: Promise<JetStreamClient>;

  constructor() {
    this.connPromise = connect({ servers: process.env.NATS_URL || 'nats://localhost:4222' });
    this.jsPromise = this.connPromise.then((c) => c.jetstream());
  }

  async subscribe(subject: string, handler: MessageHandler, options: SubscribeOptions = {}): Promise<UnsubscribeFn> {
    const conn = await this.connPromise;
    const js = await this.jsPromise;
    const subj = withPrefix(subject);
    const queue = options.queue;
    const durable = options.durable || (
      queue 
        ? `${subj.replace(/\./g, '-')}-${queue.replace(/\./g, '-')}-durable`
        : `${subj.replace(/\./g, '-')}-durable`
    );

    const opts = consumerOpts();
    opts.durable(durable);
    opts.manualAck();
    opts.ackExplicit();
    if (options.maxInFlight) opts.maxAckPending(options.maxInFlight);
    
    if (queue) {
      opts.queue(queue);
    } else {
      opts.deliverTo(createInbox());
    }

    const sub = await js.subscribe(subj, opts);

    const iterate = (async () => {
      for await (const m of sub) {
        const dataBuf = Buffer.from(m.data);
        const attrs = headersToMap(m.headers);
        // Wrap ack/nack to add logging and avoid unhandled errors
        const ack = async () => {
          try {
            m.ack();
            logger.debug('message_consumer.ack', { driver: 'nats', subject: subj });
          } catch (e: any) {
            logger.error('message_consumer.ack.error', { driver: 'nats', subject: subj, error: e?.message || String(e) });
          }
        };
        const nack = async () => {
          try {
            m.nak();
            logger.debug('message_consumer.nack', { driver: 'nats', subject: subj });
          } catch (e: any) {
            logger.error('message_consumer.nack.error', { driver: 'nats', subject: subj, error: e?.message || String(e) });
          }
        };
        logger.debug('message_consumer.receive', {
          driver: 'nats',
          subject: subj,
          bytes: dataBuf?.length || 0,
          attrCount: Object.keys(attrs || {}).length,
        });
        const started = Date.now();
        try {
          await handler(dataBuf, attrs, { ack, nack });
          logger.debug('message_consumer.process.ok', { driver: 'nats', subject: subj, durationMs: Date.now() - started });
          if ((options.ack || 'auto') === 'auto') await ack();
        } catch (e: any) {
          logger.error('message_consumer.process.error', { driver: 'nats', subject: subj, error: e?.message || String(e), durationMs: Date.now() - started });
          await nack();
        }
      }
    })();

    return async () => {
      try { await sub.drain(); } catch {}
    };
  }
}

/** Map AttributeMap to NATS headers (string values only). */
export function mapToHeaders(attrs: AttributeMap | undefined) {
  if (!attrs || Object.keys(attrs).length === 0) return undefined;
  const h = natsHeaders();
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    h.set(k, String(v));
  }
  return h;
}

/** Convert various header shapes from NATS libraries into a plain AttributeMap. */
export function headersToMap(hdrs: any): AttributeMap {
  const out: AttributeMap = {};
  if (!hdrs) return out;
  try {
    if (typeof hdrs.entries === 'function') {
      for (const [k, v] of hdrs.entries()) out[String(k)] = String(v);
      return out;
    }
    if (typeof hdrs.get === 'function' && typeof hdrs.keys === 'function') {
      for (const k of hdrs.keys()) out[String(k)] = String(hdrs.get(k));
      return out;
    }
    if (typeof hdrs.forEach === 'function') {
      hdrs.forEach((v: any, k: any) => (out[String(k)] = String(v)));
      return out;
    }
  } catch {}
  for (const k of Object.keys(hdrs)) out[k] = String(hdrs[k]);
  return out;
}

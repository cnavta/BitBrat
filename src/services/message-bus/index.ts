/**
 * Message Bus Abstraction (Driver-Agnostic)
 *
 * Purpose:
 * - Provide a small, transport-neutral API for publishing and subscribing to internal subjects/topics.
 * - Allow swapping the underlying driver (GCP Pub/Sub in Cloud; NATS JetStream for local/dev) via environment only.
 *
 * How to choose a driver:
 * - MESSAGE_BUS_DRIVER=nats | pubsub (alias: MESSAGE_BUS) — defaults to 'pubsub' if unset.
 *
 * Contracts and subjects:
 * - Prefer the versioned InternalEventV1 contracts from src/types/events.ts and the INTERNAL_* constants for subjects.
 * - Always propagate attributes like correlationId, traceparent, and type.
 *
 * Acknowledgement model:
 * - Handler receives ctx with ack() and nack() regardless of driver.
 * - By default, drivers will auto-ack after your handler resolves. Set options.ack='explicit' to require you to ack() manually.
 *
 * Example usage:
 *   import { createMessagePublisher, createMessageSubscriber } from '../services/message-bus';
 *   const pub = createMessagePublisher('internal.bot.requests.v1');
 *   await pub.publishJson({ ... }, { correlationId: 'c-1', type: 'llm.request.v1' });
 *
 *   const sub = createMessageSubscriber();
 *   await sub.subscribe('internal.bot.requests.v1', async (data, attrs, { ack, nack }) => {
 *     const evt = JSON.parse(data.toString('utf8'));
 *     // ... process ...
 *     await ack();
 *   }, { queue: 'worker', ack: 'explicit' });
 *
 * llm_prompt:
 * - Keep business logic strictly dependent on this module’s interfaces. Do not import driver implementations directly.
 */

/**
 * Transport-agnostic string map for message attributes/headers.
 * Drivers will map this to underlying systems (e.g., Pub/Sub attributes or NATS headers).
 */
export type AttributeMap = Record<string, string>;

/** Result returned by some drivers when publishing. Currently unused by factories. */
export interface PublishResult { messageId: string | null }

/**
 * Publisher that serializes JSON data and sends it to a subject/topic.
 * Implementations must be idempotent w.r.t. retries at transport level.
 */
export interface MessagePublisher {
  /** Publish a JSON-serializable payload with optional attributes. Returns a driver-specific message id or null. */
  publishJson(data: unknown, attributes?: AttributeMap): Promise<string | null>;
  /** Flush any buffers (no-op for some drivers). */
  flush(): Promise<void>;
}

/**
 * Signature for subscriber handlers.
 * - data: raw body buffer. You will typically JSON.parse it to InternalEventV1.
 * - attributes: transport-normalized AttributeMap.
 * - ctx.ack(): acknowledge successful processing.
 * - ctx.nack(requeue?): indicate failure; drivers may redeliver based on policy. Ignored flag on drivers that lack requeue.
 */
export type MessageHandler = (
  data: Buffer,
  attributes: AttributeMap,
  ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }
) => Promise<void> | void;

/**
 * Subscription tuning options (supported keys vary by driver; unsupported values are ignored).
 */
export interface SubscribeOptions {
  /** Queue group (NATS) or subscription suffix (Pub/Sub). Enables competing consumers. */
  queue?: string;
  /** Durable consumer name (NATS JetStream). */
  durable?: string;
  /**
   * Acknowledgement mode:
   * - 'auto' (default): driver acks automatically if the handler returns without throwing
   * - 'explicit': your handler must call ctx.ack() explicitly; errors should call ctx.nack()
   */
  ack?: 'auto' | 'explicit';
  /** Flow control: maximum concurrent/unacked messages. */
  maxInFlight?: number;
  /** Optional backoff schedule for retries (driver-specific). Example: [1000, 5000, 15000] */
  backoffMs?: number[];
}

/** Async disposer that tears down the underlying subscription. */
export type UnsubscribeFn = () => Promise<void>;

/** Driver-agnostic subscriber that delivers messages to the provided handler. */
export interface MessageSubscriber {
  subscribe(subject: string, handler: MessageHandler, options?: SubscribeOptions): Promise<UnsubscribeFn>;
}

/** Resolve the active driver from environment. */
function getDriver(): 'pubsub' | 'nats' | 'noop' {
  const explicit = String(process.env.MESSAGE_BUS_DRIVER || process.env.MESSAGE_BUS || '').trim().toLowerCase();
  if (explicit && explicit !== 'auto') {
    if (explicit === 'nats' || explicit === 'pubsub' || explicit === 'noop') return explicit as any;
  }
  // If IO must be disabled (tests/CI), use noop
  const ioDisabled = process.env.MESSAGE_BUS_DISABLE_IO === '1';
  const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || !!process.env.CI;
  if (ioDisabled || isTest) return 'noop';
  // Default in runtime: Pub/Sub
  return 'pubsub';
}

/** Create a MessagePublisher bound to a subject/topic for the current driver. */
export function createMessagePublisher(subject: string): MessagePublisher {
  // Ensure a single publisher instance per <driver>::<subject> across the process
  const driver = getDriver();
  const key = `${driver}::${subject}`;
  if (!(globalThis as any).__bb_publisher_cache) {
    (globalThis as any).__bb_publisher_cache = new Map<string, MessagePublisher>();
  }
  const cache: Map<string, MessagePublisher> = (globalThis as any).__bb_publisher_cache;
  const existing = cache.get(key);
  if (existing) return existing;
  let created: MessagePublisher;
  if (driver === 'nats') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NatsPublisher } = require('./nats-driver');
    created = new NatsPublisher(subject);
  } else if (driver === 'noop') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NoopPublisher } = require('./noop-driver');
    created = new NoopPublisher(subject);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PubSubPublisher } = require('./pubsub-driver');
    created = new PubSubPublisher(subject);
  }
  cache.set(key, created);
  return created;
}

/** Create a MessageSubscriber for the current driver. */
export function createMessageSubscriber(): MessageSubscriber {
  const driver = getDriver();
  if (driver === 'nats') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NatsSubscriber } = require('./nats-driver');
    return new NatsSubscriber();
  }
  if (driver === 'noop') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NoopSubscriber } = require('./noop-driver');
    return new NoopSubscriber();
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PubSubSubscriber } = require('./pubsub-driver');
  return new PubSubSubscriber();
}
export { normalizeAttributes } from './attributes';

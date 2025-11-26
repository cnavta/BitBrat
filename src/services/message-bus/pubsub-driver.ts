/**
 * GCP Pub/Sub Driver
 *
 * Purpose:
 * - Implements the MessagePublisher and MessageSubscriber interfaces using @google-cloud/pubsub.
 * - Normalizes attributes and ack/nack semantics to match the driver-agnostic contract in index.ts.
 *
 * Key environment variables:
 * - GOOGLE_CLOUD_PROJECT | GCLOUD_PROJECT | PROJECT_ID: project selection (auto-detected by default in Cloud).
 * - PUBSUB_API_ENDPOINT: override endpoint (useful for emulators or tests).
 * - PUBSUB_CLIENT_CONFIG: JSON string merged into PubSub client constructor.
 * - PUBSUB_ENSURE_DISABLE=1: skip ensureTopic/ensureSubscription (handy in tests or pre-provisioned envs).
 * - PUBSUB_ACK_DEADLINE_SECONDS: ack deadline used when creating subscriptions (default 60).
 *
 * Notes for LLM agents:
 * - Do not import this file directly from business code; import via '../services/message-bus'.
 * - Pub/Sub delivers at-least-once. Your handlers must be idempotent.
 */
import { PubSub } from '@google-cloud/pubsub';
import { logger } from '../../common/logging';
import type {
  AttributeMap,
  MessageHandler,
  MessagePublisher,
  MessageSubscriber,
  SubscribeOptions,
  UnsubscribeFn,
} from './index';

/** Create and configure a Pub/Sub client from environment. */
function buildClient(): PubSub {
  const apiEndpoint = (process.env.PUBSUB_API_ENDPOINT || '').trim() || undefined;
  const projectId = (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.PROJECT_ID || '').trim() || undefined;
  let extra: Record<string, any> = {};
  if (process.env.PUBSUB_CLIENT_CONFIG) {
    try {
      extra = JSON.parse(process.env.PUBSUB_CLIENT_CONFIG);
    } catch (e: any) {
      logger.warn('pubsub.client_config_parse_error', { error: e?.message });
    }
  }
  const cfg: any = { ...extra };
  if (apiEndpoint) cfg.apiEndpoint = apiEndpoint;
  if (projectId) cfg.projectId = projectId;
  const client = new PubSub(cfg);
  logger.info('pubsub.client.init', { apiEndpoint: apiEndpoint || 'default', projectId: projectId || 'auto' });
  return client;
}

/** Ensure a topic exists; log and continue on failure (best-effort). */
async function ensureTopic(pubsub: PubSub, topicName: string): Promise<void> {
  try {
    const topic = pubsub.topic(topicName);
    // get will throw if missing; autoCreate creates transparently in most versions
    if (typeof (topic as any).get === 'function') {
      await (topic as any).get({ autoCreate: true });
    } else {
      // fallback: attempt create; ignore if exists
      await (pubsub as any).createTopic(topicName).catch(() => {});
    }
  } catch (e: any) {
    logger.warn('pubsub.ensure_topic_failed', { topic: topicName, error: e?.message || String(e) });
  }
}

export class PubSubPublisher implements MessagePublisher {
  private readonly pubsub: PubSub;
  private readonly topicName: string;

  constructor(topicName: string) {
    this.pubsub = buildClient();
    this.topicName = topicName;
  }

  /** Serialize data to JSON and publish with optional attributes. */
  async publishJson(data: unknown, attributes: AttributeMap = {}): Promise<string | null> {
    const ensureDisabled = process.env.PUBSUB_ENSURE_DISABLE === '1';
    if (!ensureDisabled) {
      await ensureTopic(this.pubsub, this.topicName);
    }
    const topic = this.pubsub.topic(this.topicName, { batching: { maxMessages: 100, maxMilliseconds: 100 } });
    const payload = Buffer.from(JSON.stringify(data));
    const attrsNorm = normalizeAttrs(attributes);
    try {
      logger.debug('message_publisher.publish.start', {
        driver: 'pubsub',
        topic: this.topicName,
        attrCount: Object.keys(attrsNorm || {}).length,
        bytes: payload.byteLength,
      });
      const [messageId] = await topic.publishMessage({ data: payload, attributes: attrsNorm });
      logger.debug('message_publisher.publish.ok', {
        driver: 'pubsub',
        topic: this.topicName,
        messageId: messageId || null,
      });
      return messageId || null;
    } catch (e: any) {
      logger.error('message_publisher.publish.error', {
        driver: 'pubsub',
        topic: this.topicName,
        error: e?.message || String(e),
        code: (e && (e.code || e.status)) || undefined,
      });
      throw e;
    }
  }

  /** No-op for Pub/Sub; present for API symmetry and future extensibility. */
  async flush(): Promise<void> {
    // Pub/Sub client flushes internally; emit trace logs for symmetry
    try {
      logger.debug('message_publisher.flush.start', { driver: 'pubsub', topic: this.topicName });
      // no explicit flush available on Pub/Sub Topic; noop
      logger.debug('message_publisher.flush.ok', { driver: 'pubsub', topic: this.topicName });
    } catch (e: any) {
      logger.error('message_publisher.flush.error', {
        driver: 'pubsub',
        topic: this.topicName,
        error: e?.message || String(e),
      });
    }
  }
}

export class PubSubSubscriber implements MessageSubscriber {
  private readonly pubsub: PubSub;

  constructor() {
    this.pubsub = buildClient();
  }

  /**
   * Subscribe to a subject/topic and deliver messages to the provided handler.
   *
   * Ack/Nack behavior:
   * - If options.ack === 'auto' (default), the driver will ack after your handler resolves successfully.
   * - If options.ack === 'explicit', your handler must call ctx.ack() or ctx.nack().
   */
  async subscribe(subject: string, handler: MessageHandler, options: SubscribeOptions = {}): Promise<UnsubscribeFn> {
    const subName = buildSubscriptionName(subject, options.queue);
    const ackDeadline = Number(process.env.PUBSUB_ACK_DEADLINE_SECONDS ?? 60);
    const ensureDisabled = process.env.PUBSUB_ENSURE_DISABLE === '1';
    logger.info('message_consumer.subscribe.start', { driver: 'pubsub', topic: subject, subscription: subName, ackDeadline });
    if (!ensureDisabled) {
      await ensureTopic(this.pubsub, subject);
      await ensureSubscription(this.pubsub, subject, subName, { ackDeadlineSeconds: ackDeadline });
    } else {
      logger.debug('pubsub.ensure.skip', { reason: 'test_or_disabled', subscription: subName });
    }
    const subscription = this.pubsub.subscription(subName, {
      flowControl: options.maxInFlight ? { maxMessages: options.maxInFlight } : undefined,
    });
    logger.info('message_consumer.subscribe.ready', { driver: 'pubsub', subscription: subName });

    const onMessage = async (message: any) => {
      const data: Buffer = message.data as Buffer;
      const attrs: AttributeMap = message.attributes || {};
      const msgId = message?.id;
      // ack/nack are wrapped to catch and log driver-level errors
      const ack = async () => {
        try {
          message.ack();
          logger.debug('message_consumer.ack', { driver: 'pubsub', subscription: subName, messageId: msgId });
        } catch (e: any) {
          logger.error('message_consumer.ack.error', { driver: 'pubsub', subscription: subName, messageId: msgId, error: e?.message || String(e) });
        }
      };
      const nack = async () => {
        try {
          message.nack();
          logger.debug('message_consumer.nack', { driver: 'pubsub', subscription: subName, messageId: msgId });
        } catch (e: any) {
          logger.error('message_consumer.nack.error', { driver: 'pubsub', subscription: subName, messageId: msgId, error: e?.message || String(e) });
        }
      };
      logger.debug('message_consumer.receive', {
        driver: 'pubsub',
        subscription: subName,
        messageId: msgId,
        bytes: data?.length || 0,
        attrCount: Object.keys(attrs || {}).length,
      });
      const started = Date.now();
      try {
        await handler(data, attrs, { ack, nack });
        logger.debug('message_consumer.process.ok', {
          driver: 'pubsub',
          subscription: subName,
          messageId: msgId,
          durationMs: Date.now() - started,
        });
        if ((options.ack || 'auto') === 'auto') await ack();
      } catch (e: any) {
        logger.error('message_consumer.process.error', {
          driver: 'pubsub',
          subscription: subName,
          messageId: msgId,
          error: e?.message || String(e),
          durationMs: Date.now() - started,
        });
        await nack();
      }
    };

    const onError = (err: any) => {
      // Avoid unhandled 'error' event crashes; log with guidance
      logger.error('pubsub.subscription.error', {
        subscription: subName,
        code: err?.code,
        details: err?.details || String(err),
      });
    };

    subscription.on('message', onMessage);
    subscription.on('error', onError);

    return async () => {
      subscription.removeListener('message', onMessage);
      subscription.removeListener('error', onError);
      await subscription.close();
    };
  }
}

/** Build a subscription name. Includes a queue suffix to allow competing consumers. */
function buildSubscriptionName(topic: string, queue?: string): string {
  // In GCP we bind subscriptions to topics; allow a queue suffix for competing consumers
  return queue ? `${topic}.${queue}` : `${topic}.sub`;
}

/** Ensure a subscription exists for the given topic; swallow AlreadyExists errors. */
async function ensureSubscription(pubsub: PubSub, topicName: string, subName: string, opts: { ackDeadlineSeconds?: number } = {}): Promise<void> {
  try {
    // Simplest and most compatible approach: attempt to create; if it already exists, swallow the error.
    const topic = pubsub.topic(topicName);
    if (typeof (topic as any).createSubscription === 'function') {
      await (topic as any).createSubscription(subName, {
        ackDeadlineSeconds: opts.ackDeadlineSeconds || 60,
      });
      logger.info('pubsub.subscription.created', { topic: topicName, subscription: subName });
    } else {
      // Fallback to root API
      await (pubsub as any).createSubscription(topicName, subName, { ackDeadlineSeconds: opts.ackDeadlineSeconds || 60 });
      logger.info('pubsub.subscription.created', { topic: topicName, subscription: subName });
    }
  } catch (e: any) {
    // If already exists or permission denied, log and continue; subscriber may still attach if it exists
    const msg = e?.message || String(e);
    if (msg.includes('Already exists') || e?.code === 6 /* ALREADY_EXISTS */) {
      logger.debug('pubsub.subscription.exists', { subscription: subName });
      return;
    }
    logger.warn('pubsub.ensure_subscription_failed', { topic: topicName, subscription: subName, error: msg, code: e?.code });
  }
}

/** Convert arbitrary attribute values to strings for Pub/Sub transport. */
function normalizeAttrs(attrs: AttributeMap): AttributeMap {
  const out: AttributeMap = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    out[k] = String(v);
  }
  return out;
}

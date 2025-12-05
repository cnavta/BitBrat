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
import { counters } from '../../common/counters';
import { normalizeAttributes } from './attributes';
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

/** Race an async operation against a timeout. Rejects on timeout. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]) as T;
}

type EnsureMode = 'always' | 'on-publish-fail' | 'off';

function getEnsureMode(): EnsureMode {
  if (process.env.PUBSUB_ENSURE_DISABLE === '1') return 'off';
  const v = String(process.env.PUBSUB_ENSURE_MODE || '').toLowerCase();
  if (v === 'always' || v === 'on-publish-fail' || v === 'off') return v as EnsureMode;
  return 'on-publish-fail';
}

function getEnsureTimeoutMs(): number {
  const v = Number(process.env.PUBSUB_ENSURE_TIMEOUT_MS || '2000');
  return Number.isFinite(v) && v >= 0 ? v : 2000;
}

/** Optional per-publish timeout in milliseconds; 0 disables (use client defaults).
 * Default is 0 everywhere unless explicitly set via PUBSUB_PUBLISH_TIMEOUT_MS.
 */
function getPublishTimeoutMs(): number {
  const raw = process.env.PUBSUB_PUBLISH_TIMEOUT_MS;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}

const ensuredTopics = new Set<string>();

/** Lightweight in-memory idempotency dedupe (per-process). */
const DEDUPE_DISABLED = String(process.env.MESSAGE_DEDUP_DISABLE || '').toLowerCase() === '1';
function getDedupeTtlMs(): number {
  const n = Number(process.env.MESSAGE_DEDUP_TTL_MS || '600000'); // 10 minutes default
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 600000;
}
function getDedupeMax(): number {
  const n = Number(process.env.MESSAGE_DEDUP_MAX || '5000');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}
const __dedupe = {
  map: new Map<string, number>() as Map<string, number>,
  lastPrune: 0,
};
function dedupeShouldDrop(key: string, now: number): boolean {
  const ttl = getDedupeTtlMs();
  const max = getDedupeMax();
  // Prune periodically or when size exceeds max
  if (__dedupe.map.size > max || now - __dedupe.lastPrune > Math.min(ttl, 30000)) {
    for (const [k, ts] of __dedupe.map) {
      if (now - ts > ttl) __dedupe.map.delete(k);
    }
    // If still above max, drop oldest entries until at 90% of max
    if (__dedupe.map.size > max) {
      const target = Math.floor(max * 0.9);
      const it = __dedupe.map.keys();
      while (__dedupe.map.size > target) {
        const next = it.next();
        if (next.done) break;
        __dedupe.map.delete(next.value);
      }
    }
    __dedupe.lastPrune = now;
  }
  const prev = __dedupe.map.get(key);
  if (prev && now - prev <= ttl) {
    // Update timestamp to extend TTL window and drop
    __dedupe.map.set(key, now);
    return true;
  }
  __dedupe.map.set(key, now);
  return false;
}

function isNotFoundError(e: any): boolean {
  const code = e?.code ?? e?.status;
  const msg = (e?.message || '').toString();
  return code === 5 || code === 404 || /not[_\s-]?found/i.test(msg);
}

export class PubSubPublisher implements MessagePublisher {
  private readonly pubsub: PubSub;
  private readonly topicName: string;
  private readonly topic: any;

  constructor(topicName: string) {
    this.pubsub = buildClient();
    this.topicName = topicName;
    const batching = { maxMessages: getBatchMaxMessages(), maxMilliseconds: getBatchMaxMilliseconds() };
    this.topic = (this.pubsub as any).topic(this.topicName, { batching });
    // Surface effective settings at init for diagnostics
    const ensureMode = getEnsureMode();
    const publishTimeout = getPublishTimeoutMs();
    logger.info('pubsub.publisher.init', {
      topic: this.topicName,
      batching,
      ensureMode,
      publishTimeoutMs: publishTimeout,
    });
  }

  /** Serialize data to JSON and publish with optional attributes. */
  async publishJson(data: unknown, attributes: AttributeMap = {}): Promise<string | null> {
    const ensureMode = getEnsureMode();
    const ensureTimeout = getEnsureTimeoutMs();
    const publishTimeout = getPublishTimeoutMs();
    if (ensureMode === 'always' && !ensuredTopics.has(this.topicName)) {
      try {
        await withTimeout(ensureTopic(this.pubsub, this.topicName), ensureTimeout);
        ensuredTopics.add(this.topicName);
      } catch (e: any) {
        // Do not block publish path on ensure failures/timeouts
        logger.warn('pubsub.ensure_topic_failed', { topic: this.topicName, error: e?.message || String(e), mode: ensureMode, timeoutMs: ensureTimeout });
      }
    }
    const topic = this.topic;
    const payload = Buffer.from(JSON.stringify(data));
    const attrsNorm = normalizeAttributes(attributes as any);
    try {
      logger.debug('message_publisher.publish.start', {
        driver: 'pubsub',
        topic: this.topicName,
        attrCount: Object.keys(attrsNorm || {}).length,
        bytes: payload.byteLength,
      });
      const t0 = Date.now();
      const result: any = await withTimeout((topic as any).publishMessage({ data: payload, attributes: attrsNorm }), publishTimeout);
      const [messageId] = Array.isArray(result) ? result : [result];
      logger.debug('message_publisher.publish.ok', {
        driver: 'pubsub',
        topic: this.topicName,
        messageId: messageId || null,
        durationMs: Date.now() - t0,
      });
      try { counters.increment('message_publisher.publish.ok'); } catch {}
      return messageId || null;
    } catch (e: any) {
      // If our local timeout fired, tag the error with DEADLINE_EXCEEDED to enable callers to decide retry/ack policy
      if (e && typeof e.message === 'string' && /timeout after \d+ms/i.test(e.message)) {
        (e as any).code = (e as any).code || 4; // gRPC DEADLINE_EXCEEDED
        (e as any).reason = 'publish_timeout';
      }
      // If the publish failed because the topic doesn't exist, optionally attempt a fast ensure then retry once.
      if (ensureMode !== 'off' && isNotFoundError(e)) {
        try {
          logger.warn('message_publisher.publish.not_found', { driver: 'pubsub', topic: this.topicName, action: 'ensure_then_retry' });
          await withTimeout(ensureTopic(this.pubsub, this.topicName), ensureTimeout);
          ensuredTopics.add(this.topicName);
          const retryResult: any = await withTimeout((topic as any).publishMessage({ data: payload, attributes: attrsNorm }), publishTimeout);
          const [retryId] = Array.isArray(retryResult) ? retryResult : [retryResult];
          logger.debug('message_publisher.publish.ok', { driver: 'pubsub', topic: this.topicName, messageId: retryId || null, retried: true });
          return retryId || null;
        } catch (ee: any) {
          logger.warn('message_publisher.retry_failed', { driver: 'pubsub', topic: this.topicName, error: ee?.message || String(ee) });
        }
      }
      logger.error('message_publisher.publish.error', {
        driver: 'pubsub',
        topic: this.topicName,
        error: e?.message || String(e),
        code: (e && (e.code || e.status)) || undefined,
        timeout: e && /timeout after \d+ms/i.test(e.message) ? true : undefined,
      });
      try { counters.increment('message_publisher.publish.error'); } catch {}
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

      // Lightweight idempotency dedupe (based on idempotencyKey or correlationId attribute)
      try {
        if (!DEDUPE_DISABLED) {
          const key = String(
            (attrs as any).idempotencyKey ||
            (attrs as any).IdempotencyKey ||
            (attrs as any)['idempotency-key'] ||
            (attrs as any)['Idempotency-Key'] ||
            (attrs as any).correlationId ||
            (attrs as any).CorrelationId ||
            (attrs as any)['correlation-id'] ||
            (attrs as any)['Correlation-Id'] ||
            ''
          );
          if (key) {
            const now = Date.now();
            if (dedupeShouldDrop(key, now)) {
              logger.warn('message_consumer.dedupe.drop', { driver: 'pubsub', subscription: subName, idempotencyKey: key, ttlMs: getDedupeTtlMs() });
              try { counters.increment('message_consumer.dedupe.drop'); } catch {}
              await ack();
              return;
            }
          }
        }
      } catch (e: any) {
        logger.debug('message_consumer.dedupe.error', { subscription: subName, error: e?.message || String(e) });
      }
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

/** Batching defaults and env accessors */
function getBatchMaxMessages(): number {
  const v = Number(process.env.PUBSUB_BATCH_MAX_MESSAGES || '100');
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 100;
}

function getBatchMaxMilliseconds(): number {
  const raw = process.env.PUBSUB_BATCH_MAX_MS;
  const v = Number(raw == null || raw === '' ? '20' : raw);
  const ms = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 20;
  // Warn if configured very high (≥ 1000ms) which can introduce large latency at low throughput
  if (ms >= 1000) {
    logger.warn('pubsub.publisher.batching.window_high', { maxMilliseconds: ms, note: 'High flush window may add publish latency at low throughput.' });
  }
  return ms;
}

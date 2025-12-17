import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import { TwitchIrcClient, TwitchEnvelopeBuilder, ConfigTwitchCredentialsProvider, FirestoreTwitchCredentialsProvider } from '../services/ingress/twitch';
import { createTwitchIngressPublisherFromConfig } from '../services/ingress/twitch';
import { TwitchConnectorAdapter } from '../services/ingress/twitch/connector-adapter';
import { ConnectorManager } from '../services/ingress/core';
import { DiscordEnvelopeBuilder, DiscordIngressClient, createDiscordIngressPublisherFromConfig } from '../services/ingress/discord';
import { FirestoreTokenStore } from '../services/firestore-token-store';
import { buildConfig } from '../common/config';
import { logger } from '../common/logging';
import { AttributeMap } from '../services/message-bus';
import { INTERNAL_EGRESS_V1 } from '../types/events';
import { extractEgressTextFromEvent, markSelectedCandidate, selectBestCandidate } from '../services/egress/selection';
import type { PublisherResource } from '../common/resources/publisher-manager';
import type { Firestore } from 'firebase-admin/firestore';

const SERVICE_NAME = process.env.SERVICE_NAME || 'ingress-egress';
// Use centralized configuration for port instead of reading env directly in app code
const PORT = buildConfig(process.env).port;

class IngressEgressServer extends BaseServer {
  // Declare default configuration values for this service
  // Expose persistence TTL days so other components can align via ENV
  protected static CONFIG_DEFAULTS: Record<string, any> = {
    PERSISTENCE_TTL_DAYS: 7,
  };
  private twitchClient: TwitchIrcClient | null = null;
  private unsubscribeEgress: (() => Promise<void>) | null = null;
  private connectorManager: ConnectorManager | null = null;

  constructor() {
    super({ serviceName: SERVICE_NAME });
    // Perform setup after BaseServer is constructed; BaseServer's /readyz will default to ready=true
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, cfg: any) {
    // Create instances using centralized Config
    logger.debug('Creating Twitch ingress-egress service', { cfg });
    // Surface key runtime messaging config for diagnostics
    try {
      logger.info('ingress-egress.config', {
        busPrefix: cfg.busPrefix,
        messageBusDriver: process.env.MESSAGE_BUS_DRIVER || process.env.MESSAGE_BUS || 'auto',
        pubsub: {
          batchMaxMs: process.env.PUBSUB_BATCH_MAX_MS || '(default: 20)',
          batchMaxMessages: process.env.PUBSUB_BATCH_MAX_MESSAGES || '(default: 100)',
          publishTimeoutMs: process.env.PUBSUB_PUBLISH_TIMEOUT_MS || '(auto: 2000 in Cloud Run, 0 locally)',
          ensureMode: process.env.PUBSUB_ENSURE_MODE || '(default: on-publish-fail)'
        }
      });
    } catch {}

    // Resolve instance identity → used to compute per-instance egress topic
    const kRevision = process.env.K_REVISION;
    if (kRevision) {
      process.env.EGRESS_INSTANCE_ID = kRevision;
      process.env.SERVICE_INSTANCE_ID = kRevision;
    }
    const instanceId =
      process.env.EGRESS_INSTANCE_ID ||
      process.env.SERVICE_INSTANCE_ID ||
      process.env.HOSTNAME ||
      `proc-${Math.random().toString(36).slice(2, 10)}`;
    const egressTopic = `${INTERNAL_EGRESS_V1}.${instanceId}`; // without BUS_PREFIX in the value
    const egressSubject = `${cfg.busPrefix || ''}${egressTopic}`; // with BUS_PREFIX for subscription

    const envelopeBuilder = new TwitchEnvelopeBuilder();
    const pubRes = this.getResource<PublisherResource>('publisher');
    const publisher = createTwitchIngressPublisherFromConfig(cfg, pubRes ? pubRes.create.bind(pubRes) : undefined);
    const db = this.getResource<Firestore>('firestore');
    const credsProvider = cfg.firestoreEnabled
      ? new FirestoreTwitchCredentialsProvider(cfg, new FirestoreTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot', db))
      : new ConfigTwitchCredentialsProvider(cfg);

    // Create the IRC client using config-driven channels
    this.twitchClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
      cfg,
      credentialsProvider: credsProvider,
      egressDestinationTopic: egressTopic, // ensure envelope.egressDestination is set on publish
    });

    // Connector Manager wiring (register Twitch + Discord; preserve existing Twitch egress path)
    const manager = new ConnectorManager({ logger });
    if (this.twitchClient) {
      manager.register('twitch', new TwitchConnectorAdapter(this.twitchClient));
    }
    try {
      const dBuilder = new DiscordEnvelopeBuilder();
      const dPublisher = createDiscordIngressPublisherFromConfig(cfg, pubRes ? pubRes.create.bind(pubRes) : undefined);
      const dClient = new DiscordIngressClient(dBuilder, dPublisher, cfg, { egressDestinationTopic: egressTopic });
      manager.register('discord', dClient);
    } catch (e: any) {
      // Defensive: if Discord modules fail to construct, keep Twitch operational
      logger.warn('ingress-egress.discord.register_failed', { error: e?.message || String(e) });
    }

    // Start connectors (individual connectors handle disabled/test guards internally)
    try {
      await manager.start();
      this.connectorManager = manager;
    } catch (e: any) {
      logger.error('ingress-egress.connectors.start_error', { error: e?.message || String(e) });
    }

    // Subscribe to this instance's egress subject and deliver text via Twitch IRC
    const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';
    if (isTestEnv) {
      logger.debug('ingress-egress.egress_subscribe.disabled_for_tests');
    } else {
      logger.info('ingress-egress.egress_subscribe.start', { subject: egressSubject, queue: `ingress-egress.${instanceId}` });
      try {
        await this.onMessage<any>(
          { destination: egressTopic, queue: `ingress-egress.${instanceId}`, ack: 'explicit' },
          async (evt: any, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
            try {
              const tracer = (this as any).getTracer?.();
              const run = async () => {
                logger.debug('ingress-egress.egress_subscribe.received_event', { event: evt });
                // Mark selected candidate on V2 events (if candidates exist) and log rationale
                let evtForDelivery: any = evt;
                try {
                  if (evt && Array.isArray(evt.candidates) && evt.candidates.length > 0) {
                    const best = selectBestCandidate(evt.candidates);
                    if (best) {
                      logger.info('ingress-egress.egress.candidate_selected', {
                        correlationId: evt?.correlationId || evt?.envelope?.correlationId,
                        candidateId: best.id,
                        priority: best.priority,
                        confidence: best.confidence,
                        createdAt: best.createdAt,
                      });
                    }
                    evtForDelivery = markSelectedCandidate(evt);
                  }
                } catch (e: any) {
                  logger.debug('ingress-egress.egress.candidate_mark_skip', { reason: e?.message || String(e) });
                }

                const text = extractEgressTextFromEvent(evtForDelivery);
                if (!text) {
                  logger.warn('ingress-egress.egress.invalid_payload', { correlationId: evt?.correlationId || evt?.envelope?.correlationId });
                  await ctx.ack();
                  return;
                }
                const correlationId = evt?.correlationId || evt?.envelope?.correlationId;
                const publishFinalize = async (status: 'SENT' | 'FAILED', error?: { code: string; message?: string }) => {
                  try {
                    const cfg: any = this.getConfig?.() || {};
                    const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
                    const finalizeSubject = `${prefix}internal.persistence.finalize.v1`;
                    const pubRes = this.getResource<PublisherResource>('publisher');
                    const pub = pubRes?.create(finalizeSubject);
                    if (pub) {
                      const payload = {
                        correlationId,
                        destination: egressTopic,
                        deliveredAt: new Date().toISOString(),
                        status,
                        error: error ? { code: error.code, message: error.message } : undefined,
                        // Include selections context so Persistence can record them
                        // evtForDelivery has candidates with the selected one marked
                        candidates: Array.isArray((evtForDelivery as any)?.candidates) ? (evtForDelivery as any).candidates : undefined,
                        annotations: Array.isArray((evt as any)?.annotations) ? (evt as any).annotations : undefined,
                      };
                      await pub.publishJson(payload, { correlationId: String(correlationId || ''), type: 'egress.deliver.v1' });
                      logger.info('ingress-egress.finalize.published', { correlationId, status });
                    } else {
                      logger.warn('ingress-egress.finalize.publisher_unavailable');
                    }
                  } catch (e: any) {
                    logger.warn('ingress-egress.finalize.publish_error', { error: e?.message || String(e) });
                  }
                };

                try {
                  await this.twitchClient!.sendText(text);
                  logger.info('ingress-egress.egress.sent', { correlationId });
                  await publishFinalize('SENT');
                } catch (e: any) {
                  // sendText failure: publish FAILED finalization and rethrow to outer handler for logging/ack
                  await publishFinalize('FAILED', { code: 'send_error', message: e?.message || String(e) });
                  throw e;
                }
              };
              if (tracer && typeof tracer.startActiveSpan === 'function') {
                await tracer.startActiveSpan('deliver-egress', async (span: any) => {
                  try {
                    await run();
                  } finally {
                    span.end();
                  }
                });
              } else {
                await run();
              }
              await ctx.ack();
            } catch (e: any) {
              const msg = e?.message || String(e);
              // JSON parse errors or other non-retryable conditions → ack
              if (/json|unexpected token|position \d+/i.test(msg)) {
                logger.error('ingress-egress.egress.json_error', { subject: egressSubject, error: msg });
                await ctx.ack();
              } else {
                // Bootstrap behavior: log and ack to avoid retry loops for now
                logger.error('ingress-egress.egress.process_error', { subject: egressSubject, error: msg });
                await ctx.ack();
              }
            }
          }
        );
        logger.info('ingress-egress.egress_subscribe.ok', { subject: egressSubject });
      } catch (e: any) {
        logger.error('ingress-egress.egress_subscribe.error', { subject: egressSubject, error: e?.message || String(e) });
      }
    }

    // Debug endpoint exposes current snapshot
    this.onHTTPRequest('/_debug/twitch', (_req: Request, res: Response) => {
      const snapshot = this.twitchClient!.getSnapshot();
      res.status(200).json({ snapshot, egressTopic });
    });

    // IE-DIS-07: Discord debug endpoint exposing sanitized connector snapshot (no secrets)
    this.onHTTPRequest('/_debug/discord', (_req: Request, res: Response) => {
      try {
        const manager = this.connectorManager;
        const snapshots = manager ? manager.getSnapshot() : {} as any;
        const discordSnap = (snapshots as any)?.discord || { state: 'DISCONNECTED' };
        // Sanitize: remove any unexpected sensitive fields if present
        const { token, botToken, secret, ...safe } = (discordSnap || {}) as Record<string, unknown>;
        res.status(200).json({ snapshot: safe, egressTopic });
      } catch (e: any) {
        res.status(200).json({ snapshot: { state: 'ERROR', lastError: { message: e?.message || String(e) } }, egressTopic });
      }
    });
  }
}

export function createApp() {
  const server = new IngressEgressServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    logger.info('[ingress-egress] listening on port ' + PORT);
  });
}

// text extraction now lives in services/egress/selection.ts

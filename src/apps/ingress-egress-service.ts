import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import { TwitchIrcClient, TwitchEnvelopeBuilder, ConfigTwitchCredentialsProvider, FirestoreTwitchCredentialsProvider } from '../services/ingress/twitch';
import { createTwitchIngressPublisherFromConfig } from '../services/ingress/twitch';
import { FirestoreTokenStore } from '../services/firestore-token-store';
import { buildConfig } from '../common/config';
import { logger } from '../common/logging';
import { AttributeMap, createMessageSubscriber } from '../services/message-bus';
import { INTERNAL_EGRESS_V1 } from '../types/events';
import { extractEgressTextFromEvent, markSelectedCandidate, selectBestCandidate } from '../services/egress/selection';
import type { PublisherResource } from '../common/resources/publisher-manager';
import type { Firestore } from 'firebase-admin/firestore';

const SERVICE_NAME = process.env.SERVICE_NAME || 'ingress-egress';
// Use centralized configuration for port instead of reading env directly in app code
const PORT = buildConfig(process.env).port;

class IngressEgressServer extends BaseServer {
  private twitchClient: TwitchIrcClient | null = null;
  private unsubscribeEgress: (() => Promise<void>) | null = null;

  constructor() {
    super({ serviceName: SERVICE_NAME });
    // Perform setup after BaseServer is constructed; BaseServer's /readyz will default to ready=true
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, cfg: any) {
    // Create instances using centralized Config
    logger.debug('Creating Twitch ingress-egress service', { cfg });

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

    // Start the client (will be a no-op connection in tests)
    this.twitchClient.start?.().catch((e) => {
      logger.error('[ingress-egress] twitchClient.start error', e?.message || e);
    });

    // Subscribe to this instance's egress subject and deliver text via Twitch IRC
    const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';
    if (isTestEnv) {
      logger.debug('ingress-egress.egress_subscribe.disabled_for_tests');
    } else {
      const subscriber = createMessageSubscriber();
      logger.info('ingress-egress.egress_subscribe.start', { subject: egressSubject, queue: `ingress-egress.${instanceId}` });
      try {
        this.unsubscribeEgress = await subscriber.subscribe(
          egressSubject,
          async (data: Buffer, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
            try {
              const evt = JSON.parse(data.toString('utf8')) as any;
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
              await this.twitchClient!.sendText(text);
              logger.info('ingress-egress.egress.sent', { correlationId: evt?.correlationId || evt?.envelope?.correlationId });
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
          },
          { queue: `ingress-egress.${instanceId}`, ack: 'explicit' }
        );
        logger.info('ingress-egress.egress_subscribe.ok', { subject: egressSubject });
      } catch (e: any) {
        logger.error('ingress-egress.egress_subscribe.error', { subject: egressSubject, error: e?.message || String(e) });
      }
    }

    // Debug endpoint exposes current snapshot
    app.get('/_debug/twitch', (_req: Request, res: Response) => {
      const snapshot = this.twitchClient!.getSnapshot();
      res.status(200).json({ snapshot, egressTopic });
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

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

const SERVICE_NAME = process.env.SERVICE_NAME || 'ingress-egress';
// Use centralized configuration for port instead of reading env directly in app code
const PORT = buildConfig(process.env).port;

export function createApp() {
  // We'll initialize instances inside BaseServer.setup() where we have the typed Config
  let twitchClient: TwitchIrcClient | null = null;
  let unsubscribeEgress: (() => Promise<void>) | null = null;

  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    readinessCheck: () => (twitchClient ? twitchClient.getSnapshot().state === 'CONNECTED' : false),
    setup: async (app: Express, cfg, resources) => {
      // Create instances using centralized Config
      logger.debug('Creating Twitch ingress-egress service', { cfg });

      // Resolve instance identity → used to compute per-instance egress topic
      // If running on Cloud Run, K_REVISION is a stable identifier for the deployed revision.
      // When present, use it to set both EGRESS_INSTANCE_ID and SERVICE_INSTANCE_ID so all
      // downstream logic (and other modules) see a consistent instance identity.
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
      const publisher = createTwitchIngressPublisherFromConfig(cfg, (resources as any)?.publisher?.create);
      const credsProvider = cfg.firestoreEnabled
        ? new FirestoreTwitchCredentialsProvider(cfg, new FirestoreTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot', (resources as any)?.firestore))
        : new ConfigTwitchCredentialsProvider(cfg);

      // Create the IRC client using config-driven channels
      twitchClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
        cfg,
        credentialsProvider: credsProvider,
        egressDestinationTopic: egressTopic, // ensure envelope.egressDestination is set on publish
      });

      // Start the client (will be a no-op connection in tests)
      twitchClient.start?.().catch((e) => {
        // eslint-disable-next-line no-logger
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
          unsubscribeEgress = await subscriber.subscribe(
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
                await twitchClient!.sendText(text);
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
        const snapshot = twitchClient!.getSnapshot();
        res.status(200).json({ snapshot, egressTopic });
      });
    },
  });
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

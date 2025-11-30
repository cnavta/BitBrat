import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import { TwitchIrcClient, TwitchEnvelopeBuilder, ConfigTwitchCredentialsProvider, FirestoreTwitchCredentialsProvider } from '../services/ingress/twitch';
import { createTwitchIngressPublisherFromConfig } from '../services/ingress/twitch';
import { buildConfig } from '../common/config';
import { logger } from '../common/logging';
import { AttributeMap, createMessageSubscriber } from '../services/message-bus';
import { INTERNAL_EGRESS_V1, InternalEventV1 } from '../types/events';

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
    setup: async (app: Express, cfg) => {
      // Create instances using centralized Config
      logger.debug('Creating Twitch ingress-egress service', { cfg });

      // Resolve instance identity → used to compute per-instance egress topic
      const instanceId =
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        `proc-${Math.random().toString(36).slice(2, 10)}`;
      const egressTopic = `${INTERNAL_EGRESS_V1}.${instanceId}`; // without BUS_PREFIX in the value
      const egressSubject = `${cfg.busPrefix || ''}${egressTopic}`; // with BUS_PREFIX for subscription

      const envelopeBuilder = new TwitchEnvelopeBuilder();
      const publisher = createTwitchIngressPublisherFromConfig(cfg);
      const credsProvider = cfg.firestoreEnabled
        ? new FirestoreTwitchCredentialsProvider(cfg)
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
                const evt = JSON.parse(data.toString('utf8')) as InternalEventV1;
                const text = extractEgressText(evt);
                if (!text) {
                  logger.warn('ingress-egress.egress.invalid_payload', { correlationId: evt?.envelope?.correlationId });
                  await ctx.ack();
                  return;
                }
                await twitchClient!.sendText(text);
                logger.info('ingress-egress.egress.sent', { correlationId: evt?.envelope?.correlationId });
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

/** Extracts the text to send from an InternalEventV1 for egress delivery (bootstrap). */
function extractEgressText(evt: InternalEventV1 | any): string | null {
  try {
    const text = evt?.payload?.chat?.text ?? evt?.payload?.text;
    if (typeof text === 'string' && text.trim().length > 0) return text.trim();
    return null;
  } catch {
    return null;
  }
}

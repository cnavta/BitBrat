import '../common/safe-timers';
import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { INTERNAL_INGRESS_V1, INTERNAL_USER_ENRICHED_V1, InternalEventV1 } from '../types/events';
import { AttributeMap, createMessagePublisher, createMessageSubscriber } from '../services/message-bus';
import { FirestoreUserRepo } from '../services/auth/user-repo';
import { enrichEvent } from '../services/auth/enrichment';
import { logger } from '../common/logging';
import { counters } from '../common/counters';
import { configureFirestore } from '../common/firebase';

const SERVICE_NAME = process.env.SERVICE_NAME || 'auth';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export function createApp() {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    setup: async (app: Express, cfg) => {
      const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';
      // Configure Firestore database binding if provided
      if (process.env.FIREBASE_DATABASE_ID) {
        configureFirestore(process.env.FIREBASE_DATABASE_ID);
      }

      // Debug counters endpoint
      app.get('/_debug/counters', (_req, res) => {
        res.status(200).json({ counters: counters.snapshot() });
      });

      // Message bus subscription (skipped in test to avoid external clients during Jest)
      if (isTestEnv) {
        logger.debug('auth.subscribe.disabled_for_tests');
      } else {
        const inputSubject = `${cfg.busPrefix || ''}${INTERNAL_INGRESS_V1}`;
        const outTopic = process.env.AUTH_ENRICH_OUTPUT_TOPIC || INTERNAL_USER_ENRICHED_V1;
        const outputSubject = `${cfg.busPrefix || ''}${outTopic}`;
        const subscriber = createMessageSubscriber();
        const userRepo = new FirestoreUserRepo('users');

        logger.info('auth.subscribe.start', { subject: inputSubject, queue: 'auth' });
        try {
          await subscriber.subscribe(
            inputSubject,
            async (data: Buffer, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
              try {
                counters.increment('auth.enrich.total');
                const evt = JSON.parse(data.toString('utf8')) as InternalEventV1;
                const { event: enriched, matched, userRef } = await enrichEvent(evt, userRepo, {
                  provider: (evt?.envelope as any)?.source?.split('.')?.[1],
                });
                if (matched) {
                  counters.increment('auth.enrich.matched');
                  logger.debug('auth.enrich.matched', { correlationId: enriched.envelope.correlationId, userRef, outputSubject });
                } else {
                  counters.increment('auth.enrich.unmatched');
                  logger.debug('auth.enrich.unmatched', { correlationId: enriched.envelope.correlationId, outputSubject });
                }

                const pub = createMessagePublisher(outputSubject);
                const pubAttrs: AttributeMap = {
                  type: enriched.type,
                  correlationId: enriched.envelope.correlationId,
                  source: enriched.envelope.source,
                  ...(enriched.envelope.traceId ? { traceId: enriched.envelope.traceId } : {}),
                };
                await pub.publishJson(enriched, pubAttrs);
                logger.info('auth.publish.ok', { subject: outputSubject });
                await ctx.ack();
              } catch (e: any) {
                const msg = e?.message || String(e);
                counters.increment('auth.enrich.errors');
                logger.error('auth.ingress.process_error', { subject: inputSubject, error: msg });
                // Poison JSON -> ack; other errors -> nack(requeue)
                if (/json|unexpected token|position \d+/i.test(msg)) {
                  await ctx.ack();
                } else {
                  await ctx.nack(true);
                }
              }
            },
            { queue: 'auth', ack: 'explicit' }
          );
          logger.info('auth.subscribe.ok', { subject: inputSubject, queue: 'auth' });
        } catch (e: any) {
          logger.error('auth.subscribe.error', { subject: inputSubject, error: e?.message || String(e) });
        }
      }
    },
  });
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[auth] listening on port ' + PORT);
  });
}

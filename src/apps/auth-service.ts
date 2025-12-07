import '../common/safe-timers';
import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { INTERNAL_INGRESS_V1, INTERNAL_USER_ENRICHED_V1, InternalEventV2, RoutingStep } from '../types/events';
import { AttributeMap, createMessagePublisher } from '../services/message-bus';
import { FirestoreUserRepo } from '../services/auth/user-repo';
import { enrichEvent } from '../services/auth/enrichment';
import { logger } from '../common/logging';
import { counters } from '../common/counters';
import { busAttrsFromEvent } from '../common/events/attributes';
import type { PublisherResource } from '../common/resources/publisher-manager';
import type { Firestore } from 'firebase-admin/firestore';

const SERVICE_NAME = process.env.SERVICE_NAME || 'auth';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

class AuthServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, cfg: any) {
    const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';

    // Debug counters endpoint via BaseServer helper
    this.onHTTPRequest('/_debug/counters', (_req, res) => {
      res.status(200).json({ counters: counters.snapshot() });
    });

    // Message bus subscription (skipped in test to avoid external clients during Jest)
    if (isTestEnv) {
      logger.debug('auth.subscribe.disabled_for_tests');
      return;
    }

    const inputSubject = `${cfg.busPrefix || ''}${INTERNAL_INGRESS_V1}`;
    const outTopic = process.env.AUTH_ENRICH_OUTPUT_TOPIC || INTERNAL_USER_ENRICHED_V1;
    const outputSubject = `${cfg.busPrefix || ''}${outTopic}`;
    const pubRes = this.getResource<PublisherResource>('publisher');
    const publisher = pubRes ? pubRes.create(outputSubject) : createMessagePublisher(outputSubject);
    const db = this.getResource<Firestore>('firestore');
    const userRepo = new FirestoreUserRepo('users', db);

    logger.info('auth.subscribe.start', { subject: inputSubject, queue: 'auth' });
    try {
      await this.onMessage<InternalEventV2>(
        { destination: INTERNAL_INGRESS_V1, queue: 'auth', ack: 'explicit' },
        async (asV2: InternalEventV2, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
          try {
            counters.increment('auth.enrich.total');

            // Create a child span for enrichment and publish for better trace visibility
            const tracer = (this as any).getTracer?.();
            const run = async () => {
              const { event: enrichedV2Initial, matched, userRef } = await enrichEvent(asV2, userRepo, {
                provider: (asV2 as any)?.source?.split('.')?.[1],
              });

              // Append/update routing step for auth
              let enrichedV2: InternalEventV2 = enrichedV2Initial;
              const nowIso = new Date().toISOString();
              const stepId = 'auth';
              const slip: RoutingStep[] = Array.isArray(enrichedV2.routingSlip) ? [...(enrichedV2.routingSlip as RoutingStep[])] : [];
              const idx = slip.findIndex((s) => s.id === stepId);
              const step: RoutingStep = {
                id: stepId,
                v: '1',
                status: matched ? 'OK' : 'SKIP',
                attempt: 0,
                maxAttempts: 1,
                startedAt: slip[idx]?.startedAt || nowIso,
                endedAt: nowIso,
              };
              if (idx >= 0) slip[idx] = { ...slip[idx], ...step };
              else slip.push(step);
              enrichedV2 = { ...enrichedV2, routingSlip: slip };

              if (matched) {
                counters.increment('auth.enrich.matched');
                logger.debug('auth.enrich.matched', { correlationId: enrichedV2.correlationId, userRef, outputSubject });
              } else {
                counters.increment('auth.enrich.unmatched');
                logger.debug('auth.enrich.unmatched', { correlationId: enrichedV2.correlationId, outputSubject });
              }

              const pubAttrs: AttributeMap = busAttrsFromEvent(enrichedV2);
              publisher.publishJson(enrichedV2, pubAttrs);
              logger.info('auth.publish.ok', { subject: outputSubject });
            };
            if (tracer && typeof tracer.startActiveSpan === 'function') {
              await tracer.startActiveSpan('user-enrichment', async (span: any) => {
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
            counters.increment('auth.enrich.errors');
            logger.error('auth.ingress.process_error', { subject: inputSubject, error: msg });
            // Poison JSON -> ack; known network/publish timeouts -> ack to avoid redelivery storm; otherwise nack(requeue)
            const isJsonError = /json|unexpected token|position \d+/i.test(msg);
            const code = (e && (e.code || e.status)) || undefined;
            const isPublishTimeout = code === 4 /* DEADLINE_EXCEEDED */ || /DEADLINE_EXCEEDED|name resolution|getaddrinfo|ENOTFOUND|EAI_AGAIN|Waiting for LB pick/i.test(msg);
            if (isJsonError || isPublishTimeout) {
              await ctx.ack();
            } else {
              await ctx.nack(true);
            }
          }
        }
      );
      logger.info('auth.subscribe.ok', { subject: inputSubject, queue: 'auth' });
    } catch (e: any) {
      logger.error('auth.subscribe.error', { subject: inputSubject, error: e?.message || String(e) });
    }
  }
}

export function createApp() {
  const server = new AuthServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[auth] listening on port ' + PORT);
  });
}

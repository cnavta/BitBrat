import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { logger } from '../common/logging';
import { INTERNAL_INGRESS_V1, InternalEventV1 } from '../types/events';
import { AttributeMap, createMessagePublisher, createMessageSubscriber } from '../services/message-bus';
import { RuleLoader } from '../services/router/rule-loader';
import { RouterEngine } from '../services/routing/router-engine';
import { getFirestore } from '../common/firebase';

const SERVICE_NAME = process.env.SERVICE_NAME || 'event-router';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export function createApp() {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    setup: async (_app: Express, cfg) => {
      // Initialize rules and router engine
      const ruleLoader = new RuleLoader();
      const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
      try {
        if (isTestEnv) {
          // Avoid initializing Firestore listeners during Jest to prevent open handles
          logger.debug('event_router.rule_loader.disabled_for_tests');
        } else {
          // Start rule loading asynchronously; do not block subscription on Firestore availability
          // Any errors are logged and do not prevent router startup
          ruleLoader.start(getFirestore()).catch((e: any) => {
            logger.warn('event_router.rule_loader.start_error', { error: e?.message || String(e) });
          });
        }
      } catch (e: any) {
        logger.warn('event_router.rule_loader.start_error', { error: e?.message || String(e) });
      }
      const engine = new RouterEngine();

      // Subscribe to ingress topic and process routing decisions
      const subject = `${cfg.busPrefix || ''}${INTERNAL_INGRESS_V1}`;
      const sub = createMessageSubscriber();
      logger.info('event_router.subscribe.start', { subject, queue: 'event-router' });
      try {
        await sub.subscribe(
          subject,
          async (data: Buffer, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
            try {
              const evt = JSON.parse(data.toString('utf8')) as InternalEventV1;
              // Route using rules (first-match-wins, default path)
              const { slip, decision } = engine.route(evt, ruleLoader.getRules());
              evt.envelope.routingSlip = slip;

              // Debug decision logging per technical architecture
              logger.debug('router.decision', {
                matched: decision.matched,
                ruleId: decision.ruleId,
                priority: decision.priority,
                selectedTopic: decision.selectedTopic,
                type: evt?.type,
                correlationId: evt?.envelope?.correlationId,
              });

              // Publish to the next topic (first step)
              const outSubject = `${cfg.busPrefix || ''}${decision.selectedTopic}`;
              const pub = createMessagePublisher(outSubject);
              const pubAttrs: AttributeMap = {
                type: evt.type,
                correlationId: evt.envelope.correlationId,
                source: evt.envelope.source,
                ...(evt.envelope.traceId ? { traceId: evt.envelope.traceId } : {}),
              };
              await pub.publishJson(evt, pubAttrs);
              logger.info('event_router.publish.ok', { subject: outSubject, selectedTopic: decision.selectedTopic });
              // Acknowledge only after successful publish
              await ctx.ack();
            } catch (e: any) {
              // Parsing, routing, or publish error
              const msg = e?.message || String(e);
              logger.error('event_router.ingress.process_error', { subject, error: msg });
              // If JSON is invalid, ack to prevent poison redelivery; otherwise nack to retry
              if (msg && /json|unexpected token|position \d+/i.test(msg)) {
                await ctx.ack();
              } else {
                await ctx.nack(true);
              }
            }
          },
          { queue: 'event-router', ack: 'explicit' }
        );
        logger.info('event_router.subscribe.ok', { subject, queue: 'event-router' });
      } catch (e: any) {
        logger.error('event_router.subscribe.error', { subject, error: e?.message || String(e) });
      }
    },
  });
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[event-router] listening on port ' + PORT);
  });
}

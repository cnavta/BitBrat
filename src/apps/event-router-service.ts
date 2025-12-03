import '../common/safe-timers'; // install safe timer clamps early for this process
import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { logger } from '../common/logging';
import { InternalEventV2, INTERNAL_USER_ENRICHED_V1 } from '../types/events';
import { AttributeMap, createMessageSubscriber } from '../services/message-bus';
import { RuleLoader } from '../services/router/rule-loader';
import { RouterEngine } from '../services/routing/router-engine';
// Firestore is provided via BaseServer resources
import { counters } from '../common/counters';
import { busAttrsFromEvent } from '../common/events/attributes';

const SERVICE_NAME = process.env.SERVICE_NAME || 'event-router';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export function createApp() {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    setup: async (_app: Express, cfg, resources) => {
      // ---------------- Debug endpoints ----------------
      // Expose process-local counters for observability
      _app.get('/_debug/counters', (_req, res) => {
        try {
          res.status(200).json({ counters: counters.snapshot() });
        } catch (e: any) {
          logger.warn('event_router.debug_counters_error', { error: e?.message || String(e) });
          res.status(500).json({ error: 'debug_counters_unavailable' });
        }
      });
      // Convenience alias to counters on base /_debug
      _app.get('/_debug', (_req, res) => {
        res.redirect(302, '/_debug/counters');
      });
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
          ruleLoader.start((resources as any)?.firestore).catch((e: any) => {
            logger.warn('event_router.rule_loader.start_error', { error: e?.message || String(e) });
          });
        }
      } catch (e: any) {
        logger.warn('event_router.rule_loader.start_error', { error: e?.message || String(e) });
      }
      const engine = new RouterEngine();

      // Subscribe to default input topic (env override supported)
      const inputTopic = process.env.ROUTER_DEFAULT_INPUT_TOPIC || INTERNAL_USER_ENRICHED_V1;
      const subject = `${cfg.busPrefix || ''}${inputTopic}`;
      const sub = createMessageSubscriber();
      logger.info('event_router.subscribe.start', { subject, queue: 'event-router' });
      try {
        await sub.subscribe(
          subject,
          async (data: Buffer, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
            try {
              const raw = JSON.parse(data.toString('utf8')) as any;
              // Assume V2 payloads; no V1 support
              const v2In: InternalEventV2 = raw as InternalEventV2;
              logger.debug('event_router.ingress.received', {
                event: v2In,
              });
              // Route using rules (first-match-wins, default path). RouterEngine now accepts V2.
              const { slip, decision } = engine.route(v2In, ruleLoader.getRules());
              v2In.routingSlip = slip;
              const v2: InternalEventV2 = v2In;

              // Update observability counters
              try {
                counters.increment('router.events.total');
                if (decision.matched) counters.increment('router.rules.matched');
                else counters.increment('router.rules.defaulted');
              } catch (e: any) {
                logger.warn('event_router.counters.increment_error', { error: e?.message || String(e) });
              }

              // Debug decision logging per technical architecture
              logger.debug('router.decision', {
                matched: decision.matched,
                ruleId: decision.ruleId,
                priority: decision.priority,
                selectedTopic: decision.selectedTopic,
                type: v2?.type,
                correlationId: (v2 as any)?.correlationId,
              });

              // Publish to the next topic (first step)
              const outSubject = `${cfg.busPrefix || ''}${decision.selectedTopic}`;
              const pub = (resources as any)?.publisher?.create
                ? (resources as any).publisher.create(outSubject)
                : require('../services/message-bus').createMessagePublisher(outSubject);
              const pubAttrs: AttributeMap = busAttrsFromEvent(v2);
              await pub.publishJson(v2, pubAttrs);
              logger.info('event_router.publish.ok', { subject: outSubject, selectedTopic: decision.selectedTopic });
              // Acknowledge only after successful publish
              await ctx.ack();
            } catch (e: any) {
              // Parsing, routing, or publish error
              const msg = e?.message || String(e);
              logger.error('event_router.ingress.process_error', { subject, error: msg });
              // If JSON is invalid, ack to prevent poison redelivery
              // If known publish timeout/network name-resolution issues, ack to avoid redelivery storm
              // Otherwise, nack to retry
              const isJsonError = msg && /json|unexpected token|position \d+/i.test(msg);
              const code = (e && (e.code || e.status)) || undefined;
              const isPublishTimeout = code === 4 /* DEADLINE_EXCEEDED */ || /DEADLINE_EXCEEDED|name resolution|getaddrinfo|ENOTFOUND|EAI_AGAIN|Waiting for LB pick/i.test(msg);
              if (isJsonError || isPublishTimeout) {
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

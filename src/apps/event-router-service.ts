import '../common/safe-timers'; // install safe timer clamps early for this process
import { Bit } from '../common/base-server';
import { Express } from 'express';
import { logger } from '../common/logging';
import { InternalEventV2, INTERNAL_INGRESS_V1, INTERNAL_ENRICHED_V1, RoutingStage } from '../types/events';
import { AttributeMap } from '../services/message-bus';
import { createRuleLoader } from '../services/router/rule-loader';
import { RouterEngine } from '../services/routing/router-engine';
import { RuleMapper } from '../services/router/rule-mapper';
import { z } from 'zod';
// Firestore is provided via BaseServer resources
import { counters } from '../common/counters';
import { busAttrsFromEvent } from '../common/events/attributes';
import type { Firestore } from 'firebase-admin/firestore';
import type { PublisherResource } from '../common/resources/publisher-manager';
import { IStateStore } from '../services/routing/router-engine';
import {
  buildInternalEventSchemaPack,
  buildRouterJsonLogicPack,
  ROUTER_JSONLOGIC_GUIDE_PACK_ID,
  ROUTER_JSONLOGIC_GUIDE_RESOURCE_URI,
  SCHEMA_INTERNAL_EVENT_V2_PACK_ID,
} from '../common/context';

const SERVICE_NAME = process.env.SERVICE_NAME || 'event-router';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

/**
 * FirestoreStateStore – Persists event-router state (e.g. last candidate used) in Firestore.
 * Path: users/{userId}/routerState/{ruleId}
 */
export class FirestoreStateStore implements IStateStore {
  constructor(private readonly db: Firestore) {}

  async getLastCandidateId(userId: string, ruleId: string): Promise<string | undefined> {
    try {
      const doc = await this.db.doc(`users/${userId}/routerState/${ruleId}`).get();
      return doc.exists ? doc.data()?.lastCandidateId : undefined;
    } catch (e: any) {
      logger.warn('firestore_state_store.get_error', { userId, ruleId, error: e?.message || String(e) });
      return undefined;
    }
  }

  async updateLastCandidateId(userId: string, ruleId: string, candidateId: string): Promise<void> {
    try {
      await this.db.doc(`users/${userId}/routerState/${ruleId}`).set(
        { lastCandidateId: candidateId, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (e: any) {
      logger.warn('firestore_state_store.update_error', { userId, ruleId, candidateId, error: e?.message || String(e) });
    }
  }
}

class EventRouterServer extends Bit {
  constructor() {
    super({ serviceName: SERVICE_NAME, mcpExposure: 'platform+domain' });
    // Synchronously perform setup after BaseServer constructed
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(_app: Express, cfg: any) {
    // Register MCP Tools
    this.registerAdminTools();

    // ---------------- Debug endpoints (via BaseServer helper) ----------------
    this.onHTTPRequest('/_debug/counters', (_req, res) => {
      try {
        res.status(200).json({ counters: counters.snapshot() });
      } catch (e: any) {
        logger.warn('event_router.debug_counters_error', { error: e?.message || String(e) });
        res.status(500).json({ error: 'debug_counters_unavailable' });
      }
    });
    // Convenience alias to counters on base /_debug
    this.onHTTPRequest('/_debug', (_req, res) => {
      res.redirect(302, '/_debug/counters');
    });
    // Initialize rules and router engine
    // Use documentStore for PostgreSQL or fallback to Firestore
    const documentStore = this.getResource('documentStore');
    const db = this.getResource<Firestore>('firestore');
    const dbOrStore = documentStore || db;
    const ruleLoader = createRuleLoader(dbOrStore);

    const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1' || !!process.env.CI;
    try {
      if (isTestEnv) {
        // Avoid initializing database listeners during Jest to prevent open handles
        logger.debug('event_router.rule_loader.disabled_for_tests');
      } else {
        // Start rule loading asynchronously; do not block subscription on database availability
        // Any errors are logged and do not prevent router startup
        ruleLoader.start(dbOrStore).catch((e: any) => {
          logger.warn('event_router.rule_loader.start_error', { error: e?.message || String(e) });
        });
      }
    } catch (e: any) {
      logger.warn('event_router.rule_loader.start_error', { error: e?.message || String(e) });
    }
    const stateStore = db ? new FirestoreStateStore(db) : undefined;
    const engine = new RouterEngine(undefined, stateStore);

    // Subscribe to multiple input topics as declared in architecture.yaml
    const topics = [INTERNAL_INGRESS_V1, INTERNAL_ENRICHED_V1];
    
    for (const inputTopic of topics) {
      const subject = `${cfg.busPrefix || ''}${inputTopic}`;
      logger.info('event_router.subscribe.start', { subject, queue: 'event-router' });
      try {
        await this.onMessage<InternalEventV2>(
          { destination: inputTopic, queue: 'event-router', ack: 'explicit' },
          async (v2In: InternalEventV2, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
            try {
              logger.debug('event_router.ingress.received', {
                subject: inputTopic,
                correlationId: v2In.correlationId,
              });
              // Wrap routing + publish in a child span for trace visibility
              const tracer = (this as any).getTracer?.();
              const run = async () => {
                // Route using rules (first-match-wins, default path). RouterEngine now returns an immutable evtOut.
                const { slip, decision, evtOut } = await engine.route(v2In, ruleLoader.getRules(), this.getConfig());
                evtOut.routing = {
                  stage: evtOut.routing?.stage ?? v2In.routing?.stage ?? 'initial',
                  slip,
                  history: evtOut.routing?.history ? [...evtOut.routing.history] : [],
                };
                const v2: InternalEventV2 = evtOut;

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
                routing: v2.routing,
              });

                // Publish to the next topic using advance routing slip pattern
                await this.next(v2);
              };
              if (tracer && typeof tracer.startActiveSpan === 'function') {
                await tracer.startActiveSpan('route-message', async (span: any) => {
                  try {
                    await run();
                  } finally {
                    span.end();
                  }
                });
              } else {
                await run();
              }
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
          }
        );
        logger.info('event_router.subscribe.ok', { subject, queue: 'event-router' });
      } catch (e: any) {
        logger.error('event_router.subscribe.error', { subject, error: e?.message || String(e) });
      }
    }
  }

  private registerAdminTools() {
    const db = this.getResource<Firestore>('firestore');

    // Just-in-Time Context Provisioning (sprint-328, P0/P1): contribute the JsonLogic guide pack
    // (generated from jsonlogic-evaluator.ts) + the shared schema pack, expose the guide as an MCP
    // Resource, and bind both to create_rule. The shared schema pack de-dupes across the fleet.
    const routerPack = buildRouterJsonLogicPack();
    this.registerContextPack(routerPack);
    this.registerContextPack(buildInternalEventSchemaPack());
    this.registerResource(
      ROUTER_JSONLOGIC_GUIDE_RESOURCE_URI,
      routerPack.title,
      'JsonLogic routing guide: EvalContext paths + custom operators (generated from jsonlogic-evaluator.ts).',
      async (uri) => ({
        contents: [{ uri, mimeType: 'text/markdown', text: String(routerPack.body) }],
      })
    );

    // --- list_rules ---
    this.registerTool(
      'list_rules',
      'List all active routing rules stored in Firestore.',
      z.object({}),
      async () => {
        if (!db) {
          return {
            content: [{ type: 'text', text: 'Firestore not available' }],
            isError: true,
          };
        }
        const snap = await db.collection('configs/routingRules/rules').get();
        const rules = snap.docs.map(doc => ({
          id: doc.id,
          description: doc.data().description,
          priority: doc.data().priority,
          enabled: doc.data().enabled,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }] };
      }
    );

    // --- get_rule ---
    this.registerTool(
      'get_rule',
      'Retrieve the full details of a specific routing rule.',
      z.object({
        id: z.string().describe('The ID of the rule to retrieve.'),
      }),
      async ({ id }) => {
        if (!db) {
          return {
            content: [{ type: 'text', text: 'Firestore not available' }],
            isError: true,
          };
        }
        const doc = await db.collection('configs/routingRules/rules').doc(id).get();
        if (!doc.exists) {
          return {
            content: [{ type: 'text', text: `Rule ${id} not found` }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ id: doc.id, ...doc.data() }, null, 2) }] };
      }
    );

    // --- create_rule ---
    this.registerToolWithContext(
      'create_rule',
      'Create a new routing rule with specific logic and routing slip. See the context://router/jsonlogic-guide resource for the evaluation-context paths and custom operators.',
      z.object({
        logic: z.string().describe('A JsonLogic expression (JSON string) evaluated against an event-derived context. Available paths: type, identity.*, annotations[], candidates[], routingSlip, message, payload, source, channel, userId, user, auth. Custom ops: ci_eq, re_test, slip_complete, has_role, has_annotation, has_candidate, text_contains. See context://router/jsonlogic-guide.'),
        services: z.array(z.string()).describe('A list of service names (e.g., llm-bot, auth) to form the routing slip.'),
        description: z.string().optional().describe('A description for the rule.'),
        priority: z.number().optional().default(100).describe('Rule priority.'),
        stage: z.enum(['initial', 'contextualization', 'analysis', 'reaction', 'response', 'error', 'meta']).optional().default('initial').describe('The routing stage to apply when the rule matches.'),
        promptTemplate: z.string().optional().describe('A template for a prompt annotation.'),
        responseTemplate: z.string().optional().describe('A template for a text candidate.'),
        personalityId: z.string().optional().describe('The ID of a personality to attach to matched events.'),
        customAnnotation: z.object({
          key: z.string(),
          value: z.string(),
        }).optional().describe('A key-value pair for a custom annotation.'),
      }),
      async (params) => {
        if (!db) {
          return {
            content: [{ type: 'text', text: 'Firestore not available' }],
            isError: true,
          };
        }
        try {
          const ruleDoc = RuleMapper.mapToRuleDoc(params);
          const res = await db.collection('configs/routingRules/rules').add({
            ...ruleDoc,
            createdAt: new Date().toISOString(),
          });
          return {
            content: [{
              type: 'text',
              text: `Successfully created rule ${res.id}`,
            }],
          };
        } catch (e: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to create rule: ${e.message}`,
            }],
            isError: true,
          };
        }
      },
      [ROUTER_JSONLOGIC_GUIDE_PACK_ID, SCHEMA_INTERNAL_EVENT_V2_PACK_ID]
    );

    // Task binding (sprint-328, P2/BL-202): the rule-authoring task pulls the JsonLogic guide even
    // when invoked as an internal pipeline stage (not via the create_rule MCP tool).
    this.registerContextBinding({
      pack: ROUTER_JSONLOGIC_GUIDE_PACK_ID,
      when: { tasks: ['routing.create_rule'] },
    });
  }
}

export function createServer() {
  return new EventRouterServer();
}

export function createApp() {
  const server = createServer();
  return server.getApp();
}

if (require.main === module) {
  Bit.ensureRequiredEnv(SERVICE_NAME);
  // Use the Bit start() lifecycle (not app.listen directly) so the post-listen hooks run — most
  // importantly publishRegistration(), which advertises this Bit on INTERNAL_MCP_REGISTRATION_V1 so
  // the tool-gateway discovers it. Bypassing start() left event-router absent from the registry.
  const server = createServer();
  void server.start(PORT);
}

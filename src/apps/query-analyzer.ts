import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import type { InternalEventV2, AnnotationV1, Routing, RoutingStep } from '../types/events';
import crypto from 'crypto';
import type { PublisherResource } from '../common/resources/publisher-manager';
import { analyzeWithLlm, QueryAnalysis } from '../services/query-analyzer/llm-provider';
import { buildDispositionObservationEvent } from '../services/disposition/observation';
import { INTERNAL_USER_DISPOSITION_OBSERVATION_V1 } from '../types/disposition';
import { encodingForModel } from 'js-tiktoken';

const SERVICE_NAME = process.env.SERVICE_NAME || 'query-analyzer';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

const encoder = encodingForModel('gpt-4o');

const RAW_CONSUMED_TOPICS: string[] = [
  "internal.query.analysis.v1"
];

class QueryAnalyzerServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private isDispositionEnabled(): boolean {
    return this.getConfig<boolean>('DISPOSITION_ENABLED', {
      default: true,
      parser: (value: any) => value === true || value === 'true'
    });
  }

  private async analyzeQuery(text: string, correlationId?: string): Promise<QueryAnalysis | null> {
    return analyzeWithLlm(text, {
      logger: this.getLogger() as any,
      correlationId
    });
  }

  private applyPendingRoute(msg: InternalEventV2, completedStepStatus: 'OK' | 'ERROR' | 'SKIP' = 'OK'): boolean {
    const pendingRoute = (msg as InternalEventV2 & { route?: Partial<Routing> }).route;
    if (!pendingRoute || !Array.isArray(pendingRoute.slip)) {
      return false;
    }

    try {
      (this as any).updateCurrentStep?.(msg, { status: completedStepStatus });
    } catch {}

    const previousHistory = Array.isArray(msg.routing?.history)
      ? msg.routing.history.map((step) => ({ ...step }))
      : [];
    const previousSlip = Array.isArray(msg.routing?.slip)
      ? msg.routing.slip.map((step) => ({ ...step }))
      : [];

    msg.routing = {
      stage: pendingRoute.stage ?? msg.routing?.stage ?? 'analysis',
      slip: pendingRoute.slip.map((step: RoutingStep) => ({ ...step })),
      history: [...previousHistory, ...previousSlip],
    };

    delete (msg as InternalEventV2 & { route?: Partial<Routing> }).route;
    return true;
  }

  private async emitDispositionObservation(msg: InternalEventV2, analysis: QueryAnalysis, observedAt: string): Promise<void> {
    if (!this.isDispositionEnabled()) return;

    const observation = buildDispositionObservationEvent(msg, analysis, SERVICE_NAME, observedAt);
    if (!observation) {
      this.getLogger().warn('disposition.identity.missing', {
        correlationId: msg.correlationId,
        externalPlatform: msg.identity?.external?.platform,
      });
      return;
    }

    const publisher = this.getResource<PublisherResource>('publisher');
    if (!publisher) {
      this.getLogger().warn('query-analyzer.disposition.publisher_missing', {
        correlationId: msg.correlationId,
      });
      return;
    }

    const cfg: any = this.getConfig?.() || {};
    const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
    const subject = prefix && !INTERNAL_USER_DISPOSITION_OBSERVATION_V1.startsWith(prefix)
      ? `${prefix}${INTERNAL_USER_DISPOSITION_OBSERVATION_V1}`
      : INTERNAL_USER_DISPOSITION_OBSERVATION_V1;

    try {
      await publisher.create(subject).publishJson(observation, {
        correlationId: msg.correlationId,
        type: INTERNAL_USER_DISPOSITION_OBSERVATION_V1,
      });
    } catch (error: any) {
      this.getLogger().error('query-analyzer.disposition.emit_failed', {
        correlationId: msg.correlationId,
        userKey: observation.userKey,
        error: error?.message || String(error),
      });
    }
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)


    // Message subscriptions for consumed topics declared in architecture.yaml
    try {
      const instanceId =
        process.env.K_REVISION ||
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        Math.random().toString(36).slice(2);

      { // subscription for internal.query.analysis.v1
        const raw = "internal.query.analysis.v1";
        const destination = raw && raw.includes('{instanceId}') ? raw.replace('{instanceId}', String(instanceId)) : raw;
        const queue = raw && raw.includes('{instanceId}') ? SERVICE_NAME + '.' + String(instanceId) : SERVICE_NAME;
        try {
          await this.onMessage<InternalEventV2>(
            { destination, queue, ack: 'explicit' },
            async (msg: InternalEventV2, _attributes, ctx) => {
              try {
                this.getLogger().info('query-analyzer.message.received', {
                  destination,
                  correlationId: msg.correlationId,
                });

                const text = msg.message?.text;
                if (!text) {
                  this.getLogger().warn('query-analyzer.no_text', { correlationId: msg.correlationId });
                  if (this.applyPendingRoute(msg)) {
                    await this.next(msg);
                  } else {
                    await this.next(msg, 'OK');
                  }
                  await ctx.ack();
                  return;
                }

                // Skip analysis for very short messages (QA-005)
                const tokens = encoder.encode(text);
                if (tokens.length < 3) {
                  this.getLogger().info('query-analyzer.skip_short_message', {
                    correlationId: msg.correlationId,
                    tokenCount: tokens.length
                  });
                  if (this.applyPendingRoute(msg)) {
                    await this.next(msg);
                  } else {
                    await this.next(msg, 'OK');
                  }
                  await ctx.ack();
                  return;
                }

                const analysis = await this.analyzeQuery(text, msg.correlationId);
                if (analysis) {
                  const now = new Date().toISOString();
                  const annotations: AnnotationV1[] = [
                    {
                      id: crypto.randomUUID(),
                      kind: 'intent',
                      source: SERVICE_NAME,
                      createdAt: now,
                      label: analysis.intent,
                      value: analysis.intent,
                    },
                    {
                      id: crypto.randomUUID(),
                      kind: 'tone',
                      source: SERVICE_NAME,
                      createdAt: now,
                      payload: analysis.tone,
                    },
                    {
                      id: crypto.randomUUID(),
                      kind: 'risk',
                      source: SERVICE_NAME,
                      createdAt: now,
                      label: analysis.risk.level,
                      payload: analysis.risk,
                    }
                  ];

                  if (!msg.annotations) msg.annotations = [];
                  msg.annotations.push(...annotations);

                  await this.emitDispositionObservation(msg, analysis, now);

                  // Short-circuit logic (QA-004)
                  if (analysis.intent === 'spam' || analysis.risk.level === 'high') {
                    this.getLogger().info('query-analyzer.short_circuit', {
                      correlationId: msg.correlationId,
                      intent: analysis.intent,
                      risk: analysis.risk.level
                    });
                    await this.complete(msg, 'OK');
                  } else {
                    if (this.applyPendingRoute(msg)) {
                      await this.next(msg);
                    } else {
                      await this.next(msg, 'OK');
                    }
                  }
                } else {
                  // Fallback if Ollama fails
                  if (this.applyPendingRoute(msg)) {
                    await this.next(msg);
                  } else {
                    await this.next(msg, 'OK');
                  }
                }

                await ctx.ack();
              } catch (e: any) {
                this.getLogger().error('query-analyzer.message.handler_error', { destination, error: e?.message || String(e) });
                await ctx.ack();
              }
            }
          );
          this.getLogger().info('query-analyzer.subscribe.ok', { destination, queue });
        } catch (e: any) {
          this.getLogger().error('query-analyzer.subscribe.error', { destination, queue, error: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      this.getLogger().warn('query-analyzer.subscribe.init_error', { error: e?.message || String(e) });
    }

    // Example resource access patterns (uncomment and adapt):
    // const publisher = this.getResource<any>('publisher');
    // publisher?.publishJson({ hello: 'world' });
    // const firestore = this.getResource<any>('firestore');
    // const doc = await firestore?.collection('demo').doc('x').get();
  }
}

export function createApp() {
  const server = new QueryAnalyzerServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new QueryAnalyzerServer();
  void server.start(PORT);
}

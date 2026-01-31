import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import type { InternalEventV2, AnnotationV1 } from '../types/events';
import crypto from 'crypto';

const SERVICE_NAME = process.env.SERVICE_NAME || 'query-analyzer';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

const RAW_CONSUMED_TOPICS: string[] = [
  "internal.query.analysis.v1"
];

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

const SYSTEM_PROMPT = `You are an expert linguistic analyzer for the BitBrat Platform. 
Analyze the following user message and return a JSON object with:
- intent: question|joke|praise|critique|command|meta|spam
- tone: { "valence": float (-1 to 1), "arousal": float (-1 to 1) }
- risk: { "level": "none"|"low"|"med"|"high", "type": "none"|"harassment"|"spam"|"privacy"|"self_harm"|"sexual"|"illegal" }

Valence: -1 (hostile) to 1 (supportive).
Arousal: -1 (calm) to 1 (fired up).

Respond ONLY with valid JSON.`;

interface OllamaAnalysis {
  intent: string;
  tone: { valence: number; arousal: number };
  risk: { level: string; type: string };
}

class QueryAnalyzerServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async analyzeQuery(text: string): Promise<OllamaAnalysis | null> {
    const url = `${OLLAMA_HOST}/api/generate`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3:8b',
          prompt: text,
          system: SYSTEM_PROMPT,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      const data = await response.json() as { response: string };
      return JSON.parse(data.response) as OllamaAnalysis;
    } catch (e: any) {
      this.getLogger().error('query-analyzer.ollama_error', { error: e.message, text });
      return null;
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
                  await this.next(msg, 'OK');
                  await ctx.ack();
                  return;
                }

                const analysis = await this.analyzeQuery(text);
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

                  // Short-circuit logic (QA-004)
                  if (analysis.intent === 'spam' || analysis.risk.level === 'high') {
                    this.getLogger().info('query-analyzer.short_circuit', {
                      correlationId: msg.correlationId,
                      intent: analysis.intent,
                      risk: analysis.risk.level
                    });
                    await this.complete(msg, 'OK');
                  } else {
                    await this.next(msg, 'OK');
                  }
                } else {
                  // Fallback if Ollama fails
                  await this.next(msg, 'OK');
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

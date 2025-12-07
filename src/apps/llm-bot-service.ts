import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import type { InternalEventV2, RoutingStep } from '../types/events';

const SERVICE_NAME = process.env.SERVICE_NAME || 'llm-bot';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

class LlmBotServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)


    // Example resource access patterns (uncomment and adapt):
    // const publisher = this.getResource<any>('publisher');
    // publisher?.publishJson({ hello: 'world' });
    // const firestore = this.getResource<any>('firestore');
    // const doc = await firestore?.collection('demo').doc('x').get();

    // Subscribe to the llm-bot input topic and process events
    await this.onMessage<InternalEventV2>('internal.llmbot.v1', async (eventIn, attributes, ctx) => {
      try {
        const logger = this.getLogger();
        logger.info('llm_bot.received', { correlationId: (eventIn as any)?.correlationId, attributes });

        // Create a child span for processing for better trace visibility
        const tracer = (this as any).getTracer?.();
        if (tracer && typeof tracer.startActiveSpan === 'function') {
          await tracer.startActiveSpan('llm.process', async (span: any) => {
            try {
              const evt = eventIn as InternalEventV2;
              const prompt = extractPrompt(evt);

              if (!prompt) {
                // Mark current step ERROR with code NO_PROMPT and advance routing (do not crash)
                const updated = markCurrentStepError(evt, 'NO_PROMPT', 'No prompt found in annotations');
                logger.warn('llm_bot.no_prompt', { correlationId: evt?.correlationId });
                await this.next(updated);
                return;
              }

              // Placeholder for future LLM invocation (LLB-3)
              logger.info('llm_bot.prompt.ok', { correlationId: evt?.correlationId });
              // Future steps: call mcp-agent, append candidate, and advance routing
            } finally {
              span.end();
            }
          });
        }
      } finally {
        await ctx.ack();
      }
    });
  }
}

export function createApp() {
  const server = new LlmBotServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new LlmBotServer();
  void server.start(PORT);
}

/** Extract a prompt string from an InternalEventV2 annotations collection.
 * Supports either an array of AnnotationV1 entries with kind === 'prompt' or a legacy object shape.
 */
function extractPrompt(evt: InternalEventV2 | any): string | null {
  try {
    // If annotations is an array (preferred schema)
    if (Array.isArray(evt?.annotations)) {
      const ann = evt.annotations.find((a: any) => a && (a.kind === 'prompt' || a.label === 'prompt'));
      const val = ann?.value ?? ann?.payload?.text ?? ann?.payload?.value ?? ann?.label;
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    // Legacy/loose shape: annotations.prompt
    const legacy = evt?.annotations?.prompt;
    if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
  } catch {
    // ignore extraction errors; treat as missing
  }
  return null;
}

/** Mark the first pending routing step as ERROR with a code and message. */
function markCurrentStepError(evt: InternalEventV2, code: string, message?: string): InternalEventV2 {
  const slip: RoutingStep[] = Array.isArray((evt as any).routingSlip) ? ((evt as any).routingSlip as RoutingStep[]) : [];
  const idxPending = slip.findIndex((s) => s && s.status !== 'OK' && s.status !== 'SKIP');
  const step = idxPending >= 0 ? slip[idxPending] : undefined;
  if (step) {
    step.status = 'ERROR';
    step.error = { code, message, retryable: false };
    step.endedAt = new Date().toISOString();
  }
  return evt;
}

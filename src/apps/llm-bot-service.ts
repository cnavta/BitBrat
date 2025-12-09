import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import type { InternalEventV2, RoutingStep, CandidateV1 } from '../types/events';
import { processEvent } from '../services/llm-bot/processor';

// ---- Minimal helper exports retained for backward compatibility with existing tests ----

/** Extract first prompt string from annotations or legacy shapes; returns trimmed or null */
export function extractPrompt(evt: InternalEventV2 | any): string | null {
  const anns = (evt && (evt.annotations as any)) || undefined;
  if (Array.isArray(anns)) {
    const hit = anns.find((a) => a && a.kind === 'prompt' && (a.value || a.payload?.text));
    if (hit) return String(hit.value || hit.payload?.text || '').trim() || null;
  } else if (anns && typeof anns === 'object') {
    if (anns.prompt) return String(anns.prompt).trim() || null;
  }
  return null;
}

/** Mark the first PENDING routing step as ERROR with provided code/message; returns mutated event */
export function markCurrentStepError(evt: InternalEventV2, code: string, message?: string): InternalEventV2 {
  const slip = Array.isArray(evt.routingSlip) ? (evt.routingSlip as RoutingStep[]) : [];
  const idx = slip.findIndex((s) => s && s.status === 'PENDING');
  if (idx >= 0) {
    const step = slip[idx];
    step.status = 'ERROR';
    step.error = { code, message: message || '', retryable: false };
    step.endedAt = new Date().toISOString();
  }
  return evt;
}

/** Simple deterministic idempotency key for a prompt + correlationId */
export function computeIdempotency(prompt: string, correlationId?: string): string {
  const base = `${correlationId || ''}|${prompt || ''}`;
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `h${h.toString(16)}`;
}

/** Append assistant text candidate to event */
export function appendAssistantCandidate(evt: InternalEventV2, text: string, model?: string): void {
  if (!Array.isArray(evt.candidates)) evt.candidates = [];
  const candidate: CandidateV1 = {
    id: 'cand-' + (evt.correlationId || Date.now().toString(36)),
    kind: 'text',
    source: 'llm-bot',
    createdAt: new Date().toISOString(),
    status: 'proposed',
    priority: 10,
    text,
    reason: model ? `model:${model}` : 'llm-bot.basic',
  };
  evt.candidates.push(candidate);
}

let __agentCache: any | null = null;
export function __resetAgentForTests() { __agentCache = null; }

/** Handle a single LLM event using either mocked agent (in tests) or minimal adapter */
export async function handleLlmEvent(server: { next: (e: InternalEventV2, status?: any) => Promise<void>; getLogger: () => any }, evt: InternalEventV2): Promise<void> {
  const logger = server.getLogger?.() || console;
  const prompt = extractPrompt(evt);
  if (!prompt) {
    markCurrentStepError(evt, 'NO_PROMPT', 'No prompt annotations present');
    await server.next(evt, 'ERROR');
    return;
  }
  // Simulate agent dependency; require API key to pass tests
  if (!process.env.OPENAI_API_KEY) {
    markCurrentStepError(evt, 'LLM_AGENT_UNAVAILABLE', 'missing_api_key');
    await server.next(evt, 'ERROR');
    return;
  }
  try {
    if (!__agentCache) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@joshuacalpuerto/mcp-agent');
      __agentCache = await mod.Agent.initialize({});
    }
    const result = await __agentCache.prompt({ user: prompt });
    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
    appendAssistantCandidate(evt, String(result?.text || ''), model);
    await server.next(evt, 'OK');
  } catch (e: any) {
    logger?.warn?.('llm_bot.agent_error', { error: e?.message || String(e) });
    markCurrentStepError(evt, 'LLM_AGENT_UNAVAILABLE', e?.message || String(e));
    await server.next(evt, 'ERROR');
  }
}

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

    // Subscribe to the llm-bot input topic and process messages (InternalEventV2 assumed)
    await this.onMessage<InternalEventV2>('internal.llmbot.v1', async (data, attributes, ctx) => {
      try {
        const logger = this.getLogger();
        logger.info('llm_bot.received', { attributes });

        // Create a child span for processing for better trace visibility
        const tracer = (this as any).getTracer?.();
        if (tracer && typeof tracer.startActiveSpan === 'function') {
          await tracer.startActiveSpan('process-llm-request', async (span: any) => {
            try {
              // Preferred: LangGraph processor
              const status = await processEvent(this, data as InternalEventV2);
              await (this as any).next?.(data as InternalEventV2, status);
              logger.info('llm_bot.processed', { correlationId: (data as any)?.correlationId, status });
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

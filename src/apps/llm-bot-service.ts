import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import type { InternalEventV2, RoutingStep } from '../types/events';
import { createHash } from 'crypto';

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

    // Subscribe to the llm-bot input topic and log received messages (JSON assumed)
    await this.onMessage<any>('internal.llmbot.v1', async (data, attributes, ctx) => {
      try {
        const logger = this.getLogger();
        logger.info('llm_bot.received', { message: data, attributes });

        // Create a child span for processing for better trace visibility
        const tracer = (this as any).getTracer?.();
        if (tracer && typeof tracer.startActiveSpan === 'function') {
          await tracer.startActiveSpan('process-llm-request', async (span: any) => {
            try {
              logger.info('llm_bot.processing');
              await handleLlmEvent(this as any, data as InternalEventV2);
            } finally {
              span.end();
            }
          });
        } else {
          await handleLlmEvent(this as any, data as InternalEventV2);
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

// ---------------- Helper functions exported for tests and reuse ----------------

export function extractPrompt(evt: InternalEventV2): string | null {
  try {
    const anyAnn: any = (evt as any).annotations;
    if (Array.isArray(anyAnn)) {
      const prompts = anyAnn
        .filter((a: any) => (a?.kind || '').toLowerCase() === 'prompt' && typeof a?.value === 'string')
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((a: any) => String(a.value).trim())
        .filter((v: string) => v.length > 0);
      const combined = prompts.join('\n\n').trim();
      return combined.length > 0 ? combined : null;
    }
    // Legacy shape support: annotations: { prompt: string }
    if (anyAnn && typeof anyAnn.prompt === 'string') {
      const s = String(anyAnn.prompt).trim();
      return s.length ? s : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function markCurrentStepError(evt: InternalEventV2, code: string, message?: string): InternalEventV2 {
  const now = new Date().toISOString();
  const slip = (evt.routingSlip || []) as RoutingStep[];
  const idx = slip.findIndex((s) => s.status === 'PENDING');
  if (idx >= 0) {
    const step = slip[idx];
    step.status = 'ERROR';
    step.endedAt = now;
    step.error = { code, message, retryable: false } as any;
  }
  return evt;
}

export function computeIdempotency(prompt: string, correlationId: string): string {
  const base = `${prompt?.toLowerCase?.() || ''}|${correlationId || ''}`;
  return createHash('sha256').update(base).digest('hex');
}

export function appendAssistantCandidate(evt: InternalEventV2, text: string, model: string): void {
  const list = Array.isArray(evt.candidates) ? evt.candidates! : (evt.candidates = []);
  const id = `cand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  list.push({
    id,
    kind: 'text',
    source: 'llm-bot',
    createdAt: new Date().toISOString(),
    status: 'proposed',
    priority: 100,
    text,
    format: 'plain',
    metadata: { model },
  } as any);
}

let cachedAgent: any | undefined;

async function getAgent(): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }
  if (cachedAgent) return cachedAgent;
  // Prefer optional MCP agent if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mcp = require('@joshuacalpuerto/mcp-agent');
    if (mcp?.Agent?.initialize) {
      cachedAgent = await mcp.Agent.initialize({ openai: { apiKey } });
      return cachedAgent;
    }
  } catch {
    // ignore, fallback to OpenAI wrapper
  }
  // Fallback minimal OpenAI wrapper
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  cachedAgent = {
    prompt: async ({ system, user }: { system?: string; user: string }) => {
      const messages: any[] = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: user });
      const resp = await client.chat.completions.create({ model, messages });
      const text = resp?.choices?.[0]?.message?.content || '';
      return { text };
    },
  };
  return cachedAgent;
}

export function __resetAgentForTests() {
  cachedAgent = undefined;
}

export async function handleLlmEvent(server: { next: Function; getLogger: () => any }, evt: InternalEventV2): Promise<InternalEventV2> {
  const logger = server.getLogger?.() || console;
  const prompt = extractPrompt(evt);
  if (!prompt) {
    markCurrentStepError(evt, 'NO_PROMPT', 'No prompt annotations present');
    await server.next(evt, 'ERROR');
    return evt;
  }

  // Compute idempotency and attach to current step attributes
  const slip = (evt.routingSlip || []) as RoutingStep[];
  const idx = slip.findIndex((s) => s.status === 'PENDING');
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  if (idx >= 0) {
    const key = computeIdempotency(prompt, evt.correlationId);
    const step = slip[idx];
    step.attributes = { ...(step.attributes || {}), llm_hash: key };
  }

  try {
    const agent = await getAgent();
    const res = await agent.prompt({ user: prompt });
    const text = String(res?.text || '').trim();
    appendAssistantCandidate(evt, text, model);
    if (idx >= 0) {
      const step = slip[idx];
      step.status = 'OK';
      step.endedAt = new Date().toISOString();
      step.error = null as any;
    }
    await server.next(evt, 'OK');
    return evt;
  } catch (e: any) {
    logger.error?.('llm_bot.error', { message: e?.message || String(e) });
    const code = e?.message?.includes('OPENAI_API_KEY') ? 'LLM_AGENT_UNAVAILABLE' : 'LLM_CALL_FAILED';
    markCurrentStepError(evt, code, e?.message || 'LLM error');
    await server.next(evt, 'ERROR');
    return evt;
  }
}

// Named exports for tests
export { LlmBotServer };

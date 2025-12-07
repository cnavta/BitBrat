import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import type { InternalEventV2, RoutingStep } from '../types/events';
import crypto from 'crypto';

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

              logger.info('llm_bot.prompt.ok', { correlationId: evt?.correlationId });

              // LLB-3: Integrate mcp-agent with OpenAI (lazy import + singleton)
              const agent = await getAgent();

              logger.info('llm.invoke.start', { correlationId: evt?.correlationId });
              let text = '';
              try {
                // Minimal agent prompt interface; keep generic to avoid tight coupling
                const res: any = await agent.prompt({ user: prompt, options: { model: getModel(), timeoutMs: getTimeoutMs() } });
                text = extractText(res);
              } catch (err: any) {
                const mapped = mapLlmError(err);
                if (mapped.kind === 'invalid') {
                  markCurrentStepError(evt, 'LLM_REQUEST_INVALID', mapped.message || 'LLM provider rejected request');
                  logger.warn('llm.invoke.invalid', { correlationId: evt?.correlationId, code: 'LLM_REQUEST_INVALID' });
                  await this.next(evt);
                  return;
                }
                // network/timeout/server — rethrow to allow redelivery
                logger.error('llm.invoke.failed', { correlationId: evt?.correlationId, reason: mapped.kind });
                throw err;
              }
              logger.info('llm.invoke.finish', { correlationId: evt?.correlationId });

              // LLB-4: Append assistant candidate with idempotency guard
              const idKey = computeIdempotency(prompt, evt?.correlationId);
              if (!hasIdempotency(evt, idKey)) {
                appendAssistantCandidate(evt, text, getModel());
                setIdempotency(evt, idKey);
              } else {
                logger.debug?.('llm.candidate.idempotent_skip', { correlationId: evt?.correlationId });
              }

              // Advance routing
              await this.next(evt);
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

// ---- LLM helpers (LLB-3/4) ----
let _agentPromise: Promise<any> | null = null;
async function getAgent(): Promise<any> {
  if (_agentPromise) return _agentPromise;
  // lazy dynamic import to keep startup light and avoid type coupling
  _agentPromise = (async () => {
    try {
      const mod = await import('@joshuacalpuerto/mcp-agent');
      const Agent = (mod as any).Agent || (mod as any).default || mod;
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY missing');
      const agent = new Agent({
        provider: 'openai',
        apiKey,
        model: getModel(),
        timeoutMs: getTimeoutMs(),
        maxRetries: getMaxRetries(),
      });
      return agent;
    } catch (e) {
      // Re-throw with a clean error that does not leak internals; caller maps error kinds
      const err = new Error('MCP_AGENT_IMPORT_FAILED');
      (err as any).code = 'IMPORT_FAILED';
      throw err;
    }
  })();
  return _agentPromise;
}

function getModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-5-mini';
}
function getTimeoutMs(): number {
  const v = parseInt(String(process.env.OPENAI_TIMEOUT_MS || '30000'), 10);
  return Number.isFinite(v) ? v : 30000;
}
function getMaxRetries(): number {
  const v = parseInt(String(process.env.OPENAI_MAX_RETRIES || '2'), 10);
  return Number.isFinite(v) ? v : 2;
}

function extractText(res: any): string {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res.text === 'string') return res.text;
  if (typeof res.content === 'string') return res.content;
  if (Array.isArray(res.messages)) {
    const last = res.messages[res.messages.length - 1];
    if (last && typeof last.content === 'string') return last.content;
    if (last && typeof last.text === 'string') return last.text;
  }
  return '';
}

function appendAssistantCandidate(evt: any, text: string, model: string) {
  if (!evt) return;
  if (!Array.isArray(evt.candidates)) evt.candidates = [];
  const now = new Date().toISOString();
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.createHash('sha1').update(now + Math.random()).digest('hex');
  evt.candidates.push({
    id,
    kind: 'text',
    source: 'llm-bot',
    createdAt: now,
    status: 'proposed',
    text,
    format: 'plain',
    metadata: { model },
  });
}

function computeIdempotency(prompt: string, correlationId?: string): string {
  return crypto.createHash('sha256').update(`${prompt}::${correlationId || ''}`).digest('hex');
}
function getCurrentStep(evt: any): RoutingStep | undefined {
  const slip: RoutingStep[] = Array.isArray(evt?.routingSlip) ? evt.routingSlip : [];
  const idx = slip.findIndex((s) => s && s.status !== 'OK' && s.status !== 'SKIP');
  return idx >= 0 ? slip[idx] : undefined;
}
function hasIdempotency(evt: any, key: string): boolean {
  const step = getCurrentStep(evt);
  const attrs = (step && step.attributes) || {};
  return attrs['llm_hash'] === key;
}
function setIdempotency(evt: any, key: string): void {
  const step = getCurrentStep(evt);
  if (!step) return;
  step.attributes = step.attributes || {};
  step.attributes['llm_hash'] = key;
}

function mapLlmError(err: any): { kind: 'invalid' | 'server' | 'network' | 'timeout' | 'unknown'; message?: string } {
  const msg = String(err?.message || '');
  const code = (err?.status || err?.code || err?.response?.status) as number | string | undefined;
  if (typeof code === 'number') {
    if (code >= 400 && code < 500) return { kind: 'invalid', message: msg };
    if (code >= 500) return { kind: 'server', message: msg };
  }
  if (/timeout/i.test(msg)) return { kind: 'timeout', message: msg };
  if (/network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(msg)) return { kind: 'network', message: msg };
  return { kind: 'unknown', message: msg };
}

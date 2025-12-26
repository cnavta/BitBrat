import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import type { InternalEventV2, RoutingStep, CandidateV1 } from '../types/events';
import { processEvent } from '../services/llm-bot/processor';
import { ToolRegistry } from '../services/llm-bot/tools/registry';
import { McpClientManager } from '../services/llm-bot/mcp/client-manager';

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
  const unwrapped = (() => {
    let t = String(text ?? '').trim();
    if (!t) return t;
    const pairs: Array<[string, string]> = [["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"], ["`", "`"]];
    let changed = true;
    let guard = 0;
    while (changed && guard < 2) {
      changed = false;
      for (const [o, c] of pairs) {
        if (t.length >= 2 && t.startsWith(o) && t.endsWith(c)) {
          t = t.slice(o.length, t.length - c.length).trim();
          changed = true;
          break;
        }
      }
      guard++;
    }
    return t;
  })();
  const candidate: CandidateV1 = {
    id: 'cand-' + (evt.correlationId || Date.now().toString(36)),
    kind: 'text',
    source: 'llm-bot',
    createdAt: new Date().toISOString(),
    status: 'proposed',
    priority: 10,
    text: unwrapped,
    reason: model ? `model:${model}` : 'llm-bot.basic',
  };
  evt.candidates.push(candidate);
}

// Legacy handleLlmEvent removed in BL-160-001. Use processEvent instead.

class LlmBotServer extends BaseServer {
  private registry = new ToolRegistry();
  private mcpManager = new McpClientManager(this, this.registry);

  // Provide sensible defaults via BaseServer CONFIG_DEFAULTS so getConfig() can honor them
  protected static CONFIG_DEFAULTS: Record<string, any> = {
    SERVICE_NAME: 'llm-bot',
    PORT: 3000,
    OPENAI_MODEL: 'gpt-5-mini',
    OPENAI_TIMEOUT_MS: 15000,
    // Short-term, in-run memory bounds
    LLM_BOT_MEMORY_MAX_MESSAGES: 8,
    LLM_BOT_MEMORY_MAX_CHARS: 8000,
    // Personalities system defaults
    PERSONALITY_ENABLED: true,
    PERSONALITY_MAX_ANNOTATIONS: 3,
    PERSONALITY_MAX_CHARS: 4000,
    PERSONALITY_CACHE_TTL_MS: 300000, // 5 minutes
    PERSONALITY_COLLECTION: 'personalities',
    PERSONALITY_LOG_PREVIEW_CHARS: 160,
    PERSONALITY_COMPOSE_MODE: 'append',
    // User context defaults (Phase 2)
    USER_CONTEXT_ENABLED: true,
    USER_CONTEXT_INJECTION_MODE: 'append',
    USER_CONTEXT_CACHE_TTL_MS: 300000,
    USER_CONTEXT_ROLES_PATH: '/configs/bot/roles',
    USER_CONTEXT_DESCRIPTION_ENABLED: true,
  };
  constructor() {
    // Use a stable service name; env can override via logging/config elsewhere if needed
    super({ serviceName: 'llm-bot' });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  async start(port: number) {
    await this.mcpManager.initFromConfig();
    return super.start(port);
  }

  async close(reason?: string) {
    await this.mcpManager.shutdown();
    return super.close(reason);
  }

  private async setupApp(app: Express, _cfg: any) {
    app.get('/_debug/mcp', (req, res) => {
      const stats = this.mcpManager.getStats();
      res.json({
        servers: stats.getAllServerStats(),
        tools: stats.getAllToolStats(),
        registry: {
          totalTools: Object.keys(this.registry.getTools()).length
        }
      });
    });

    await this.onMessage<InternalEventV2>('internal.llmbot.v1', async (data, attributes, ctx) => {
      try {
        const logger = this.getLogger();
        logger.info('llm_bot.received', { attributes });
        logger.debug('llm_bot.received.annotations', {annotations:data.annotations});

        // Create a child span for processing for better trace visibility
        const tracer = (this as any).getTracer?.();
        if (tracer && typeof tracer.startActiveSpan === 'function') {
          await tracer.startActiveSpan('process-llm-request', async (span: any) => {
            try {
              // Preferred: LLM processor
              logger.debug('llm_bot.processing');
              const status = await processEvent(this, data as InternalEventV2, { registry: this.registry });
              await (this as any).next?.(data as InternalEventV2, status);
              logger.info('llm_bot.processed', {correlationId: (data as any)?.correlationId, status});
            } catch (e) {
              logger.error('llm_bot.process_error', { error: e });
              throw e;
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
  BaseServer.ensureRequiredEnv('llm-bot');
  const server = new LlmBotServer();
  // Prefer SERVICE_PORT when provided, otherwise PORT, with default from CONFIG_DEFAULTS
  let port = server.getConfig<number>('SERVICE_PORT', { required: false, parser: (s) => parseInt(String(s), 10) });
  if (!(typeof port === 'number' && isFinite(port))) {
    port = server.getConfig<number>('PORT', { default: 3000, parser: (s) => parseInt(String(s), 10) });
  }
  void server.start(port);
}

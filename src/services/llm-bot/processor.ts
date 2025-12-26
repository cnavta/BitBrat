import { InternalEventV2, CandidateV1, AnnotationV1 } from '../../types/events';
import { generateText, ModelMessage, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { BaseServer } from '../../common/base-server';
import { getInstanceMemoryStore, type ChatMessage as StoreMessage } from './instance-memory';
import { resolvePersonalityParts, PersonalityDoc } from './personality-resolver';
import { buildUserContextAnnotation } from './user-context';
import { getFirestore } from '../../common/firebase';
import { isFeatureEnabled } from '../../common/feature-flags';
import { assemble } from '../../common/prompt-assembly/assemble';
import { openaiAdapter } from '../../common/prompt-assembly/adapters/openai';
import type { PromptSpec, TaskAnnotation as PATask, RequestingUser as PARequestingUser, AssemblerConfig } from '../../common/prompt-assembly/types';
import { redactText } from '../../common/prompt-assembly/redaction';
import { IToolRegistry } from '../../types/tools';
import { metrics,
  METRIC_PERSONALITIES_RESOLVED,
  METRIC_PERSONALITIES_FAILED,
  METRIC_PERSONALITIES_DROPPED,
  METRIC_PERSONALITY_CACHE_HIT,
  METRIC_PERSONALITY_CACHE_MISS,
  METRIC_PERSONALITY_CLAMPED,
} from '../../common/metrics';

// ChatMessage is used for short-term memory within a single run
export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; createdAt: string };

// PASM-V2-10: one-time deprecation warning flag for legacy Input.context history injection
let warnedInputContextHistory = false;

function preview(text: string, max = 200): string {
  const s = redactText(String(text || ''));
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(+${s.length - max})`;
}

function isAbortError(err: any): boolean {
  const name = (err && err.name) || '';
  const msg = (err && err.message) || '';
  return name === 'AbortError' || /abort(ed)?/i.test(msg) || /The operation was aborted/i.test(msg);
}

function toHuman(text: string): ChatMessage {
  return { role: 'user', content: String(text || ''), createdAt: new Date().toISOString() };
}

function toAssistant(text: string): ChatMessage {
  return { role: 'assistant', content: String(text || ''), createdAt: new Date().toISOString() };
}

function totalChars(msgs: ChatMessage[] = []): number {
  return msgs.reduce((acc, m) => acc + (m.content?.length || 0), 0);
}

export function applyMemoryReducer(
  existing: ChatMessage[] = [],
  incoming: ChatMessage[] = [],
  limits: { maxMessages: number; maxChars: number }
): { messages: ChatMessage[]; trimmedByChars: number; trimmedByCount: number } {
  // Preserve a leading system message from existing history so history trimming never drops it.
  const hasLeadingSystem = existing.length > 0 && existing[0]?.role === 'system';
  const systemMsg = hasLeadingSystem ? existing[0] : undefined;

  // Only trim the non-system history + incoming
  const history = hasLeadingSystem ? existing.slice(1) : existing.slice();
  let work = [...history, ...incoming];

  let trimmedByChars = 0;
  let trimmedByCount = 0;

  // Trim by chars (drop from oldest of history/incoming) while keeping system pinned at the front
  const maxChars = Math.max(0, limits.maxChars || 0);
  const systemChars = systemMsg ? (systemMsg.content?.length || 0) : 0;
  const totalWith = (arr: ChatMessage[]) => systemChars + totalChars(arr);
  while (maxChars > 0 && totalWith(work) > maxChars && work.length > 0) {
    const dropped = work.shift();
    trimmedByChars += (dropped?.content?.length || 0);
  }

  // Trim by count (keep last N, reserving 1 slot for system if present)
  const maxMessages = Math.max(1, limits.maxMessages || 1);
  const allowedHistoryCount = hasLeadingSystem ? Math.max(0, maxMessages - 1) : maxMessages;
  if (work.length > allowedHistoryCount) {
    trimmedByCount = work.length - allowedHistoryCount;
    work = work.slice(-allowedHistoryCount);
  }

  // Re-prepend the system if it existed
  const out = hasLeadingSystem ? [systemMsg as ChatMessage, ...work] : work;
  return { messages: out, trimmedByChars, trimmedByCount };
}

function buildCombinedPrompt(annotations?: AnnotationV1[]): string | undefined {
  if (!Array.isArray(annotations)) return undefined;
  const prompts = annotations.filter((a) => a?.kind === 'prompt' && (a.value || a.payload?.text));
  if (prompts.length === 0) return undefined;
  prompts.sort((a, b) => {
    const at = Date.parse(a.createdAt || '') || 0;
    const bt = Date.parse(b.createdAt || '') || 0;
    if (at !== bt) return at - bt;
    return (a.id || '').localeCompare(b.id || '');
  });
  const parts = prompts.map((p) => p.value || p.payload?.text || '').filter(Boolean);
  const combined = parts.join('\n\n');
  return combined.trim() || undefined;
}

function formatHistoryForContext(messages: ChatMessage[] = []): string | undefined {
  // Exclude leading system and empty lines; oldest to newest
  const nonSystem = (messages || []).filter((m) => m.role !== 'system');
  if (nonSystem.length === 0) return undefined;
  const body = nonSystem
    .map((m) => `(${m.role}) ${m.content}`)
    .join('\n');
  const header = 'Conversation History (oldest to newest):';
  const fenced = `~~~text\n${header}\n${body}\n~~~`;
  return fenced;
}

/**
 * Remove a single pair of wrapping quotes from a string if present.
 * Supports common pairs: '""', "''", '“”', '‘’', and backticks. Trims whitespace at the ends.
 */
function unwrapQuoted(input: string): string {
  let t = String(input ?? '').trim();
  if (!t) return t;
  const pairs: Array<[string, string]> = [["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"], ["`", "`"]];
  let changed = true;
  let guard = 0;
  while (changed && guard < 2) { // unwrap at most twice to handle cases like "\"hi\""
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
}

// callOpenAI removed in BL-160-001 as it used legacy client.

export async function processEvent(
  server: BaseServer,
  evt: InternalEventV2,
  deps?: { 
    registry?: IToolRegistry;
    callLLM?: (model: string, input: string) => Promise<string>;
  }
): Promise<'SKIP'|'OK'|'ERROR'> {
  const logger = (server as any).getLogger?.();
  const corr = evt.correlationId;
  const store = getInstanceMemoryStore(server);
  
  function memoryKeyFor(e: any): string {
    const channel = (e?.dispatch?.channel) || (e?.channel) || 'default';
    const userId = e?.user?.id || 'anon';
    return `${channel}:${userId}`;
  }
  const memKey = memoryKeyFor(evt);

  logger.debug('llm_bot.process_event', { correlationId: corr });

  try {
    // 1. User Context Annotation
    const userCtxEnabled = server.getConfig<boolean>('USER_CONTEXT_ENABLED', { 
      default: true, 
      parser: (v: any) => v === true || v === 'true' 
    });
    if (userCtxEnabled) {
      try {
        const cfg = {
          rolesPath: server.getConfig<string>('USER_CONTEXT_ROLES_PATH', { default: '/configs/bot/roles' }),
          ttlMs: server.getConfig<number>('USER_CONTEXT_CACHE_TTL_MS', { default: 300000, parser: (v: any) => Number(v) }),
          includeDescription: server.getConfig<boolean>('USER_CONTEXT_DESCRIPTION_ENABLED', { default: true, parser: (v: any) => v === true || v === 'true' }),
          maxChars: server.getConfig<number>('PERSONALITY_MAX_CHARS', { default: 4000, parser: (v: any) => Number(v) }),
          injectionMode: server.getConfig<string>('USER_CONTEXT_INJECTION_MODE', { default: 'append' }),
        };
        const ann = await buildUserContextAnnotation(evt, cfg as any);
        if (ann) {
          if (!Array.isArray(evt.annotations)) evt.annotations = [];
          evt.annotations.push(ann);
        }
      } catch (e: any) {
        logger?.warn?.('llm_bot.user_ctx.error', { correlationId: corr, error: e?.message });
      }
    }

    const anns = Array.isArray(evt.annotations) ? evt.annotations : [];
    const combinedPrompt = buildCombinedPrompt(anns as any);
    if (!combinedPrompt) {
      logger?.info?.('llm_bot.no_prompt', { correlationId: corr });
      return 'SKIP';
    }

    // 2. Load Memory
    let messages: ChatMessage[] = [];
    try {
      const prior = await store.read(memKey);
      if (Array.isArray(prior)) {
        messages = prior.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })) as ChatMessage[];
      }
    } catch (e: any) {
      logger?.warn?.('llm_bot.memory.read_error', { correlationId: corr, error: e?.message });
    }

    // 3. Resolve Personalities
    const personalitiesEnabled = server.getConfig<boolean>('PERSONALITY_ENABLED', { 
      default: true,
      parser: (v: any) => v === true || v === 'true'
    });
    let resolvedIdentity: string | undefined;
    let resolvedConstraints: any[] | undefined;

    if (personalitiesEnabled) {
      try {
        const opts = {
          maxAnnotations: server.getConfig<number>('PERSONALITY_MAX_ANNOTATIONS', { default: 3, parser: (v: any) => Number(v) }),
          maxChars: server.getConfig<number>('PERSONALITY_MAX_CHARS', { default: 4000, parser: (v: any) => Number(v) }),
          cacheTtlMs: server.getConfig<number>('PERSONALITY_CACHE_TTL_MS', { default: 300000, parser: (v: any) => Number(v) }),
        };
        const collection = server.getConfig<string>('PERSONALITY_COLLECTION', { default: 'personalities' });
        const fetchByName = async (name: string): Promise<PersonalityDoc | undefined> => {
          const db = getFirestore();
          const snap = await db.collection(collection).where('name', '==', name).where('status', '==', 'active').orderBy('version', 'desc').limit(1).get();
          return snap.docs[0]?.data() as PersonalityDoc | undefined;
        };
        const parts = await resolvePersonalityParts(anns as any, opts, { fetchByName, logger });
        resolvedIdentity = parts.map((p: any) => p.text || p.payload?.text || p.summary || p.name).filter(Boolean).join('\n\n');
        // Simple constraint extraction heuristic
        resolvedConstraints = [];
        for (const p of parts) {
          const t = String((p as any)?.text || (p as any)?.payload?.text || '').trim();
          const lines = t.split(/\n/);
          for (const line of lines) {
            if (/^(?:Do not|Never|Always|Must|Should|Format|Output)/i.test(line.trim())) {
              resolvedConstraints.push({ text: line.trim(), priority: 3, source: 'policy' });
            }
          }
        }
      } catch (e: any) {
        logger?.warn?.('llm_bot.personality.error', { correlationId: corr, error: e?.message });
      }
    }

    // 4. Build PromptSpec & Assemble
    const sysPrompt = server.getConfig<string>('LLM_BOT_SYSTEM_PROMPT', { default: '' });
    const maxMemoryMessages = server.getConfig<number>('LLM_BOT_MEMORY_MAX_MESSAGES', { default: 8, parser: (v: any) => Number(v) });
    const maxMemoryChars = server.getConfig<number>('LLM_BOT_MEMORY_MAX_CHARS', { default: 8000, parser: (v: any) => Number(v) });

    const spec: PromptSpec = {
      systemPrompt: sysPrompt ? { summary: 'Rules', rules: [sysPrompt], sources: ['config'] } : undefined,
      identity: resolvedIdentity ? { summary: resolvedIdentity } : undefined,
      constraints: resolvedConstraints?.length ? resolvedConstraints : undefined,
      task: [{ instruction: combinedPrompt, priority: 3, required: true }],
      input: { userQuery: evt.message?.text || combinedPrompt },
      conversationState: messages.length > 0 ? {
        transcript: messages.map(m => ({ role: m.role as any, content: m.content })),
        retention: { maxMessages: maxMemoryMessages, maxChars: maxMemoryChars },
        renderMode: 'transcript'
      } : undefined
    };

    const assembled = assemble(spec, { headingLevel: 2, showEmptySections: true });
    const payload = openaiAdapter(assembled);

    // 5. Call LLM
    const modelName = server.getConfig<string>('OPENAI_MODEL', { default: 'gpt-4o' });
    const timeoutMs = server.getConfig<number>('OPENAI_TIMEOUT_MS', { default: 30000, parser: (v: any) => Number(v) });
    let finalResponse: string;

    if (deps?.callLLM) {
      const fullPrompt = payload.messages.map((m: any) => `(${m.role}) ${m.content}`).join('\n\n');
      finalResponse = await deps.callLLM(modelName, fullPrompt);
    } else {
      const coreMessages: ModelMessage[] = [
        { role: 'system', content: payload.messages[0].content },
        { role: 'user', content: payload.messages[1].content },
      ];

      const allTools = deps?.registry?.getTools() || {};
      const userRoles = evt.user?.roles || [];

      const filteredTools: Record<string, any> = {};
      for (const [name, tool] of Object.entries(allTools)) {
        let allowed = false;
        if (!tool.requiredRoles || tool.requiredRoles.length === 0) {
          allowed = true;
        } else if (tool.requiredRoles.some(role => userRoles.includes(role))) {
          allowed = true;
        }

        if (allowed) {
          // Wrap tool to capture errors in InternalEventV2
          filteredTools[name] = {
            description: tool.description,
            parameters: tool.inputSchema,
            execute: tool.execute ? async (args: any) => {
              try {
                return await tool.execute!(args);
              } catch (e: any) {
                logger.error('llm_bot.tool_error', { tool: tool.id, error: e.message });
                if (!Array.isArray(evt.errors)) evt.errors = [];
                evt.errors.push({
                  source: tool.source === 'mcp' ? `mcp:${tool.id}` : tool.source,
                  message: e.message || String(e),
                  at: new Date().toISOString()
                });
                throw e;
              }
            } : undefined
          };
        } else {
          logger.debug('llm_bot.tool_filtered_rbac', { tool: tool.id, userRoles });
        }
      }

      logger.debug('llm_bot.generate_text.start', { 
        model: modelName, 
        allToolCount: Object.keys(allTools).length,
        filteredToolCount: Object.keys(filteredTools).length,
        tools: Object.keys(filteredTools)
      });

      const result = await generateText({
        model: openai(modelName),
        messages: coreMessages,
        tools: filteredTools,
        stopWhen: stepCountIs(5),
        abortSignal: AbortSignal.timeout(timeoutMs),
      });

      logger.debug('llm_bot.generate_text.finish', { 
        textPreview: preview(result.text)
      });

      finalResponse = result.text;
    }

    finalResponse = unwrapQuoted(finalResponse.trim());
    logger.debug('llm_bot.llm_call.finish', { responsePreview: preview(finalResponse) });

    // 6. Prompt Logging (Fire and forget)
    if (isFeatureEnabled('llm.promptLogging.enabled')) {
      const fullPrompt = payload.messages.map((m: any) => `(${m.role}) ${m.content}`).join('\n\n');
      const db = getFirestore();
      db.collection('prompt_logs').add({
        correlationId: corr,
        prompt: redactText(fullPrompt),
        response: redactText(finalResponse),
        model: modelName,
        createdAt: new Date(),
      }).catch((e: any) => {
        logger?.warn?.('llm_bot.prompt_logging_failed', { correlationId: corr, error: e?.message });
      });
    }

    // 7. Update Memory
    if (finalResponse) {
      const incoming = [toHuman(combinedPrompt), toAssistant(finalResponse)];
      try {
        await store.append(memKey, incoming as StoreMessage[]);
      } catch (e: any) {
        logger?.warn?.('llm_bot.memory.append_error', { correlationId: corr, error: e?.message });
      }
    }

    // 8. Append Candidate
    if (finalResponse) {
      if (!Array.isArray(evt.candidates)) evt.candidates = [];
      evt.candidates.push({
        id: `cand-${corr || Date.now()}`,
        kind: 'text',
        source: 'llm-bot',
        createdAt: new Date().toISOString(),
        status: 'proposed',
        priority: 10,
        text: finalResponse,
        reason: `model:${modelName}`,
      });
    }

    return 'OK';
  } catch (err: any) {
    logger.error('llm_bot.processor.error', { correlationId: corr, error: err?.message, stack: err?.stack });
    if (!Array.isArray(evt.errors)) evt.errors = [];
    evt.errors.push({ 
      source: 'llm-bot', 
      message: err?.message || String(err), 
      at: new Date().toISOString(),
      fatal: true
    });
    return 'ERROR';
  }
}

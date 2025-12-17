import OpenAI from 'openai';
import { StateGraph, END, Annotation } from '@langchain/langgraph';
import { InternalEventV2, CandidateV1, AnnotationV1 } from '../../types/events';
import { BaseServer } from '../../common/base-server';
import { getInstanceMemoryStore, type ChatMessage as StoreMessage } from './instance-memory';
import { resolvePersonalityParts } from './personality-resolver';
import { buildUserContextAnnotation } from './user-context';
import { getFirestore } from '../../common/firebase';
import { assemble } from '../../common/prompt-assembly/assemble';
import { openaiAdapter } from '../../common/prompt-assembly/adapters/openai';
import type { PromptSpec, TaskAnnotation as PATask, RequestingUser as PARequestingUser, AssemblerConfig } from '../../common/prompt-assembly/types';
import { redactText } from '../../common/prompt-assembly/redaction';
import { metrics,
  METRIC_PERSONALITIES_RESOLVED,
  METRIC_PERSONALITIES_FAILED,
  METRIC_PERSONALITIES_DROPPED,
  METRIC_PERSONALITY_CACHE_HIT,
  METRIC_PERSONALITY_CACHE_MISS,
  METRIC_PERSONALITY_CLAMPED,
} from '../../common/metrics';

// Minimal LangGraph shim: we keep structure ready; can swap with real graph nodes later.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; createdAt: string };

type LlmGraphState = {
  event: InternalEventV2;
  combinedPrompt?: string; // backward-compat
  messages?: ChatMessage[]; // short-term memory within a single run
  llmText?: string;
  error?: Error;
};

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

async function callOpenAI(apiKey: string, model: string, prompt: string, timeoutMs?: number): Promise<string> {
  const client = new OpenAI({ apiKey });
  const controller = timeoutMs ? new AbortController() : undefined;
  if (timeoutMs && controller) {
    setTimeout(() => controller.abort(), timeoutMs).unref?.();
  }
  // Use new Responses API when available in openai >= 6
  const requestBody: any = {
    model: model || 'gpt-5-mini',
    input: prompt,
    max_output_tokens: 1024,
  };
  // IMPORTANT: pass AbortSignal via the fetch options (2nd param), NOT in the request body
  const resp = await (client as any).responses.create(
    requestBody,
    controller ? { signal: controller.signal } : undefined
  );
  const text = (resp as any)?.output?.[0]?.content?.[0]?.text
    ?? (resp as any)?.output_text
    ?? (resp as any)?.choices?.[0]?.message?.content
    ?? '';
  return String(text || '').trim();
}

export async function processEvent(
  server: BaseServer,
  evt: InternalEventV2,
  deps?: { callLLM?: (model: string, prompt: string, timeoutMs?: number) => Promise<string> }
): Promise<'SKIP'|'OK'|'ERROR'> {
  const logger = (server as any).getLogger?.();
  const state: LlmGraphState = { event: evt };

  const store = getInstanceMemoryStore(server);
  function memoryKeyFor(e: any): string {
    const channel = (e?.dispatch?.channel) || (e?.channel) || 'default';
    const userId = e?.user?.id || 'anon';
    return `${channel}:${userId}`;
  }
  const memKey = memoryKeyFor(evt);

  logger.debug('llm_bot.process_event', { correlationId: evt.correlationId });

  try {
    // Build a tiny LangGraph to orchestrate the steps using Annotations for typing
    const LlmState = Annotation.Root({
      event: Annotation<InternalEventV2>(),
      combinedPrompt: Annotation<string | undefined>(),
      messages: Annotation<ChatMessage[] | undefined>(),
      llmText: Annotation<string | undefined>(),
      promptSpec: Annotation<PromptSpec | undefined>(),
      systemText: Annotation<string | undefined>(),
      userTurns: Annotation<string[] | undefined>(),
    });

    const graph = new StateGraph(LlmState)
      .addNode('ingest_prompt', async (s: typeof LlmState.State) => {
        logger.debug('llm_bot.process_event.ingest_prompt', { correlationId: s.event.correlationId });
        // Optionally build user context annotation and attach before building combined prompt
        const userCtxEnabled = (() => {
          const v = server.getConfig<string>('USER_CONTEXT_ENABLED', { default: 'true' });
          const sflag = String(v).toLowerCase();
          return !(sflag === 'false' || sflag === '0' || sflag === 'no');
        })();
        if (userCtxEnabled) {
          try {
            const cfg = {
              rolesPath: server.getConfig<string>('USER_CONTEXT_ROLES_PATH', { default: '/configs/bot/roles' }),
              ttlMs: server.getConfig<number>('USER_CONTEXT_CACHE_TTL_MS', { default: 300000, parser: (v) => Number(String(v)) }),
              includeDescription: (() => {
                const v = server.getConfig<string>('USER_CONTEXT_DESCRIPTION_ENABLED', { default: 'true' });
                const sflag = String(v).toLowerCase();
                return !(sflag === 'false' || sflag === '0' || sflag === 'no');
              })(),
              maxChars: server.getConfig<number>('PERSONALITY_MAX_CHARS', { default: 4000, parser: (v) => Number(String(v)) }),
              injectionMode: (String(server.getConfig<string>('USER_CONTEXT_INJECTION_MODE', { default: 'append' })).toLowerCase() as any),
            } as any;
            const ann = await buildUserContextAnnotation(s.event, cfg);
            if (ann) {
              if (!Array.isArray(s.event.annotations)) s.event.annotations = [];
              s.event.annotations.push(ann);
              logger?.info?.('llm_bot.user_ctx.compose.end', {
                correlationId: s.event.correlationId,
                mode: cfg.injectionMode,
                hasDescription: Boolean((ann.payload as any)?.description),
                preview: (ann.value || (ann.payload as any)?.text || '').slice(0, server.getConfig<number>('PERSONALITY_LOG_PREVIEW_CHARS', { default: 160, parser: (v)=>Number(String(v)) })),
              });
            }
          } catch (e: any) {
            logger?.warn?.('llm_bot.user_ctx.compose.error', { correlationId: s.event.correlationId, error: e?.message || String(e) });
          }
        }
        const anns = Array.isArray(s.event.annotations) ? s.event.annotations : [];
        const combinedPrompt = buildCombinedPrompt(anns as any);
        const maxMessages = server.getConfig<number>('LLM_BOT_MEMORY_MAX_MESSAGES', { default: 8, parser: (v) => Number(String(v)) });
        const maxChars = server.getConfig<number>('LLM_BOT_MEMORY_MAX_CHARS', { default: 8000, parser: (v) => Number(String(v)) });
        // Start with any messages already in state (should be empty on first node)
        let messages: ChatMessage[] = Array.isArray(s.messages) ? [...(s.messages as ChatMessage[])] : [];

        // Load prior turns from instance store and prepend
        try {
          const prior = await store.read(memKey);
          if (Array.isArray(prior) && prior.length > 0) {
            // Cast StoreMessage -> ChatMessage (identical shape)
            const priorAsChat = (prior as StoreMessage[]).map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })) as ChatMessage[];
            messages = [...priorAsChat, ...messages];
          }
        } catch (e: any) {
          logger?.warn?.('llm_bot.instance_memory.read_error', { correlationId: s.event.correlationId, error: e?.message || String(e) });
        }

        // Always include a system prompt as the first message (with personalities if enabled),
        // regardless of whether prior memory exists. This ensures personalities apply even with history.
        const sys = server.getConfig<string>('LLM_BOT_SYSTEM_PROMPT', { required: false });
        let finalSystem = sys || '';
        const personalitiesEnabled = (() => {
          const v = server.getConfig<string>('PERSONALITY_ENABLED', { default: 'true' });
          const sflag = String(v).toLowerCase();
          if (sflag === 'false' || sflag === '0' || sflag === 'no') return false;
          return true;
        })();
        // LLM-04: Resolve personalities but map into Identity & Constraints instead of composing System
        let resolvedIdentitySummary: string | undefined;
        let resolvedConstraints: Array<{ text: string; priority?: number; tags?: string[]; source?: 'system'|'policy'|'runtime' }>|undefined;
        try {
          if (personalitiesEnabled) {
            const opts = {
              maxAnnotations: server.getConfig<number>('PERSONALITY_MAX_ANNOTATIONS', { default: 3, parser: (v) => Number(String(v)) }),
              maxChars: server.getConfig<number>('PERSONALITY_MAX_CHARS', { default: 4000, parser: (v) => Number(String(v)) }),
              cacheTtlMs: server.getConfig<number>('PERSONALITY_CACHE_TTL_MS', { default: 5 * 60 * 1000, parser: (v) => Number(String(v)) }),
            };
            const collection = server.getConfig<string>('PERSONALITY_COLLECTION', { default: 'personalities' });
            const fetchByName = async (name: string) => {
              const db = getFirestore();
              const snap = await db
                .collection(collection)
                .where('name', '==', name)
                .where('status', '==', 'active')
                .orderBy('version', 'desc')
                .limit(1)
                .get();
              const doc = snap.docs[0];
              if (!doc) return undefined;
              return doc.data() as any;
            };
            const before = metrics.snapshot();
            const parts = await resolvePersonalityParts(anns as any as AnnotationV1[], opts, { fetchByName, logger });
            // Do NOT compose into system; instead, build identity summary and constraints from parts
            const texts: string[] = [];
            const constraints: typeof resolvedConstraints = [];
            for (const p of parts) {
              const t = String((p as any)?.text || (p as any)?.payload?.text || (p as any)?.summary || '').trim();
              if (t) {
                texts.push(t);
                // naive extraction of constraint-like lines (policy/format hints)
                const lines = t.split(/\r?\n/);
                for (const line of lines) {
                  const l = line.trim();
                  if (!l) continue;
                  // Heuristics: lines that look like rules
                  if (/^(?:-\s*)?\(?\d+\)?\s*|^(?:-\s*)?(?:Do not|Never|Always|Must|Should|Format|Output)/i.test(l)) {
                    const clean = l.replace(/^[-\s]*/, '').trim();
                    constraints.push({ text: clean, priority: 3, tags: ['policy'], source: 'policy' });
                  }
                }
              } else if ((p as any)?.name) {
                texts.push(String((p as any).name));
              }
            }
            resolvedIdentitySummary = texts.filter(Boolean).join('\n\n');
            resolvedConstraints = (constraints && constraints.length > 0) ? constraints : undefined;

            const previewLen = server.getConfig<number>('PERSONALITY_LOG_PREVIEW_CHARS', { default: 160, parser: (v) => Number(String(v)) });
            const names = parts.map((p) => (p as any).name).filter(Boolean);
            const versions = parts.map((p) => (p as any).version).filter((v) => typeof v === 'number');
            const after = metrics.snapshot();
            const delta = (k: string) => Math.max(0, (after[k] || 0) - (before[k] || 0));
            logger?.info?.('llm_bot.personality.mapped', {
              count: parts.length,
              names,
              versions,
              metrics: {
                resolved: delta(METRIC_PERSONALITIES_RESOLVED),
                failed: delta(METRIC_PERSONALITIES_FAILED),
                dropped: delta(METRIC_PERSONALITIES_DROPPED),
                cacheHit: delta(METRIC_PERSONALITY_CACHE_HIT),
                cacheMiss: delta(METRIC_PERSONALITY_CACHE_MISS),
                clamped: delta(METRIC_PERSONALITY_CLAMPED),
              },
              identityPreview: preview(resolvedIdentitySummary || '', previewLen),
              constraintsCount: resolvedConstraints?.length || 0,
              correlationId: s.event.correlationId,
            });
          }
        } catch (e: any) {
          logger?.warn?.('llm_bot.personality.compose_error', { error: e?.message || String(e), correlationId: s.event.correlationId });
        }
        if (finalSystem && finalSystem.trim()) {
          // Ensure only one system message at the front
          messages = messages.filter((m) => m.role !== 'system');
          messages = [{ role: 'system', content: finalSystem.trim(), createdAt: new Date().toISOString() }, ...messages];
        }

        let userTurns: string[] = [];
        if (combinedPrompt) {
          // Build one HumanMessage from the base event message (if present),
          // then one per prompt annotation (sorted) for better trimming behavior
          const incoming: ChatMessage[] = [];
          const baseText = (s.event as any)?.message?.text ? String((s.event as any).message.text).trim() : '';
          if (baseText) {
            incoming.push(toHuman(baseText));
          }

          const promptAnns = anns
            .filter((a: any) => a?.kind === 'prompt' && (a.value || a.payload?.text));
          promptAnns.sort((a: any, b: any) => {
            const at = Date.parse(a.createdAt || '') || 0;
            const bt = Date.parse(b.createdAt || '') || 0;
            if (at !== bt) return at - bt;
            return (a.id || '').localeCompare(b.id || '');
          });
          for (const p of promptAnns) {
            const t = String(p.value || p.payload?.text || '').trim();
            // Avoid immediate duplication if prompt equals the base message text
            if (!t) continue;
            if (!(baseText && t === baseText)) incoming.push(toHuman(t));
          }

          // Capture individual user turns for legacy-marked input formatting
          userTurns = incoming.filter((m) => m.role === 'user').map((m) => m.content);

          const { messages: reduced, trimmedByChars, trimmedByCount } = applyMemoryReducer(messages, incoming, {
            maxMessages: isFinite(maxMessages) ? maxMessages : 8,
            maxChars: isFinite(maxChars) ? maxChars : 8000,
          });
          logger?.debug?.('llm_bot.memory_update', {
            beforeCount: messages.length,
            afterCount: reduced.length,
            trimmedByChars,
            trimmedByCount,
            correlationId: s.event.correlationId,
          });
          messages = reduced;

          // Persist the current user turns to instance store to carry across events
          try {
            if (incoming.length > 0) {
              await store.append(memKey, incoming as StoreMessage[]);
            }
          } catch (e: any) {
            logger?.warn?.('llm_bot.instance_memory.append_user_error', { correlationId: s.event.correlationId, error: e?.message || String(e) });
          }
        }

        // Build PromptSpec (LLM-01) from current event + personalities + memory
        const baseText = (s.event as any)?.message?.text ? String((s.event as any).message.text).trim() : '';
        // Map annotations to TaskAnnotation[] (default priority=3; sorted earlier by createdAt)
        const taskAnns: PATask[] = (() => {
          const promptAnns = (anns as any[])?.filter((a) => a?.kind === 'prompt' && (a.value || a.payload?.text)) || [];
          const out: PATask[] = [];
          for (const p of promptAnns) {
            const t = String(p.value || p.payload?.text || '').trim();
            if (!t) continue;
            out.push({ id: p.id, priority: 3, instruction: t, required: true });
          }
          return out;
        })();

        // RequestingUser mapping (best-effort)
        const ru: PARequestingUser | undefined = (() => {
          const u = (s.event as any)?.user || {};
          const anyRoles = Array.isArray((u as any).roles) ? (u as any).roles : undefined;
          const obj: PARequestingUser = {
            userId: (u as any)?.id,
            handle: (u as any)?.handle || (u as any)?.username || undefined,
            displayName: (u as any)?.displayName || (u as any)?.name || undefined,
            roles: anyRoles,
            locale: (u as any)?.locale,
            timezone: (u as any)?.timezone,
            tier: (u as any)?.tier,
          };
          const hasAny = Object.values(obj).some((v) => Boolean(v) && (Array.isArray(v) ? v.length > 0 : true));
          return hasAny ? obj : undefined;
        })();

        // Legacy history-in-Input.context (v1) — compute but do not inject anymore (PASM-V2-10)
        const historyCtx = formatHistoryForContext(messages);
        // PASM-V2-09: Build conversationState from recent exchanges
        const convoTranscript = (messages || [])
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: (m.role as 'user'|'assistant'|'tool'), content: m.content }));
        const convoSummary = (() => {
          const total = convoTranscript.length;
          const lastUser = [...convoTranscript].reverse().find((m) => m.role === 'user')?.content || '';
          const lastPreview = lastUser ? (lastUser.length > 160 ? (lastUser.slice(0, 160) + '…') : lastUser) : '';
          const parts: string[] = [];
          parts.push(`Recent exchanges: ${total}`);
          if (lastPreview) parts.push(`Latest user: ${lastPreview}`);
          return parts.join('\n');
        })();
        const conversationState = (() => {
          if (convoTranscript.length === 0 && !convoSummary) return undefined;
          return {
            summary: convoSummary || undefined,
            // Default to summary-first; transcript optionally included for richer context
            transcript: convoTranscript.length > 0 ? convoTranscript : undefined,
            retention: {
              maxMessages: isFinite(maxMessages) ? maxMessages : 8,
              maxChars: isFinite(maxChars) ? maxChars : 8000,
            },
            renderMode: 'summary',
          } as PromptSpec['conversationState'];
        })();

        const systemPrompt = finalSystem && finalSystem.trim()
          ? {
              summary: 'LLM Bot System Rules',
              rules: [
                finalSystem.trim(),
                'Precedence: architecture.yaml > AGENTS.md > everything else.',
                'Safety: Do not reveal secrets or internal tokens. Refuse requests that violate policy.',
              ],
              sources: ['architecture.yaml', 'AGENTS.md v2.4'],
            }
          : undefined;

        const promptSpec: PromptSpec | undefined = (taskAnns.length > 0 || baseText)
          ? {
              systemPrompt,
              identity: (() => {
                if (personalitiesEnabled && resolvedIdentitySummary && resolvedIdentitySummary.trim()) {
                  return { summary: resolvedIdentitySummary.trim() };
                }
                return undefined;
              })(),
              constraints: (() => {
                if (personalitiesEnabled && resolvedConstraints && resolvedConstraints.length > 0) return resolvedConstraints as any;
                return undefined;
              })(),
              task: taskAnns.length > 0 ? taskAnns : [{ instruction: 'Answer the user query', priority: 3, required: true }],
              // PASM-V2-09/10: populate conversationState (v2) and stop injecting history into Input.context
              conversationState,
              input: { userQuery: baseText || combinedPrompt || '' },
              requestingUser: ru,
            }
          : undefined;

        // PASM-V2-10: Deprecation warning (once) when legacy history context existed
        if (!warnedInputContextHistory && historyCtx && historyCtx.trim().length > 0) {
          warnedInputContextHistory = true;
          logger?.warn?.('llm_bot.deprecation.input_context_history', {
            correlationId: s.event.correlationId,
            note: 'Conversation history is no longer injected into Input.context. It is now rendered under [Conversation State / History].',
          });
        }

        return { combinedPrompt, messages, promptSpec, systemText: finalSystem, userTurns };
      })
      .addNode('call_model', async (s: typeof LlmState.State) => {
        logger.debug('llm_bot.process_event.call_model', { correlationId: s.event.correlationId });
        const model = server.getConfig<string>('OPENAI_MODEL', { default: 'gpt-5-mini' });
        const timeoutMs = server.getConfig<number>('OPENAI_TIMEOUT_MS', { default: 15000, parser: (v) => Number(String(v)) });
        const fn = deps?.callLLM || ((m: string, p: string, t?: number) => {
          const key = server.getConfig<string>('OPENAI_API_KEY');
          return callOpenAI(key, m, p, t);
        });
        if (!s.combinedPrompt) return {}; // No prompt to act on (legacy gating retained)
        const spec = (s.promptSpec as PromptSpec | undefined);
        if (!spec) return {};
        const cfg: AssemblerConfig = { headingLevel: 2, showEmptySections: true };
        const corr = s.event.correlationId;
        const assembled = assemble(spec, cfg);
        // LLM-07: Log assembly meta and safe preview (no secrets)
        if (assembled?.meta) {
          logger?.debug?.('llm_bot.assembly.meta', {
            correlationId: corr,
            truncated: assembled.meta.truncated,
            totalChars: assembled.meta.totalChars,
            maxTotalChars: assembled.meta.maxTotalChars,
            sectionLengths: assembled.meta.sectionLengths,
            truncationNotes: (assembled.meta.truncationNotes || []).slice(0, 3),
          });
        }
        logger?.debug?.('llm_bot.assembly.preview', {
          correlationId: corr,
          preview: preview(assembled.text),
        });
        // Do not log full assembled text to avoid leaking sensitive data or transcripts
        const payload = openaiAdapter(assembled);
        // LLM-05: Hard cutover – build request input from adapter payload preserving canonical order
        const sysContent = payload.messages[0]?.content || '';
        const userContent = payload.messages[1]?.content || '';
        const input = [`(system) ${sysContent}`, `(user) ${userContent}`].join('\n\n').trim();
        // LLM-07: Adapter payload stats
        logger?.debug?.('llm_bot.adapter.payload_stats', {
          correlationId: corr,
          messageCount: 2,
          systemChars: sysContent.length,
          userChars: userContent.length,
        });
        const startedAt = Date.now();
        // Backward-compatible input logging for operational visibility
        logger?.debug?.('llm_bot.call_model.input_stats', {
          correlationId: corr,
          messageCount: 2,
          charCount: input.length,
        });
        logger?.debug?.('llm_bot.call_model.input_preview', {
          correlationId: corr,
          preview: preview(input),
        });
        logger?.debug?.('openai.request', {
          correlationId: corr,
          model,
          timeoutMs: isFinite(timeoutMs) ? timeoutMs : undefined,
          messageCount: 2,
          inputChars: input.length,
          inputPreview: preview(input),
        });
        try {
          const llmText = await fn(model, input, isFinite(timeoutMs) ? timeoutMs : undefined);
          const durationMs = Date.now() - startedAt;
          const trimmed = String(llmText || '').trim();
          const unwrapped = unwrapQuoted(trimmed);
          logger?.debug?.('openai.response', {
            correlationId: corr,
            model,
            durationMs,
            outputChars: unwrapped.length,
            outputPreview: preview(unwrapped),
          });
          const out: Partial<typeof LlmState.State> = { llmText: unwrapped } as any;
          // Only append assistant message if non-empty to avoid blank turns in memory
          if (unwrapped) {
            const assistantMsg = toAssistant(unwrapped);
            const msgs = (s.messages as ChatMessage[]) || [];
            (out as any).messages = [...msgs, assistantMsg];
            // Persist assistant turn to instance store
            try {
              await store.append(memKey, [assistantMsg as unknown as StoreMessage]);
            } catch (e: any) {
              logger?.warn?.('llm_bot.instance_memory.append_assistant_error', { correlationId: corr, error: e?.message || String(e) });
            }
          }
          return out as any;
        } catch (e: any) {
          const durationMs = Date.now() - startedAt;
          if (isAbortError(e)) {
            logger?.warn?.('openai.timeout', {
              correlationId: corr,
              model,
              timeoutMs: isFinite(timeoutMs) ? timeoutMs : undefined,
              durationMs,
              inputChars: input.length,
              message: e?.message || 'aborted',
            });
          } else {
            logger?.error?.('openai.error', {
              correlationId: corr,
              model,
              durationMs,
              message: e?.message || String(e),
              name: e?.name,
              code: (e && (e.code || e.status)) || undefined,
            });
          }
          throw e; // preserve existing error handling at outer scope
        }
      })
      .addNode('build_candidate', async (_s: typeof LlmState.State) => {
        // Node kept for structural clarity; actual candidate push happens after graph execution
        return {};
      })
      .addEdge('__start__', 'ingest_prompt')
      .addConditionalEdges('ingest_prompt', (s: typeof LlmState.State) => (s.combinedPrompt ? 'call_model' : END))
      .addEdge('call_model', 'build_candidate')
      .addEdge('build_candidate', END)
      .compile();

    logger.debug('llm_bot.process_event.graph_compiled', { correlationId: evt.correlationId }, state);
    const result = await graph.invoke(state);
    logger.debug('llm_bot.process_event.graph_invoked', { correlationId: evt.correlationId, result });

    if (!result.combinedPrompt) {
      logger?.info?.('llm_bot.no_prompt_annotations', { correlationId: evt.correlationId });
      return 'SKIP';
    }

    // Append candidate based on llmText only if non-empty
    const text = String(result.llmText || '').trim();
    logger.debug('llm_bot.process_event.llm_text_trimmed', { correlationId: evt.correlationId, text });
    if (!text) {
      logger?.info?.('llm_bot.empty_llm_response', { correlationId: evt.correlationId });
      return 'OK';
    }
    if (!Array.isArray(evt.candidates)) evt.candidates = [];
    const candidate: CandidateV1 = {
      id: 'cand-' + (evt.correlationId || Date.now().toString(36)),
      kind: 'text',
      source: 'llm-bot',
      createdAt: new Date().toISOString(),
      status: 'proposed',
      priority: 10,
      text,
      reason: 'llm-bot.basic',
    };
    logger.debug('llm_bot.process_event.candidate_added', { correlationId: evt.correlationId, candidate });
    evt.candidates.push(candidate);
    return 'OK';
  } catch (err: any) {
    state.error = err instanceof Error ? err : new Error(String(err));
    logger.error('llm_bot.error', { message: state.error.message, correlationId: evt.correlationId, err });
    if (!Array.isArray(evt.errors)) evt.errors = [];
    evt.errors.push({ source: 'llm-bot', message: state.error.message, at: new Date().toISOString() });
    return 'ERROR';
  }
}

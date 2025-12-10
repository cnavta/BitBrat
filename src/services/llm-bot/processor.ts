import OpenAI from 'openai';
import { StateGraph, END, Annotation } from '@langchain/langgraph';
import { InternalEventV2, CandidateV1, AnnotationV1 } from '../../types/events';
import { BaseServer } from '../../common/base-server';

// Minimal LangGraph shim: we keep structure ready; can swap with real graph nodes later.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; createdAt: string };

type LlmGraphState = {
  event: InternalEventV2;
  combinedPrompt?: string; // backward-compat
  messages?: ChatMessage[]; // short-term memory within a single run
  llmText?: string;
  error?: Error;
};

function preview(text: string, max = 200): string {
  const s = String(text || '');
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
  const merged = [...existing, ...incoming];
  let trimmedByChars = 0;
  let trimmedByCount = 0;
  // Trim by chars (drop from oldest)
  const maxChars = Math.max(0, limits.maxChars || 0);
  let work = merged;
  while (maxChars > 0 && totalChars(work) > maxChars && work.length > 0) {
    const dropped = work.shift();
    trimmedByChars += (dropped?.content?.length || 0);
  }
  // Trim by count (keep last N)
  const maxMessages = Math.max(1, limits.maxMessages || 1);
  if (work.length > maxMessages) {
    trimmedByCount = work.length - maxMessages;
    work = work.slice(-maxMessages);
  }
  return { messages: work, trimmedByChars, trimmedByCount };
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

function flattenMessagesForModel(messages: ChatMessage[] = []): string {
  return messages.map((m) => `(${m.role}) ${m.content}`).join('\n\n').trim();
}

async function callOpenAI(model: string, prompt: string, timeoutMs?: number): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

  console.debug('openai.request.raw', JSON.stringify(requestBody));
  // IMPORTANT: pass AbortSignal via the fetch options (2nd param), NOT in the request body
  const resp = await (client as any).responses.create(
    requestBody,
    controller ? { signal: controller.signal } : undefined
  );
  console.debug('openai.response.raw', JSON.stringify(resp));
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

  logger.debug('llm_bot.process_event', { correlationId: evt.correlationId });

  try {
    // Build a tiny LangGraph to orchestrate the steps using Annotations for typing
    const LlmState = Annotation.Root({
      event: Annotation<InternalEventV2>(),
      combinedPrompt: Annotation<string | undefined>(),
      messages: Annotation<ChatMessage[] | undefined>(),
      llmText: Annotation<string | undefined>(),
    });

    const graph = new StateGraph(LlmState)
      .addNode('ingest_prompt', async (s: typeof LlmState.State) => {
        logger.debug('llm_bot.process_event.ingest_prompt', { correlationId: s.event.correlationId });
        const anns = Array.isArray(s.event.annotations) ? s.event.annotations : [];
        const combinedPrompt = buildCombinedPrompt(anns as any);
        const maxMessages = Number(process.env.LLM_BOT_MEMORY_MAX_MESSAGES || '8');
        const maxChars = Number(process.env.LLM_BOT_MEMORY_MAX_CHARS || '8000');
        let messages: ChatMessage[] = Array.isArray(s.messages) ? [...(s.messages as ChatMessage[])] : [];

        // Optionally include a system prompt as the very first message
        if (messages.length === 0) {
          const sys = process.env.LLM_BOT_SYSTEM_PROMPT;
          if (sys && sys.trim()) {
            messages.push({ role: 'system', content: sys.trim(), createdAt: new Date().toISOString() });
          }
        }

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
        }

        return { combinedPrompt, messages };
      })
      .addNode('call_model', async (s: typeof LlmState.State) => {
        logger.debug('llm_bot.process_event.call_model', { correlationId: s.event.correlationId });
        const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
        const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || '15000');
        const fn = deps?.callLLM || callOpenAI;
        const msgs = (s.messages as ChatMessage[]) || [];
        if (!s.combinedPrompt) return {}; // No prompt to act on
        const input = flattenMessagesForModel(msgs);
        const corr = s.event.correlationId;
        const startedAt = Date.now();
        // Backward-compatible input logging for operational visibility
        logger?.debug?.('llm_bot.call_model.input_stats', {
          correlationId: corr,
          messageCount: msgs.length,
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
          messageCount: msgs.length,
          inputChars: input.length,
          inputPreview: preview(input),
        });
        try {
          const llmText = await fn(model, input, isFinite(timeoutMs) ? timeoutMs : undefined);
          const durationMs = Date.now() - startedAt;
          const trimmed = String(llmText || '').trim();
          logger?.debug?.('openai.response', {
            correlationId: corr,
            model,
            durationMs,
            outputChars: trimmed.length,
            outputPreview: preview(trimmed),
          });
          const out: Partial<typeof LlmState.State> = { llmText: trimmed } as any;
          // Only append assistant message if non-empty to avoid blank turns in memory
          if (trimmed) {
            (out as any).messages = [...msgs, toAssistant(trimmed)];
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

import OpenAI from 'openai';
import { StateGraph, END, Annotation } from '@langchain/langgraph';
import { InternalEventV2, CandidateV1, AnnotationV1 } from '../../types/events';
import { BaseServer } from '../../common/base-server';

// Minimal LangGraph shim: we keep structure ready; can swap with real graph nodes later.
type LlmGraphState = {
  event: InternalEventV2;
  combinedPrompt?: string;
  llmText?: string;
  error?: Error;
};

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
    max_output_tokens: 512,
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

  try {
    // Build a tiny LangGraph to orchestrate the steps using Annotations for typing
    const LlmState = Annotation.Root({
      event: Annotation<InternalEventV2>(),
      combinedPrompt: Annotation<string | undefined>(),
      llmText: Annotation<string | undefined>(),
    });

    const graph = new StateGraph(LlmState)
      .addNode('build_prompt', async (s: typeof LlmState.State) => {
        const combinedPrompt = buildCombinedPrompt(s.event.annotations);
        return { combinedPrompt };
      })
      .addNode('call_model', async (s: typeof LlmState.State) => {
        const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
        const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || '15000');
        const fn = deps?.callLLM || callOpenAI;
        if (!s.combinedPrompt) return {};
        const llmText = await fn(model, s.combinedPrompt, isFinite(timeoutMs) ? timeoutMs : undefined);
        return { llmText };
      })
      .addEdge('__start__', 'build_prompt')
      .addConditionalEdges('build_prompt', (s: typeof LlmState.State) => (s.combinedPrompt ? 'call_model' : END))
      .addEdge('call_model', END)
      .compile();

    const result = await graph.invoke(state);

    if (!result.combinedPrompt) {
      logger?.info?.('llm_bot.no_prompt_annotations', { correlationId: evt.correlationId });
      return 'SKIP';
    }

    // Append candidate based on llmText
    if (!Array.isArray(evt.candidates)) evt.candidates = [];
    const candidate: CandidateV1 = {
      id: 'cand-' + (evt.correlationId || Date.now().toString(36)),
      kind: 'text',
      source: 'llm-bot',
      createdAt: new Date().toISOString(),
      status: 'proposed',
      priority: 10,
      text: String(result.llmText || '').trim(),
      reason: 'llm-bot.basic',
    };
    evt.candidates.push(candidate);
    return 'OK';
  } catch (err: any) {
    state.error = err instanceof Error ? err : new Error(String(err));
    logger?.error?.('llm_bot.error', { message: state.error.message, correlationId: evt.correlationId });
    if (!Array.isArray(evt.errors)) evt.errors = [];
    evt.errors.push({ source: 'llm-bot', message: state.error.message, at: new Date().toISOString() });
    return 'ERROR';
  }
}

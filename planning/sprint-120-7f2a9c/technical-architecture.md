## Technical Architecture – LLM Bot (First Pass)

Objective:
- Consume events on internal.llmbot.v1
- Extract prompt annotations
- Use a simple LangGraph-style pipeline to call OpenAI (gpt-5-mini)
- Append assistant candidate and advance routing slip via next()

Context:
- Node/TypeScript on Cloud Run
- Contracts: src/types/events.ts (InternalEventV2, routingSlip)
- Secrets/Env: OPENAI_API_KEY, OPENAI_MODEL (default gpt-5-mini), OPENAI_TIMEOUT_MS, OPENAI_MAX_RETRIES

High-Level Flow:
1. Receive event; find current llm-bot step (status PENDING)
2. Extract prompt:
   - Prefer annotations[] where kind == "prompt" (ordered by createdAt)
   - Fallback to legacy annotations.prompt
   - If none: mark ERROR code NO_PROMPT and next(evt, "ERROR")
3. Compute idempotency key: sha256(lower(prompt) + correlationId), store in step.attributes.llm_hash
4. Pipeline (LangGraph-ready): composePrompt -> llmCall(OpenAI) -> result
5. Append candidate { role: "assistant", model: OPENAI_MODEL, text, createdAt }
6. Mark step OK and next(evt, "OK")

LangGraph Integration (First Pass):
- Graph layout (simple chain): Start -> composePrompt -> llmCall -> End
- composePrompt: inputs (event, userText, optional systemPrompt), output { system, user }
- llmCall: inputs (system, user), uses OpenAI SDK; model from env; timeout/retries from env
- Rationale: adopt LangGraph now to standardize future expansion (tools, branches, retries)

Data Contracts:
- Input: InternalEventV2
  - v == "1"
  - message: minimal { id, role }
  - annotations: array of { kind: "prompt", value, createdAt } or legacy { prompt }
  - routingSlip: includes step id == "llm-bot", status == "PENDING"
- Output mutation:
  - routingSlip current step -> status: "OK" | "ERROR", error if applicable
  - candidates: push { role: "assistant", model, text, createdAt, meta?: {} }

Error Handling:
- NO_PROMPT: no prompt -> ERROR and advance
- LLM_AGENT_UNAVAILABLE: OpenAI/Agent init failure -> ERROR and advance
- LLM_CALL_FAILED: transport/model error -> ERROR and advance (retryable flag as appropriate)

Security & Observability:
- Avoid logging raw prompt at info level; truncate at debug
- Never log secrets
- Optional tracing span: process-llm-request

Out of Scope (Future):
- Advanced prompt selection, RAG/tools/memory, multi-model routing
# Technical Architecture — Short‑Term Memory (In‑Memory) for llm-bot

Date: 2025-12-09
Owner: Architect
Service: llm-bot (src/apps/llm-bot-service.ts, src/services/llm-bot/processor.ts)

1. Executive Summary
- Goal: Add short‑term memory to llm-bot using LangChain.js LangGraph state reducers, per docs: https://docs.langchain.com/oss/javascript/langgraph/add-memory#add-short-term-memory
- Scope: In‑run, ephemeral memory only (no cross‑run persistence). Messages from the current request (user input + model replies) should be accumulated in graph state and used to form the model call.
- Outcome: Better reply quality when multiple prompt annotations are present; structured foundation for future long‑/medium‑term memory.

2. Constraints & Alignment
- Architecture guardrails (architecture.yaml):
  - Service: llm-bot consumes internal.llmbot.v1, uses OpenAI, Node/TS, Cloud Run.
  - Observability via BaseServer logger + optional tracing spans.
- No dependencies on deprecated/*.
- Keep implementation minimal; no external storage (Firestore, Redis) in this sprint.

3. Design Overview
- Use LangGraph StateGraph with Annotation to define a messages array on state that is updated via a reducer function. This is the “short‑term memory” container.
- Transform incoming prompt annotations into a HumanMessage and append to messages.
- Call the LLM with the conversation messages (system + prior context if any + latest human). Capture the assistant response, append as an AssistantMessage, and build the CandidateV1 from that last assistant message.
- Enforce soft limits (by count and optional token estimate) in the reducer to bound memory growth.

4. State Shape (LangGraph)
- LlmState (extends current state):
  - event: InternalEventV2
  - messages: Array<ChatMessageLike>
    - Each item: { role: 'system'|'user'|'assistant', content: string, createdAt: string }
  - combinedPrompt?: string (kept for backward compatibility during transition)
  - llmText?: string

5. Reducer for Short‑Term Memory
- messages annotation will specify a reducer that appends new messages and then trims:
  - maxMessages: default 8 (env LLM_BOT_MEMORY_MAX_MESSAGES)
  - maxChars: default 8000 (env LLM_BOT_MEMORY_MAX_CHARS) — simple proxy for tokens
- Pseudocode:
  - newMessages = existing.concat(incoming)
  - if totalChars(newMessages) > maxChars, drop from the oldest until under limit
  - if newMessages.length > maxMessages, keep last maxMessages
- Reducer is pure, deterministic, and only manipulates state.messages.

6. Node Graph Changes
- Current nodes (from processor.ts): build_prompt -> call_model -> END
- Proposed nodes:
  1) ingest_prompt: Convert prompt annotations to a single HumanMessage; update state.messages via reducer. If no prompts, SKIP early.
  2) call_model: Call OpenAI with messages (chat style) or transform to single prompt if using responses API; append AssistantMessage to messages.
  3) build_candidate: Create CandidateV1 from the latest AssistantMessage; set llmText for backward compatibility; return OK.
  - Control edges:
    - start -> ingest_prompt
    - ingest_prompt -> (no input) END (SKIP) | call_model
    - call_model -> build_candidate -> END

7. Prompt Construction Strategy
- If OPENAI client uses Responses API (current), we’ll flatten messages into a single input string for simplicity in this sprint:
  - input = join(messages.map(m => `(${m.role}) ${m.content}`), "\n\n")
- Later, when using Chat Completions or a multi‑part input, we can pass structured messages.
- Include optional system primer (from architecture.yaml llm_guidance.default_system_prompt) as a leading system message if present.

8. Integration Points
- src/services/llm-bot/processor.ts
  - Extend LlmGraphState Annotations to include messages with reducer + defaults.
  - Add ingest_prompt and build_candidate nodes.
  - Update call_model node to read from messages and to append AssistantMessage after the call.
  - Preserve existing env handling (OPENAI_MODEL, OPENAI_TIMEOUT_MS) and error pathways.
- src/apps/llm-bot-service.ts
  - No functional changes required; it already delegates to processEvent and handles routing/ack.

9. Configuration
- New env vars:
  - LLM_BOT_MEMORY_MAX_MESSAGES (default 8)
  - LLM_BOT_MEMORY_MAX_CHARS (default 8000)
- Optional:
  - LLM_BOT_SYSTEM_PROMPT (fallback to architecture.yaml llm_guidance.default_system_prompt if we wire config later; for this sprint, default to empty unless trivially retrievable).

10. Observability & Telemetry
- Log debug fields on memory updates: { beforeCount, afterCount, trimmedByChars, trimmedByCount }.
- Log the length of messages passed to the model and the estimated char count.
- Keep existing error logging and tracing span boundaries in llm-bot-service.ts.

11. Error Handling
- No prompt annotations -> SKIP (return 'SKIP')
- OpenAI call errors -> ERROR with evt.errors entry and structured log
- Oversize memory is handled by trimming; not an error.

12. Testing Strategy
- Unit tests (jest) in src/services/llm-bot/:
  - reducer.spec.ts: validates append + trimming by count and chars.
  - processor.memory.spec.ts: simulates events with multiple prompt annotations, verifies messages built, LLM call invoked with flattened input containing prior turns, and candidate equals last assistant message.
  - SKIP path: no annotations => returns 'SKIP'; no candidate added.
  - ERROR path: inject failing deps.callLLM => returns 'ERROR' and records evt.errors.

13. Backward Compatibility
- Maintain combinedPrompt and llmText fields through the sprint; deprecated after full migration.
- Candidate creation stays identical (kind "text", status "proposed").

14. Risks & Mitigations
- Token mismatch: chars != tokens. For now use chars as proxy; add better tok estimation later.
- OpenAI API differences: Responses API vs Chat Completion; we normalize through a single flattened string in this sprint.
- Memory growth: bounded via reducer limits.

15. Acceptance Criteria
- Given multiple prompt annotations, call_model uses flattened conversation including earlier prompts (at least last N within limits).
- Candidate text equals model output derived from the last assistant message.
- No external storage or cross‑run persistence introduced.
- Tests for reducer and processor behaviors pass locally in validation.

16. Implementation Notes (for next phase)
- Introduce a small helper in processor.ts for message creation:
  - toHuman(text: string): Message
  - toAssistant(text: string): Message
- Keep Message timestamps for deterministic ordering and easier testing.
- Where possible, isolate reducer logic to enable reuse in medium‑term memory or future checkpointing.

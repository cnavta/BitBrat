# Implementation Plan – sprint-123-a2f701b

## Objective
- Implement short-term (in-run, ephemeral) conversational memory for the llm-bot using LangGraph.js state reducers so the bot can consider prior turns within a single request flow. Maintain backward compatibility and add tests and observability.

## Scope
- In scope
  - LangGraph state extension to include a messages array with a pure reducer to append and trim
  - New/updated graph nodes: ingest_prompt, call_model (reads messages), build_candidate
  - Flattened prompt construction for Responses API (join messages with role tags)
  - Soft limits (max messages, max chars) via env with safe defaults
  - Logging around memory updates and model invocation
  - Unit tests for reducer and processor happy/skip/error paths
  - Minimal configuration updates (env defaults, local dev docs)
- Out of scope
  - Any persistence beyond current run (no Firestore/Redis)
  - Token-accurate counting and multi-modal message parts
  - Broader refactors of unrelated services

## Deliverables
- Code changes in src/services/llm-bot/processor.ts to add state/messages reducer and nodes
- No functional changes to src/apps/llm-bot-service.ts (only uses processor)
- New environment variables with defaults:
  - LLM_BOT_MEMORY_MAX_MESSAGES (default 8)
  - LLM_BOT_MEMORY_MAX_CHARS (default 8000)
- Tests:
  - src/services/llm-bot/__tests__/reducer.spec.ts
  - src/services/llm-bot/__tests__/processor.memory.spec.ts
- Observability:
  - Debug logs for memory updates and model input sizing
- Planning artifacts (this plan + backlog.yaml)

## Acceptance Criteria
- Given multiple prompt annotations in an incoming event, the model call must use a flattened conversation including prior turns within configured limits
- The last assistant reply is appended to messages and a text candidate is created from it
- When no prompt annotations are present, the processor returns a SKIP-like result without creating a candidate
- On model errors, processor marks error and logs details; tests cover this path
- Tests pass locally via validate_deliverable.sh

## Testing Strategy
- Unit tests (Jest):
  - Reducer: append behavior; trims by count and by char budget deterministically
  - Processor: 
    - Happy path with 2+ prompts creates messages list, calls the LLM with flattened text containing prior turns, and emits a candidate matching assistant text
    - Skip path: no prompt annotations results in early SKIP and no candidate
    - Error path: injected LLM failure results in ERROR and logs
- Mocks: mock OpenAI client/dependency used by call_model

## Deployment Approach
- No infra changes. Follows existing Cloud Run deployment for llm-bot.
- validate_deliverable.sh will run npm ci/build/test; local run optional.
- Ensure env defaults don’t break runtime when unset; read via process.env with fallbacks.

## Dependencies
- Node/TypeScript toolchain (existing)
- OpenAI API key for runtime/manual tests (unit tests use mocks)
- LangChain/LangGraph (already in use; if not, add minimal dependency)

## Definition of Done
- Code follows architecture.yaml and AGENTS.md
- No TODOs in production paths
- Tests implemented and passing locally
- Backlog items through “Implement + Test + Validate” are moved to done
- Ready for PR creation per Sprint Protocol upon approval and implementation completion

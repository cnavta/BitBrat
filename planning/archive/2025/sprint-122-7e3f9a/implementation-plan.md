# Implementation Plan – sprint-122-7e3f9a

## Objective
- Implement in-run short-term memory for llm-bot using LangGraph state reducers so multiple prompt annotations are coherently considered within a single processing run.

## Scope
- In scope
  - Add messages[] to processor state with a pure reducer that appends and trims by count and char limits
  - New/updated graph nodes: ingest_prompt, call_model (read/write messages), build_candidate
  - Flatten conversation to a single input string for OpenAI Responses API in this sprint
  - Config via env: LLM_BOT_MEMORY_MAX_MESSAGES, LLM_BOT_MEMORY_MAX_CHARS; optional LLM_BOT_SYSTEM_PROMPT
  - Observability: structured logs around memory trims and model input sizes
  - Unit tests for reducer and processor paths (OK, SKIP, ERROR)
- Out of scope
  - Cross-run persistence (Redis/DB)
  - Token-accurate length estimation
  - Switching to Chat Completions API

## Deliverables
- Code changes in src/services/llm-bot/processor.ts implementing short-term memory per TA
- New tests: reducer.spec.ts, processor.memory.spec.ts
- Env var documentation in planning artifacts
- planning/sprint-122-7e3f9a/validate_deliverable.sh (sprint validation)

## Acceptance Criteria
- Given multiple prompt annotations in an event, the model call receives a flattened conversation including prior turns (bounded by limits)
- The candidate text returned equals the last assistant message content
- No external storage introduced; all memory is ephemeral within a single run
- Tests pass locally via validate_deliverable.sh

## Testing Strategy
- Jest unit tests
  - reducer.spec.ts: append + char-limit + count-limit trimming, determinism
  - processor.memory.spec.ts: 
    - OK path: multiple prompts -> LLM called with flattened conversation -> assistant message appended -> candidate created
    - SKIP path: no prompt annotations -> returns SKIP, no candidate
    - ERROR path: injected failing callLLM -> returns ERROR, evt.errors populated
- Mock OpenAI calls to be deterministic and offline

## Deployment Approach
- None beyond standard CI. The sprint validation script uses existing npm scripts:
  - npm ci
  - npm run build
  - npm test
  - npm run local || true (optional)
  - npm run deploy:cloud -- --dry-run || true

## Dependencies
- openai client already present
- @langchain/langgraph already present
- No new external services

## Definition of Done
- Meets project DoD (tests present and passing; docs updated; no TODOs in production paths)
- planning artifacts updated (verification report, publication on PR creation) before sprint closure

## Work Breakdown (high-level)
1. Implement reducer and state wiring
2. Implement ingest_prompt node
3. Update call_model to use/append messages
4. Implement build_candidate from assistant message
5. Add observability logs
6. Add unit tests
7. Run validation script and fix issues
8. Open PR and complete verification docs

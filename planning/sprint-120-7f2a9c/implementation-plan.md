Implementation Plan – sprint-120-7f2a9c

Objective
- Implement a first-pass llm-bot service using a LangGraph-ready pipeline to:
  - Consume events on internal.llmbot.v1
  - Extract prompt annotations
  - Call OpenAI (gpt-5-mini)
  - Append an assistant candidate to the event
  - Advance the routing slip by calling next()

Scope
- In Scope
  - Minimal LangGraph-style pipeline (composePrompt → llmCall → result)
  - Event consumption and routingSlip mutation per architecture.yaml
  - Prompt annotation extraction and legacy fallback
  - OpenAI call via SDK; environment-driven model/timeout/retries
  - Basic error handling: NO_PROMPT, LLM_AGENT_UNAVAILABLE, LLM_CALL_FAILED
  - Unit tests for helper functions and end-to-end handler
  - Validation script alignment
- Out of Scope
  - Advanced prompt selection logic
  - RAG/tools/memory integration
  - Observability beyond basic logging/tracing

Deliverables
- Code changes
  - src/apps/llm-bot-service.ts: export helpers and main handler; wire subscription
  - Minimal pipeline chain (inline or module) for LangGraph readiness
  - Env handling and safe logging
- Tests
  - tests/llm-bot-service.spec.ts scenarios covered
- Deployment & CI artifacts
  - Reuse existing Cloud Build / Cloud Run configs (no changes expected)
  - Ensure validate_deliverable.sh is logically passable
- Documentation
  - technical-architecture.md (done)
  - This implementation plan

Acceptance Criteria
- No prompt annotations:
  - Current llm-bot routing step marked ERROR with code NO_PROMPT
  - next(event, "ERROR") called once
- Prompt annotations present and agent available:
  - OpenAI is called with model OPENAI_MODEL (default gpt-5-mini)
  - A candidate with role assistant is appended containing the response text
  - Current step marked OK and next(event, "OK") called once
- Agent init fails (e.g., missing OPENAI_API_KEY):
  - Current step marked ERROR with code LLM_AGENT_UNAVAILABLE
  - No candidate appended; next(event, "ERROR") called once
- Unit tests pass via npm test

Testing Strategy
- Unit tests with Jest (no external network calls)
  - Mock OpenAI and optional MCP agent
  - Test extractPrompt, computeIdempotency, appendAssistantCandidate, markCurrentStepError
  - Test handleLlmEvent for the three core scenarios

Deployment Approach
- Cloud Run per architecture.yaml
- No infra changes expected; use existing cloudbuild.llm-bot.yaml
- Validation script will build, test, and perform a basic local run stub

Dependencies
- OpenAI SDK (already present)
- Environment variables:
  - OPENAI_API_KEY (secret)
  - OPENAI_MODEL (default: gpt-5-mini)
  - OPENAI_TIMEOUT_MS (optional)
  - OPENAI_MAX_RETRIES (optional)

Definition of Done
- Aligns with architecture.yaml and AGENTS.md
- No TODOs in production paths
- Tests pass via npm test
- Validation script logically passable
- Feature branch commit and PR at publication

Plan of Work
1. Implement helper functions and main handler in src/apps/llm-bot-service.ts
2. Add minimal graph pipeline and OpenAI call wrapper
3. Write/adjust unit tests to validate expected behavior
4. Run validation script locally; fix issues
5. Commit, push branch, create PR; record PR URL in publication.yaml

Status: awaiting user approval to begin implementation
Implementation Plan – sprint-121-508d0c

Status: Approved → Implemented

Objective
- Implement a minimal llm-bot using LangGraph.js to aggregate prompt annotations, call OpenAI (model: gpt-5-mini by default), append a candidate response, and advance the routing slip.

Scope
- In scope:
  - Consume events on internal.llmbot.v1 (InternalEventV2 shape)
  - Extract all annotations where kind === "prompt"
  - Build a single combined prompt string in deterministic order (by createdAt asc, then id)
  - Call OpenAI with the combined prompt via a minimal LangGraph graph
  - Append a CandidateV1(text/proposed) on success
  - Call BaseServer.next(evt, status) with SKIP when no prompt, OK on success, ERROR on failure
  - Unit tests for extraction, short-circuit, and candidate append behavior
- Out of scope:
  - Advanced prompt selection/weighting
  - Tools/RAG/memory or multi-turn management
  - Rich formatting and safety policies beyond basic length trimming

Deliverables
- Code: Minimal LangGraph graph in llm-bot service integrating OpenAI client
- Tests: Unit tests for core flows with OpenAI mocked
- Docs: Technical Architecture (done), this implementation plan
- CI/Validation: Sprint validate_deliverable.sh wrapper invoking repo root script

Acceptance Criteria
- When an event has no prompt annotations, the service logs and calls next(evt, { status: 'SKIP' }) without contacting the LLM.
- When an event has one or more prompt annotations, the prompts are combined and submitted to OpenAI; the response text is appended as a CandidateV1 with:
  - kind: "text", status: "proposed", source: "llm-bot", createdAt: ISO8601, priority: 10
  - text: trimmed model output, reason: "llm-bot.basic"
  The service then calls next(evt, { status: 'OK' }).
- On unexpected errors, the service records an error entry on the event (if available), logs an error, and calls next(evt, { status: 'ERROR' }).
- Implementation uses LangGraph.js to orchestrate the steps even if simple now.

Testing Strategy
- Unit tests (Jest):
  - Extract no prompts -> skip path; BaseServer.next called with SKIP; no OpenAI call
  - Extract prompts -> OpenAI called with combined prompt; candidate appended; next called with OK
  - Error during OpenAI call -> next called with ERROR; log contains failure
- Integration-lite: construct an InternalEventV2 object and invoke the processing function with a mocked server context
- External I/O mocked: OpenAI client and message bus interactions

Deployment Approach
- Reuse existing Cloud Run service definition (architecture.yaml) and Dockerfile.llm-bot
- No infra changes; environment variables via architecture.yaml:
  - Required secret: OPENAI_API_KEY
  - Optional env: OPENAI_MODEL (default gpt-5-mini), OPENAI_TIMEOUT_MS, OPENAI_MAX_RETRIES
- validate_deliverable.sh: delegate to repository root script for install/build/test and dry-run

Dependencies
- NPM packages: openai (already present), langgraphjs (add: "@langchain/langgraph": latest)
- No new cloud resources

Definition of Done
- Code adheres to architecture.yaml and AGENTS.md
- Tests for new behavior pass under npm test
- validate_deliverable.sh is logically passable
- Minimal logging and error handling present
- Traceability: commits reference sprint-121-508d0c and request-log updated

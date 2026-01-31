# Implementation Plan – sprint-241-b8d4e2

## Objective
- Define and implement the `query-analyzer` service (Llama Sentry) to reduce LLM costs and improve response times for simple queries.

## Scope
- Architectural definition of the `query-analyzer` service.
- Integration of `query-analyzer` into the `event-router` logic.
- Implementation of complexity scoring and short-circuiting.
- Updating `llm-bot` to support adaptive model selection based on annotations.

## Deliverables
- `src/types/events.ts` updates (AnnotationKindV1).
- `src/apps/query-analyzer.ts` implementation.
- `src/services/llm-bot/processor.ts` updates for adaptive model selection.
- `infrastructure/docker-compose/` updates to include an Ollama container for local development.
- `validate_deliverable.sh` for this sprint.

## Acceptance Criteria
- Events routed through `query-analyzer` are enriched with a `pre-analysis` annotation.
- Simple queries (e.g., "Hello") are handled by `query-analyzer` and skip `llm-bot`.
- Complex queries are routed to `llm-bot` with the appropriate model selected based on the annotation.
- Guardrails correctly identify and block toxic/spam content.

## Testing Strategy
- Unit tests for `query-analyzer` logic.
- Integration tests simulating the `Router -> QueryAnalyzer -> LLMBot -> Egress` flow.
- Mocking Ollama/Llama responses for reliable CI tests.

## Deployment Approach
- Cloud Run with a sidecar container for Ollama/Llama-3.
- Update Firestore-based routing rules via a script or manual update (to be decided).

## Dependencies
- Llama-3 8B model.
- Ollama or vLLM runner.

## Definition of Done
- All deliverables implemented and tested.
- `validate_deliverable.sh` passes.
- PR created and verified.
- Open questions resolved.

## Open Questions & Decisions
1. **Sidecar vs Separate Service**: Confirm if Sidecar is preferred for Cloud Run.
2. **Short-Circuit Implementation**: Should `query-analyzer` modify the `routingSlip` or just set a flag?
3. **Model Mapping**: Define the exact mapping of Complexity -> OpenAI Model.
4. **Trigger Rules**: What exact criteria should `event-router` use to route to `query-analyzer`?

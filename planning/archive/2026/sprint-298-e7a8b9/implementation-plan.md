# Implementation Plan – sprint-298-e7a8b9

## Objective
Implement the "Stream Observer" pattern and `stream-analyst-service` for standardized event stream summarization and inspection, including support for MCP-triggered requests.

## Scope
- New Technical Architecture document integrating SESSI and MCP.
- `stream-analyst-service` implementation (Phase 1 & 2 of original TA).
- MCP Tool integration for on-demand summarization.
- Firestore schema for `stream_observers`.
- Standardized events for summarization requests and reports.

## Execution Plan
The implementation will follow a staged approach:
1.  **Stage 1: Foundation (SESSI-001, SESSI-002)**: Define Firestore schemas, TypeScript interfaces, and implement the `StreamBuffer` utility for PII redaction and truncation.
2.  **Stage 2: Core Service (SESSI-003)**: Build the `stream-analyst-service` focusing on Firestore event extraction and LLM orchestration.
3.  **Stage 3: MCP & Egress (SESSI-004)**: Integrate with `tool-gateway` to expose the `summarize_stream` tool and implement the synchronous response path.
4.  **Stage 4: Advanced Analysis (SESSI-005)**: Implement structured inspection and `AnnotationV1` generation.
5.  **Stage 5: Verification (SESSI-006)**: Final validation, testing, and documentation.

## Deliverables
- `documentation/technical-architecture/sessi-v2.md`: Updated Technical Architecture.
- `src/services/stream-analyst/`: Service implementation.
- `src/common/mcp/tools/summarize.ts`: MCP tool for summarization.
- Firestore collection setup/migration instructions.
- Unit and integration tests for summarization logic.

## Acceptance Criteria
- `stream-analyst-service` can process `StreamObserver` configurations from Firestore.
- Summaries can be triggered via cron (simulated/scheduled) or MCP tool calls.
- MCP tool "summarize_stream" accepts parameters for time window and stream type.
- Generated summaries are dispatched to the configured egress topic.
- `validate_deliverable.sh` passes successfully.

## Testing Strategy
- Unit tests for `StreamBuffer` utility (redaction, truncation).
- Integration tests for Firestore event extraction.
- Mocking LLM calls for summarization and inspection.
- Testing MCP tool registration and invocation.

## Deployment Approach
- Cloud Run for `stream-analyst-service`.
- Integration with existing `scheduler-service` via Pub/Sub.

## Dependencies
- `PersistenceStore` (Firestore)
- `llm-bot-service` (or direct LLM provider)
- `scheduler-service`
- `tool-gateway` (for MCP integration)

## Definition of Done
- Technical Architecture updated and approved.
- Code implemented and adheres to `architecture.yaml`.
- Tests pass with high coverage.
- PR created and linked in manifest.

# Implementation Plan – sprint-299-d5e6f7

## Objective
Close the gaps in the SESSI (Stream Content Summarization & Inspection) implementation to enable automated, robust, and integrated stream analysis.

## Scope
- `stream-analyst-service` lifecycle management (scheduled triggering).
- `StreamAnalystEngine` robustness (idempotency, retries).
- Integration with egress pipelines and data enrichment (annotations).
- Alignment of MCP tools with Observer configurations.
- **Improved observability and debug logging across the SESSI flow.**
- **Automatic reloading of Stream observers from Firestore.**

## Deliverables
- Updated `StreamAnalystServer` with scheduled poller.
- Enhanced `StreamAnalystEngine` with idempotency and retry logic.
- Firestore enrichment logic for annotations.
- Updated MCP tool in `StreamAnalystServer`.
- **Descriptive debug logging implemented across the service and engine.**
- **Real-time StreamObserver caching and automatic reloading.**
- Updated tests and validation scripts.

## Acceptance Criteria
- Active `StreamObservers` are triggered automatically based on their cron expressions.
- Duplicate summarization runs for the same window/observer are prevented.
- Summaries are delivered to `internal.egress.v1` when an observer is used.
- Annotations are persisted back to the source event documents in Firestore.
- `prompt_logs` collection can be used as a source for analysis.
- MCP tools respect `mcpEnabled` and use Observer configurations when provided.
- **Stream analyst service automatically reloads observers from Firestore upon changes.**
- **Firestore reads are minimized by using an in-memory cache for observers.**

## Testing Strategy
- Unit tests for engine changes (idempotency, retries).
- Integration tests for the poller logic and Firestore interactions.
- Mocking of LLM provider and Message Bus for end-to-end flow validation.

## Deployment Approach
- Deployed to Cloud Run as `stream-analyst-service`.
- Uses Cloud Build for CI/CD.

## Dependencies
- Firestore (PersistenceStore).
- Pub/Sub (internal.summarization.request.v1, internal.summarization.report.v1, internal.egress.v1).
- LLM Provider (OpenAI/Google).

## Definition of Done
- All code follows project style and architecture.yaml.
- All tests pass.
- `validate_deliverable.sh` succeeds.
- Documentation updated.
- Pull Request created.

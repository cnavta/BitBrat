# Execution Plan: Query Analyzer (Llama Sentry)

## Phase 1: Service Foundation & Environment Setup
- **Goal**: Establish the base service structure and ensure local/cloud environment parity.
- **Tasks**:
  - Refine `Dockerfile.query-analyzer` for production-grade Node.js execution.
  - Configure environment variable management for `OLLAMA_HOST` and `SERVICE_NAME`.
  - Verify `query-analyzer.compose.yaml` connectivity between the Node app and the Ollama sidecar.

## Phase 2: Ollama Client & Inference Logic
- **Goal**: Implement a robust interface for interacting with the local Llama-3 model.
- **Tasks**:
  - Create a dedicated Ollama HTTP client using `fetch` or a lightweight wrapper.
  - Implement the System Prompt Template defined in the Technical Architecture.
  - Implement structured JSON parsing and validation for model responses (Intent, Tone, Risk).
  - Add retry logic and circuit-breaking for Ollama API calls.

## Phase 3: Event Enrichment & Routing Logic
- **Goal**: Integrate the analysis logic into the BitBrat event-driven pipeline.
- **Tasks**:
  - Subscribe to `internal.query.analysis.v1`.
  - Map Llama output to `AnnotationV1` objects.
  - Implement the "Decision Point" logic:
    - If `intent == 'spam'` or trivial: Call `this.complete(event, 'OK')`.
    - Otherwise: Call `this.next(event, 'OK')`.
  - Ensure `correlationId` and `traceId` are preserved across the enrichment step.

## Phase 4: Downstream Integration (llm-bot Updates)
- **Goal**: Ensure the `llm-bot` service consumes the new annotations.
- **Tasks**:
  - Update `llm-bot` processor to check for `pre-analysis` annotations.
  - Implement adaptive model selection mapping (e.g., High Complexity -> `gpt-4o`, Low/Medium -> `gpt-4o-mini`).

## Phase 5: Testing, Validation & CI/CD
- **Goal**: Verify the system behavior and prepare for production deployment.
- **Tasks**:
  - Create `src/apps/query-analyzer.test.ts` with comprehensive unit and integration tests.
  - Implement a mock Ollama server for CI environments.
  - Finalize `cloudbuild.query-analyzer.yaml` for multi-container Cloud Run deployment.
  - Verify the full flow: `Router -> Query Analyzer -> LLM Bot -> Egress`.

## Definition of Done
- `validate_deliverable.sh` passes successfully.
- Code coverage for `query-analyzer` logic >= 80%.
- Service successfully builds and starts in both Docker Compose and Cloud Run (dry-run).
- All annotations adhere to the schema in `technical-architecture.md`.

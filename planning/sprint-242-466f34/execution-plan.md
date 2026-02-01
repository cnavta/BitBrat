# Execution Plan - sprint-242-466f34

## Objective
Introduce an LLM abstraction layer in the `query-analyzer` service using the Vercel AI SDK to support both Ollama and OpenAI (gpt-4o-mini).

## Phase 1: Preparation
1. **Dependency Management**:
   - Add `@ai-sdk/ollama` to `package.json`.
   - Ensure `ai` and `zod` are available (already present in the project but verify versions if necessary).
   - Run `npm install`.

## Phase 2: Abstraction Implementation
1. **Schema Definition**:
   - Create `src/services/query-analyzer/schema.ts` (or include in `llm-provider.ts`).
   - Define the `queryAnalysisSchema` using Zod, matching the `QueryAnalysis` interface from the TA.
2. **Provider Factory**:
   - Create `src/services/query-analyzer/llm-provider.ts`.
   - Implement `getLlmProvider(providerName: string, modelName: string)` factory.
   - Implement a wrapper function (e.g., `analyzeWithLlm`) that uses `generateObject` with the selected provider.

## Phase 3: Service Refactoring
1. **Update `src/apps/query-analyzer.ts`**:
   - Remove the manual `fetch` call to Ollama.
   - Import the new LLM abstraction.
   - Replace `analyzeQuery` method logic with a call to the new abstraction.
   - Update environment variable usage (add `LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY`).

## Phase 4: Testing and Validation
1. **Unit Testing**:
   - Create `tests/services/query-analyzer/llm-provider.test.ts`.
   - Mock AI SDK providers to verify the factory logic.
2. **Integration Testing**:
   - Update existing tests in `tests/apps/query-analyzer.test.ts` (if they exist) to ensure the service still processes events correctly.
3. **Validator Script**:
   - Create `planning/sprint-242-466f34/validate_deliverable.sh` to automate build and test checks.

## Phase 5: Deployment & Documentation
1. **Environment Config**:
   - Update `Dockerfile.query-analyzer` with new required environment variables.
   - Update `architecture.yaml` if necessary to reflect new configuration options.
2. **Documentation**:
   - Update service documentation to reflect the new LLM flexibility.

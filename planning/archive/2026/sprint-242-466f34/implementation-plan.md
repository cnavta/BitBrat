# Implementation Plan – sprint-242-466f34

## Objective
Introduce an abstraction layer for LLM providers in `query-analyzer` to support both Ollama and OpenAI (gpt-4o-mini), using Vercel AI SDK.

## Scope
- Refactor `src/apps/query-analyzer.ts` to use an abstraction for LLM calls.
- Implement Ollama provider using `@ai-sdk/ollama`.
- Implement OpenAI provider using `@ai-sdk/openai`.
- Add `@ai-sdk/ollama` to `package.json`.
- Maintain existing functionality and output format.

## Deliverables
- Code changes in `src/apps/query-analyzer.ts`.
- New service file `src/services/query-analyzer/llm-provider.ts`.
- Updated `package.json` and `package-lock.json`.
- New tests for the LLM abstraction.

## Acceptance Criteria
- `query-analyzer` can switch between Ollama and OpenAI via environment variables.
- Structured output (intent, tone, risk) remains consistent.
- `validate_deliverable.sh` passes.
- Unit tests cover both providers (mocked).

## Testing Strategy
- Unit tests for `LLMProviderFactory` and individual providers.
- Mocking Vercel AI SDK `generateObject` to verify provider-specific logic.
- Integration test with a simulated LLM response.

## Deployment Approach
- Standard Cloud Run deployment as defined in `architecture.yaml`.
- Ensure `OPENAI_API_KEY` is available in the environment if OpenAI provider is selected.

## Dependencies
- `@ai-sdk/ollama` (to be added)
- `@ai-sdk/openai` (already present)
- `ai` (already present)
- `zod` (already present)

## Definition of Done
- All deliverables implemented.
- All tests pass.
- PR created and linked.
- Documentation updated (Technical Architecture).

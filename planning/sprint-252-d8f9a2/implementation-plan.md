# Implementation Plan – sprint-252-d8f9a2

## Objective
Implement a shared LLM provider factory to centralize provider instantiation and enable OpenAI-compatible vLLM support across query-analyzer and llm-bot services.

## Scope
- Shared utility for LLM provider instantiation.
- Standardization of LLM-related environment variables.
- Refactoring `query-analyzer` and `llm-bot` services.
- Updating local environment configurations.

## Deliverables
- `src/common/llm/provider-factory.ts`
- Updated `src/services/query-analyzer/llm-provider.ts` (or equivalent)
- Updated `src/services/llm-bot/processor.ts`
- Updated `env/local/query-analyzer.yaml` and `env/local/llm-bot.yaml`
- Unit tests for `provider-factory.ts`

## Acceptance Criteria
- `provider-factory.ts` correctly instantiates OpenAI, Ollama, and vLLM providers.
- `query-analyzer` service successfully uses the factory.
- `llm-bot` service successfully uses the factory.
- Services correctly read and use the new standardized environment variables.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Unit tests for the new `provider-factory.ts` using mocks for `@ai-sdk/openai` and `ai-sdk-ollama`.
- Integration tests (if possible in local env) to verify that environment variables are correctly picked up.

## Deployment Approach
- Update local YAML configurations to reflect new environment variable names.
- Ensure Cloud Build configurations remain compatible (though they should use standard env vars).

## Dependencies
- `@ai-sdk/openai`
- `ai-sdk-ollama`
- `ai` package (Vercel AI SDK)

## Definition of Done
- Code adheres to project style.
- Tests pass.
- Documentation updated.
- PR created.

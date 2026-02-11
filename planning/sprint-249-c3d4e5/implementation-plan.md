# Implementation Plan – sprint-249-c3d4e5

## Objective
- Fix `query-analyzer` to respect the `OLLAMA_HOST` environment variable.

## Scope
- Modify `src/services/query-analyzer/llm-provider.ts` to read `OLLAMA_HOST`.
- Update `getLlmProvider` to accept an optional host and use it for the Ollama provider.

## Deliverables
- Code fix in `src/services/query-analyzer/llm-provider.ts`.
- Validation script.

## Acceptance Criteria
- `query-analyzer` code correctly references `OLLAMA_HOST`.
- Project builds successfully.

## Testing Strategy
- Manual code review.
- Build check via `validate_deliverable.sh`.
- Since I cannot easily run a real Ollama instance in this environment, I will verify the code logic and ensure it compiles.

## Definition of Done
- Code follows project style.
- `validate_deliverable.sh` passes.
- PR created.

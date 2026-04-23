# Implementation Plan – sprint-293-b5c1d2

## Objective
- Fix `query-analyzer.embedding_error`: `model.doEmbed is not a function`.

## Scope
- `src/common/llm/provider-factory.ts`
- `src/services/query-analyzer/llm-provider.ts`

## Deliverables
- Updated `LlmProviderConfig` to include an optional `kind` field.
- Updated `getLlmProvider` to return either a `LanguageModel` or `EmbeddingModel`.
- Fixed `generateEmbedding` in `query-analyzer` to correctly request an embedding model.

## Acceptance Criteria
- `generateEmbedding` no longer throws `model.doEmbed is not a function`.
- `analyzeWithLlm` still works correctly.
- Tests for `provider-factory` cover both language and embedding models.

## Testing Strategy
- Update `src/common/llm/__tests__/provider-factory.test.ts` to verify embedding model instantiation.
- Add a test in `tests/services/query-analyzer/llm-provider.test.ts` (if exists or create one) to mock `embed` call.

## Definition of Done
- Code changes implemented and tested.
- `validate_deliverable.sh` passes.
- PR created.

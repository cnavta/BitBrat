# Deliverable Verification – sprint-293-b5c1d2

## Completed
- [x] Updated `getLlmProvider` to support `kind: 'embedding'`.
- [x] Updated `analyzeWithLlm` and `generateEmbedding` in `query-analyzer` to use the correct model kind.
- [x] Updated `provider-factory.test.ts` to cover embedding models.
- [x] Updated `llm-provider.test.ts` to cover embedding generation.

## Partial
- None

## Deferred
- None

## Alignment Notes
- The fix correctly addresses the `model.doEmbed is not a function` error by providing the expected `EmbeddingModel` interface to the AI SDK.

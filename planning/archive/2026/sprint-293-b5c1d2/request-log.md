# Request Log – sprint-293-b5c1d2

## [2026-04-23T18:56:00Z] - Initial investigation
- **Prompt**: Investigating `query-analyzer.embedding_error`: `model.doEmbed is not a function`.
- **Interpretation**: The `vllm` provider is being used for embeddings, but the provider factory is returning a completion model instead of an embedding model.
- **Actions**:
    - Analyzed `src/common/llm/provider-factory.ts`.
    - Analyzed `src/services/query-analyzer/llm-provider.ts`.
    - Identified that `getLlmProvider` needs to support `EmbeddingModel`.

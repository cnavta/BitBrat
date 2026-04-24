# Key Learnings – sprint-293-b5c1d2

- **Vercel AI SDK Model Interfaces**: The SDK strictly separates `LanguageModel` (for completion/object generation) and `EmbeddingModel` (for embeddings). Passing a `LanguageModel` to the `embed()` function results in a runtime error because it expects the `doEmbed` method which only exists on `EmbeddingModel`.
- **vLLM Compatibility**: While vLLM is OpenAI-compatible, the SDK still needs to be explicitly told to treat a model as an embedding model via `provider.embedding(modelName)`.
- **Fluent API Mocking**: When mocking providers that have both a callable interface and methods (like `.embedding()`), the mock must be configured as a function with attached mock methods.

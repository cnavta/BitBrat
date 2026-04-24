# Retro – sprint-293-b5c1d2

## What Worked
- Identifying the root cause as a type mismatch in the Vercel AI SDK interface was straightforward.
- Centralized provider factory made the fix easy to propagate.

## What Didn't Work
- Initial unit test mocks for the provider factory were too simplistic and had to be rewritten to handle the fluent API (`provider(model)` vs `provider.embedding(model)`).

## Key Learnings
- Always ensure that the model object passed to `@ai-sdk` functions matches the expected interface (LanguageModel vs EmbeddingModel).

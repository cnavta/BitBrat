# Sprint Retro - sprint-241-b8d4e2

## What went well
- Transition from architecture to execution was smooth thanks to the detailed plan.
- The sidecar pattern for Ollama provides a robust local development experience.
- Adaptive model selection in `llm-bot` was easy to integrate with the new annotations.

## What didn't go well
- TypeScript mocking for `fetch` and `message-bus` required some boilerplate.
- Cloud Run resource requirements for Llama-3 8B are high, which might impact cost if not scaled carefully.

## Improvements for future sprints
- Standardize a mock Ollama service for common testing scenarios.
- Explore smaller models (e.g., Phi-3 or TinyLlama) for even faster/cheaper analysis where Llama-3 might be overkill.

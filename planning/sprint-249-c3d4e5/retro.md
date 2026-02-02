What worked:
- Identifying the issue in `llm-provider.ts`.
- Switching to `createOllama` fixed the type error and allowed proper configuration.

What didn't work:
- Initial attempt to use `ollama(model, { config: { baseURL } })` failed because `ollama()` factory doesn't support `config` property in that way; `createOllama` is the correct approach for custom settings.

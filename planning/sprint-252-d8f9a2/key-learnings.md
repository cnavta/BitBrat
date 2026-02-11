# Key Learnings – sprint-252-d8f9a2

- **Factory Pattern for AI SDKs**: Leveraging the Vercel AI SDK's provider functions within a factory allows for seamless switching between local (Ollama), compatible (vLLM), and hosted (OpenAI) providers with zero changes to the calling code.
- **Environment Standardization**: Use a single set of standardized variable names (e.g., `LLM_PROVIDER`, `LLM_MODEL`) across all microservices to reduce deployment complexity.
- **Mocking Vercel AI SDK**: When mocking the SDK in tests, be sure to mock the specific provider creation functions (`createOpenAI`, `createOllama`) used by the factory to ensure test reliability.

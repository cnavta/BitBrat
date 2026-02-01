# Key Learnings - sprint-242-466f34

- **Vercel AI SDK Abstraction**: Using a unified factory for LLM providers makes it trivial to support local (Ollama) and cloud (OpenAI) models side-by-side.
- **Structured Output**: `generateObject` is the preferred way to get reliable JSON from LLMs when using the AI SDK. It integrates seamlessly with Zod for validation.
- **TypeScript Limitations**: Very complex generic types in libraries like `ai` can sometimes hit TypeScript's recursion limits, especially when combined with other complex libraries like `zod`. Strategic use of `any` or `// @ts-ignore` might be necessary when library-level type issues arise and cannot be easily fixed via configuration.
- **Dependency Discovery**: Always verify package availability in the registry if using community-maintained providers for the Vercel AI SDK.

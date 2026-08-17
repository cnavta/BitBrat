# Technical Architecture: LLM Abstraction Layer for Query Analyzer

## 1. Introduction
The `query-analyzer` service currently has a hardcoded dependency on Ollama for linguistic analysis. To improve flexibility and allow for high-availability/performance trade-offs, we need an abstraction layer that supports multiple LLM providers, specifically Ollama and OpenAI (gpt-4o-mini).

## 2. Proposed Framework: Vercel AI SDK
We already use the Vercel AI SDK (`ai` package) in the `llm-bot` service. It provides a clean, unified API for interacting with various LLM providers and supports structured output (JSON) out of the box.

### Advantages:
- Unified API for multiple providers.
- Built-in support for structured output via `generateObject` (using Zod).
- Middleware support for logging, telemetry, etc.
- Consistency with existing services.

## 3. Design Components

### 3.1 LLM Abstraction Interface
We will define a common interface or type for the analysis result, matching the existing `OllamaAnalysis` but renamed to something more generic like `QueryAnalysis`.

```typescript
interface QueryAnalysis {
  intent: 'question' | 'joke' | 'praise' | 'critique' | 'command' | 'meta' | 'spam';
  tone: { valence: number; arousal: number };
  risk: { 
    level: 'none' | 'low' | 'med' | 'high'; 
    type: 'none' | 'harassment' | 'spam' | 'privacy' | 'self_harm' | 'sexual' | 'illegal' 
  };
}
```

### 3.2 Provider Factory
A factory will instantiate the appropriate provider based on environment configuration.

Supported Providers:
- `ollama`: Uses `@ai-sdk/ollama`.
- `openai`: Uses `@ai-sdk/openai`.

### 3.3 Configuration
We will use environment variables to select the provider and configure provider-specific settings:
- `LLM_PROVIDER`: `ollama` | `openai` (default: `ollama`)
- `LLM_MODEL`: e.g., `llama3` for Ollama or `gpt-4o-mini` for OpenAI.
- `OLLAMA_HOST`: Existing variable for Ollama.
- `OPENAI_API_KEY`: Required for OpenAI.

## 4. Implementation Details

### 4.1 Dependency Addition
We need to add `@ai-sdk/ollama` to the project's dependencies.

### 4.2 Structured Output with `generateObject`
Instead of manually parsing JSON strings, we will use `generateObject`:

```typescript
const { object } = await generateObject({
  model: provider(modelName),
  schema: analysisSchema,
  prompt: text,
  system: SYSTEM_PROMPT,
});
```

## 5. Migration Plan
1.  Add `@ai-sdk/ollama` dependency.
2.  Create `src/services/query-analyzer/llm-provider.ts` to host the abstraction and factory.
3.  Refactor `src/apps/query-analyzer.ts` to use the new abstraction.
4.  Update environment configurations (Dockerfile, etc.) if necessary.
5.  Validate with existing tests and add new integration tests for OpenAI provider (mocked).

## 6. Alternatives Considered
- **LangChain**: More feature-rich but might be overkill for this simple use case and introduces more overhead than Vercel AI SDK.
- **Custom Abstraction**: We could write our own wrappers for `fetch`, but it would be reinventing the wheel and wouldn't benefit from the ecosystem of providers supported by Vercel AI SDK.

## 7. Recommendation
Proceed with **Vercel AI SDK** using `generateObject` for structured analysis. It aligns with our current tech stack and provides the most robust way to handle JSON outputs across different models.

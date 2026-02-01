# Query Analyzer (Llama Sentry)

The `query-analyzer` is a high-performance linguistic analysis service that acts as a "Sentry" middleware in the BitBrat Platform. It sits between the `event-router` and the `llm-bot` to provide fast, cost-effective pre-processing of user queries using a local Llama-3 model.

## Features

- **Intent Classification**: Identifies if a message is a question, joke, praise, critique, command, meta-discussion, or spam.
- **Tone Analysis**: Measures valence (supportive vs. hostile) and arousal (calm vs. fired up).
- **Risk Assessment**: Detects harassment, spam, privacy violations, and other risky content.
- **Short-Circuiting**: Automatically terminates processing for spam or high-risk messages, saving expensive primary LLM tokens.
- **Adaptive Model Selection Support**: Enriches events with annotations that allow `llm-bot` to select the most appropriate model (e.g., GPT-4o vs. GPT-4o-mini).
- **Prompt Logging**: Logs all queries and analysis results to Firestore for audit and training purposes, including token usage metrics.

## Architecture

The service is built on the `BaseServer` framework and uses the **Vercel AI SDK** to interface with LLM providers. It defaults to a local **Ollama** sidecar for inference but can be configured to use external providers like **OpenAI**.

- **Primary Container**: Node.js application (`src/apps/query-analyzer.ts`).
- **Sidecar Container (Optional)**: Ollama (`ollama/ollama:latest`) when using the `ollama` provider.
- **Providers**: Supports `ollama` (default) and `openai`.
- **Model**: Defaulting to `llama3` for Ollama. For OpenAI, `gpt-4o-mini` is recommended for performance.

## Event Flow

1. **Ingress**: `event-router` assigns a routing slip starting with `query-analyzer`.
2. **Topic**: Consumes from `internal.query.analysis.v1`.
3. **Analysis**: Query text is sent to the configured LLM provider using `generateObject` with a Zod schema to ensure structured output.
4. **Enrichment**: Results are attached to the `InternalEventV2` as `AnnotationV1` objects.
5. **Routing**:
   - **Trivial/Spam**: Calls `this.complete()`, bypassing `llm-bot` and sending directly to `egress`.
   - **Standard**: Calls `this.next()`, passing the enriched event to `llm-bot`.

## Annotations

The service produces three types of annotations with the source `query-analyzer`:

| Kind | Label/Value | Payload Details |
|------|-------------|-----------------|
| `intent` | intent name | e.g., `question`, `spam`, `joke` |
| `tone` | N/A | `{"valence": float, "arousal": float}` |
| `risk` | risk level | `{"level": string, "type": string}` |

## Observability

### Prompt Logging

The service logs every analysis request to Firestore for audit and debugging.

- **Storage Path**: `services/query-analyzer/prompt_logs/{logId}`
- **Fields**:
    - `correlationId`: Unique ID to trace the request across services.
    - `prompt`: The query text (redacted).
    - `response`: The structured analysis result in JSON format (redacted).
    - `model`: The name of the LLM model used.
    - `usage`: Token usage metrics:
        - `promptTokens`: Tokens in the input prompt.
        - `completionTokens`: Tokens in the generated completion.
        - `totalTokens`: Sum of prompt and completion tokens.
    - `createdAt`: Timestamp of the log entry.

## Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | LLM provider to use (`ollama`, `openai`) |
| `LLM_MODEL` | `llama3` | Model to use for analysis (e.g., `llama3`, `gpt-4o-mini`) |
| `OLLAMA_HOST` | `http://localhost:11434` | URL of the Ollama API (only for `ollama` provider) |
| `OPENAI_API_KEY` | N/A | OpenAI API Key (required for `openai` provider) |
| `FF_LLM_PROMPT_LOGGING` | `false` | Feature flag to enable prompt logging to Firestore. |
| `SERVICE_PORT` | `3000` | Port for the service to listen on |

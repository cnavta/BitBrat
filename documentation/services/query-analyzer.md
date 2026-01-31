# Query Analyzer (Llama Sentry)

The `query-analyzer` is a high-performance linguistic analysis service that acts as a "Sentry" middleware in the BitBrat Platform. It sits between the `event-router` and the `llm-bot` to provide fast, cost-effective pre-processing of user queries using a local Llama-3 model.

## Features

- **Intent Classification**: Identifies if a message is a question, joke, praise, critique, command, meta-discussion, or spam.
- **Tone Analysis**: Measures valence (supportive vs. hostile) and arousal (calm vs. fired up).
- **Risk Assessment**: Detects harassment, spam, privacy violations, and other risky content.
- **Short-Circuiting**: Automatically terminates processing for spam or high-risk messages, saving expensive primary LLM tokens.
- **Adaptive Model Selection Support**: Enriches events with annotations that allow `llm-bot` to select the most appropriate model (e.g., GPT-4o vs. GPT-4o-mini).

## Architecture

The service is built on the `BaseServer` framework and uses an **Ollama** sidecar for local LLM inference.

- **Primary Container**: Node.js application (`src/apps/query-analyzer.ts`).
- **Sidecar Container**: Ollama (`ollama/ollama:latest`).
- **Communication**: The Node.js app communicates with Ollama over `localhost:11434` (Sidecar) or via `OLLAMA_HOST`.
- **Model**: Defaulting to `llama3` (Llama-3 8B).

## Event Flow

1. **Ingress**: `event-router` assigns a routing slip starting with `query-analyzer`.
2. **Topic**: Consumes from `internal.query.analysis.v1`.
3. **Analysis**: Query text is sent to Ollama with a strict system prompt and JSON mode enabled.
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

## Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `OLLAMA_HOST` | `http://localhost:11434` | URL of the Ollama API |
| `OLLAMA_MODEL` | `llama3` | Llama model to use for analysis |
| `SERVICE_PORT` | `3000` | Port for the service to listen on |

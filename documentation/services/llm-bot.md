# LLM Bot Service

The `llm-bot` service is the primary reasoning engine of the BitBrat Platform. It consumes enriched events, assembles complex prompts, and interacts with LLMs to generate assistant responses.

## Features

- **Prompt Assembly**: Uses a modular framework to build system prompts, identity, user context, and task instructions.
- **Personality Injection**: Dynamically applies assistant personalities based on event annotations.
- **User Context**: Enriches prompts with user-specific data (roles, status, etc.).
- **MCP Integration**: Uses the Model Context Protocol to interact with external tools (e.g., OBS, web search).
- **Adaptive Model Selection**: Selects between different models (e.g., GPT-4o, GPT-4o-mini) based on query complexity.
- **Memory Management**: Maintains short-term conversation history for contextual replies.
- **Prompt Logging**: Logs detailed interaction data, including prompts, tool calls, and usage metrics.

## Architecture

The service is a Node.js application built on the `BaseServer` framework.

- **Entry Point**: `src/apps/llm-bot-service.ts`
- **Core Logic**: `src/services/llm-bot/processor.ts`
- **Framework**: Vercel AI SDK (`ai` package) with OpenAI provider.

## Observability

### Prompt Logging

The service logs every LLM interaction to Firestore for audit, debugging, and analytics.

- **Storage Path**: `services/llm-bot/prompt_logs/{logId}`
- **Fields**:
    - `correlationId`: Unique ID to trace the request across services.
    - `prompt`: The fully assembled prompt sent to the LLM (redacted).
    - `response`: The final response from the LLM (redacted).
    - `model`: The name of the LLM model used (e.g., `gpt-4o`).
    - `personalityNames`: List of personalities applied to the request.
    - `toolCalls`: List of MCP tool calls made during the interaction (redacted).
    - `usage`: Token usage metrics:
        - `promptTokens`: Tokens in the input prompt.
        - `completionTokens`: Tokens in the generated completion.
        - `totalTokens`: Sum of prompt and completion tokens.
    - `createdAt`: Timestamp of the log entry.

## Configuration

Relevant environment variables for the LLM Bot service:

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `OPENAI_MODEL` | `gpt-4o` | Primary model to use. |
| `OPENAI_API_KEY` | N/A | OpenAI API Key. |
| `PERSONALITY_ENABLED` | `true` | Enable personality injection. |
| `USER_CONTEXT_ENABLED` | `true` | Enable user context enrichment. |
| `FF_LLM_PROMPT_LOGGING` | `false` | Feature flag to enable prompt logging to Firestore. |
| `LLM_BOT_MEMORY_MAX_MESSAGES` | `8` | Maximum messages to keep in short-term memory. |
| `LLM_BOT_MEMORY_MAX_CHARS` | `8000` | Maximum characters to keep in short-term memory. |

# Technical Architecture: MCP Tool Registration & Vercel AI SDK Integration

## 1. Executive Summary
This document outlines the architectural plan for integrating the Model Context Protocol (MCP) into the BitBrat Platform's `llm-bot` service. By leveraging Vercel's AI SDK, we will establish a robust, provider-agnostic foundation for tool use, enabling BitBrat to interact with external systems through a standardized protocol. This sprint focuses on the initial setup, registration abstractions, and bridging MCP tools to the AI SDK.

## 2. System Overview
The BitBrat Platform uses a headless `llm-bot` service to process user messages and generate responses. Currently, this service is tied to OpenAI and uses a minimal LangGraph implementation for flow orchestration. The new architecture introduces:
- **Vercel AI SDK Core**: To provide a unified interface for multiple LLM providers and replace LangGraph for tool orchestration.
- **MCP Client Layer**: To discover and invoke tools from MCP servers.
- **Tool Registry**: A centralized component to manage tools from various sources (Built-in, MCP, and future Firestore-based).

## 3. Core Components

### 3.1 Vercel AI SDK Integration
The AI SDK will replace direct OpenAI library calls. This allows us to:
- Easily switch between models (GPT-4o, Claude 3.5 Sonnet, etc.).
- Use the unified `tools` API for function calling.
- Benefit from built-in support for tool execution and streaming.

### 3.2 MCP Bridge
The MCP Bridge will act as a translator between the Model Context Protocol and Vercel AI SDK's tool definitions.
- **Discovery**: The bridge will connect to configured MCP servers (via stdio or HTTP) and list available tools.
- **Translation**: MCP tool definitions (using JSON Schema) will be mapped to AI SDK `tool` objects.
- **Execution**: When the LLM requests a tool call, the bridge will forward the request to the appropriate MCP server.

### 3.3 Tool Registration Abstractions
To support future extensibility, tool registration will be decoupled from the LLM execution logic.
- `ToolDefinition`: An interface describing a tool (name, description, schema, execution logic).
- `ToolRegistry`: A service that aggregates tools from:
    - **Internal Static Tools**: Built-in BitBrat commands.
    - **MCP Dynamic Tools**: Tools fetched from MCP servers.
    - **Firestore Tools (Future)**: Tools discovered via RAG from a Firestore registry.

## 4. Proposed Abstractions (TypeScript)

### 4.1 LLM Service Abstraction
```typescript
interface LlmService {
  generateResponse(prompt: string, context: Context): Promise<string>;
}
```
*Note: This will likely wrap `generateText` or `streamText` from Vercel AI SDK.*

### 4.2 Tool Interface
```typescript
import { CoreTool } from 'ai';

interface BitBratTool extends CoreTool {
  source: 'internal' | 'mcp' | 'firestore';
  id: string;
}
```

### 4.3 Tool Registry
```typescript
class ToolRegistry {
  private tools: Map<string, BitBratTool> = new Map();

  registerTool(tool: BitBratTool): void;
  getTools(): Record<string, BitBratTool>;
}
```

## 5. Integration Flow
1. **Startup**: `llm-bot` initializes the `ToolRegistry`.
2. **Discovery**: `McpClient` connects to MCP servers, fetches tool definitions, and registers them in the `ToolRegistry`.
3. **Event Processing**: When an `internal.llmbot.v1` event arrives:
    - The `LlmService` is invoked.
    - It fetches all active tools from the `ToolRegistry`.
    - It calls Vercel AI SDK's `generateText` with the model and tools.
4. **Tool Call**: If the model requests a tool, the AI SDK executes the `execute` function of the tool.
5. **Completion**: The final response (including tool results) is returned.

## 6. Multi-LLM Support
By using Vercel AI SDK, we can support multiple providers by simply changing the `model` parameter:
- `openai('gpt-4o')`
- `anthropic('claude-3-5-sonnet-20240620')`
- `google('gemini-1.5-pro')`

Configuration will determine which provider/model is used for a given request or environment.

## 7. Future Considerations: Firestore-based RAG Registry
The current architecture prepares for the future by:
- Using a centralized `ToolRegistry` that can be populated from any source.
- Keeping tool definitions separate from the LLM invocation logic.
- Standardizing on JSON Schema (via MCP) which is compatible with Firestore storage and vector search.

In the next phase, we will add a `FirestoreToolProvider` that queries a collection for relevant tools based on the current prompt context.

## 8. Vercel AI SDK: Capabilities & Benefits

### 8.1 Unified API
Vercel AI SDK provides a single API for multiple LLM providers. This directly supports our goal of multi-LLM service support without rewriting integration logic for each provider.

### 8.2 Tool Calling & Orchestration
The SDK simplifies tool calling by:
- Providing a `tool` helper for type-safe definitions using Zod.
- Automatically handling tool execution loops (`maxSteps` parameter).
- Managing tool results and feeding them back to the model.

### 8.3 Streaming & UX
For future features requiring real-time interaction (e.g., chat interfaces for streamers), the SDK's `streamText` and `useChat` hooks provide industry-standard performance and ease of use.

### 8.4 Structured Data (generateObject)
The `generateObject` capability is crucial for internal administrative tasks, such as:
- Classifying incoming events.
- Parsing complex user commands into structured parameters.
- Generating new rules or configurations for the platform.

### 8.5 Future: RAG & Observability
The SDK integrates well with vector databases and provides hooks for observability (OpenTelemetry), which aligns with BitBrat's scaling requirements.

## 9. Deprecation of LangGraph
As part of this transition, we will deliberately remove the dependency on `@langchain/langgraph`. 

### 9.1 Rationale
While LangGraph provided a structure for future complexity, Vercel AI SDK's native capabilities render it redundant for BitBrat's current needs:
- **Native Tool Loops**: The SDK's `maxSteps` parameter handles multi-turn tool calling without manual state management.
- **Provider Agnosticism**: The SDK handles provider-specific tool formats internally.
- **Simplicity**: Removing LangGraph reduces bundle size, complexity, and the learning curve for new contributors.

### 9.2 Migration Path
1. **Remove Dependencies**: Uninstall `@langchain/langgraph` and `@langchain/openai`.
2. **Refactor Processor**: Rewrite `src/services/llm-bot/processor.ts` to use `generateText` directly instead of a `StateGraph`.
3. **Unified Logging**: Consolidate LangGraph-based logging into the Vercel AI SDK's telemetry hooks.

## 10. Conclusion
The proposed architecture provides a scalable and flexible foundation for BitBrat's evolution into a tool-enabled, multi-model AI assistant. By standardizing on MCP and Vercel AI SDK, and simplifying our stack by removing redundant layers like LangGraph, we ensure interoperability and future-proof the platform.

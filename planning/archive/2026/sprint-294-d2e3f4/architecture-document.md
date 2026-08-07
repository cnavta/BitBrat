# Technical Architecture Document: MCP Timeout Coordination – sprint-294-d2e3f4

## 1. Overview
The BitBrat Platform currently suffers from uncoordinated timeout layers across the Model Context Protocol (MCP) tool invocation path. This document outlines the hierarchical timeout strategy to synchronize these layers.

## 2. Proposed Architecture: Hierarchical Timeouts

We will implement a "Top-Down" timeout hierarchy where each layer is slightly more permissive than the layer it encapsulates to allow for processing overhead.

### 2.1 Standardized Timeout Values
We will standardize on a **60-second** baseline for most tool operations.

*   **Layer 1: Event/Bus (QoS)**: `90,000ms` (90s)
    *   *Purpose*: The absolute maximum time the platform will track an event.
*   **Layer 2: Application (LLM Bot)**: `75,000ms` (75s)
    *   *Purpose*: The limit for the entire `generateText` multi-step loop.
*   **Layer 3: Infrastructure (MCP Proxy/Invoker)**: `60,000ms` (60s)
    *   *Purpose*: The limit for a single tool call to an upstream server.
*   **Layer 4: Transport (HTTP/Node)**: `120,000ms` (120s).

## 3. Component-Specific Implementation Guidelines

### ProxyInvoker (`src/common/mcp/proxy-invoker.ts`)
*   Align JSDoc comments with code defaults.
*   Ensure error logging distinguishes between "Upstream Timeout" and "Caller Abort".

### LLM Bot Service (`src/apps/llm-bot-service.ts`)
*   Update `CONFIG_DEFAULTS.OPENAI_TIMEOUT_MS` to `75000`.

### LLM Processor (`src/services/llm-bot/processor.ts`)
*   Update fallback `timeoutMs` (currently 30s) to `75000`.

## 4. Verification Plan
*   **Unit Tests**: Validate `ProxyInvoker` default rejections.
*   **Integration Tests**: Simulate long-running tool calls (e.g., 45s) and verify successful Bot completion.
*   **Observability**: Ensure logs indicate the specific layer triggering any timeout.

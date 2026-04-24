# MCP Timeout Analysis Report – sprint-294-d2e3f4

The investigation revealed multiple, often uncoordinated timeout layers operating across the Model Context Protocol (MCP) tool invocation path. The most significant issue is the mismatch between the infrastructure's willingness to wait (ProxyInvoker) and the application's timeout (LLM Bot), as well as inconsistencies between code implementation and documentation.

## 1. ProxyInvoker Timeout (The Infrastructure Layer)
Located in `src/common/mcp/proxy-invoker.ts`, this is the primary timeout for upstream MCP server calls (Tools, Resources, Prompts).
*   **Code Default**: `60,000ms` (60 seconds).
*   **Documentation Default**: The JSDoc comments incorrectly state a default of `15,000ms` (15 seconds).
*   **Mechanism**: Implemented via `Promise.race` against a `setTimeout` promise.
*   **Configuration**: Can be overridden per-server via the `timeoutMs` field in `McpServerConfig`.

## 2. LLM Bot Interaction Timeout (The Application Layer)
Located in `src/apps/llm-bot-service.ts` and `src/services/llm-bot/processor.ts`.
*   **Service Default**: `15,000ms` (15 seconds) defined in `LlmBotServer.CONFIG_DEFAULTS`.
*   **Processor Default**: `30,000ms` (30 seconds) used as a fallback within the processor logic if the server configuration is missing.
*   **Uncoordinated Behavior**: Since the `LlmBotServer` default (15s) is much shorter than the `ProxyInvoker` default (60s), a tool call that takes 20 seconds will be aborted by the LLM Bot's `generateText` call, even though the `ProxyInvoker` would have continued to wait.

## 3. BaseServer Quality of Service (The Event Layer)
Located in `src/common/base-server.ts`, enforced in `onMessage` handlers.
*   **Default**: None (only applied if `qos.maxResponseMs` is present in the event).
*   **Impact**: If a tool call is part of an event-driven flow, this timeout can terminate the entire process regardless of internal tool timeouts.

## 4. Summary Table of Primary Conflicts

| Layer | Source | Value (Code) | Value (Doc/Default) |
| :--- | :--- | :--- | :--- |
| **Tool Invocation** | `ProxyInvoker` | 60s | 15s (Comment) |
| **Bot Overall** | `LlmBotServer` | 15s | 30s (Processor fallback) |
| **Circuit Reset** | `ProxyInvoker` | 120s | 30s (Comment) |
| **HTTP Request** | Node/Express | 120s | - |

**Conclusion**: The system is currently "abort-heavy" at the application level (15s) while being "wait-heavy" at the infrastructure level (60s). This leads to scenarios where tools are successfully executing in the background but the requesting agent has already given up.

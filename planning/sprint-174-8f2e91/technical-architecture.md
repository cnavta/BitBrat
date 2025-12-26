# Technical Architecture – MCP Stats and Debug Endpoint (sprint-174-8f2e91)

## 1. Introduction
This document outlines the architectural changes required to add usage statistics, error tracking, and a debug visibility endpoint for Model Context Protocol (MCP) integrations within the BitBrat Platform.

## 2. Current State
The `McpClientManager` (inside `llm-bot` service) manages connections to multiple MCP servers defined in Firestore (`mcp_servers` collection). It uses `McpBridge` to wrap MCP tools as `BitBratTool` objects, which are then registered in a local `ToolRegistry`.

Currently:
- There is no centralized tracking of how often an MCP tool is called.
- Errors during MCP tool execution are logged but not aggregated or exposed via API.
- The state of active MCP connections and registered tools is only visible through logs.

## 3. Proposed Changes

### 3.1. Stats Collection
We will introduce a `McpStatsCollector` (or similar) to track metrics per MCP Server and per Tool.

**Metrics to collect:**
- **Invocations**: Total number of times a tool was called.
- **Errors**: Number of failed invocations.
- **Latency**: Time taken for tool execution (Min, Max, Avg).
- **Last Used**: Timestamp of the most recent invocation.
- **Connection Status**: Uptime/Downtime per MCP server.
- **Discovery Stats**: Number of tools discovered per server, time taken for discovery.

**Additional valuable metrics:**
- **Response Size**: Size of the data returned by MCP tools (to monitor bandwidth/memory usage).
- **Retry Count**: If retries are implemented, track how many attempts were made.
- **Auth Failures**: Specific tracking for authentication-related errors if using tokens.

### 3.2. Data Storage
For this sprint, stats will be kept **in-memory** within the `llm-bot` service instance for low latency and simplicity. 
*Note: In a multi-instance scenario, these stats will be instance-specific. Future sprints could aggregate these into Firestore or Cloud Monitoring.*

### 3.3. HTTP `_debug` Endpoint
A new endpoint `GET /_debug/mcp` will be added to the `llm-bot` service.

**Response Structure:**
```json
{
  "servers": {
    "obs-mcp": {
      "status": "connected",
      "transport": "stdio",
      "uptime": "2h 15m",
      "tools": ["mcp:set_scene", "mcp:get_sources"],
      "stats": {
        "totalInvocations": 150,
        "totalErrors": 2,
        "avgLatencyMs": 45,
        "lastUsed": "2025-12-26T12:00:00Z"
      }
    }
  },
  "tools": {
    "mcp:set_scene": {
      "invocations": 45,
      "errors": 0,
      "avgLatencyMs": 30
    }
  },
  "registry": {
    "totalTools": 15
  }
}
```

### 3.4. Implementation Strategy
1. **Update `McpBridge`**: Wrap the `execute` function to record start time, end time, and success/failure.
2. **Update `McpClientManager`**: 
    - Hold the `McpStatsCollector` instance.
    - Update stats during discovery and connection/disconnection events.
3. **Update `LlmBotServer`**: 
    - Add the route `/_debug/mcp`.
    - Expose data from `McpClientManager`.

### 3.5. Error Tracking in InternalEventV2
In addition to in-memory stats, any MCP or LLM errors encountered during processing will be appended to the `errors` array of the `InternalEventV2` object. This ensures that errors are traceable within the event lifecycle and can be persisted by the `persistence` service.

**Mechanism:**
- When an MCP tool call fails in `McpBridge`, it will throw an error.
- The `processEvent` or `McpBridge` execution wrapper will catch these errors and update the `InternalEventV2.errors` array using the `ErrorEntryV1` schema.
- Similarly, if the LLM itself returns an error or fails to respond, it will be recorded in the same array.

## 4. Security Considerations
- The `/_debug` endpoints should ideally be restricted to internal traffic or authorized users. Existing `architecture.yaml` suggests `/_debug` routes are exposed via the Load Balancer in some cases, but for `llm-bot`, it is currently behind the internal LB.
- Sensitive environment variables or secrets in MCP config should **not** be exposed in the debug endpoint.

## 5. Acceptance Criteria
- [ ] `GET /_debug/mcp` returns the current state of all MCP connections.
- [ ] Usage stats (invocations, errors, latency) are updated correctly after tool execution.
- [ ] Stats are broken down by server and by individual tool.
- [ ] Any MCP or LLM errors are appended to `InternalEventV2.errors`.
- [ ] The system remains stable and does not leak memory from stats collection.

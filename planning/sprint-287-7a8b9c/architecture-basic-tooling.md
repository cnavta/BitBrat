# Technical Architecture – Basic Tooling for BitBrat Platform

## 1. Overview
The BitBrat platform utilizes LLMs as central orchestration and execution engines. These LLMs require access to various tools to interact with external services (e.g., OBS, Twitch) and perform local computations or data retrievals.

This document defines the architecture for "Basic Tooling" — a subset of tools that are simple, stateless, and execute locally within the calling service's process.

## 2. Core Concepts

### 2.1 Tool Classification
- **Internal Tools:** Tools that provide information about the internal state of the service (e.g., `get_bot_status`, `list_available_tools`).
- **Basic Tools:** Tools that perform general-purpose local operations (e.g., `getCurrentTime`, `calculateMath`, `getRandomNumber`).
- **External Tools (MCP):** Tools provided by external Model Context Protocol (MCP) servers (e.g., `obs:setSourceVisibility`).

### 2.2 Local Execution
Basic tools are implemented as `BitBratTool` objects and registered in a local `ToolRegistry`. They do not require an external MCP server, minimizing latency and complexity for simple operations.

## 3. Implementation Guidelines

### 3.1 Location
Basic tools shall be located in a dedicated module within the service:
`src/services/<service-name>/tools/basic-tools.ts`

### 3.2 Structure
Each basic tool must implement the `BitBratTool` interface:
- **id:** Prefixed with `basic:` to distinguish from `internal:` and external tools (e.g., `basic:get_current_time`).
- **source:** Set to `'internal'`.
- **inputSchema:** A Zod schema defining the input parameters.
- **execute:** An asynchronous function implementing the tool logic.

### 3.3 Extensibility
Adding a new basic tool follows a simple pattern:
1. Define the tool in `basic-tools.ts`.
2. Export it via a creation function (e.g., `createGetCurrentTimeTool()`).
3. Register it in the `ToolRegistry` during service initialization.

## 4. Example: getCurrentTime Tool
- **ID:** `basic:get_current_time`
- **Description:** Returns the current ISO 8601 timestamp and timezone information.
- **Input:** None.
- **Output:** JSON object containing `iso`, `timestamp`, and `timezone`.

## 5. Future Considerations
As the platform grows, we may consider moving these basic tools into a shared library (`src/common/tools/basic/`) to allow multiple services to share common local tools without code duplication. For now, they will be managed within the `llm-bot` service.

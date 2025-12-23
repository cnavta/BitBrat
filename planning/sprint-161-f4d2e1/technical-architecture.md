# Technical Architecture: Web Search MCP Integration

## 1. Executive Summary
This document outlines the architectural plan for integrating web search capabilities into the BitBrat Platform by incorporating the `@guhcostan/web-search-mcp` Model Context Protocol (MCP) server. This tool will enable the BitBrat `llm-bot` to perform real-time searches and fetch web content, significantly expanding its knowledge base beyond its training data.

## 2. Component: @guhcostan/web-search-mcp
The `@guhcostan/web-search-mcp` is a lightweight MCP server that provides:
- **Web Search**: Powered by DuckDuckGo (no API key required).
- **Content Retrieval**: Capability to fetch and parse the content of specific web pages.

### Rationale
- **Ease of Deployment**: Being a Node.js package, it fits naturally into BitBrat's existing infrastructure.
- **Cost Effective**: DuckDuckGo search is free and does not require managing additional API quotas or secrets.
- **Verification**: It serves as an ideal first external MCP tool to verify our `McpClientManager` and `McpBridge` implementations in a production-like environment.

## 3. Integration Architecture

### 3.1 Dependency Management
The package will be added to the project's root `package.json`.
```bash
npm install @guhcostan/web-search-mcp
```
This ensures the package is bundled into the Docker images for the `llm-bot` service.

### 3.2 Service Configuration
The `llm-bot` service will be configured to start the MCP server via standard input/output (stdio). This is managed by the `McpClientManager`.

The configuration will be provided via the `LLM_BOT_MCP_SERVERS` environment variable as a JSON array:
```json
[
  {
    "name": "web-search",
    "command": "node",
    "args": ["./node_modules/@guhcostan/web-search-mcp/dist/index.js"]
  }
]
```
*Note: The exact path to the entry point will be verified after installation.*

### 3.3 Data Flow
1. **Startup**: `llm-bot` starts up and calls `mcpManager.initFromConfig()`.
2. **Spawn**: `McpClientManager` spawns the `web-search-mcp` process.
3. **Discovery**: `McpClientManager` queries the tools available from the server.
4. **Registration**: Tools are translated into `BitBratTool` objects (with names prefixed like `mcp_web_search`) and registered in the `ToolRegistry`.
5. **Execution**: During a conversation, if the LLM decides to use a search tool:
    - AI SDK calls the `execute` function on the `BitBratTool`.
    - `McpBridge` forwards the call to the MCP server via stdio.
    - Results are returned to the LLM.

## 4. Usage Patterns for BitBrat

### 4.1 "Web-Enhanced" Responses
The primary use case is allowing BitBrat to answer questions about:
- Recent news or events.
- Technical documentation or live data.
- Streamer-specific information that might have changed recently.

### 4.2 Best Practices for Tool Use
To ensure BitBrat uses the search tool effectively, we recommend the following:
- **Fact Verification**: Use the tool whenever a user asks a question that requires factual accuracy regarding recent events (post-2023).
- **Conciseness**: When the tool returns large amounts of text (e.g., from content retrieval), BitBrat should summarize the most relevant parts for the user rather than dumping the raw output.
- **Attribution**: BitBrat should ideally mention it found the information via a web search (e.g., "According to a quick search...").
- **Fallback**: If a search fails or returns no results, BitBrat should gracefully inform the user and use its internal knowledge while noting the limitation.

## 5. Security & Operational Considerations
- **Egress Connectivity**: The `llm-bot` service must have outbound internet access.
- **Resource Limits**: The search process should be monitored for CPU/Memory usage, though it is expected to be minimal.
- **Error Handling**: If the MCP server fails to start or crashes, `McpClientManager` should log the error and ensure the `llm-bot` continues to function with its remaining capabilities.

## 6. Implementation Steps
1. **Update `package.json`**: Add `@guhcostan/web-search-mcp`.
2. **Update `architecture.yaml`**: Document the new `LLM_BOT_MCP_SERVERS` environment variable (Completed).
3. **Verify Entry Point**: Confirm the correct path to the MCP server's executable.
4. **Configure Environment**: Update development and production environment variables.
5. **Validation**: Run local and integration tests to confirm tool registration and execution.

## 7. Future Considerations
- **Namespace Collisions**: As more MCP servers are added, we should evolve the `McpBridge` or `McpClientManager` to include the server name in the tool prefix (e.g., `mcp_web_search_search` instead of just `mcp_search`) to avoid collisions between tools with the same name on different servers.
- **RAG-based Tool Discovery**: As the number of tools grows, we will implement Phase 2 of the roadmap, using Firestore and vector search to dynamically register only the most relevant tools for each prompt.
- **Support for Resources & Prompts**: Future sprints will extend the bridge to support MCP Resources and Prompts, allowing the LLM to access structured data and pre-defined prompt templates from external servers.

## 8. Conclusion
The integration of `@guhcostan/web-search-mcp` is a significant step forward for BitBrat, providing it with the means to stay current and grounded in real-world information. The established architecture ensures this is done in a scalable, secure, and maintainable fashion.

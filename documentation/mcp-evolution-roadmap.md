# Model Context Protocol (MCP) Evolution Roadmap: BitBrat Platform

## 1. Executive Summary
Following the successful integration of the Vercel AI SDK and the establishment of the core `ToolRegistry` and `McpBridge` in Sprint 160, the BitBrat platform is positioned to transition from static tool registration to a dynamic, context-aware intelligence layer. This roadmap outlines the progression from simple tool connectivity to a RAG-based tool discovery system and self-administrative capabilities.

## 2. Current State (Post-Sprint 160)
- **Unified Interface**: Vercel AI SDK handles multi-model support and tool loops.
- **Protocol Bridge**: `McpBridge` translates MCP schemas to BitBrat/AI SDK tools.
- **Registry Abstraction**: `ToolRegistry` aggregates tools from local and pre-configured MCP sources.
- **Lifecycle Management**: `McpClientManager` handles the connection to external MCP servers via stdio.

## 3. Phase 2: Intelligent Tool Discovery (RAG)
**Objective**: Transition from "Register All" to "Discover as Needed" to support a large ecosystem of tools without degrading LLM performance or exceeding context windows.

### 3.1 Firestore Tool Registry
- **Schema Definition**: Formalize a Firestore schema for `BitBratTool` persistence, including JSON Schema, metadata, and category tags.
- **FirestoreToolProvider**: Implement a provider that fetches tool definitions from Firestore collections.
- **Embedding Layer**: Integrate a mechanism to generate vector embeddings for tool descriptions.

### 3.2 Semantic Tool Selection
- **Contextual Search**: For every incoming `llm-bot` event, embed the user prompt and perform a similarity search (using Firestore Vector Search) for relevant tools.
- **Dynamic Registration**: Only the top-scoring N tools are registered for the current LLM turn, keeping the prompt lean and focused.

## 4. Phase 3: Self-Administrative Capabilities
**Objective**: Empower the AI to manage its own configuration, personality, and capabilities through specialized administrative tools.

### 4.1 "BitBrat for BitBrat" Tools
Implement a suite of internal tools accessible to the `llm-bot`:
- `manage_personality`: Create, update, or archive personality documents in Firestore.
- `update_platform_rules`: Modify global instructions and behavioral constraints.
- `register_mcp_source`: Dynamically add new MCP server configurations to the platform.
- `deploy_command`: Convert a proven LLM chain/prompt into a new named command/tool.

### 4.2 Autonomous Optimization
- **Capability Gap Analysis**: Log events when a user intent cannot be satisfied by current tools, triggering a background "search and recommend" process.
- **Rule Evolution**: Allow the bot to suggest updates to its own `architecture.yaml` or system prompts based on interaction patterns.

## 5. Phase 4: Expansion & Ecosystem
- **Multi-Model Verification**: Rigorous testing of tool-calling performance across OpenAI, Anthropic, and Google models using the AI SDK.
- **Tool Permissions (RBAC)**: Fine-grained access control for tool execution based on user roles (Moderator, Subscriber, VIP).
- **Public MCP Gallery**: A shared repository of MCP server configurations that streamers can install with a single command.

## 6. Proposed Next Sprint: "The Firestore Bridge" (Sprint 161)
1. **Tool Persistence**: Create Firestore collections for `tools` and `mcp_servers`.
2. **Dynamic Provider**: Implement `FirestoreToolProvider` and integrate it into `ToolRegistry`.
3. **Admin Tools**: Implement `register_tool` and `update_personality` as MCP tools.
4. **Refactor**: Update `llm-bot` startup to initialize both local and Firestore-based tools.

## 7. Technical Considerations
- **Security**: Strict validation of MCP server sources to prevent prompt injection or unauthorized code execution.
- **Latency**: Optimize RAG search to ensure tool discovery does not significantly delay bot responses.
- **Observability**: Track tool selection accuracy and execution success rates in Cloud Logging.

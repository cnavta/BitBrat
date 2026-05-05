# Architecture Brief: Advanced Tool Selection and Filtering

## 1. Problem Statement
As the BitBrat platform expands its Model Context Protocol (MCP) capabilities, the number of available tools is increasing. Presenting a massive, flat list of tools to an LLM leads to:
- **Performance Degradation**: Increased context window usage and latency.
- **Hallucinations**: The LLM selecting tools that are irrelevant to the current context.
- **Security Risks**: Greater surface area for prompt injection to trigger unauthorized tool calls.
- **Cost**: Higher token counts per turn.

The "Story Engine" use case highlights a specific need: when a user is in an active adventure, only story-related tools should be prioritized or allowed.

## 2. Proposed Options

### Option A: Metadata-Driven Contextual Filtering (Immediate)
Leverage existing `InternalEventV2` annotations and routing slips to define "Tool Scopes."

*   **Mechanism**: 
    - Tools are tagged with `scopes` (e.g., `story`, `social`, `admin`).
    - The `event-router` or an enrichment service (like `story-engine-mcp`) injects a `required_tool_scope` annotation into the event.
    - `llm-bot` filters the tool list provided to the LLM based on this annotation.
*   **Pros**: Highly deterministic, low latency, uses existing event structure.
*   **Cons**: Requires manual tagging of all tools and explicit logic to determine the current scope.

### Option B: Semantic Vector Selection (Evolutionary)
Use embeddings to select the most relevant tools for a given user query.

*   **Mechanism**:
    - `tool-gateway` or a new `Discovery Service` maintains an embedding index of tool descriptions.
    - When a query arrives, the system performs a vector search to find the Top-K most relevant tools.
    - These tools are then injected into the LLM context.
*   **Pros**: Highly scalable for hundreds of tools, handles fuzzy intent well.
*   **Cons**: Introduces embedding latency, non-deterministic, potential for missing "required" tools (like `get_bot_status`) if the query doesn't match semantically.

### Option C: State-Aware Dynamic Catalogs
The `tool-gateway` serves different tool manifests based on the session's state.

*   **Mechanism**:
    - `llm-bot` passes session metadata (e.g., `active_story_id`, `current_location`) to `tool-gateway` during discovery.
    - `tool-gateway` applies logic to prune the returned tool list (e.g., "If `active_story` exists, include `story-engine` tools and exclude `image-gen` unless requested").
*   **Pros**: Centralizes filtering logic in the gateway, reduces `llm-bot` complexity.
*   **Cons**: Tight coupling between gateway and application state.

## 3. Recommended Path: Hybrid Tiered Selection

I recommend a tiered approach that combines the strengths of the above options:

1.  **Tier 1: Hard RBAC & Policy (Existing)**: 
    - Keep current role-based access and behavioral risk filtering.
2.  **Tier 2: Explicit Contextual Scoping (P0)**:
    - Implement Option A. Use the `adventure` routing step to trigger a `story` tool scope. 
    - Modify `llm-bot`'s `evaluateBehavioralToolEligibility` to also check for `scope` alignment.
3.  **Tier 3: Semantic Fallback (P1)**:
    - For general chat (no explicit scope), use Vector Similarity (Option B) to limit the tool list to ~5-10 tools plus a "Global Always-On" set (e.g., identity tools).

## 4. Implementation Steps
1.  **Tagging**: Add `tags: string[]` to the `BitBratTool` type and existing tool definitions.
2.  **Enrichment**: Update `story-engine-mcp` to add a `tool_scope: story` annotation when an active story is detected.
3.  **Filtering**: Update `src/services/llm-bot/processor.ts` to implement scope-based filtering.
4.  **Vector Store (Future)**: Integrate an embedding service (e.g., Vertex AI or OpenAI Embeddings) into `tool-gateway`.

---
**Status**: Draft for Architect Review
**Author**: AI Architect
**Date**: 2026-05-01

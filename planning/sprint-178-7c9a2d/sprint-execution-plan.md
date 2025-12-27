# Sprint Execution Plan – sprint-178-7c9a2d

## Overview
This plan outlines the execution strategy for implementing the `McpServer` subclass of `BaseServer`. The goal is to provide a standardized way for BitBrat microservices to expose MCP capabilities via SSE.

## Track 1: Core Framework Implementation
**Owner**: Lead Implementor
**Tasks**: BL-178-001, BL-178-002, BL-178-005
- **Goal**: Establish the base class and connectivity.
- **Key Deliverables**:
    - `src/common/mcp-server.ts`: Class skeleton extending `BaseServer`.
    - SSE Session Management: A robust `Map` to track `SSEServerTransport` instances.
    - Route Registration: `/sse` and `/message` automatically wired into Express.
    - Security Middleware: Auth token validation for MCP endpoints.

## Track 2: Developer Experience & API
**Owner**: Lead Implementor
**Tasks**: BL-178-003, BL-178-004
- **Goal**: Provide high-level, type-safe APIs for service developers.
- **Key Deliverables**:
    - `registerTool`: Wrapper around MCP tool registration with Zod schema inference.
    - `registerResource`: Helper for exposing static/dynamic resources.
    - `registerPrompt`: Helper for exposing system prompts.

## Track 3: Quality, Observability & Docs
**Owner**: Quality Lead / Lead Implementor
**Tasks**: BL-178-006, BL-178-007, BL-178-008
- **Goal**: Ensure the implementation is robust, observable, and documented.
- **Key Deliverables**:
    - Unit Tests: `tests/common/mcp-server.spec.ts` covering all lifecycle events.
    - Tracing: OpenTelemetry integration for tool execution.
    - Documentation: Usage guide and example service in `documentation/mcp-server.md`.

## Execution Timeline
1. **Day 1**: Finalize Core Framework (Track 1).
2. **Day 2**: Implement Developer APIs (Track 2).
3. **Day 3**: Security, Observability, and Unit Tests (Track 3).
4. **Day 4**: Documentation and PR Creation.

## Risk Assessment
- **SSE Stability**: Cloud Run's short-lived connections might affect SSE. We must ensure the client (llm-bot) handles reconnections gracefully.
- **Dependency Conflicts**: Ensure compatibility between `@modelcontextprotocol/sdk` and existing `BaseServer` dependencies (Express 5.x).

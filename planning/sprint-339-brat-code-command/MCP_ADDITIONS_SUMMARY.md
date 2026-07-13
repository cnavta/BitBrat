# MCP Auto-Configuration Additions to Sprint 339

## Summary

This document summarizes the MCP auto-configuration enhancements added to Sprint 339 planning documents.

## New Backlog Items (To be added to backlog.yaml)

### Phase 1 MCP Tasks (P0)

**BL-339-060: Implement MCP environment detector**
- Priority: P0
- Effort: L
- Deps: BL-339-005
- Description: Detect running BitBrat services (Docker, tool-gateway) and verify MCP connectivity
- Deliverables:
  - tools/brat/src/cli/code/mcp/environment-detector.ts
  - Detects docker compose services
  - Reads architecture.yaml for tool-gateway port
  - Health check verification
  - Tool discovery via fleet API

**BL-339-061: Implement MCP stdio proxy for Claude Code**
- Priority: P0
- Effort: XL
- Deps: BL-339-060
- Description: Create stdio-to-HTTP proxy for Claude Code MCP integration
- Deliverables:
  - tools/brat/src/mcp-proxy.ts
  - Accepts MCP stdio protocol from Claude Code
  - Translates to HTTP requests to tool-gateway
  - Returns responses in MCP stdio format
  - Handles authentication

**BL-339-062: Implement MCP auth token management**
- Priority: P0
- Effort: S
- Deps: BL-339-060
- Description: Manage MCP authentication tokens
- Deliverables:
  - tools/brat/src/cli/code/mcp/auth-manager.ts
  - Read MCP_AUTH_TOKEN from environment
  - Default to 'local-dev-token' for local development
  - Token validation

**BL-339-063: Implement MCP tool discovery**
- Priority: P0
- Effort: M
- Deps: BL-339-060
- Description: Discover available MCP tools via fleet API
- Deliverables:
  - tools/brat/src/cli/code/mcp/tool-discovery.ts
  - Call /mcp/tools/list endpoint
  - Parse and enumerate available tools
  - Cache results for performance

### Phase 2 MCP Tasks (P0)

**BL-339-064: Implement MCP config generator for Claude Code**
- Priority: P0
- Effort: M
- Deps: BL-339-061, BL-339-013
- Description: Generate mcpServers block in Claude Code config.json
- Deliverables:
  - tools/brat/src/cli/code/mcp/config-generator.ts
  - Generate mcpServers config block
  - Configure proxy command and args
  - Set environment variables (TOOL_GATEWAY_URL, MCP_AUTH_TOKEN)
  - Integrate with Claude Code plugin

**BL-339-065: Update project context extractor for MCP**
- Priority: P0
- Effort: S
- Deps: BL-339-005, BL-339-060
- Description: Integrate MCP environment detection into project context
- Deliverables:
  - Modification to project-context.ts
  - Add mcp?: McpEnvironment to ProjectContext interface
  - Call detectMcpEnvironment() during context loading
  - Include MCP info in context object

**BL-339-066: Update Claude Code plugin for MCP**
- Priority: P0
- Effort: M
- Deps: BL-339-014, BL-339-064
- Description: Integrate MCP configuration into Claude Code plugin
- Deliverables:
  - Modification to claude-code-plugin.ts
  - Call MCP config generator when MCP available
  - Add mcpServers block to config.json
  - Skip MCP if not available (graceful degradation)

**BL-339-067: Write unit tests for MCP components**
- Priority: P0
- Effort: L
- Deps: BL-339-060, BL-339-061, BL-339-062, BL-339-063, BL-339-064
- Description: Comprehensive unit tests for all MCP modules
- Deliverables:
  - tools/brat/src/cli/code/mcp/environment-detector.test.ts
  - tools/brat/src/mcp-proxy.test.ts
  - tools/brat/src/cli/code/mcp/auth-manager.test.ts
  - tools/brat/src/cli/code/mcp/tool-discovery.test.ts
  - tools/brat/src/cli/code/mcp/config-generator.test.ts
  - Coverage >= 80%

**BL-339-068: Integration test: MCP with Claude Code**
- Priority: P0
- Effort: M
- Deps: BL-339-067
- Description: End-to-end integration test of MCP + Claude Code
- Deliverables:
  - Test: `brat code --agent=claude-code --dry-run` with Docker running
  - Verifies: MCP environment detected
  - Verifies: mcpServers block generated in config
  - Verifies: Proxy configured correctly
  - Test: Tools accessible from Claude Code session (manual)

**BL-339-069: Documentation for MCP integration**
- Priority: P0
- Effort: M
- Deps: BL-339-068
- Description: Document MCP auto-configuration for users and developers
- Deliverables:
  - Update documentation/guides/coding-agents.md with MCP section
  - Document available BitBrat tools
  - Document how to use bit.* control plane from agent
  - Document troubleshooting (MCP not detected, connection failed)
  - Add examples of using fleet tools in coding sessions

## Updated Technical Architecture

### Key Changes:
1. Added "MCP-enabled" to Design Goals
2. Updated Problem Statement to include MCP configuration friction
3. Added MCP Environment Detection step to high-level flow
4. Added MCP Auto-Configuration step to high-level flow
5. Added mcp/ directory to component architecture with 4 new modules
6. Added McpEnvironment interface to type definitions
7. Updated ProjectContext to include mcp?: McpEnvironment field
8. Updated Context Injection Strategies table with MCP column
9. Added new section 4.3: MCP Environment Detection Algorithm
10. Updated Claude Code config template (section 4.5) to include mcpServers block
11. Added MCP Proxy Bridge explanation

### New Components:
- `tools/brat/src/cli/code/mcp/environment-detector.ts`
- `tools/brat/src/cli/code/mcp/tool-discovery.ts`
- `tools/brat/src/cli/code/mcp/config-generator.ts`
- `tools/brat/src/cli/code/mcp/auth-manager.ts`
- `tools/brat/src/mcp-proxy.ts` (MCP stdio-to-HTTP proxy)

## Updated Execution Plan

### Scope Changes:
- Phase 1 now includes:
  - MCP environment detection
  - MCP stdio proxy
- Phase 2 now includes:
  - MCP auto-configuration for Claude Code
  - MCP tool discovery
  - MCP authentication

### Week-by-Week Updates:
- Week 1 Days 1-2: Add BL-339-060, BL-339-061, BL-339-062, BL-339-063
- Week 1 Days 3-4: Add BL-339-064, BL-339-065, BL-339-066, BL-339-067, BL-339-068, BL-339-069

## Total New Tasks

- **10 new backlog items** (BL-339-060 through BL-339-069)
- **All P0 priority** (critical for MVP)
- **Estimated total effort:** ~6-8 days (includes proxy implementation)

## Implementation Priority

1. **BL-339-060** (Environment Detector) - Foundation for MCP detection
2. **BL-339-062** (Auth Manager) - Simple, no dependencies beyond BL-339-060
3. **BL-339-063** (Tool Discovery) - Depends on BL-339-060
4. **BL-339-061** (Stdio Proxy) - Most complex, can be done in parallel with 62/63
5. **BL-339-065** (Update ProjectContext) - Quick integration task
6. **BL-339-064** (Config Generator) - After proxy is ready
7. **BL-339-066** (Update Claude Code Plugin) - Final integration
8. **BL-339-067** (Unit Tests) - Throughout implementation
9. **BL-339-068** (Integration Test) - After all components ready
10. **BL-339-069** (Documentation) - Final step

## Success Criteria

- ✅ Agent launches with MCP tools when Docker services running
- ✅ Agent launches without MCP when Docker not running (graceful degradation)
- ✅ `bit.*` control plane tools accessible from coding agent
- ✅ Domain tools from all Bits accessible via tool-gateway
- ✅ MCP connection failures handled gracefully with clear error messages
- ✅ MCP configuration completely transparent to user (zero-config)

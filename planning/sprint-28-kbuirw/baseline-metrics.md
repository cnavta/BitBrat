# Baseline Metrics - MCP SDK v1.x

**Sprint**: sprint-28-kbuirw
**Date**: 2026-08-29
**Purpose**: Performance baseline before MCP SDK 2.0 migration

---

## Build Metrics

### TypeScript Compilation
- **Command**: `npm run build`
- **Status**: ❌ Failed (expected after codemod)
- **Errors**: 46 TypeScript errors (import, type, schema issues)
- **Note**: Will measure after Phase 2 fixes

### Docker Image Size
- **Base Image**: `node:24-bookworm-slim`
- **Status**: ✅ Measured
- **Note**: Will compare after migration

---

## Test Suite Metrics

### Unit Tests
- **Command**: `npm test`
- **Status**: ⏸️ Deferred (build must pass first)
- **Baseline**: Will measure after Phase 2

### Integration Tests
- **Status**: ⏸️ Deferred
- **Baseline**: Will measure after Phase 4

---

## Runtime Metrics (Agent-Dev)

### Service Startup Time
- **Services**: 23 Bit services
- **Status**: ⏸️ Deferred until Phase 5 (agent-dev validation)
- **Measurement**: Time from container start to `/healthz` 200 OK

### Tool Invocation Latency
- **Test**: Simple tool call (bit.info)
- **Status**: ⏸️ Deferred until Phase 5
- **Target**: < 100ms (current baseline unknown)

### Memory Usage
- **Measurement**: RSS after 1 hour of idle
- **Status**: ⏸️ Deferred until Phase 5

---

## MCP SDK Version

### Current (v1.x)
```json
{
  "@modelcontextprotocol/sdk": "1.29.0"
}
```

### Target (v2.0)
```json
{
  "@modelcontextprotocol/server": "2.0.0",
  "@modelcontextprotocol/client": "2.0.0",
  "@modelcontextprotocol/express": "2.0.0",
  "@modelcontextprotocol/node": "2.0.0",
  "@modelcontextprotocol/core": "2.0.0" (transitive),
  "zod": "4.5.2"
}
```

---

## Node.js Version

### Development
- **Local**: v24.11.0 ✅
- **Requirement**: >= 22.19.0 ✅

### Docker
- **Base Image**: node:24-bookworm-slim ✅
- **Effective**: v24.x (>= 22.19.0) ✅

---

## Codemod Impact

### Files Changed
- **Total**: 26 files
- **Changes**: 87 modifications

### Categories
- **Imports**: Package paths updated (`@modelcontextprotocol/sdk` → split packages)
- **Server**: Server → McpServer
- **Client**: Client → McpClient
- **Schemas**: Type imports from @modelcontextprotocol/core

### Manual Fixes Required
- **Error Markers**: 6 locations (`@mcp-codemod-error` comments)
- **Warnings**: 6 warnings (context property shape changes)
- **Info**: 5 info messages (import location suggestions)

---

## Expected Improvements (from architecture doc)

### Performance
- **Latency**: -20% (no session validation)
- **Throughput**: +50% (no session bottleneck)
- **Memory**: -30% (no session maps)

### Code Quality
- **Lines Removed**: ~150 (session management)
- **Complexity**: Reduced (stateless pattern)

---

## Post-Migration Comparison

**To be filled in Phase 5 (Agent-Dev Validation)**:
- [ ] Build time comparison
- [ ] Test suite time comparison
- [ ] Docker image size comparison
- [ ] Service startup time comparison
- [ ] Tool invocation latency comparison
- [ ] Memory usage comparison

---

**Document Version**: 1.0
**Last Updated**: 2026-08-29
**Status**: Baseline documented, awaiting post-migration comparison

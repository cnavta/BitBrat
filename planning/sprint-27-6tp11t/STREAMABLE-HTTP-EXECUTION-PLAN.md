# Execution Plan: SSE → StreamableHTTP Transport Migration

**Sprint**: 27
**Date**: 2026-08-28
**Lead Implementor**: Claude Code
**Status**: APPROVED - Ready for Execution

---

## Objective

Migrate BitBrat MCP communication layer from deprecated `SSEClientTransport` to `StreamableHTTPClientTransport` to resolve critical timeout issue blocking all cross-service MCP tool invocations.

**Success Criteria**:
- ✅ All MCP tool calls complete within 5 seconds (down from 60s timeout)
- ✅ Zero regressions in existing MCP functionality
- ✅ All services successfully communicate via StreamableHTTP transport
- ✅ Rollback capability verified and functional

---

## Prerequisites

### Required Tools & Access
- [x] Local development environment with Docker
- [x] Access to staging environment (bitbrat.lan)
- [x] Agent-dev context provisioning capability
- [x] Repository write access (sprint-27-6tp11t worktree)

### Knowledge Requirements
- [x] MCP SDK v1.25.1 API documentation
- [x] BaseServer architecture (src/common/base-server.ts)
- [x] McpClientManager implementation (src/common/mcp/client-manager.ts)
- [x] BitBrat testing patterns (Jest + agent-dev validation)

### Environment Setup
```bash
# Verify we're in the sprint worktree
pwd
# Expected: /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-27-6tp11t

# Ensure dependencies are current
npm install

# Build to verify clean baseline
npm run build

# Run existing tests to establish baseline
npm test -- src/common/base-server.test.ts
npm test -- src/common/mcp/client-manager.test.ts
```

---

## Phase 1: Server-Side Migration (Day 1)

### 1.1 Update BaseServer Transport Implementation

**File**: `src/common/base-server.ts`

**Changes**:
1. Add StreamableHTTPServerTransport import
2. Update setupMcpServer() method to use StreamableHTTP
3. Replace dual endpoints (/sse, /message) with single root endpoint (/)
4. Update session management to use header-based session IDs

**Steps**:
```typescript
// Step 1: Add import at top of file (after line 40)
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Step 2: Update setupMcpServer() method (around line 2126)
// Replace SSEServerTransport initialization with StreamableHTTPServerTransport

// Step 3: Update endpoint registration
// Change from:
//   - GET /sse (handshake)
//   - POST /message (receive)
// To:
//   - GET / (SSE stream)
//   - POST / (requests + optional SSE response)

// Step 4: Update session ID extraction
// Change from: req.query.sessionId
// To: req.headers['mcp-session-id']
```

**Testing Checkpoint**:
```bash
# Build and verify no TypeScript errors
npm run build

# Run unit tests
npm test -- src/common/base-server.test.ts

# Deploy to agent-dev for integration testing
mcp__bitbrat-dev__agent_dev_provision({ name: "agent-dev-sprint27-server" })
# Deploy a single service (utility) to test server-side changes
npm run brat -- bit deploy utility --context agent-dev-sprint27-server
```

**Validation**:
- [ ] TypeScript compilation succeeds
- [ ] Unit tests pass
- [ ] Service starts in agent-dev without errors
- [ ] MCP endpoint responds to GET requests
- [ ] Session initialization succeeds

**Rollback**: Revert changes to base-server.ts, redeploy

---

## Phase 2: Client-Side Migration (Days 2-3)

### 2.1 Update McpClientManager Transport Implementation

**File**: `src/common/mcp/client-manager.ts`

**Changes**:
1. Add StreamableHTTPClientTransport import
2. Update transport initialization logic
3. Update URL construction (remove /sse suffix)
4. Remove sessionId query parameter handling
5. Update error handling for new transport

**Steps**:
```typescript
// Step 1: Add import at top of file (after line 3)
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Step 2: Update transport initialization (around line 240-244)
// Replace:
//   transport = new SSEClientTransport(new URL(config.url), {...})
// With:
//   transport = new StreamableHTTPClientTransport(new URL(config.url), {...})

// Step 3: Update URL construction
// Change from: http://service:3020/sse
// To: http://service:3020/

// Step 4: Remove any sessionId query param logic
// StreamableHTTP uses headers instead

// Step 5: Update connection error handling
// StreamableHTTP may throw different error types
```

**Testing Checkpoint**:
```bash
# Build and verify no TypeScript errors
npm run build

# Run unit tests
npm test -- src/common/mcp/client-manager.test.ts

# Deploy to agent-dev for integration testing
# Deploy tool-gateway (client) to talk to utility (server)
npm run brat -- bit deploy tool-gateway --context agent-dev-sprint27-server
```

**Validation**:
- [ ] TypeScript compilation succeeds
- [ ] Unit tests pass
- [ ] Client connects to server successfully
- [ ] Tool discovery works (listTools())
- [ ] Tool invocation works (callTool())
- [ ] No timeout errors in logs

**Rollback**: Revert changes to client-manager.ts, redeploy

---

### 2.2 Update Integration Tests

**File**: Create `src/common/mcp/streamable-http-transport.integration.test.ts`

**Coverage**:
1. Server-side StreamableHTTP transport initialization
2. Client-side StreamableHTTP transport initialization
3. Full client-server communication cycle
4. Tool discovery (listTools)
5. Tool invocation (callTool)
6. Error handling and timeout scenarios
7. Session lifecycle (connect, disconnect, reconnect)

**Steps**:
```bash
# Create integration test file
touch src/common/mcp/streamable-http-transport.integration.test.ts

# Write tests covering:
# - Transport initialization
# - Client-server handshake
# - Tool listing
# - Tool execution
# - Error scenarios
# - Session management

# Run tests
npm test -- src/common/mcp/streamable-http-transport.integration.test.ts
```

**Validation**:
- [ ] All integration tests pass
- [ ] Code coverage meets threshold (>80%)
- [ ] No test flakiness (run 3x)

---

## Phase 3: Configuration Updates (Day 4)

### 3.1 Update Architecture Configuration

**File**: `architecture.yaml`

**Changes**:
1. Update MCP endpoint URLs for all services
2. Remove /sse suffix from URLs
3. Add feature flag for gradual rollout (optional)

**Steps**:
```yaml
# Update services with MCP servers (utility, scheduler, etc.)
# Change from:
services:
  utility:
    mcp:
      endpoint: http://utility.bitbrat.local:3020/sse

# To:
services:
  utility:
    mcp:
      endpoint: http://utility.bitbrat.local:3020/
```

**Testing Checkpoint**:
```bash
# Validate architecture.yaml syntax
npm run brat -- config validate

# Deploy updated config to agent-dev
npm run brat -- bit deploy --all --context agent-dev-sprint27-server

# Verify all services start successfully
npm run brat -- fleet list --context agent-dev-sprint27-server
npm run brat -- fleet info --all --context agent-dev-sprint27-server
```

**Validation**:
- [ ] YAML syntax valid
- [ ] All services deploy successfully
- [ ] No missing environment variables
- [ ] MCP endpoints resolve correctly

---

### 3.2 Update Environment Resolution

**File**: `src/common/environment-resolver.ts` (if needed)

**Changes**: Verify that environment variable resolution works correctly with updated endpoint URLs

**Steps**:
```bash
# Check if any hardcoded /sse references exist
grep -r "/sse" src/common/environment-resolver.ts

# Update if necessary
# No changes expected (URLs come from architecture.yaml)
```

---

## Phase 4: Testing & Validation (Days 4-5)

### 4.1 Agent-Dev Validation

**Objective**: Full stack testing in isolated environment

**Steps**:
```bash
# 1. Provision fresh agent-dev context
mcp__bitbrat-dev__agent_dev_provision({ name: "agent-dev-sprint27-full" })

# 2. Deploy entire stack
npm run brat -- bit deploy --all --context agent-dev-sprint27-full

# 3. Verify all services healthy
npm run brat -- fleet list --context agent-dev-sprint27-full
npm run brat -- fleet info --all --context agent-dev-sprint27-full

# 4. Test MCP tool discovery
# From tool-gateway, verify it can discover utility tools
npm run brat -- fleet logs tool-gateway --context agent-dev-sprint27-full | grep "mcp.client.tools_listed"

# 5. Test MCP tool invocation
# Use test harness to invoke mcp_counter_increment
# Expected: Response within 5 seconds (not 60s timeout)
curl -X POST http://localhost:3000/v1/tools/mcp_counter_increment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \
  -d '{"testId":"sprint27-validation"}' \
  -m 10

# 6. Check for errors in all service logs
npm run brat -- fleet logs --all --context agent-dev-sprint27-full | grep -i error
```

**Validation Checklist**:
- [ ] All services start without errors
- [ ] MCP handshake succeeds (check logs for "mcp_server.transport.connected")
- [ ] Tool discovery completes successfully
- [ ] Tool invocation returns response within 5 seconds
- [ ] No timeout errors in logs
- [ ] No "session not found" errors
- [ ] No transport-related errors

---

### 4.2 Staging Environment Testing

**Objective**: Validate in production-like environment

**Prerequisites**:
- [ ] Agent-dev validation passed
- [ ] Code review completed
- [ ] Unit tests passing
- [ ] Integration tests passing

**Steps**:
```bash
# 1. Deploy to staging
npm run brat -- bit deploy --all --context staging

# 2. Monitor deployment
ssh root@bitbrat.lan "docker ps | grep bitbrat-staging"

# 3. Test from staging tool-gateway
ssh root@bitbrat.lan "docker exec bitbrat-staging-tool-gateway-1 curl -X POST http://localhost:3000/v1/tools/mcp_counter_increment -H 'Content-Type: application/json' -H 'Authorization: Bearer \${MCP_AUTH_TOKEN}' -d '{\"testId\":\"staging-test\"}' -m 10"

# 4. Monitor logs for errors
mcp__bitbrat-dev__fleet_logs({ context: "staging", limit: 100 })

# 5. Test reflex counter operations (original failing use case)
ssh root@bitbrat.lan "docker exec bitbrat-staging-reflex-1 curl -X POST http://tool-gateway:3000/v1/tools/mcp_counter_increment -H 'Content-Type: application/json' -H 'Authorization: Bearer \${MCP_AUTH_TOKEN}' -d '{\"testId\":\"reflex-test\"}' -m 10"
```

**Validation Checklist**:
- [ ] Deployment succeeds on all services
- [ ] No errors during startup
- [ ] MCP connections established successfully
- [ ] Tool calls complete within 5 seconds
- [ ] Reflex counter operations work
- [ ] No performance degradation
- [ ] Memory usage stable

---

### 4.3 Performance Testing

**Objective**: Verify no performance regressions

**Metrics to Capture**:
1. MCP handshake latency
2. Tool discovery latency
3. Tool invocation latency
4. Memory usage (client + server)
5. Connection count/stability

**Steps**:
```bash
# Run performance test suite
npm test -- src/common/mcp/performance.test.ts

# Capture baseline metrics
# - Before: SSE transport (if rollback data available)
# - After: StreamableHTTP transport

# Compare:
# - Connection latency (should be similar)
# - Tool call latency (should be <5s, down from 60s timeout)
# - Memory usage (should be similar or lower)
```

**Acceptance Criteria**:
- [ ] Tool call latency: <5 seconds (target: <2 seconds)
- [ ] Memory usage: Within 10% of baseline
- [ ] Connection stability: >99% uptime during 1-hour test
- [ ] No memory leaks detected

---

## Phase 5: Rollback Verification (Day 5)

### 5.1 Implement Feature Flag

**File**: `src/common/mcp/client-manager.ts`

**Changes**: Add feature flag to toggle between SSE and StreamableHTTP

**Steps**:
```typescript
// Add feature flag check
const useStreamableHTTP = process.env.ENABLE_STREAMABLE_HTTP_TRANSPORT !== 'false';

if (config.transport === 'sse') {
  if (useStreamableHTTP) {
    // Use StreamableHTTPClientTransport (new)
    transport = new StreamableHTTPClientTransport(new URL(config.url), {...});
  } else {
    // Use SSEClientTransport (deprecated fallback)
    transport = new SSEClientTransport(new URL(config.url), {...});
  }
}
```

**Testing**:
```bash
# Test with feature flag disabled (rollback scenario)
ENABLE_STREAMABLE_HTTP_TRANSPORT=false npm run brat -- bit deploy tool-gateway --context agent-dev-sprint27-full

# Verify service starts (may have timeout issues, that's expected)
npm run brat -- fleet info tool-gateway --context agent-dev-sprint27-full

# Test with feature flag enabled (normal operation)
ENABLE_STREAMABLE_HTTP_TRANSPORT=true npm run brat -- bit deploy tool-gateway --context agent-dev-sprint27-full

# Verify MCP works correctly
npm run brat -- fleet logs tool-gateway --context agent-dev-sprint27-full
```

**Validation**:
- [ ] Feature flag toggles transport successfully
- [ ] No errors when disabling flag
- [ ] Services restart cleanly after flag toggle

---

### 5.2 Document Rollback Procedure

**File**: `planning/sprint-27-6tp11t/ROLLBACK-PROCEDURE.md`

**Content**:
```markdown
# Rollback Procedure: StreamableHTTP → SSE Transport

## Quick Rollback (Emergency)

If critical issues arise after deployment:

1. Set feature flag: `ENABLE_STREAMABLE_HTTP_TRANSPORT=false`
2. Redeploy affected services: `brat bit deploy --all`
3. Verify services recover

## Full Rollback (Code Revert)

If feature flag insufficient:

1. Revert commits from sprint-27-6tp11t branch
2. Redeploy all services
3. Verify MCP connectivity (may have original timeout issue)

## Rollback Verification

- [ ] Services start successfully
- [ ] MCP handshake completes
- [ ] Tool discovery works
- [ ] No new errors introduced
```

---

## Risk Mitigation

### High-Risk Areas

1. **Session Management Changes**
   - **Risk**: Session IDs from query params → headers may break existing clients
   - **Mitigation**: Feature flag allows instant rollback
   - **Validation**: Integration tests cover both transports

2. **Endpoint URL Changes**
   - **Risk**: Hardcoded /sse references may break
   - **Mitigation**: Grep entire codebase for "/sse" before deployment
   - **Validation**: Agent-dev full stack testing

3. **Breaking Changes in SDK**
   - **Risk**: StreamableHTTP API differences from SSE
   - **Mitigation**: Thorough SDK documentation review
   - **Validation**: Unit + integration tests

4. **Transport Error Handling**
   - **Risk**: Different error types/messages from new transport
   - **Mitigation**: Update error handling to cover new cases
   - **Validation**: Error scenario testing

### Mitigation Checklist

Before each deployment:
- [ ] Feature flag implemented and tested
- [ ] Rollback procedure documented and rehearsed
- [ ] Monitoring/alerting configured for new transport
- [ ] Backup of current stable state available
- [ ] All tests passing (unit + integration + E2E)

---

## Success Metrics

### Functional Metrics
- ✅ MCP tool calls complete successfully (0% timeout rate)
- ✅ Tool call latency: <5 seconds (target: <2 seconds)
- ✅ Zero MCP connection errors in logs
- ✅ All services communicate via StreamableHTTP

### Quality Metrics
- ✅ Code coverage: >80% for new/modified code
- ✅ Zero regressions in existing functionality
- ✅ All CI/CD tests passing
- ✅ Documentation complete and accurate

### Operational Metrics
- ✅ Deployment success rate: 100%
- ✅ Rollback capability verified: <5 minutes to rollback
- ✅ Zero production incidents
- ✅ Service uptime: >99.9%

---

## Timeline

| Phase | Duration | Start | End | Status |
|-------|----------|-------|-----|--------|
| Phase 1: Server Migration | 1 day | Day 1 | Day 1 | Pending |
| Phase 2: Client Migration | 1.5 days | Day 2 | Day 3 | Pending |
| Phase 3: Configuration | 0.5 days | Day 4 | Day 4 | Pending |
| Phase 4: Testing | 1.5 days | Day 4 | Day 5 | Pending |
| Phase 5: Rollback Verification | 0.5 days | Day 5 | Day 5 | Pending |
| **Total** | **5 days** | **Day 1** | **Day 5** | **Pending** |

---

## Checkpoints & Approvals

### Phase 1 Checkpoint
- [ ] Server-side migration complete
- [ ] Unit tests passing
- [ ] Agent-dev deployment successful
- **Approver**: Lead Implementor
- **Date**: _______

### Phase 2 Checkpoint
- [ ] Client-side migration complete
- [ ] Integration tests passing
- [ ] Full stack communication verified
- **Approver**: Lead Implementor
- **Date**: _______

### Phase 3 Checkpoint
- [ ] Configuration updated
- [ ] All services deployed successfully
- [ ] No configuration errors
- **Approver**: Lead Implementor
- **Date**: _______

### Phase 4 Checkpoint
- [ ] Agent-dev validation complete
- [ ] Staging validation complete
- [ ] Performance tests passing
- **Approver**: Lead Implementor
- **Date**: _______

### Final Approval
- [ ] All phases complete
- [ ] All success metrics met
- [ ] Rollback verified
- [ ] Documentation complete
- **Approver**: Sprint Owner
- **Date**: _______

---

## Post-Implementation

### Monitoring

After deployment, monitor for 48 hours:

```bash
# Monitor MCP-related logs
mcp__bitbrat-dev__fleet_logs({
  context: "staging",
  since: "1h",
  limit: 1000
}) | grep -E "(mcp|transport|session)"

# Monitor error rates
mcp__bitbrat-dev__fleet_logs({
  context: "staging",
  level: ["error"],
  since: "1h"
})

# Monitor tool call latency
# Check for calls completing in <5s (no 60s timeouts)
```

### Documentation Updates

After successful deployment:
- [ ] Update MCP integration guide
- [ ] Update architecture.yaml comments
- [ ] Update troubleshooting guide
- [ ] Create migration retrospective

### Sprint Artifacts

Complete sprint documentation:
- [x] Technical Architecture (STREAMABLE-HTTP-MIGRATION-ARCHITECTURE.md)
- [x] Execution Plan (this document)
- [ ] Backlog (backlog.yaml)
- [ ] Implementation Log (implementation-log.md)
- [ ] Test Report (test-report.md)
- [ ] Verification Report (verification-report.md)
- [ ] Retrospective (retrospective.md)

---

## References

- **MCP SDK Documentation**: https://github.com/modelcontextprotocol/sdk
- **StreamableHTTP Transport**: node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js
- **Technical Architecture**: planning/sprint-27-6tp11t/STREAMABLE-HTTP-MIGRATION-ARCHITECTURE.md
- **Sprint Backlog**: planning/sprint-27-6tp11t/backlog.yaml
- **BitBrat MCP Guide**: documentation/guides/mcp-integration.md

---

**Document Version**: 1.0
**Last Updated**: 2026-08-28
**Next Review**: After Phase 1 completion

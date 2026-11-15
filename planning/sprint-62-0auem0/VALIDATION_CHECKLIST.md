# Sprint 62 Validation Checklist
**Date**: 2026-11-14
**Sprint ID**: sprint-62-0auem0
**Environment**: Staging
**Status**: In Progress

---

## Overview

This checklist validates that tool-orchestrator MCP aggregation is working correctly in staging. Each section corresponds to acceptance criteria from the backlog.

---

## Pre-Validation Setup

### Environment Information
- **Staging URL**: `http://tool-orchestrator:3000/mcp` (update with actual URL)
- **PostgreSQL**: Connected and populated with tool registry
- **Feature Flag**: `ENABLE_TOOL_ORCHESTRATOR` (currently: false)

### Required Access
- [ ] SSH access to staging environment
- [ ] Access to staging logs (Docker logs or log aggregation)
- [ ] PostgreSQL query access (for tool count validation)
- [ ] Ability to modify environment variables (for feature flag testing)

---

## Validation Steps

### 1. Service Health Check ⏳

**Objective**: Verify tool-orchestrator is running and healthy

**Commands**:
```bash
# Check service status
npm run brat -- fleet info tool-orchestrator --context staging --json

# Check service health
npm run brat -- fleet health tool-orchestrator --context staging
```

**Expected Results**:
- [ ] Service status: `running`
- [ ] Health check: `healthy`
- [ ] MCP endpoint accessible at `/mcp`

**Logs to Check**:
```bash
npm run brat -- fleet logs tool-orchestrator --context staging --tail 50 | grep -E "(tool_orchestrator|mcp_server)"
```

**Success Criteria**:
- Service is running without errors
- No crash loops or restart events
- Health endpoint responds successfully

---

### 2. Tool Cache Loading ⏳

**Objective**: Verify tools loaded from PostgreSQL into cache

**Log Patterns to Find**:
```bash
# Look for tool loading log
npm run brat -- fleet logs tool-orchestrator --context staging | grep "tool_orchestrator.tools_loaded"

# Should show:
# {
#   "level": "info",
#   "msg": "tool_orchestrator.tools_loaded",
#   "count": <number>,
#   "sources": ["mcp", "internal", "composition", ...]
# }
```

**Expected Results**:
- [ ] Log entry `tool_orchestrator.tools_loaded` present
- [ ] Tool count > 20 (indicates aggregation, not just admin tools)
- [ ] Multiple sources listed (mcp, internal, composition)
- [ ] No error logs `tool_orchestrator.tools_load_failed`

**Validation**:
- [ ] Count matches expectation (compare to PostgreSQL query below)
- [ ] All expected sources present
- [ ] No warnings about missing ToolRegistry

---

### 3. MCP Server Initialization ⏳

**Objective**: Verify MCP server initialized with aggregated tools

**Log Patterns to Find**:
```bash
# Look for MCP server initialization
npm run brat -- fleet logs tool-orchestrator --context staging | grep "mcp_server.initialized_with_aggregation"

# Should show:
# {
#   "level": "info",
#   "msg": "mcp_server.initialized_with_aggregation",
#   "aggregatedTools": <number>
# }
```

**Expected Results**:
- [ ] Log entry `mcp_server.initialized_with_aggregation` present
- [ ] `aggregatedTools` count matches `tools_loaded` count
- [ ] No debug logs showing `ownTools` count only

**Success Criteria**:
- MCP server serves aggregated tools, not just direct tools
- Tool count confirms aggregation is working

---

### 4. Periodic Cache Refresh ⏳

**Objective**: Verify cache refreshes every 60 seconds

**Commands**:
```bash
# Monitor logs for periodic refresh
npm run brat -- fleet logs tool-orchestrator --context staging --follow | grep "tool_orchestrator.periodic_refresh"

# Wait 60+ seconds, should see repeated entries
```

**Expected Results**:
- [ ] `tool_orchestrator.tools_loaded` appears every ~60 seconds
- [ ] No `tool_orchestrator.periodic_refresh_failed` warnings
- [ ] Tool count remains consistent between refreshes

**Success Criteria**:
- Automatic refresh is working
- No failures in refresh cycle
- Cache stays synchronized

---

### 5. Integration Test Execution ⏳

**Objective**: Run 5 automated integration tests against staging

**Prerequisites**:
- Tool-orchestrator accessible from test machine
- Staging URL configured correctly

**Command**:
```bash
RUN_MCP_INTEGRATION_TESTS=true \
TEST_TOOL_ORCHESTRATOR_URL=http://<staging-url>:3000/mcp \
npm test tool-orchestrator-mcp-aggregation
```

**Expected Results**:
```
✓ should connect to tool-orchestrator via MCP (XXXms)
✓ should expose admin tools (bit.*, tool.*, model.*) (XXXms)
✓ should expose aggregated tools from PostgreSQL registry (XXXms)
  console.log
    tool-orchestrator exposed XX tools
✓ should serve MCP-compliant input schemas (no $schema, definitions, $defs) (XXXms)
  console.log
    Validated XX tools for MCP schema compliance
✓ should include tools from multiple sources (mcp, internal, composition) (XXXms)
  console.log
    Tools by prefix: { bit: X, tool: X, model: X, ... }

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

**Test-by-Test Validation**:

#### Test 1: Connection ⏳
- [ ] MCP client successfully connects
- [ ] No connection timeout or network errors
- [ ] Client object defined and ready

#### Test 2: Admin Tools ⏳
- [ ] `bit.info` present
- [ ] `bit.health` present
- [ ] `bit.config.get` present
- [ ] At least one `tool.*` tool present
- [ ] At least one `model.*` tool present

#### Test 3: Aggregation ⏳
- [ ] Tool count > 20 (confirms aggregation)
- [ ] Console output shows actual count
- [ ] Significantly more than just admin tools (18)

#### Test 4: Schema Compliance ⏳
- [ ] All tools have `inputSchema` defined
- [ ] No `$schema` field in any tool
- [ ] No `definitions` field in any tool
- [ ] No `$defs` field in any tool
- [ ] All schemas have `type: 'object'`
- [ ] Console shows validation count matches tool count

#### Test 5: Multi-Source ⏳
- [ ] At least 3 different tool prefixes detected
- [ ] Console shows prefix breakdown
- [ ] Tools from different sources (mcp, internal, composition) confirmed

**Success Criteria**:
- All 5 tests pass (5/5)
- No test timeouts or failures
- Output confirms aggregation is working

---

### 6. PostgreSQL Tool Count Validation ⏳

**Objective**: Verify MCP exposed count matches PostgreSQL registry

**PostgreSQL Query**:
```sql
-- Count active tools in registry
SELECT COUNT(*) as active_tool_count
FROM tool_registry.tools
WHERE status = 'active';

-- Get tool sources breakdown
SELECT source, COUNT(*) as count
FROM tool_registry.tools
WHERE status = 'active'
GROUP BY source
ORDER BY count DESC;
```

**Expected Results**:
- [ ] PostgreSQL count matches MCP exposed count (from integration test)
- [ ] Source breakdown matches log output
- [ ] No disabled/deprecated tools included in MCP response

**Comparison Table**:
| Source | PostgreSQL Count | MCP Exposed Count | Match? |
|--------|------------------|-------------------|--------|
| Total  | ???              | ???               | ⏳     |
| mcp    | ???              | ???               | ⏳     |
| internal | ???            | ???               | ⏳     |
| composition | ???         | ???               | ⏳     |

**Success Criteria**:
- Counts match exactly
- All active tools are exposed
- No stale or disabled tools served

---

### 7. Schema Compliance Validation ⏳

**Objective**: Verify no INVALID_RESULT errors in logs

**Commands**:
```bash
# Check tool-orchestrator logs for MCP errors
npm run brat -- fleet logs tool-orchestrator --context staging | grep -i "INVALID_RESULT"

# Should return no results (empty output = success)

# Check for any MCP protocol errors
npm run brat -- fleet logs tool-orchestrator --context staging | grep -i "protocol.*error"
```

**Expected Results**:
- [ ] No `INVALID_RESULT` errors in logs
- [ ] No MCP protocol validation errors
- [ ] No schema-related warnings

**Success Criteria**:
- Clean logs with no MCP errors
- Schema cleaning is working correctly
- All tools are MCP-compliant

---

### 8. Feature Flag Cutover Testing ⏳

**Objective**: Verify `ENABLE_TOOL_ORCHESTRATOR` flag switches llm-bot connection

**Test Plan**:

#### Phase A: Baseline (tool-gateway)
```bash
# Ensure flag is disabled
ENABLE_TOOL_ORCHESTRATOR=false

# Restart llm-bot with flag disabled
npm run brat -- bit deploy llm-bot --context staging

# Check logs
npm run brat -- fleet logs llm-bot --context staging | grep "tool_provider_selected"

# Expected: "tool_provider_selected": "tool-gateway"
```

**Baseline Results**:
- [ ] llm-bot connects to `tool-gateway`
- [ ] Log shows `tool_provider_selected: tool-gateway`
- [ ] MCP client manager connects to gateway URL

#### Phase B: Cutover (tool-orchestrator)
```bash
# Enable flag
ENABLE_TOOL_ORCHESTRATOR=true

# Restart llm-bot with flag enabled
npm run brat -- bit deploy llm-bot --context staging

# Check logs
npm run brat -- fleet logs llm-bot --context staging | grep "tool_provider_selected"

# Expected: "tool_provider_selected": "tool-orchestrator"
```

**Cutover Results**:
- [ ] llm-bot connects to `tool-orchestrator`
- [ ] Log shows `tool_provider_selected: tool-orchestrator`
- [ ] MCP client manager connects to orchestrator URL
- [ ] Tool discovery works correctly
- [ ] No connection errors

#### Phase C: Tool Discovery Comparison
```bash
# Compare tool counts between gateway and orchestrator
npm run brat -- fleet logs llm-bot --context staging | grep "mcp.client_manager.tool_registered" | wc -l

# With tool-gateway: ~18-25 tools (gateway's own + upstream)
# With tool-orchestrator: Should be similar or more (PostgreSQL aggregation)
```

**Discovery Results**:
- [ ] Tool count with orchestrator >= tool count with gateway
- [ ] All expected tools discovered
- [ ] No missing tools compared to baseline

**Success Criteria**:
- Feature flag correctly switches connections
- Both configurations work without errors
- Tool discovery works in both modes

---

### 9. End-to-End Functionality Test ⏳

**Objective**: Verify tools can be executed through tool-orchestrator

**Test Steps**:
```bash
# Use llm-bot to execute a tool via tool-orchestrator
# (Requires ENABLE_TOOL_ORCHESTRATOR=true)

# Example: Execute bit.info tool
npm run brat -- chat --context staging
# User: "Use the bit.info tool to check tool-orchestrator status"

# Check logs for tool execution
npm run brat -- fleet logs tool-orchestrator --context staging | grep "tool:bit.info"
```

**Expected Results**:
- [ ] Tool execution request received
- [ ] ToolGateway.execute() called successfully
- [ ] Result returned to MCP client
- [ ] No execution errors

**Success Criteria**:
- Tools can be executed end-to-end
- Execution routing through ToolGateway works
- Results returned correctly to llm-bot

---

## Summary Checklist

### Core Functionality
- [ ] Service health check passed
- [ ] Tool cache loaded from PostgreSQL
- [ ] MCP server initialized with aggregation
- [ ] Periodic cache refresh working
- [ ] Integration tests passed (5/5)

### Data Validation
- [ ] PostgreSQL count matches MCP count
- [ ] No INVALID_RESULT errors in logs
- [ ] Schema compliance verified

### Feature Flag Testing
- [ ] Baseline mode (tool-gateway) works
- [ ] Cutover mode (tool-orchestrator) works
- [ ] Tool discovery works in both modes

### End-to-End Testing
- [ ] Tools executable through orchestrator
- [ ] Execution routing works correctly
- [ ] Results returned successfully

---

## Issues Tracker

| Issue # | Description | Severity | Status | Resolution |
|---------|-------------|----------|--------|------------|
| - | - | - | - | - |

---

## Validation Sign-Off

**Core Implementation**: ⏳ Pending
- All Phase 1 tasks verified
- All Phase 3 tasks verified
- Integration tests passing

**Deployment Validation**: ⏳ Pending
- Staging deployment verified
- Feature flag tested
- PostgreSQL validation complete

**Approval**: ⏳ Pending
- Technical validation complete
- Documentation updated
- Ready for production deployment

**Notes**:
[Add any observations, concerns, or recommendations here]

---

## References
- **Implementation Summary**: `planning/sprint-62-0auem0/IMPLEMENTATION_SUMMARY.md`
- **Progress Report**: `planning/sprint-62-0auem0/PROGRESS.md`
- **Backlog**: `planning/sprint-62-0auem0/backlog.yaml`
- **Integration Test**: `src/apps/__tests__/tool-orchestrator-mcp-aggregation.integration.test.ts`

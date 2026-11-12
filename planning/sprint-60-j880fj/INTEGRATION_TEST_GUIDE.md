# Integration Test Guide - Sprint 60
**Tool Execution Migration - Staging Validation**

## Overview

This guide provides instructions for running integration tests against the staging deployment of tool-orchestrator. The integration test suite validates all execution types (MCP, internal, composition) with RBAC, error handling, and performance verification.

---

## Prerequisites

### Environment Access
- Network access to `bitbrat.lan` (staging environment)
- MCP_AUTH_TOKEN from `.secure.staging/.env`
- PostgreSQL access (for verification queries)
- Loki access (for log validation)

### Services Required
- ✅ tool-orchestrator (deployed and healthy)
- ✅ llm-bot (deployed and healthy)
- ✅ ingress-egress (deployed and healthy)
- ✅ Message bus (NATS/PubSub operational)
- ✅ PostgreSQL (accessible)
- ✅ Loki (for log aggregation)

---

## Running Integration Tests

### Option 1: Automated Test Suite

```bash
# Set environment variables
export RUN_INTEGRATION_TESTS=true
export BITBRAT_CONTEXT=staging
export MCP_AUTH_TOKEN=$(grep MCP_AUTH_TOKEN .secure.staging/.env | cut -d= -f2)

# Run integration tests
npm test -- --testPathPattern="integration.test.ts"
```

**Expected Output:**
```
 PASS  src/apps/tool-orchestrator-service/__tests__/integration.test.ts
  ToolOrchestrator - Integration Tests
    Test 1: MCP Tool Execution Flow
      ✓ should execute MCP tool via llm-bot with full tracing (523 ms)
    Test 2: Composition Execution Flow
      ✓ should execute multi-step composition with RBAC validation (1245 ms)
    Test 3: RBAC Denial Flow
      ✓ should deny tool execution when user lacks required roles (156 ms)
      ✓ should deny composition when constituent tool is denied for model tier (234 ms)
    Test 4: Progress Update Flow
      ✓ should send progress updates during long-running operation (31245 ms)
    Test 5: Model Upgrade Flow
      ✓ should allow premium tools when model is upgraded (467 ms)
    Performance Validation
      ✓ should maintain P95 latency < 100ms under load (15234 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Time:        49.127 s
```

### Option 2: Manual Verification

If automated tests cannot connect, verify manually using fleet commands:

```bash
# Set auth token
export MCP_AUTH_TOKEN=$(grep MCP_AUTH_TOKEN .secure.staging/.env | cut -d= -f2)

# Check deployment status
npm run brat -- fleet list --context staging

# Get tool-orchestrator info
npm run brat -- fleet info tool-orchestrator --context staging

# Check health
npm run brat -- fleet health tool-orchestrator --context staging
```

---

## Test Scenarios

### Test 1: MCP Tool Execution ✅

**What it tests:**
- User message → llm-bot → tool-orchestrator → MCP server
- Tool execution with timeout enforcement
- Result transformation and error handling
- Event logging to Loki

**How to verify:**
1. Send test message via API or chat interface
2. Check Loki logs for execution flow:
   ```
   {service="tool-orchestrator"} |= "execute_mcp.start"
   ```
3. Verify tool result returned correctly
4. Check P95 latency < 100ms

**Expected logs:**
```
tool_gateway.execute_mcp.start
tool_gateway.execute_mcp.success
tool_invocation_event (logged to Loki)
```

---

### Test 2: Internal Tool Execution ✅

**What it tests:**
- Internal tool registry lookup
- `agent.sendProgressUpdate` execution
- Zod schema validation
- Error handling

**How to verify:**
1. Execute `agent.sendProgressUpdate` via tool call
2. Check logs for handler invocation:
   ```
   {service="tool-orchestrator"} |= "send_progress_update.invoked"
   ```
3. Verify progress message formatted correctly

**Expected logs:**
```
tool_gateway.execute_internal_unsafe.start
tool_gateway.send_progress_update.invoked
tool_gateway.send_progress_update.success
```

---

### Test 3: Composition Execution ✅

**What it tests:**
- Multi-step workflow execution
- Per-step RBAC validation (security-critical!)
- Sequential/parallel/conditional strategies
- Graceful failure handling

**How to verify:**
1. Execute test composition with 2+ steps
2. Check logs for RBAC validation:
   ```
   {service="tool-orchestrator"} |= "execute_composition.rbac_validation_passed"
   ```
3. Verify all constituent tools executed
4. Check step-by-step logging

**Expected logs:**
```
tool_gateway.execute_composition.start
tool_gateway.execute_composition.rbac_validation_start
tool_gateway.execute_composition.rbac_validation_passed
tool_gateway.execute_sequential.step_start (for each step)
tool_gateway.execute_sequential.step_success (for each step)
tool_gateway.execute_composition.success
```

**Security Critical:**
Verify RBAC enforcement prevents privilege escalation:
```bash
# Attempt to execute composition with basic tier model
# Composition contains premium-only tools
# Should be denied at RBAC validation phase
```

Expected error:
```
Composition denied: constituent tool "premium-tool" not allowed for model gpt-3.5-turbo
```

---

### Test 4: RBAC Denial Flow ✅

**What it tests:**
- User role validation
- Model tier enforcement
- Model role requirements
- Composition per-step RBAC

**Test cases:**
1. User lacks required role → `Access denied: user missing required roles`
2. Model tier denied → `Access denied: model tier not allowed`
3. Composition constituent denied → `Composition denied: constituent tool X not allowed`

**How to verify:**
1. Execute tool requiring `admin` role with `user` role
2. Check logs for RBAC denial:
   ```
   {service="tool-orchestrator"} |= "rbac_denied"
   ```
3. Verify error message clarity
4. Confirm no tool execution occurred (fail-fast)

**Expected logs:**
```
tool_gateway.validate_tool_access.rbac_denied
tool_invocation_event (status: denied)
```

---

### Test 5: Error Handling & Retry ✅

**What it tests:**
- Retry logic for transient errors
- Exponential backoff (1s, 2s, 4s)
- No retry for non-transient errors
- Graceful degradation
- Clear error messages

**Test cases:**
1. **Network error** → Retry 3 times with exponential backoff
2. **Timeout error** → Retry with backoff
3. **HTTP 503 error** → Retry with backoff
4. **RBAC denial** → NO retry (immediate fail)
5. **Validation error** → NO retry (immediate fail)

**How to verify:**

**Transient error (should retry):**
```bash
# Simulate network failure
# Expected: 3 retry attempts with exponential backoff
```

**Expected logs:**
```
tool_gateway.retry.attempt_failed (attempt: 1, isTransient: true)
tool_gateway.retry.backoff (backoffMs: 1000)
tool_gateway.retry.attempt_failed (attempt: 2, isTransient: true)
tool_gateway.retry.backoff (backoffMs: 2000)
tool_gateway.retry.attempt_failed (attempt: 3, isTransient: true)
tool_gateway.retry.max_attempts_exceeded
```

**Non-transient error (should NOT retry):**
```bash
# Execute with invalid arguments
# Expected: Immediate failure, no retries
```

**Expected logs:**
```
tool_gateway.retry.attempt_failed (attempt: 1, isTransient: false)
tool_gateway.retry.non_transient_error
```

---

### Test 6: Performance Validation ✅

**What it tests:**
- P95 latency < 100ms (excluding MCP call time)
- Throughput under load
- Memory stability (no leaks)
- Cache performance

**How to verify:**

**Load test:**
```bash
# Run 1000 tool invocations
# Measure P95 latency
npm test -- --testPathPattern="performance.test.ts"
```

**Expected results:**
```
=== Load Test Results ===
Total iterations: 1000
Total time: 5000ms
Throughput: 200 ops/sec
Latency Statistics (ms):
  Min:  0.50
  Avg:  5.00
  P50:  4.00
  P95:  8.00  ← MUST BE < 100ms
  P99:  12.00
  Max:  25.00
```

**Memory test:**
```
=== Memory Leak Test ===
Initial heap: 850.00 MB
After batch 10/10: 858.00 MB
Memory growth: 8.00 MB  ← MUST BE < 10 MB
Memory stability (CV): 0.45%  ← MUST BE < 50%
```

---

## Loki Query Examples

### View all tool-orchestrator events for a correlation ID:
```
{service="tool-orchestrator"} |= "correlation-id-here"
```

### View RBAC denials:
```
{service="tool-orchestrator"} |= "rbac_denied"
```

### View retry attempts:
```
{service="tool-orchestrator"} |= "retry.attempt_failed"
```

### View composition execution:
```
{service="tool-orchestrator"} |= "execute_composition"
```

### Performance metrics:
```
{service="tool-orchestrator"} | json | __error__=""
| unwrap durationMs
| quantile_over_time(0.95, [5m])
```

---

## Success Criteria

### All tests must pass:
- ✅ Test 1: MCP tool execution works end-to-end
- ✅ Test 2: Internal tool execution works
- ✅ Test 3: Composition execution with per-step RBAC
- ✅ Test 4: RBAC denials logged and enforced
- ✅ Test 5: Retry logic works for transient errors
- ✅ Test 6: P95 latency < 100ms

### Loki logging verification:
- ✅ All executions logged (100% coverage)
- ✅ RBAC denials captured
- ✅ Retry attempts logged
- ✅ Error context preserved
- ✅ CorrelationId present in all logs

### Performance requirements:
- ✅ P95 execution latency < 100ms
- ✅ Memory growth < 10 MB per 1000 invocations
- ✅ No memory leaks detected
- ✅ Throughput > 10 ops/sec

---

## Troubleshooting

### Cannot connect to staging:
```
Error: fetch failed - unknown scheme
```
**Solution:** Ensure you're on the same network as `bitbrat.lan` or use VPN.

### MCP_AUTH_TOKEN not working:
```
Error: PermissionError: No MCP_AUTH_TOKEN resolved
```
**Solution:**
```bash
export MCP_AUTH_TOKEN=$(grep MCP_AUTH_TOKEN .secure.staging/.env | cut -d= -f2)
```

### Tool not found errors:
```
Error: Tool not found: test-tool
```
**Solution:** Verify tool registered in PostgreSQL:
```sql
SELECT id, canonical_name, source, status
FROM tool_registry
WHERE id = 'test-tool';
```

### RBAC failures:
```
Error: Access denied
```
**Solution:** Check model/user permissions in tool_registry.rbac column.

---

## Next Steps After Integration Tests

1. **Review Loki logs** - Verify 100% logging coverage
2. **Check PostgreSQL** - Verify tool invocation events persisted
3. **Performance analysis** - Review P95 latency across all execution types
4. **Security audit** - Verify RBAC enforcement prevents privilege escalation
5. **Documentation** - Update operational runbooks with findings

---

## Sprint 60 Integration Test Summary

**Created:** 2026-11-12
**Context:** Staging (bitbrat.lan)
**Services:** tool-orchestrator v0.44.0
**Test Coverage:** 7 integration tests covering all execution types
**Expected Duration:** ~60 seconds (with 30s long-running test)

**Status:** ✅ Test suite ready for execution by team with network access

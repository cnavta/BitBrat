# Tool Gateway Migration Guide
## Migrating from tool-gateway to tool-orchestrator

**Sprint 60**: Safe, phased migration from legacy tool-gateway to unified tool-orchestrator

**Purpose**: Migrate tool execution from the legacy `tool-gateway` service to the new `tool-orchestrator` service with minimal downtime and comprehensive rollback capability.

---

## Table of Contents

1. [Overview](#overview)
2. [Why Migrate](#why-migrate)
3. [Migration Strategy](#migration-strategy)
4. [Pre-Migration Checklist](#pre-migration-checklist)
5. [Step-by-Step Migration](#step-by-step-migration)
6. [Validation](#validation)
7. [Rollback Procedure](#rollback-procedure)
8. [Post-Migration Cleanup](#post-migration-cleanup)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The migration from `tool-gateway` to `tool-orchestrator` consolidates tool execution into a single, battle-tested service with enhanced retry logic, graceful degradation, and per-step RBAC validation.

### Migration Timeline

**Phase 1: Preparation** (1-2 hours)
- Deploy tool-orchestrator alongside tool-gateway
- Configure feature flags
- Validate deployment

**Phase 2: Testing** (2-4 hours)
- Enable tool-orchestrator for test users
- Monitor metrics and logs
- Validate all execution types

**Phase 3: Gradual Rollout** (1-3 days)
- Increase traffic to tool-orchestrator incrementally
- Monitor performance and errors
- Address issues as they arise

**Phase 4: Complete Migration** (1 hour)
- Switch 100% traffic to tool-orchestrator
- Deprecate tool-gateway
- Clean up legacy code

**Total Estimated Time**: 3-5 days

---

## Why Migrate

### Problems with tool-gateway

1. **No Retry Logic**: Network failures = immediate user-facing errors
2. **No Graceful Degradation**: Parallel compositions fail completely on first error
3. **No Per-Step RBAC**: Compositions can escalate privileges
4. **Limited Observability**: Minimal logging and metrics
5. **Performance Issues**: Inefficient caching and connection management

### Benefits of tool-orchestrator

| Feature | tool-gateway | tool-orchestrator |
|---------|-------------|-------------------|
| **Retry Logic** | ❌ None | ✅ Exponential backoff (3 attempts) |
| **Graceful Degradation** | ❌ Fail-fast | ✅ Partial success for parallel |
| **Per-Step RBAC** | ❌ No | ✅ Security-critical validation |
| **Observability** | ⚠️ Basic | ✅ Comprehensive Loki integration |
| **Performance** | ⚠️ P95 ~50ms | ✅ P95 <1ms (internal) |
| **Error Handling** | ⚠️ Basic | ✅ Transient vs non-transient |
| **Health Monitoring** | ❌ None | ✅ Automated health tracking |
| **Code Coverage** | ⚠️ ~60% | ✅ 94.4% |
| **Test Suite** | ⚠️ 50 tests | ✅ 188 tests |

---

## Migration Strategy

### Phased Approach (Recommended)

Use feature flags to gradually shift traffic from tool-gateway to tool-orchestrator.

**Advantages**:
- Zero downtime
- Incremental risk
- Easy rollback
- A/B testing capability

**Disadvantages**:
- Longer migration timeline
- Requires maintaining both services temporarily
- More complex monitoring

---

### Big Bang Approach (Not Recommended)

Switch all traffic at once.

**Advantages**:
- Faster migration
- Simpler deployment

**Disadvantages**:
- Higher risk
- All-or-nothing rollback
- No testing in production
- Potential for widespread outages

---

## Pre-Migration Checklist

### 1. Deploy tool-orchestrator

**Verify deployment**:
```bash
# Check tool-orchestrator is running
npm run brat -- fleet list --context <env>

# Expected output:
# tool-orchestrator: HEALTHY (20 tools registered)
```

**Check health**:
```bash
npm run brat -- fleet health tool-orchestrator --context <env>

# Expected: status: healthy
```

---

### 2. Verify Environment Configuration

**Required Environment Variables** (env/<context>/infra.yaml):
```yaml
# Loki Observability
LOKI_URL: http://loki:3100
LOKI_TIMEOUT_MS: 10000

# Health Tracking
HEALTHY_ERROR_THRESHOLD: 0.05
DEGRADED_ERROR_THRESHOLD: 0.20
HEALTH_UPDATE_INTERVAL_MS: 300000
HEALTH_STALE_THRESHOLD_MS: 3600000
```

**Verify configuration loaded**:
```bash
npm run brat -- fleet config tool-orchestrator --describe --context <env>

# Check for:
# - LOKI_URL
# - HEALTHY_ERROR_THRESHOLD
# - DEGRADED_ERROR_THRESHOLD
```

---

### 3. Validate Tool Registry

**Check all tools registered**:
```sql
SELECT COUNT(*) AS total_tools
FROM tool_registry
WHERE status = 'active';

-- Expected: 20+ tools
```

**Verify RBAC configuration**:
```sql
SELECT id, rbac
FROM tool_registry
WHERE rbac IS NULL OR rbac = '{}';

-- Expected: 0 results (all tools should have RBAC config)
```

**Check compositions**:
```sql
SELECT id, source, source_metadata
FROM tool_registry
WHERE source = 'composition';

-- Verify all compositions have valid step configurations
```

---

### 4. Test MCP Connections

**List MCP servers**:
```bash
# Via MCP tools (if available)
npm run brat -- mcp list --context <env>

# Via direct connection test
npm run brat -- fleet info tool-orchestrator --context <env>

# Check logs for MCP initialization
npm run brat -- fleet logs tool-orchestrator --context <env> | grep "mcp_server.initialized"
```

**Expected output**:
```json
{
  "msg": "mcp_server.initialized_successfully",
  "tools": 20,
  "resources": 0,
  "prompts": 0
}
```

---

### 5. Baseline Metrics

**Capture pre-migration metrics** (for comparison):
```bash
# Tool invocation rate (tool-gateway)
# Query Loki or Grafana dashboards

# Error rate
# Latency (P50, P95, P99)
# Throughput
```

**Save baseline**:
```json
{
  "service": "tool-gateway",
  "date": "2026-11-12",
  "metrics": {
    "invocations_per_hour": 1200,
    "error_rate": 0.08,
    "p50_latency_ms": 25,
    "p95_latency_ms": 50,
    "p99_latency_ms": 100
  }
}
```

---

## Step-by-Step Migration

### Step 1: Deploy tool-orchestrator (Already Complete)

```bash
npm run brat -- bit deploy tool-orchestrator --context <env>
```

**Verify**:
- Service running and healthy
- All tools registered
- MCP servers connected
- Loki logging operational

---

### Step 2: Configure Feature Flag (llm-bot)

The llm-bot service routes tool calls to either tool-gateway or tool-orchestrator based on a feature flag.

**Option A: Environment Variable** (Recommended for gradual rollout):
```yaml
# env/<context>/llm-bot.yaml
USE_TOOL_ORCHESTRATOR: false  # Start with tool-gateway
```

**Option B: Runtime Feature Flag** (Advanced - dynamic switching):
```typescript
// In llm-bot configuration
const useToolOrchestrator = await featureFlags.isEnabled(
  'use-tool-orchestrator',
  { userId, modelId }
);
```

**For phased migration, start with**:
```yaml
USE_TOOL_ORCHESTRATOR: false  # All traffic to tool-gateway
```

---

### Step 3: Enable for Test Users (Canary Testing)

**Create canary user list**:
```yaml
# env/<context>/llm-bot.yaml
USE_TOOL_ORCHESTRATOR: false
TOOL_ORCHESTRATOR_CANARY_USERS: "test-user-1,test-user-2,admin-user"
```

**Update llm-bot logic**:
```typescript
const useToolOrchestrator =
  process.env.USE_TOOL_ORCHESTRATOR === 'true' ||
  process.env.TOOL_ORCHESTRATOR_CANARY_USERS?.split(',').includes(userId);

const toolGatewayUrl = useToolOrchestrator
  ? process.env.TOOL_ORCHESTRATOR_URL || 'http://tool-orchestrator:3000'
  : process.env.TOOL_GATEWAY_URL || 'http://tool-gateway:3000';
```

**Redeploy llm-bot**:
```bash
npm run brat -- bit deploy llm-bot --context <env>
```

**Validate canary users**:
1. Test as canary user → should use tool-orchestrator
2. Test as regular user → should use tool-gateway
3. Check logs to verify routing

---

### Step 4: Monitor Canary Metrics

**Monitor for 2-4 hours**:

**Loki Queries**:
```
# Tool-orchestrator invocations from canary users
{service="tool-orchestrator"} |= "tool_gateway.execute"

# Error rate
count_over_time({service="tool-orchestrator", level="error"}[1h])

# Retry attempts (should be > 0, indicating retry logic working)
{service="tool-orchestrator"} |= "retry.attempt_failed"
```

**Success Criteria**:
- ✅ All canary tool calls succeed
- ✅ No increase in error rate compared to tool-gateway
- ✅ Retry logic activating for transient errors (expected)
- ✅ P95 latency within acceptable range
- ✅ No RBAC false-positives (legitimate calls denied)

---

### Step 5: Gradual Rollout (Percentage-Based)

**Week 1: 10% Traffic**:
```yaml
USE_TOOL_ORCHESTRATOR: false
TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 10  # 10% of users
```

**Implementation**:
```typescript
const useToolOrchestrator =
  process.env.USE_TOOL_ORCHESTRATOR === 'true' ||
  (Math.random() * 100) < parseInt(process.env.TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE || '0');
```

**Monitor**:
- Error rates
- Latency percentiles
- Retry frequency
- RBAC denials

**Week 2: 25% Traffic** (if 10% successful):
```yaml
TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 25
```

**Week 3: 50% Traffic**:
```yaml
TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 50
```

**Week 4: 100% Traffic**:
```yaml
USE_TOOL_ORCHESTRATOR: true  # All traffic
TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 100
```

---

### Step 6: Complete Migration

**Final configuration**:
```yaml
# env/<context>/llm-bot.yaml
USE_TOOL_ORCHESTRATOR: true
```

**Redeploy llm-bot**:
```bash
npm run brat -- bit deploy llm-bot --context <env>
```

**Verify 100% traffic**:
```bash
# Should see NO new invocations to tool-gateway
docker logs tool-gateway-1 --since 10m

# Should see ALL invocations to tool-orchestrator
docker logs tool-orchestrator-1 --since 10m | grep "tool_gateway.execute"
```

---

## Validation

### Automated Validation Checklist

**1. Health Check**:
```bash
npm run brat -- fleet health tool-orchestrator --context <env>

# Expected: status: healthy
```

**2. MCP Tool Execution**:
```bash
# Trigger MCP tool via chat or API
# Example: "Read the file /tmp/test.txt"

# Check logs for successful execution
docker logs tool-orchestrator-1 | grep "tool_gateway.execute_mcp.success"
```

**3. Internal Tool Execution**:
```bash
# Trigger internal tool (e.g., progress update)
# Should see in logs:
docker logs tool-orchestrator-1 | grep "tool_gateway.execute_internal_unsafe.success"
```

**4. Composition Execution**:
```bash
# Trigger composition via chat or API
# Check for sequential/parallel execution logs
docker logs tool-orchestrator-1 | grep "execute_sequential.all_steps_complete"
```

**5. RBAC Validation**:
```bash
# Attempt tool call with insufficient permissions
# Should see RBAC denial
docker logs tool-orchestrator-1 | grep "rbac_denied"
```

**6. Retry Logic**:
```bash
# Simulate transient error (disconnect MCP server briefly)
# Should see retry attempts
docker logs tool-orchestrator-1 | grep "retry.attempt_failed"
docker logs tool-orchestrator-1 | grep "retry.success"
```

**7. Graceful Degradation**:
```bash
# Execute parallel composition with one failing tool
# Should see partial failure handling
docker logs tool-orchestrator-1 | grep "execute_parallel.complete"
```

---

### Manual Validation

**Test Scenarios**:

| Scenario | Expected Result | Validation |
|----------|----------------|------------|
| Simple MCP tool call | Success | Tool executes, returns result |
| Internal tool call | Success | Handler invoked, returns result |
| Sequential composition (3 steps) | Success | All steps execute in order |
| Parallel composition (3 steps) | Success | All steps execute concurrently |
| RBAC denial (user role) | Denied | Clear error message |
| RBAC denial (model tier) | Denied | Clear error message |
| Composition per-step RBAC | Denied | Composition rejected before execution |
| Transient error (network) | Retry → Success | 2-3 retry attempts, eventual success |
| Non-transient error (RBAC) | Immediate failure | No retry attempts |
| Timeout | Retry → Success | AbortController enforces timeout |

---

### Performance Validation

**Compare metrics** (tool-gateway vs tool-orchestrator):

| Metric | tool-gateway (baseline) | tool-orchestrator (target) |
|--------|------------------------|---------------------------|
| P50 Latency | 25ms | < 30ms |
| P95 Latency | 50ms | < 60ms |
| P99 Latency | 100ms | < 120ms |
| Error Rate | 8% | < 5% (retry logic reduces errors) |
| Throughput | 1200/hour | >= 1200/hour |

**Loki Query** (P95 latency):
```
{service="tool-orchestrator", eventType="tool.invocation"}
| json
| unwrap durationMs
| quantile_over_time(0.95, [1h])
```

---

## Rollback Procedure

### When to Rollback

**Trigger conditions**:
- Error rate > 15% (vs baseline 8%)
- P95 latency > 2x baseline
- Critical RBAC false-positives (legitimate calls denied)
- Widespread tool execution failures
- Data corruption or integrity issues

---

### Immediate Rollback (< 5 minutes)

**Step 1: Revert feature flag**:
```yaml
# env/<context>/llm-bot.yaml
USE_TOOL_ORCHESTRATOR: false  # Back to tool-gateway
```

**Step 2: Redeploy llm-bot**:
```bash
npm run brat -- bit deploy llm-bot --context <env>
```

**Step 3: Verify traffic**:
```bash
# Check tool-gateway receives traffic
docker logs tool-gateway-1 --since 2m | grep "tool_execution"

# Check tool-orchestrator traffic stops
docker logs tool-orchestrator-1 --since 2m | grep "tool_gateway.execute"
# (Should see no new executions)
```

**Step 4: Monitor recovery**:
- Error rate returns to baseline
- Latency returns to normal
- User-facing issues resolved

---

### Partial Rollback (Reduce Percentage)

**If 100% rollout has issues, reduce to 50%**:
```yaml
USE_TOOL_ORCHESTRATOR: false
TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 50  # Reduce from 100%
```

**If 50% still has issues, reduce to 10%**:
```yaml
TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 10
```

**If canary users only**:
```yaml
TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 0
TOOL_ORCHESTRATOR_CANARY_USERS: "admin-user"  # Debug with single user
```

---

### Post-Rollback Analysis

**1. Collect Error Logs**:
```bash
docker logs tool-orchestrator-1 --since 1h > tool-orchestrator-errors.log
```

**2. Identify Root Cause**:
- RBAC misconfiguration?
- MCP server connectivity issues?
- Performance regression?
- Bug in retry logic?

**3. Create GitHub Issue**:
```markdown
Title: tool-orchestrator rollback - [brief description]

**Rollback Time**: 2026-11-12 15:30 UTC
**Reason**: [error rate spike | latency | RBAC false-positives]
**Traffic Level**: [100% | 50% | 10%]

**Error Logs**:
[paste relevant logs]

**Metrics**:
- Error rate: X% (baseline: 8%)
- P95 latency: Xms (baseline: 50ms)

**Next Steps**:
- [ ] Fix identified issue
- [ ] Test in agent-dev
- [ ] Re-attempt rollout
```

**4. Fix and Retry**:
- Address root cause
- Test fix in agent-dev
- Restart rollout from canary users

---

## Post-Migration Cleanup

**After 30 days of 100% tool-orchestrator traffic with no issues:**

### 1. Deprecate tool-gateway

**Mark service inactive**:
```yaml
# architecture.yaml
services:
  tool-gateway:
    active: false  # ← Deprecate
```

**Stop service**:
```bash
docker stop tool-gateway-1
```

**Remove from docker-compose**:
```yaml
# docker-compose.yaml
# Comment out or remove tool-gateway service
```

---

### 2. Archive Legacy Code

**Move to deprecated**:
```bash
git mv src/apps/tool-gateway-service.ts deprecated/tool-gateway/
git mv src/services/tool-gateway/ deprecated/tool-gateway/
```

**Update documentation**:
```markdown
# deprecated/tool-gateway/README.md

This service has been deprecated in favor of tool-orchestrator (Sprint 60).

**Migration Date**: 2026-11-12
**Reason**: Consolidated tool execution into tool-orchestrator
**Replacement**: tool-orchestrator-service

DO NOT use this code in new features.
```

---

### 3. Clean Up Feature Flags

**Remove migration flags**:
```yaml
# env/<context>/llm-bot.yaml
# DELETE:
# USE_TOOL_ORCHESTRATOR: true
# TOOL_ORCHESTRATOR_ROLLOUT_PERCENTAGE: 100
# TOOL_ORCHESTRATOR_CANARY_USERS: ""
```

**Update llm-bot code**:
```typescript
// Before (migration):
const toolGatewayUrl = useToolOrchestrator
  ? process.env.TOOL_ORCHESTRATOR_URL
  : process.env.TOOL_GATEWAY_URL;

// After (cleanup):
const toolGatewayUrl = process.env.TOOL_ORCHESTRATOR_URL || 'http://tool-orchestrator:3000';
```

---

### 4. Update Documentation

**Mark migration complete**:
```markdown
# documentation/guides/tool-gateway-migration.md

**Status**: ✅ COMPLETE
**Completion Date**: 2026-12-12
**Final Traffic**: 100% to tool-orchestrator
**Rollbacks**: 0
```

---

## Troubleshooting

### Issue 1: Increased Error Rate After Migration

**Symptoms**:
- Error rate jumps from 8% to 15%+
- User-facing errors increase

**Diagnosis**:
```bash
# Compare error types
docker logs tool-orchestrator-1 | grep "level.*error" | cut -d'"' -f4 | sort | uniq -c

# Check for new error patterns
docker logs tool-orchestrator-1 | grep "level.*error" | grep -v "ECONNREFUSED\|timeout"
```

**Common Causes**:
1. **MCP server connectivity**: tool-orchestrator can't reach MCP server
2. **RBAC misconfiguration**: Tools incorrectly denied
3. **Timeout too aggressive**: Legitimate slow tools timing out

**Solutions**:
```sql
-- 1. Increase timeout for slow tools
UPDATE tool_registry
SET config = jsonb_set(config, '{timeoutMs}', '60000')
WHERE id = 'slow-mcp-tool';

-- 2. Adjust RBAC for falsely denied tool
UPDATE tool_registry
SET rbac = jsonb_set(rbac, '{modelTiers,allowed}', '["basic", "premium"]')
WHERE id = 'previously-denied-tool';

-- 3. Check MCP server health
SELECT id, source_metadata->'mcpServer'->>'name' AS mcp_server, health
FROM tool_registry
WHERE source = 'mcp' AND health->>'status' = 'unhealthy';
```

---

### Issue 2: Performance Regression (Latency Increase)

**Symptoms**:
- P95 latency > 2x baseline
- User-perceived slowness

**Diagnosis**:
```bash
# Check Loki for slow executions
{service="tool-orchestrator"} | json | durationMs > 1000

# Identify slow tools
{service="tool-orchestrator"} | json
| durationMs > 500
| topk(10, sum by (toolId) (count_over_time([1h])))
```

**Common Causes**:
1. **Database query performance**: Tool/model registry lookups slow
2. **MCP connection pooling**: Not reusing connections
3. **Cache misses**: Registry cache not populated

**Solutions**:
```bash
# 1. Check PostgreSQL performance
docker exec postgres-1 psql -U bitbrat -c "\
SELECT schemaname, tablename, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE schemaname = 'public' AND tablename IN ('tool_registry', 'model_registry');"

# 2. Add indexes if needed
CREATE INDEX IF NOT EXISTS idx_tool_registry_source ON tool_registry(source);
CREATE INDEX IF NOT EXISTS idx_tool_registry_status ON tool_registry(status);

# 3. Check cache hit rate (via application metrics)
docker logs tool-orchestrator-1 | grep "cache_hit"
```

---

### Issue 3: Retry Logic Too Aggressive

**Symptoms**:
- Excessive retry attempts logged
- User delays due to retries
- Downstream services overwhelmed

**Diagnosis**:
```bash
# Count retry attempts
docker logs tool-orchestrator-1 | grep "retry.attempt_failed" | wc -l

# Check retry distribution
docker logs tool-orchestrator-1 | grep "retry.attempt_failed" | \
jq -r '.toolId' | sort | uniq -c | sort -rn
```

**Solutions**:
```sql
-- Reduce retry attempts for specific tool
UPDATE tool_registry
SET config = jsonb_set(config, '{retryPolicy,maxAttempts}', '2')
WHERE id = 'problematic-tool';

-- Increase backoff interval
UPDATE tool_registry
SET config = jsonb_set(config, '{retryPolicy,backoffMs}', '2000')
WHERE id = 'problematic-tool';
```

---

### Issue 4: RBAC False Positives (Legitimate Calls Denied)

**Symptoms**:
- Users report "Access denied" for tools they should access
- Canary testing shows denials for expected operations

**Diagnosis**:
```bash
# Find RBAC denials
docker logs tool-orchestrator-1 | grep "rbac_denied"

# Extract denial reasons
docker logs tool-orchestrator-1 | grep "rbac_denied" | jq -r '.msg'
```

**Solutions**:
```sql
-- Check tool RBAC configuration
SELECT id, rbac
FROM tool_registry
WHERE id = 'denied-tool';

-- Fix overly restrictive RBAC
UPDATE tool_registry
SET rbac = '{
  "userRoles": {"required": [], "denied": []},
  "modelRoles": {"required": [], "denied": []},
  "modelTiers": {"allowed": ["basic", "premium"], "denied": []}
}'::jsonb
WHERE id = 'denied-tool';
```

---

## Related Documentation

- **[Tool Orchestrator Guide](./tool-orchestrator.md)** - Complete execution guide
- **[Tool Observability Guide](./tool-observability.md)** - Metrics and monitoring
- **[RBAC Configuration](./rbac-configuration.md)** - Access control setup

---

**Migration Guide Version**: 1.0.0
**Last Updated**: 2026-11-12 (Sprint 60)
**Status**: Ready for production migration

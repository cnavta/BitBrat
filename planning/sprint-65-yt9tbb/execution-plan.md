# Execution Plan: MCP SDK v2 Handler Migration

**Sprint**: 65
**Lead Implementor**: Implementation Team
**Date**: 2026-11-18
**Status**: Ready for Execution
**Estimated Duration**: 8 days (3 phases)

---

## Executive Summary

This execution plan details the step-by-step implementation of the MCP SDK v2 handler migration, addressing the root cause of _meta context passing failures identified in the Architecture Brief.

**Critical Path**: tool-orchestrator → base-server.ts → all dependent services

**Success Criteria**:
- ✅ Tool executions receive correct `modelId` (not fallback)
- ✅ RBAC validation succeeds with proper context
- ✅ Zero "Model not found" errors in staging
- ✅ All integration tests pass
- ✅ No regression in tool execution success rates

---

## Phase 1: tool-orchestrator Migration (Priority: P0 - Critical)

**Goal**: Fix tool-orchestrator to correctly extract _meta from ServerContext, resolving RBAC and tool execution failures.

**Duration**: 2 days (1 day implementation + 1 day testing)

### Tasks Overview

#### 1.1 Code Changes
- **File**: `src/apps/tool-orchestrator-service.ts`
- **Lines**: 1445-1632 (getMcpServer method)
- **Change Type**: Replace per-tool registerTool loops with single setRequestHandler

#### 1.2 Testing
- Unit tests for context extraction
- Integration tests for _meta passing
- Agent-dev deployment validation
- Staging deployment validation

#### 1.3 Success Metrics
- Context extraction logs show correct modelId
- Tool execution success rate maintains 100%
- Zero RBAC validation failures
- Original failing trace (4db52bc2) resolves successfully

### Detailed Steps

**Step 1.1.1: Backup Current Implementation**
```bash
cp src/apps/tool-orchestrator-service.ts src/apps/tool-orchestrator-service.ts.v1-backup
git add src/apps/tool-orchestrator-service.ts.v1-backup
git commit -m "Backup tool-orchestrator v1 implementation before v2 migration"
```

**Step 1.1.2: Implement setRequestHandler Pattern**
- Remove PostgreSQL tool registration loop (lines 1465-1486)
- Remove direct tool registration loop (lines 1607-1632)
- Add single `setRequestHandler('tools/call')` with routing logic
- Extract _meta from `ctx.mcpReq._meta` (not `args._meta`)
- Add fallback header extraction from `ctx.http?.req?.headers.get()`
- Implement tool lookup from registry by name
- Add error handling for tool not found, execution failures

**Step 1.1.3: Add tools/list Handler**
- Register separate `setRequestHandler('tools/list')` for discovery
- Query all tools from toolRegistry
- Return tool metadata (name, description, inputSchema)

**Step 1.1.4: Add Structured Logging**
- Log context extraction: userId, modelId, roles
- Log tool lookup success/failure
- Log execution context passed to tools
- Use correlation IDs for tracing

**Step 1.2.1: Write Unit Tests**
- Test context extraction from `ctx.mcpReq._meta`
- Test fallback to HTTP headers when _meta missing
- Test tool lookup from registry
- Test error handling (tool not found, execution failure)
- Test modelId correctly extracted (not fallback)

**Step 1.2.2: Write Integration Tests**
- Test full flow: llm-bot → tool-orchestrator → tool execution
- Verify _meta passes through chain
- Verify RBAC validation succeeds
- Verify correct modelId reaches ToolGateway
- Test with multiple tools (tavily-search, tool.list, tool.get)

**Step 1.3.1: Deploy to agent-dev**
```bash
npm run brat -- agent_dev.provision --name agent-dev-mcp-v2-test
npm run brat -- bit deploy tool-orchestrator --context agent-dev-mcp-v2-test
```

**Step 1.3.2: Validate in agent-dev**
- Check logs for correct context extraction
- Send test tool calls via message.send MCP tool
- Verify tools execute successfully
- Verify no "Model not found" errors

**Step 1.3.3: Deploy to Staging**
```bash
npm run brat -- bit deploy tool-orchestrator --context staging
```

**Step 1.3.4: Validate in Staging**
- Replay original failing trace scenario
- Monitor logs for 1 hour (look for errors)
- Run smoke tests on critical tools
- Verify metrics show no regressions

---

## Phase 2: base-server.ts Migration (Priority: P0 - Critical)

**Goal**: Update base class to use v2 API, fixing ALL services inheriting from Bit.

**Duration**: 4 days (2 days implementation + 2 days testing)

### Tasks Overview

#### 2.1 Base Class Changes
- **File**: `src/common/base-server.ts`
- **Lines**: 1748-1762 (getMcpServer method)
- **Change Type**: Replace registerTool per-tool with single setRequestHandler

#### 2.2 Service Updates
- Identify all services using getMcpServer()
- Update service-specific overrides if needed
- Ensure no conflicts with Phase 1 tool-orchestrator changes

#### 2.3 Comprehensive Testing
- Unit tests for base class
- Integration tests for each affected service
- Cross-service integration tests (llm-bot → tool-gateway)
- Agent-dev full stack validation

### Detailed Steps

**Step 2.1.1: Analyze Service Dependencies**
```bash
# Find all services extending Bit and using MCP
grep -r "extends Bit" src/apps/*.ts
grep -r "getMcpServer" src/apps/*.ts
grep -r "registerTool" src/apps/*.ts
```

**Expected affected services**:
- llm-bot-service.ts
- tool-gateway.ts
- auth-service.ts
- claim-check-service.ts
- All domain MCP services (image-gen-mcp, story-engine-mcp, etc.)

**Step 2.1.2: Backup Base Class**
```bash
cp src/common/base-server.ts src/common/base-server.ts.v1-backup
git add src/common/base-server.ts.v1-backup
git commit -m "Backup base-server v1 implementation before v2 migration"
```

**Step 2.1.3: Update base-server.ts getMcpServer()**
- Replace per-tool registerTool with single setRequestHandler
- Extract _meta from `ctx.mcpReq._meta`
- Build combinedExtra with full ServerContext
- Add tool lookup from `this.registeredTools` Map
- Add tools/list handler for discovery
- Keep resources and prompts registration unchanged

**Step 2.1.4: Check for Service Overrides**
- Scan all services for `getMcpServer()` overrides
- Identify conflicts with new base implementation
- Plan updates for conflicting services (e.g., tool-gateway aggregation)

**Step 2.2.1: Update tool-gateway.ts**
- tool-gateway overrides getMcpServer() for aggregation (lines 2602+)
- Ensure tool-gateway's override uses v2 API
- Test aggregated tool serving still works
- Verify upstream MCP server connections maintained

**Step 2.2.2: Update llm-bot-service.ts**
- Check if llm-bot has getMcpServer() override
- If using registerTool directly, update to v2 pattern
- Test tool calls from llm-bot to tool-orchestrator
- Verify agent.sendProgressUpdate tool still works

**Step 2.2.3: Update Domain MCP Services**
- image-gen-mcp: Check for getMcpServer() override
- story-engine-mcp: Check for getMcpServer() override
- Other domain services: Verify they inherit base class behavior
- Test each service's MCP endpoint individually

**Step 2.3.1: Write Base Class Unit Tests**
```typescript
// src/common/__tests__/base-server-mcp-v2.test.ts
describe('Bit.getMcpServer() v2 Context Access', () => {
  it('should extract _meta from ctx.mcpReq._meta', async () => { ... });
  it('should fall back to HTTP headers when _meta missing', async () => { ... });
  it('should route tool calls to registered handlers', async () => { ... });
  it('should return proper error for unknown tools', async () => { ... });
});
```

**Step 2.3.2: Write Service Integration Tests**
```typescript
// src/apps/__tests__/llm-bot-tool-orchestrator.integration.test.ts
describe('LLM Bot → Tool Orchestrator v2 Integration', () => {
  it('should pass _meta through entire chain', async () => { ... });
  it('should maintain correct modelId through proxying', async () => { ... });
  it('should handle RBAC validation with correct context', async () => { ... });
});
```

**Step 2.3.3: Deploy All Services to agent-dev**
```bash
npm run brat -- bit deploy --all --context agent-dev-mcp-v2-test
```

**Step 2.3.4: Run Full Stack Tests in agent-dev**
- Send messages through ingress-egress
- Verify routing through event-router
- Test llm-bot tool calls
- Verify tool-orchestrator executions
- Check egress responses
- Monitor logs for errors

**Step 2.3.5: Deploy All Services to Staging**
```bash
npm run brat -- bit deploy --all --context staging
```

**Step 2.3.6: Staging Soak Test (48 hours)**
- Monitor error rates
- Monitor tool execution success rates
- Monitor RBAC validation failures
- Monitor _meta extraction failures
- Run automated smoke tests every hour

---

## Phase 3: Monitoring & Production Rollout (Priority: P1 - High)

**Goal**: Establish monitoring, validate in production, complete rollout.

**Duration**: 2 days (monitoring setup + production deployment)

### Tasks Overview

#### 3.1 Monitoring Setup
- Add structured logging for context extraction
- Create dashboards for _meta success rates
- Set up alerts for context extraction failures
- Monitor RBAC validation success rates

#### 3.2 Production Deployment
- Deploy to production with monitoring
- Monitor for 24 hours before full rollout
- Complete rollout to all services
- Document lessons learned

### Detailed Steps

**Step 3.1.1: Add Context Extraction Logging**
```typescript
// In setRequestHandler for tools/call
logger.info('tool_call.context_extracted', {
  toolName,
  hasUserId: !!userId,
  hasModelId: !!modelId,
  hasRoles: userRoles.length > 0,
  metaSource: meta ? 'mcpReq._meta' : 'http.headers',
  modelId,  // Log actual value for debugging
});
```

**Step 3.1.2: Add Context Extraction Metrics**
```typescript
// Increment metrics in handler
this.metrics.increment('tool.context.extracted', {
  source: meta ? '_meta' : 'headers',
  hasModelId: !!modelId,
});

this.metrics.increment('tool.execution.attempted', {
  toolName,
  modelId,
});
```

**Step 3.1.3: Create Monitoring Dashboard**
- **Panel 1**: Tool executions by modelId (should show actual models, not fallbacks)
- **Panel 2**: Context extraction source (_meta vs headers)
- **Panel 3**: RBAC validation success/failure rates
- **Panel 4**: Tool execution success rates
- **Panel 5**: Error rates by error type

**Step 3.1.4: Set Up Alerts**
```yaml
alerts:
  - name: high_context_fallback_rate
    condition: (headers_source / total_extractions) > 0.1
    severity: warning
    message: "More than 10% of tool calls falling back to header extraction"

  - name: rbac_validation_failures
    condition: rbac_failures > 10 per minute
    severity: critical
    message: "High RBAC validation failure rate"

  - name: model_not_found_errors
    condition: contains(error_message, "Model not found")
    severity: critical
    message: "Model not found errors detected - v2 migration issue"
```

**Step 3.2.1: Production Deployment (Canary)**
```bash
# Deploy tool-orchestrator first
npm run brat -- bit deploy tool-orchestrator --context production

# Monitor for 1 hour
npm run brat -- fleet logs --bit tool-orchestrator --context production --follow

# Check metrics dashboard
# - Look for context extraction logs
# - Verify modelId values are correct
# - Check for errors
```

**Step 3.2.2: Production Deployment (Full)**
```bash
# If canary successful, deploy all services
npm run brat -- bit deploy --all --context production

# Monitor for 24 hours
# - Watch dashboard metrics
# - Check alert channel for issues
# - Run smoke tests every 4 hours
```

**Step 3.2.3: Validation Checklist**
- [ ] Zero "Model not found: tool-orchestrator" errors
- [ ] Tool execution success rate ≥ baseline (should improve)
- [ ] RBAC validation success rate ≥ 99.9%
- [ ] Context extraction from _meta ≥ 90% (headers fallback <10%)
- [ ] No increase in error rates
- [ ] No regression in response times (p50, p99)

**Step 3.2.4: Document Lessons Learned**
```markdown
# Sprint 65: MCP v2 Migration Retrospective

## What Went Well
- Root cause analysis was thorough
- Architecture Brief provided clear migration path
- Phased rollout minimized risk

## What Could Be Improved
- Earlier detection of SDK version mismatch
- Better type checking for handler signatures
- Integration tests for SDK upgrades

## Action Items
- Add pre-commit hook to validate handler signatures
- Create SDK upgrade checklist
- Add type tests for MCP handler callbacks
```

---

## Risk Mitigation Strategies

### Risk 1: Tool Execution Failures During Migration

**Probability**: Medium
**Impact**: High
**Mitigation**:
1. Use feature flag for gradual rollout:
   ```typescript
   if (process.env.ENABLE_MCP_V2_HANDLERS === 'true') {
     // Use v2 setRequestHandler
   } else {
     // Use v1 registerTool (broken but stable)
   }
   ```
2. Deploy during low-traffic window
3. Have rollback script ready
4. Keep v1 backup files committed

**Rollback Procedure**:
```bash
# Revert to v1 implementation
git checkout src/apps/tool-orchestrator-service.ts.v1-backup \
  src/apps/tool-orchestrator-service.ts
git checkout src/common/base-server.ts.v1-backup \
  src/common/base-server.ts

# Rebuild and deploy
npm run build
npm run brat -- bit deploy --all --context production

# Verify rollback
npm run brat -- fleet info --all --context production
```

### Risk 2: Service-Specific Overrides Break

**Probability**: Medium
**Impact**: Medium
**Mitigation**:
1. Identify all getMcpServer() overrides before migration
2. Test each override individually in agent-dev
3. Update overrides to match new base class API
4. Add integration tests for aggregator services

**Detection**:
- Monitor for HTTP 500 errors from MCP endpoints
- Check logs for "Tool not found" errors
- Test tools/list endpoint for each service

### Risk 3: Performance Regression

**Probability**: Low
**Impact**: Low
**Mitigation**:
1. Measure baseline latencies before migration:
   ```bash
   # Run load test on tool-orchestrator
   ab -n 1000 -c 10 http://tool-orchestrator:3000/mcp
   ```
2. Compare after migration
3. Expected overhead: <1ms (Map lookup + property access)
4. If regression detected, add caching for tool handlers

**Rollback Trigger**: p99 latency increases by >10%

---

## Communication Plan

### Pre-Migration
- [ ] Send Architecture Brief to team
- [ ] Schedule migration kickoff meeting
- [ ] Create #sprint-65-mcp-v2 Slack channel
- [ ] Post timeline in channel
- [ ] Alert SRE team of staging/production deployments

### During Migration
- [ ] Daily standup updates on progress
- [ ] Post completion of each phase in Slack
- [ ] Alert before staging deployments
- [ ] Alert before production deployments
- [ ] Share monitoring dashboard link

### Post-Migration
- [ ] Post completion announcement
- [ ] Share metrics showing improvement
- [ ] Document lessons learned
- [ ] Update CLAUDE.md with v2 patterns
- [ ] Close out sprint artifacts

---

## Success Metrics

### Functional Metrics
- **Tool Execution Success Rate**: Baseline → 100% (fix broken calls)
- **RBAC Validation Success Rate**: 0% → 99.9%
- **Context Extraction from _meta**: 0% → 90%+
- **"Model not found" Errors**: >0 → 0

### Performance Metrics
- **Tool Call Latency (p50)**: Maintain baseline ±5ms
- **Tool Call Latency (p99)**: Maintain baseline ±10ms
- **MCP Endpoint Availability**: Maintain 99.9%

### Code Quality Metrics
- **Test Coverage**: Tool handlers >90%
- **Integration Tests**: Added 10+ tests covering v2 patterns
- **Type Safety**: No `any` types in handler signatures

---

## Timeline & Resource Allocation

### Week 1: Implementation
- **Days 1-2**: Phase 1 (tool-orchestrator)
  - Developer: 1 full-time
  - QA: 0.5 time for testing
- **Days 3-6**: Phase 2 (base-server + services)
  - Developer: 1 full-time
  - QA: 1 full-time for comprehensive testing

### Week 2: Validation & Deployment
- **Days 7-8**: Phase 3 (monitoring + production)
  - Developer: 0.5 time for monitoring setup
  - SRE: 0.5 time for deployment support
  - QA: 1 time for validation

**Total Effort**: ~10 person-days

---

## Checkpoint Reviews

### After Phase 1 (tool-orchestrator)
- [ ] Code review completed
- [ ] Unit tests passing (100%)
- [ ] Integration tests passing (100%)
- [ ] Agent-dev validation successful
- [ ] Staging validation successful
- [ ] Zero regressions detected
- **Go/No-Go Decision**: Proceed to Phase 2?

### After Phase 2 (base-server)
- [ ] Code review completed
- [ ] All service tests passing
- [ ] Agent-dev full stack tests passing
- [ ] Staging soak test completed (48 hours)
- [ ] Metrics show improvement
- [ ] Zero critical issues
- **Go/No-Go Decision**: Proceed to Phase 3?

### After Phase 3 (production)
- [ ] Production canary successful
- [ ] Full rollout completed
- [ ] Monitoring dashboard green
- [ ] No alerts triggered
- [ ] Validation checklist completed
- [ ] Documentation updated
- **Go/No-Go Decision**: Close out sprint?

---

## Dependencies & Blockers

### External Dependencies
- None - all work is internal to BitBrat codebase

### Internal Dependencies
- **Phase 2 depends on Phase 1**: Must complete tool-orchestrator before base-server
- **Phase 3 depends on Phase 2**: Must complete all services before production

### Potential Blockers
1. **Service override conflicts**: May discover complex overrides needing custom migration
   - **Mitigation**: Analysis phase identifies these early
2. **Test environment availability**: Need agent-dev and staging
   - **Mitigation**: Provision environments at start of Phase 1
3. **Production deployment window**: May need approval/scheduling
   - **Mitigation**: Schedule production window early in Week 2

---

## Appendix: Quick Reference Commands

### Agent-Dev Environment
```bash
# Provision
npm run brat -- agent_dev.provision --name agent-dev-mcp-v2-test

# Deploy single service
npm run brat -- bit deploy tool-orchestrator --context agent-dev-mcp-v2-test

# Deploy all services
npm run brat -- bit deploy --all --context agent-dev-mcp-v2-test

# Check logs
npm run brat -- fleet logs --bit tool-orchestrator --context agent-dev-mcp-v2-test

# Destroy when done
npm run brat -- agent_dev.destroy --name agent-dev-mcp-v2-test --confirm
```

### Testing Commands
```bash
# Run all tests
npm test

# Run specific test file
npm test tool-orchestrator-mcp-v2.test.ts

# Run integration tests
npm run test:integration

# Watch mode
npm test -- --watch
```

### Monitoring Commands
```bash
# View logs with filtering
npm run brat -- fleet logs --bit tool-orchestrator --level info --limit 100

# Trace specific request
npm run brat -- fleet trace --correlation-id <id> --context staging

# Check service health
npm run brat -- fleet health tool-orchestrator --context staging
```

---

## Sign-Off

**Lead Implementor**: _____________________________ Date: _______

**Engineering Manager**: _____________________________ Date: _______

**QA Lead**: _____________________________ Date: _______

**SRE Lead**: _____________________________ Date: _______

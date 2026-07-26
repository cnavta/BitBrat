# Sprint 366: Runtime Context Switching for Dev MCP

**Status**: READY FOR EXECUTION
**Sprint Goal**: Enable dynamic execution context switching at MCP tool invocation time
**Estimated Duration**: 2 work days (15-18 hours)
**Risk Level**: Low-Medium

---

## Quick Links

- **[Technical Architecture](./technical-architecture.md)** - Comprehensive design document
- **[Execution Plan](./execution-plan.md)** - Detailed implementation roadmap
- **[Backlog (YAML)](./backlog.yaml)** - Trackable, prioritized task list

---

## Sprint Overview

### Problem
The Dev MCP server currently binds to a single execution context at startup. Switching between environments (local, staging, production) requires server restarts, creating friction for coding agents.

### Solution
Move context resolution from **startup-time** to **runtime** by adding an optional `context` parameter to all MCP tools.

### Impact
Agents can seamlessly switch between execution contexts without restarting the MCP server:

```javascript
// Same session, different contexts
await fleet.list({ context: "staging" });
await db.get({ context: "prod", collection: "events", id: "123" });
await config.show();  // Uses default context
```

---

## Key Features

1. **Runtime Context Switching** - Tools accept optional `context` parameter
2. **Connection Pooling** - Contexts cached for performance (< 2ms overhead)
3. **Backward Compatibility** - Zero breaking changes, existing calls work unchanged
4. **Enhanced Audit Logging** - Track context usage for compliance
5. **Clear Error Messages** - Actionable guidance for unknown contexts

---

## Implementation Summary

### 5 Phases, 39 Tasks

| Phase | Description | Tasks | Est. Hours |
|-------|-------------|-------|------------|
| **1. Foundation** | Schema changes & validation | 7 | 3.08h |
| **2. Core Logic** | Request handler & context resolution | 8 | 2.25h |
| **3. Testing** | Integration & performance tests | 8 | 3.50h |
| **4. Documentation** | User guides & reference | 6 | 2.17h |
| **5. Finalization** | Review & release prep | 5 | 1.67h |
| **TOTAL** | | **39** | **12.67h** |

**Realistic Estimate with Buffer**: 15-18 hours (2 work days)

---

## Task Breakdown by Priority

| Priority | Count | Description |
|----------|-------|-------------|
| **P0 (Critical)** | 12 | Must complete for sprint success |
| **P1 (High)** | 15 | Required for full functionality |
| **P2 (Medium)** | 10 | Important but not blocking |
| **P3 (Low)** | 2 | Nice-to-have |

---

## Critical Path (6.83 hours)

Sequential tasks that must complete:

1. **Phase 1 Foundation** (2.58h)
   - Add `context` parameter to all tool schemas
   - Implement `validateContext()` in TargetConnectionManager
   - Write unit tests

2. **Phase 2 Core Logic** (1.67h)
   - Add `defaultContext` to DevMcpServer
   - Update request handler for runtime context extraction
   - Sanitize args before passing to tools
   - Write unit tests

3. **Phase 3 Testing** (1.17h)
   - Multi-context integration tests
   - Backward compatibility tests
   - Full test suite execution

4. **Phase 5 Finalization** (1.42h)
   - Code review
   - Build verification
   - Verification report
   - Git commit

---

## Files Modified

### Core Implementation (6 files)
- `tools/brat/src/dev-mcp/server.ts` - Request handler, defaultContext
- `tools/brat/src/dev-mcp/target-manager.ts` - validateContext()
- `tools/brat/src/dev-mcp/tools/config.ts` - Add context parameter
- `tools/brat/src/dev-mcp/tools/persistence.ts` - Add context parameter
- `tools/brat/src/dev-mcp/tools/fleet.ts` - Add context parameter
- `tools/brat/src/dev-mcp/tools/agent-dev.ts` - Add context parameter

### Documentation (4 files)
- `documentation/guides/mcp-dev-tools-reference.md`
- `documentation/guides/mcp-setup.md`
- `CLAUDE.md`
- `CHANGELOG.md`

### Tests (3 new files)
- `tools/brat/src/dev-mcp/__tests__/schema-validation.test.ts`
- `tools/brat/src/dev-mcp/__tests__/integration-context-switching.test.ts`
- `tools/brat/src/dev-mcp/__tests__/performance-benchmark.test.ts`

### Planning (2 new files)
- `planning/sprint-366-runtime-context-switching/manual-test-checklist.md`
- `planning/sprint-366-runtime-context-switching/verification-report.md`

**Total**: 10 modified, 5 new = **15 files**

---

## Success Criteria

### Functional ✅
- [ ] All tools accept optional `context` parameter
- [ ] Runtime context switching works without server restart
- [ ] Connection pooling prevents redundant connections
- [ ] Backward compatibility preserved

### Non-Functional ✅
- [ ] Performance overhead < 2ms per tool call (cache hit)
- [ ] Memory overhead < 25 MB (3-5 cached connections)
- [ ] Test coverage > 90% for new code
- [ ] Build time increase < 5%

### Quality ✅
- [ ] Zero breaking changes
- [ ] Clear error messages for edge cases
- [ ] Comprehensive documentation
- [ ] All tests pass

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Request Handler Regression | Low | High | Comprehensive unit tests, manual testing |
| Connection Pool Memory Leak | Low | Medium | Reuse existing cleanup logic, lifecycle tests |
| Context Resolution Performance | Low | Medium | Connection pooling, performance benchmarks |
| Breaking Changes | Very Low | High | Optional parameters, backward compatibility tests |

---

## Getting Started

### 1. Review Documents
- Read [Technical Architecture](./technical-architecture.md) for design details
- Read [Execution Plan](./execution-plan.md) for implementation roadmap

### 2. Set Up Environment
```bash
cd /Users/christophernavta/IdeaProjects/BitBratPlatform
git checkout -b feat/sprint-366-runtime-context-switching
npm install
npm run build
npm test
```

### 3. Start Implementation
Follow the [Backlog (YAML)](./backlog.yaml) in order:
1. Phase 1: Foundation (Tasks 1.1 - 1.7)
2. Phase 2: Core Logic (Tasks 2.1 - 2.8)
3. Phase 3: Testing (Tasks 3.1 - 3.8)
4. Phase 4: Documentation (Tasks 4.1 - 4.6)
5. Phase 5: Finalization (Tasks 5.1 - 5.5)

### 4. Track Progress
Update `backlog.yaml` task statuses:
- `not_started` → `in_progress` → `completed`
- Mark blockers with `status: blocked`

---

## Architecture Highlights

### Before (Startup-Time Context Binding)
```
brat dev-mcp start --context staging
  ↓
DevMcpServer(defaultContext: "staging")
  ↓
ALL tools use staging connection
  ↓
Want to check prod? ❌ RESTART REQUIRED
```

### After (Runtime Context Switching)
```
brat dev-mcp start
  ↓
DevMcpServer(defaultContext: "local")
  ↓
Tool call extracts context from args
  ↓
TargetConnectionManager.getActiveConnection(contextName)
  ↓
Cache hit? ✅ Reuse connection (1ms)
Cache miss? ✅ Create connection (155-710ms)
  ↓
Tool executes with correct connection
```

---

## Example Workflow

### Multi-Context Session
```typescript
// Start MCP server (default: local)
const server = new DevMcpServer({ context: 'local' });
await server.start();

// Query local fleet (uses default context)
const localFleet = await callTool('fleet.list', {});
// ✅ Returns local fleet

// Query staging fleet (runtime override)
const stagingFleet = await callTool('fleet.list', { context: 'staging' });
// ✅ Returns staging fleet (connection created & cached)

// Query production database (runtime override)
const prodEvent = await callTool('db.get', {
  context: 'prod',
  collection: 'events',
  id: 'evt_12345'
});
// ✅ Returns prod event (connection created & cached)

// Query staging again (reuses cached connection)
const stagingHealth = await callTool('fleet.health', {
  context: 'staging',
  bit: 'llm-bot'
});
// ✅ Returns staging health (connection reused, ~1ms overhead)
```

---

## Performance Expectations

### Context Resolution Latency
- **Cache Hit** (subsequent calls): ~1ms
- **Cache Miss** (first call):
  - Context resolution: ~5-10ms
  - PostgreSQL connection: ~50-200ms
  - Firestore init: ~50-200ms
  - SSH tunnel setup: ~100-500ms
  - **Total**: 155-710ms (one-time cost per context)

### Memory Footprint
- **Per Connection**: 2-5 MB (PostgreSQL pool + Firestore client)
- **Max Connections**: 3-5 (local, staging, prod)
- **Total Overhead**: 6-25 MB (acceptable for dev tooling)

### Build Impact
- **New LOC**: ~400 lines (implementation + tests + docs)
- **Expected Build Time Increase**: < 5%

---

## Backward Compatibility Guarantee

### Existing Behavior Preserved
```typescript
// Before Sprint 366
brat dev-mcp start --context staging
fleet.list()  // ✅ Uses staging

// After Sprint 366 (still works!)
brat dev-mcp start --context staging
fleet.list()  // ✅ Uses staging (default context)

// New capability (optional)
fleet.list({ context: 'prod' })  // ✅ Uses prod (runtime override)
```

### Migration Path
**None required.** All changes are additive (optional parameter).

---

## Testing Strategy

### Unit Tests (Phase 1 & 2)
- Schema validation for all tools
- `validateContext()` logic
- Request handler context extraction
- Args sanitization
- Audit logging enhancement

**Target**: > 90% coverage for new code

### Integration Tests (Phase 3)
- Multi-context tool invocations
- Connection pooling behavior
- Backward compatibility (no context param)
- Error handling (unknown context)
- Cross-persistence-backend switching

**Target**: All happy paths + error paths

### Manual Tests (Phase 3)
- Start MCP server
- Call tools without `context` (uses default)
- Call tools with `context` (uses override)
- Call tools with invalid `context` (errors gracefully)
- Inspect audit logs for `context` field

**Checklist**: `manual-test-checklist.md`

### Performance Tests (Phase 3)
- Context resolution latency (cache hit)
- Context resolution latency (cache miss)
- Memory usage (3-5 contexts)
- Connection pool growth

**Benchmarks**: `performance-benchmark.test.ts`

---

## Completion Checklist

### Pre-Merge
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing checklist complete
- [ ] Performance benchmarks within acceptable range
- [ ] Documentation updated
- [ ] Code review (self) complete
- [ ] No linting errors
- [ ] Build succeeds cleanly

### Merge
- [ ] Create feature branch `feat/sprint-366-runtime-context-switching`
- [ ] Commit with descriptive messages (conventional commits)
- [ ] Push to remote
- [ ] Verify CI passes (if applicable)
- [ ] Merge to main

### Post-Merge
- [ ] Tag release (if applicable)
- [ ] Update CHANGELOG
- [ ] Announce in team channel
- [ ] Monitor for issues in staging

---

## Questions & Clarifications

Before starting implementation, confirm:

1. **Default Context Behavior**: Keep `local` as default? ✅ Recommended
2. **Connection Pool Eviction**: Implement LRU in Sprint 366 or defer? ✅ Defer to Sprint 367+
3. **Parameter Naming**: Use `context` or `executionContext`? ✅ Recommend `context`
4. **Audit Logs**: Keep deprecated `target` field? ✅ Recommend yes (backward compatibility)
5. **Error Handling**: Throw exception for unknown context? ✅ Recommend yes (fail fast)

---

## Sprint Artifacts

### Planning Phase ✅
- [x] Technical Architecture document
- [x] Execution Plan document
- [x] Backlog (YAML) with priorities
- [x] README (this file)

### Implementation Phase (TODO)
- [ ] All code changes committed
- [ ] All tests passing
- [ ] Documentation updated

### Verification Phase (TODO)
- [ ] Manual test checklist executed
- [ ] Performance benchmarks recorded
- [ ] Verification report created

### Completion Phase (TODO)
- [ ] Sprint merged to main
- [ ] CHANGELOG updated
- [ ] Release tagged (if applicable)

---

## Contact & Support

**Sprint Lead**: Lead Implementor
**Architect**: Lead Architect
**Sprint ID**: 366
**Sprint Start**: TBD
**Sprint End**: TBD (estimated 2 work days)

**Documentation**: `planning/sprint-366-runtime-context-switching/`
**Codebase**: `/Users/christophernavta/IdeaProjects/BitBratPlatform`
**Git Branch**: `feat/sprint-366-runtime-context-switching`

---

**Last Updated**: 2026-07-26
**Status**: READY FOR EXECUTION ✅

# Sprint 66: Schema Injection via LlmProfile Integration

**Sprint ID**: sprint-66-pshifz
**Status**: Planning (Ready for Implementation)
**Owner**: christophernavta
**Created**: 2026-11-20

---

## 🎯 Sprint Goal

Implement **Option 0** from [schema-injection-architecture.md](../../sprint-65-yt9tbb/schema-injection-architecture.md): Extend `LlmProfile` with `prepareToolsForLlm()` capability method for **seamless, zero-boilerplate** schema injection from PostgreSQL tool registry.

---

## 📋 Executive Summary

### Problem
PostgreSQL-registered tools arrive at llm-bot with `inputSchema: undefined` (MCP SDK v2 limitation). AI SDK cannot generate correct tool arguments without schemas, causing tool calls to fail.

### Solution
Add `prepareToolsForLlm()` method to `LlmCapability` interface. Services call this single method to automatically fetch missing schemas from PostgreSQL and inject them before passing to AI SDK.

### Benefits
- ✅ **Seamless**: One method call (`bit.llm.prepareToolsForLlm()`)
- ✅ **Consistent**: All LLM-using services get same behavior
- ✅ **Maintainable**: Schema injection logic in one place (LlmProfile)
- ✅ **Fail-open**: Missing schemas don't break execution
- ✅ **Future-proof**: Works for all current and future services

---

## 📁 Sprint Artifacts

| Document | Purpose |
|----------|---------|
| [execution-plan.md](./execution-plan.md) | Comprehensive implementation plan with 4 phases |
| [backlog.yaml](./backlog.yaml) | Trackable, prioritized task breakdown (36 tasks) |
| README.md | This document - sprint overview and quick reference |

---

## 🏗️ Architecture Overview

### Current Flow (Broken)
```
1. tool-orchestrator: Register tools in PostgreSQL WITH schemas
2. tool-orchestrator: Register tools via MCP WITHOUT schemas (SDK limitation)
3. llm-bot: Get tools from MCP → inputSchema: undefined
4. llm-bot: Pass to AI SDK → LLM cannot generate arguments
5. Tool call fails ❌
```

### New Flow (Fixed)
```
1. tool-orchestrator: Register tools in PostgreSQL WITH schemas
2. tool-orchestrator: Register tools via MCP WITHOUT schemas (SDK limitation)
3. llm-bot: Get tools from MCP → inputSchema: undefined
4. llm-bot: Call bit.llm.prepareToolsForLlm(tools)
   a. Query PostgreSQL for missing schemas
   b. Inject schemas into tools
5. llm-bot: Pass enriched tools to AI SDK → LLM generates correct arguments
6. Tool call succeeds ✅
```

---

## 🚀 Implementation Phases

### Phase 1: Extend LlmProfile (2-4 hours)
**Goal**: Add schema injection capability to LlmProfile

**Key Tasks**:
1. Extend `LlmCapability` interface with `prepareToolsForLlm()` method
2. Implement `mapToolNameToRegistryId()` helper (reverse sanitization)
3. Implement `prepareToolsForLlm()` in `LlmProfile.install()`
4. Register method in capability object

**Deliverable**: Updated `src/common/profiles/llm-profile.ts`

**Verification**: `npm run build && npm run lint`

---

### Phase 2: Migrate llm-bot (1-2 hours)
**Goal**: Update llm-bot to use new capability

**Key Tasks**:
1. Refactor tool filtering to separate concerns
2. Add schema injection call after filtering
3. Update execute wrapping to use enriched tools
4. Add debug logging for schema injection

**Deliverable**: Updated `src/services/llm-bot/processor.ts`

**Verification**: `npm test -- processor.test.ts`

---

### Phase 3: Agent-Dev Validation (2-3 hours)
**Goal**: Validate schema injection end-to-end

**Key Tasks**:
1. Provision agent-dev context
2. Deploy tool-orchestrator and llm-bot
3. Test tool execution with schema injection
4. Verify logs show successful schema fetches
5. Test fail-open behavior (missing schemas, PostgreSQL down)
6. Measure performance overhead

**Deliverable**: Validation report with test results

**Verification**: All tests pass, performance <100ms overhead

---

### Phase 4: Documentation (2-3 hours)
**Goal**: Document pattern for future developers

**Key Tasks**:
1. Add new pattern to CLAUDE.md
2. Create comprehensive integration guide
3. Enhance JSDoc comments
4. Update Sprint 65 architecture doc

**Deliverable**: Updated documentation

**Verification**: Documentation complete and accurate

---

## 📊 Sprint Statistics

| Metric | Value |
|--------|-------|
| **Total Tasks** | 36 |
| **P0 (Must Have)** | 20 tasks |
| **P1 (Should Have)** | 13 tasks |
| **P2 (Nice to Have)** | 3 tasks |
| **Estimated Effort** | 7-12 hours |
| **Estimated Duration** | 1.75-2 days |

---

## ✅ Success Criteria

Sprint 66 is complete when:

### Implementation
- [ ] `LlmProfile` has `prepareToolsForLlm()` method
- [ ] llm-bot uses new pattern
- [ ] TypeScript compilation succeeds
- [ ] No breaking changes to existing services

### Validation
- [ ] Agent-dev deployment successful
- [ ] Schema injection logs confirm behavior
- [ ] Tool calls succeed with correct arguments
- [ ] Fail-open behavior verified
- [ ] Performance overhead <100ms

### Documentation
- [ ] CLAUDE.md updated with new pattern
- [ ] Integration guide created
- [ ] Code comments enhanced
- [ ] Sprint artifacts complete

### Quality
- [ ] All existing tests pass
- [ ] No new lint errors
- [ ] Logs show detailed activity
- [ ] Error cases handled gracefully

---

## 🔍 Critical Path

The shortest path to completion:

```
Phase 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.6 (Extend LlmProfile)
         ↓
Phase 2: 2.1 → 2.2 → 2.3 → 2.6 (Migrate llm-bot)
         ↓
Phase 3: 3.1 → 3.2 → 3.3 → 3.5 → 3.6 (Validate in agent-dev)
         ↓
Phase 4: 4.1 (Update CLAUDE.md)
         ↓
Phase 5: 5.1 → 5.3 → 5.4 (Complete sprint, create PR)
```

**Estimated Time**: 7-8 hours (minimum viable path)

---

## 🛠️ Key Files

| File | Description |
|------|-------------|
| `src/common/profiles/llm-profile.ts` | LlmProfile with schema injection capability |
| `src/services/llm-bot/processor.ts` | llm-bot using prepareToolsForLlm() |
| `documentation/guides/llm-tool-schema-injection.md` | Integration guide (new) |
| `CLAUDE.md` | Platform patterns (updated) |

---

## 🧪 Testing Strategy

### Unit Tests
Not required (profile methods typically not unit tested in codebase).

### Integration Tests
Agent-dev validation serves as end-to-end integration test:
- Tool execution with schema injection
- Error cases (missing schemas, PostgreSQL down)
- Performance validation

### Regression Tests
Existing tests must pass:
```bash
npm test -- processor.test.ts
npm test -- llm-bot-service.test.ts
```

---

## ⚠️ Risk Assessment

### Medium Risk Items

**Risk**: Tool name mapping fails for complex qualified tools
**Mitigation**: Heuristic mapping + fallback logging + fail-open behavior
**Contingency**: Add manual mapping table if needed in future sprint

**Risk**: PostgreSQL query latency impacts performance
**Mitigation**: Lazy initialization + fail-open + future caching optimization
**Contingency**: Add per-service in-memory cache in Phase 5 if needed

### Low Risk Items
- documentStore not available → Graceful degradation
- Schema format incompatible → AI SDK jsonSchema() helper handles all formats

---

## 🔄 Rollback Plan

If implementation fails validation:

1. **Revert Phase 2** (llm-bot processor.ts):
   - Restore original tool handling
   - Remove prepareToolsForLlm() call
   - Commit revert with explanation

2. **Keep Phase 1** (LlmProfile):
   - New method harmless if not called
   - Can be used in future sprint

**Rollback Effort**: <30 minutes

---

## 🚀 Future Enhancements

### Phase 5: Performance Optimization (Future Sprint)
- Add per-service in-memory cache
- Implement batch PostgreSQL queries
- Add TTL-based cache invalidation

### Phase 6: Advanced Tool Mapping (Future Sprint)
- Create mapping table for complex qualified tools
- Support namespace aliases
- Handle MCP server version changes

### Phase 7: Multi-Service Migration (Future Sprint)
- Migrate reflex to use pattern
- Migrate query-analyzer to use pattern
- Document patterns for future services

---

## 📚 Background Reading

| Document | Description |
|----------|-------------|
| [schema-injection-architecture.md](../../sprint-65-yt9tbb/schema-injection-architecture.md) | Architecture analysis and option evaluation (Sprint 65) |
| [schema-problem-analysis.md](../../sprint-65-yt9tbb/schema-problem-analysis.md) | Root cause analysis (Sprint 65) |
| [execution-plan.md](./execution-plan.md) | Detailed implementation plan (This sprint) |
| [backlog.yaml](./backlog.yaml) | Task breakdown with acceptance criteria (This sprint) |

---

## 🤝 Getting Started

Ready to implement? Follow these steps:

### 1. Review Planning Artifacts
```bash
cd planning/sprint-66-pshifz/
cat execution-plan.md    # Read implementation plan
cat backlog.yaml         # Review task breakdown
```

### 2. Start with Phase 1
```bash
# Open key file
code src/common/profiles/llm-profile.ts

# Start with task 1.1: Extend LlmCapability interface
# See backlog.yaml for detailed acceptance criteria
```

### 3. Follow Critical Path
Follow the critical path in backlog.yaml:
- Complete all P0 (must have) tasks first
- Validate at each phase boundary
- Use agent-dev for end-to-end validation

### 4. Update Status
As you complete tasks, update backlog.yaml:
```yaml
- id: "1.1"
  status: "completed"  # Change from "pending"
```

---

## 📞 Questions?

Refer to:
- **Implementation details**: [execution-plan.md](./execution-plan.md)
- **Task acceptance criteria**: [backlog.yaml](./backlog.yaml)
- **Architecture decisions**: [schema-injection-architecture.md](../../sprint-65-yt9tbb/schema-injection-architecture.md)
- **Platform patterns**: [CLAUDE.md](../../CLAUDE.md)

---

**Sprint Status**: 🟡 Planning Complete - Ready for Implementation
**Next Action**: Begin Phase 1, Task 1.1 (Extend LlmCapability interface)
**Est. Completion**: 2026-11-22 (2 days from start)

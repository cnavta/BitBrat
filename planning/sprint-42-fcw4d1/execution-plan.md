# Execution Plan: Sprint 42 - Composition Tool Registration Fix + Hot-Reload

**Sprint ID**: sprint-42-fcw4d1
**Goal**: Fix composition tool registration + enable hot-reloading
**Owner**: Lead Implementor
**Created**: 2026-09-04
**Status**: In Progress

---

## Executive Summary

This sprint fixes the critical bug preventing database-stored compositions from appearing as MCP tools and adds hot-reload capability for zero-downtime composition updates.

**Core Issue**: `CompositionRegistry.list()` returns raw database records without compiling them, causing `registerCompositionTool()` to fail with null reference errors.

**Solution**:
1. Compile definitions on load in `registry.list()`
2. Add `CompositionWatcher` to poll database and auto-register changes

**Timeline**: 6.5-8.5 hours over 1-2 days

---

## Execution Phases

### Phase 1: Core Implementation (2-3 hours)

#### Objectives
- Fix `CompositionRegistry.list()` to compile definitions
- Add error handling for invalid compositions
- Implement `CompositionWatcher` class
- Integrate watcher into tool-gateway

#### Tasks (P0 - Critical Path)
1. ✅ Modify `CompositionRegistry.list()` - **30 min**
   - Add compilation logic
   - Handle snake_case → camelCase mapping
   - Return properly-typed `CompositionRecord[]`

2. ✅ Add error handling to `list()` - **15 min**
   - Wrap compilation in try/catch
   - Log errors but continue loading other compositions
   - Use proper logger (not console.error)

3. ✅ Create `CompositionWatcher` class - **1 hour**
   - Implement polling logic using `DocumentStore.watch()`
   - Add change detection (additions, updates, deletions)
   - Add callback handlers
   - Include detailed logging

4. ✅ Integrate watcher into tool-gateway - **30 min**
   - Add watcher initialization in `start()`
   - Implement `onCompositionAdded` handler
   - Implement `onCompositionUpdated` handler
   - Implement `onCompositionRemoved` handler
   - Add watcher cleanup in `shutdown()`
   - Add environment variable for poll interval

5. ✅ Build and verify compilation - **15 min**
   - Run `npm run build`
   - Fix any TypeScript errors
   - Verify no import errors

#### Deliverables
- [ ] Modified `src/common/composition/registry.ts`
- [ ] New file `src/common/composition/composition-watcher.ts`
- [ ] Modified `src/apps/tool-gateway.ts`
- [ ] Clean TypeScript compilation

#### Exit Criteria
- Code compiles without errors
- No TypeScript type issues
- All new code follows existing patterns

---

### Phase 2: Testing (3-4 hours)

#### Objectives
- Validate core fix with unit tests
- Verify grockle loads and registers correctly
- Test hot-reload lifecycle (add/update/delete)
- Ensure no regressions

#### Tasks (P0 - Must Complete)

**Unit Tests** (1.5 hours)
1. ✅ Test `CompositionRegistry.list()` compilation - **30 min**
   - Test compiles definitions from database records
   - Test handles snake_case database columns
   - Test returns empty array for empty database
   - Test skips invalid compositions with error logging
   - Test preserves all CompositionRecord fields

2. ✅ Test `CompositionWatcher` behavior - **1 hour**
   - Test detects new compositions
   - Test detects removed compositions
   - Test detects updated compositions (content hash changed)
   - Test ignores unchanged compositions
   - Test handles errors gracefully
   - Test stops polling when stop() called

**Integration Tests** (1-1.5 hours)
3. ✅ Create validation scripts - **30 min**
   - Create `validate-grockle-loading.sh`
   - Create `test-grockle-invocation.sh`
   - Create `test-hot-reload.sh`
   - Make executable (`chmod +x`)

4. ✅ Run local validation - **30 min**
   - Run unit tests: `npm test -- registry.test.ts`
   - Run unit tests: `npm test -- composition-watcher.test.ts`
   - Verify all tests pass
   - Fix any test failures

**End-to-End Tests** (1 hour)
5. ✅ Test in agent-dev context - **1 hour**
   - Provision agent-dev context
   - Deploy tool-gateway
   - Insert test composition via SQL
   - Wait for watcher poll
   - Verify composition appears as tool
   - Test composition invocation
   - Clean up

#### Deliverables
- [ ] Test files: `registry.test.ts`, `composition-watcher.test.ts`
- [ ] Validation scripts: 3 bash scripts
- [ ] All tests passing
- [ ] Agent-dev validation complete

#### Exit Criteria
- All unit tests pass (100% success rate)
- Integration tests complete successfully
- Hot-reload lifecycle validated (add → update → delete)
- No test failures or errors

---

### Phase 3: Deployment & Verification (1 hour)

#### Objectives
- Deploy to staging environment
- Verify grockle composition loads and works
- Validate hot-reload in production-like environment
- Monitor logs for errors

#### Tasks (P0 - Critical)

1. ✅ Deploy to staging - **15 min**
   - Build: `npm run build`
   - Deploy: `npm run brat -- bit deploy tool-gateway --context staging`
   - Wait for deployment to complete
   - Check service health

2. ✅ Validate grockle loading - **15 min**
   - Run `validate-grockle-loading.sh`
   - Check logs for successful composition loading
   - Verify grockle appears in MCP tool list
   - Test grockle invocation

3. ✅ Validate hot-reload - **20 min**
   - Run `test-hot-reload.sh`
   - Monitor logs during test
   - Verify all lifecycle events (add/update/delete)
   - Confirm no errors

4. ✅ Smoke test existing functionality - **10 min**
   - Verify other compositions still work
   - Test MCP server auto-discovery still works
   - Check llm-bot receives tool list notifications
   - Ensure no regressions

#### Deliverables
- [ ] Staging deployment complete
- [ ] grockle composition working
- [ ] Hot-reload validated
- [ ] No regressions detected

#### Exit Criteria
- Tool-gateway running successfully in staging
- grockle loads on startup without errors
- grockle can be invoked and returns expected response
- Hot-reload working (30-second poll interval)
- No error messages in logs
- Existing functionality unaffected

---

### Phase 4: Documentation (30 minutes)

#### Objectives
- Update composition documentation
- Add comments to new code
- Document hot-reload behavior
- Provide usage examples

#### Tasks (P1 - Should Complete)

1. ✅ Update `documentation/guides/compositions.md` - **15 min**
   - Add "Database Storage" section
   - Document direct SQL insertion
   - Explain automatic compilation on load
   - Add hot-reload documentation

2. ✅ Add code comments - **10 min**
   - Add JSDoc to `CompositionRegistry.list()`
   - Add JSDoc to `CompositionWatcher` class
   - Document configuration options

3. ✅ Update architecture notes - **5 min**
   - Note polling interval configuration
   - Document watcher lifecycle
   - Add troubleshooting tips

#### Deliverables
- [ ] Updated `documentation/guides/compositions.md`
- [ ] Code comments in registry.ts and composition-watcher.ts
- [ ] Architecture notes updated

#### Exit Criteria
- Documentation clearly explains hot-reload behavior
- Examples provided for direct SQL insertion
- Configuration options documented
- Code is well-commented

---

## Sprint Completion

### Final Tasks (P0)

1. ✅ Create verification report - **15 min**
   - Document all fixes implemented
   - Include test results
   - Note deployment status
   - List any known issues

2. ✅ Create retrospective - **15 min**
   - What went well
   - What could be improved
   - Lessons learned
   - Action items for future sprints

3. ✅ Create key learnings document - **10 min**
   - Technical learnings
   - Process improvements
   - Reusable patterns

4. ✅ Commit all changes - **10 min**
   - Stage all modified files
   - Create comprehensive commit message
   - Push to feature branch

5. ✅ Create pull request - **10 min**
   - Write detailed PR description
   - Link to sprint artifacts
   - Request review

6. ✅ Complete sprint via MCP - **5 min**
   - Update sprint status to 'complete'
   - Add PR link to manifest
   - Generate final summary

**Total Completion Time**: ~1 hour

---

## Risk Management

### High Priority Risks

**Risk 1: DocumentStore.watch() not working as expected**
- **Impact**: High - Hot-reload won't work
- **Mitigation**: Test with existing RegistryWatcher pattern first
- **Fallback**: Implement manual polling with setInterval

**Risk 2: Compilation errors on invalid compositions**
- **Impact**: Medium - Service may fail to start
- **Mitigation**: Error handling catches and logs compilation errors
- **Fallback**: Continue loading other compositions, skip invalid ones

**Risk 3: Performance impact from polling**
- **Impact**: Low - Database query every 30 seconds
- **Mitigation**: Use efficient query, cache results
- **Fallback**: Increase poll interval to 60 seconds

**Risk 4: Unregister not working (MCP limitation)**
- **Impact**: Medium - Deleted compositions may still appear
- **Mitigation**: Track registered tools, filter on list
- **Fallback**: Document manual cleanup process

### Contingency Plans

**If Phase 1 takes longer than 3 hours**:
- Defer hot-reload to separate sprint
- Focus on core fix only (registry.list())
- Ship basic functionality first

**If tests fail in Phase 2**:
- Fix critical failures immediately
- Document non-critical issues
- Add to backlog for follow-up

**If staging deployment fails**:
- Roll back to previous version
- Debug in agent-dev context
- Fix issues before retry

---

## Communication Plan

### Status Updates

**Daily Standup Format**:
- Yesterday: [Completed tasks]
- Today: [Current focus]
- Blockers: [Any impediments]

**Progress Tracking**:
- Update todo list after each task
- Mark backlog items complete as finished
- Update sprint manifest status

### Milestone Notifications

- **Phase 1 Complete**: Notify when core fix implemented and compiling
- **Phase 2 Complete**: Notify when all tests pass
- **Phase 3 Complete**: Notify when staging deployment validated
- **Sprint Complete**: Notify when PR created and sprint finalized

---

## Quality Gates

### Code Quality
- [ ] TypeScript strict mode compliance
- [ ] No `any` types without justification
- [ ] Consistent error handling
- [ ] Proper logging at all levels
- [ ] Follows existing code patterns

### Test Coverage
- [ ] All new functions have unit tests
- [ ] Edge cases covered
- [ ] Error paths tested
- [ ] Integration tests validate end-to-end flow

### Documentation
- [ ] Code is self-documenting with clear names
- [ ] Complex logic has explanatory comments
- [ ] Public APIs have JSDoc
- [ ] User-facing features documented in guides

### Deployment
- [ ] Builds successfully
- [ ] All tests pass
- [ ] No console errors in logs
- [ ] Backward compatible
- [ ] Graceful degradation on errors

---

## Success Metrics

### Functional Metrics
- ✅ grockle composition loads on startup
- ✅ grockle can be invoked successfully
- ✅ New compositions auto-register within 30 seconds
- ✅ Updated compositions auto-refresh within 30 seconds
- ✅ Deleted compositions auto-unregister within 30 seconds

### Performance Metrics
- ✅ Startup time not significantly increased (<500ms overhead)
- ✅ Poll operation completes in <100ms
- ✅ No memory leaks from polling
- ✅ Database query load acceptable (<1 query/30s)

### Quality Metrics
- ✅ 100% test pass rate
- ✅ Zero critical bugs
- ✅ Clean TypeScript compilation
- ✅ No regressions in existing functionality

---

## Appendices

### A. Commands Reference

```bash
# Build
npm run build

# Test
npm test -- registry.test.ts
npm test -- composition-watcher.test.ts

# Deploy
npm run brat -- bit deploy tool-gateway --context staging

# Validate
bash planning/sprint-42-fcw4d1/validate-grockle-loading.sh
bash planning/sprint-42-fcw4d1/test-hot-reload.sh

# Check logs
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-gateway-1 2>&1" | grep composition

# Agent-dev
npm run brat -- mcp agent-dev.provision '{"name": "agent-dev-sprint-42"}'
npm run brat -- bit deploy tool-gateway --context agent-dev-sprint-42
npm run brat -- mcp agent-dev.destroy '{"name": "agent-dev-sprint-42", "confirm": true}'
```

### B. File Locations

**Modified Files**:
- `src/common/composition/registry.ts` (line 289-292)
- `src/apps/tool-gateway.ts` (add watcher integration)

**New Files**:
- `src/common/composition/composition-watcher.ts`
- `src/common/composition/composition-watcher.test.ts`
- `planning/sprint-42-fcw4d1/validate-grockle-loading.sh`
- `planning/sprint-42-fcw4d1/test-grockle-invocation.sh`
- `planning/sprint-42-fcw4d1/test-hot-reload.sh`

**Documentation**:
- `documentation/guides/compositions.md`

### C. Related Sprints

- **Sprint 41**: MCP Behavioral Compilation Architecture (created compositions table)
- **Sprint 27**: MCP server auto-discovery (RegistryWatcher pattern)
- **Sprint 24**: Claim check pattern (DocumentStore usage)

---

**Status**: Ready for Execution
**Next Action**: Begin Phase 1, Task 1 - Modify CompositionRegistry.list()
**Estimated Completion**: 2026-09-05 (1-2 days)

# Sprint 49: Platform Cleanup & Bug Fixes - Execution Plan

**Sprint Goal**: Address critical cleanup items from previous sprints affecting developer experience and composition subsystem reliability.

**Owner**: Lead Implementor (christophernavta)

**Estimated Duration**: 8-12 hours

---

## Problem Statement

Three distinct issues are impacting platform usability and reliability:

### Issue 1: `.mcp.json` Deletion During Test Runs
**Symptom**: Project root `.mcp.json` file (used for MCP server registration in Claude Desktop/Code) is deleted every time `npm test` runs.

**Root Cause**: Test `tools/brat/src/cli/__tests__/mcp-setup.test.ts:178-198` creates `.mcp.json` in project root (`process.cwd()`) for testing project-scope MCP setup, then cleans up at line 196 with `fs.unlinkSync(configPath)`.

**Impact**: Developers must re-run `brat mcp setup` after every test run to restore MCP server registration. This breaks the development workflow when using Claude Code with BitBrat's MCP server.

**Evidence**:
```typescript
// tools/brat/src/cli/__tests__/mcp-setup.test.ts:178-198
it('should create project scope config in project root', async () => {
  const projectRoot = process.cwd();  // <-- Uses actual project root
  const flags: McpSetupFlags = {
    scope: 'project',
    serverName: 'test-server',
    dryRun: false,
  };

  await cmdMcpSetup(flags);

  const configPath = path.join(projectRoot, '.mcp.json');
  expect(fs.existsSync(configPath)).toBe(true);

  // ... assertions ...

  // Clean up
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);  // <-- Deletes actual project .mcp.json
  }
});
```

---

### Issue 2: MCP Composition Visibility After Deploy
**Symptom**: After deploying tool-gateway (which registers compositions as MCP tools), compositions are not visible to llm-bot immediately. They appear after ~30 seconds or after an llm-bot restart.

**Root Cause**: `CompositionWatcher` (src/common/composition/composition-watcher.ts) uses polling with 30-second default interval. When tool-gateway starts:
1. `loadCompositions()` is called (line 1395 in tool-gateway.ts)
2. `CompositionWatcher.start()` begins polling (line 1404)
3. First poll doesn't execute until 30 seconds AFTER start
4. Compositions are only registered as tools when the first poll completes

**Impact**: Poor developer experience - compositions appear "missing" after deploy until watcher's first poll completes. Workaround is to restart llm-bot or wait 30+ seconds.

**Evidence**:
```typescript
// src/common/composition/composition-watcher.ts:77-178
const poll = async () => {
  // Detect additions, updates, deletions
};

// Set up polling interval
const intervalId = setInterval(poll, pollInterval);  // <-- No immediate execution
```

**Why llm-bot restart fixes it**: llm-bot reconnects to tool-gateway MCP server, which triggers full tool list sync including compositions loaded during startup.

---

### Issue 3: Grockle Composition Execution Error
**Symptom**: Calling the `grockle` composition tool results in execution error. Composition is located at `.worktrees/sprint-41-u18tqc/examples/compositions/grockle.yaml`.

**Root Cause**: **To be determined during investigation phase**. Likely causes:
1. **Template resolution bug**: Grockle uses template expression `{{notes}} {{description}}` (line 61). May be issue with template variable resolution in `CompositionExecutor.resolveTemplate()`.
2. **IfValue step bug**: Grockle uses `ifValue` with conditional `exists` check (lines 51-69). May be issue with conditional evaluation or value resolution.
3. **Missing tools**: Grockle calls `get_state` and `generate_image`. If these tools aren't registered, call will fail.
4. **Schema validation**: Input/output schema validation may be failing due to type mismatch.

**Impact**: Composition subsystem not functioning for real-world use cases. This blocks adoption of the composition learning system (Sprint 41 goal).

**Evidence Needed**:
- Actual error message from grockle execution
- tool-gateway logs showing composition execution attempt
- Validation that `get_state` and `generate_image` tools exist
- Template resolution trace logs

---

## Investigation & Fix Strategy

### Phase 1: Issue Investigation (1-2 hours)

#### Task 1.1: Validate Grockle Composition Location
- [ ] Check if grockle.yaml exists in main repo or only in sprint-41 worktree
- [ ] If in worktree only, copy to main repo `examples/compositions/`
- [ ] Register composition via `composition.register` MCP tool or REST API

#### Task 1.2: Reproduce Grockle Error
- [ ] Deploy tool-gateway and llm-bot to agent-dev context
- [ ] Use `composition.list_tools` to verify grockle tool is registered
- [ ] Use `composition.list` to verify grockle composition exists in PostgreSQL
- [ ] Invoke grockle via MCP: `grockle({ description: "test landscape" })`
- [ ] Capture full error message and stack trace
- [ ] Check tool-gateway logs for execution failure details

#### Task 1.3: Analyze Grockle Error
- [ ] Verify `get_state` and `generate_image` tools are registered
- [ ] Add TRACE-level logging to `CompositionExecutor.executeStep()`
- [ ] Add TRACE-level logging to `CompositionExecutor.resolveTemplate()`
- [ ] Re-run grockle with TRACE logging enabled
- [ ] Identify exact failure point (template resolution, tool call, validation)

---

### Phase 2: Fix Implementation (4-6 hours)

#### Fix 1: .mcp.json Test Isolation (1-2 hours)
**Solution**: Isolate test to use temporary directory instead of project root.

**Implementation**:
```typescript
// tools/brat/src/cli/__tests__/mcp-setup.test.ts
it('should create project scope config in project root', async () => {
  // Create temp directory to simulate project root
  const fakeProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-setup-project-'));

  // Mock process.cwd() to return fake root
  const originalCwd = process.cwd;
  process.cwd = () => fakeProjectRoot;

  try {
    const flags: McpSetupFlags = {
      scope: 'project',
      serverName: 'test-server',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const configPath = path.join(fakeProjectRoot, '.mcp.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcpServers['test-server']).toBeDefined();
  } finally {
    // Restore original cwd
    process.cwd = originalCwd;

    // Clean up fake project root
    if (fs.existsSync(fakeProjectRoot)) {
      fs.rmSync(fakeProjectRoot, { recursive: true, force: true });
    }
  }
});
```

**Validation**:
- [ ] Run `npm test` and verify `.mcp.json` still exists in project root
- [ ] Verify test still passes with mocked project root
- [ ] Verify test cleans up temp directory correctly

---

#### Fix 2: Composition Immediate Loading (2-3 hours)
**Solution**: Execute poll immediately on CompositionWatcher start, then begin interval.

**Implementation**:
```typescript
// src/common/composition/composition-watcher.ts:69-186
start() {
  const pollInterval = this.options.pollInterval || 30000;

  this.logger.info('composition_watcher.starting', {
    pollInterval,
  });

  // Poll function to check for changes
  const poll = async () => {
    // ... existing poll implementation ...
  };

  // Execute poll IMMEDIATELY on start
  poll().catch((err) => {
    this.logger.error('composition_watcher.initial_poll_failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  });

  // Then set up polling interval
  const intervalId = setInterval(poll, pollInterval);

  // Create unsubscribe function
  this.unsubscribe = () => {
    clearInterval(intervalId);
  };

  this.logger.info('composition_watcher.started');
}
```

**Alternative Solution** (if immediate poll causes timing issues):
Add `onStartup` callback to `CompositionWatcherOptions` and invoke it in tool-gateway's `start()` method after `loadCompositions()`.

**Validation**:
- [ ] Deploy tool-gateway to agent-dev
- [ ] Immediately check `composition.list_tools` output
- [ ] Verify compositions appear in tool list without 30s delay
- [ ] Verify llm-bot can invoke compositions immediately after tool-gateway starts
- [ ] Monitor logs for "composition_watcher.added" events at startup

---

#### Fix 3: Grockle Composition Error (1-2 hours)
**Solution**: TBD based on Phase 1 investigation findings.

**Likely Scenarios**:

**Scenario A: Template Resolution Bug**
- Add null/undefined checks in `CompositionExecutor.resolveTemplate()`
- Handle missing variables gracefully (substitute empty string or throw descriptive error)
- Add validation for template variable types (must be string/number)

**Scenario B: IfValue Step Bug**
- Fix conditional evaluation in `CompositionExecutor.evaluateCondition()`
- Add better error messages for `exists` condition failures
- Handle undefined/null values in `then`/`else` branches

**Scenario C: Missing Tools**
- Register `get_state` and `generate_image` tools in tool-gateway
- Or update grockle.yaml to use existing tools (`state.get`, `image.generate`)

**Scenario D: Schema Validation**
- Relax input/output schema validation for compositions
- Add better error messages showing expected vs actual types
- Fix grockle.yaml schema if incorrect

**Validation**:
- [ ] Invoke grockle via MCP with test description
- [ ] Verify execution succeeds and returns valid output
- [ ] Test edge cases (missing notes, long description, special characters)
- [ ] Verify TRACE logs show correct step execution

---

### Phase 3: Integration Testing (2-3 hours)

#### Test 1: Full Agent-Dev Validation
- [ ] Provision agent-dev context
- [ ] Deploy all services (`bit deploy --all --context agent-dev-sprint-49`)
- [ ] Run full test suite (`npm test`)
- [ ] Verify `.mcp.json` still exists after tests
- [ ] Register grockle composition via REST API
- [ ] Invoke grockle via dev MCP messaging tools
- [ ] Verify compositions visible immediately after tool-gateway deploy
- [ ] Destroy agent-dev context

#### Test 2: Composition Watcher Behavior
- [ ] Deploy tool-gateway
- [ ] Register new composition via REST API
- [ ] Verify composition appears in tool list within poll interval
- [ ] Update existing composition (modify YAML)
- [ ] Verify updated composition reloads correctly
- [ ] Delete composition
- [ ] Verify tool is unregistered from registry

#### Test 3: Test Suite Validation
- [ ] Run `npm test` 3 times consecutively
- [ ] Verify `.mcp.json` exists after each run
- [ ] Verify mcp-setup test still passes
- [ ] Verify no test failures related to compositions

---

### Phase 4: Documentation (1 hour)

#### Doc Updates
- [ ] Update `documentation/guides/composition-usage.md` with grockle example
- [ ] Document CompositionWatcher immediate loading behavior
- [ ] Add troubleshooting section for composition visibility issues
- [ ] Update test guidelines to avoid touching project root files

---

## Success Criteria

### Must Have
1. ✅ `.mcp.json` file persists after `npm test` runs
2. ✅ Compositions visible to llm-bot immediately after tool-gateway deploy (< 5 seconds)
3. ✅ Grockle composition executes successfully without errors
4. ✅ All existing tests pass
5. ✅ Agent-dev full deployment succeeds

### Nice to Have
1. ⭐ TRACE logging for composition execution helps debug future issues
2. ⭐ Template resolution error messages are descriptive and actionable
3. ⭐ Composition hot-reload documented with examples

---

## Risk Assessment

### Low Risk
- `.mcp.json` test fix: Isolated change, low blast radius
- Composition immediate loading: Backwards compatible, only changes timing

### Medium Risk
- Grockle error fix: Depends on root cause, may require executor changes

### Mitigation
- Use agent-dev for all testing before merging
- Add comprehensive logging for debugging
- Keep changes minimal and focused
- Fail-open where possible (don't break existing compositions)

---

## Estimated Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 1: Investigation | 1-2h | Grockle error analysis, tool verification |
| Phase 2: Implementation | 4-6h | 3 fixes + validation |
| Phase 3: Integration Testing | 2-3h | Agent-dev, composition watcher, test suite |
| Phase 4: Documentation | 1h | Guide updates, troubleshooting |
| **Total** | **8-12h** | **All phases** |

---

## Notes

- Sprint 41 worktree contains grockle.yaml - may need to merge or copy
- CompositionWatcher pattern mirrors RegistryWatcher (proven design)
- Test isolation is critical pattern for all CLI tests
- Immediate poll may cause startup race conditions - monitor closely

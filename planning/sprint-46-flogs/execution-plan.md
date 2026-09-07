# Fleet.logs Infrastructure Remediation - Execution Plan
**Sprint**: sprint-46-flogs
**Date**: 2026-09-07
**Owner**: Claude
**Status**: Planning

## Mission

**Fix critical observability gap**: Ensure all error-level logs are reliably retrieved, parsed, and displayed through the fleet.logs MCP tooling layer. No silent failures.

## Success Criteria

### Functional Requirements
- ✅ **All error logs visible**: The missing error log (d75e7c4c-dcb5-4d5f-870f-6081a7e66df8) must be retrievable
- ✅ **No silent failures**: Parse failures must be logged and counted
- ✅ **Accurate filtering**: `level: ["error"]` must return ALL error logs, no false negatives
- ✅ **Consistent behavior**: Same results whether using Loki or Docker backend

### Non-Functional Requirements
- ✅ **Backward compatibility**: Existing queries continue to work
- ✅ **Performance**: No regression in query latency
- ✅ **Observability**: Users can diagnose issues (counters, diagnostics)
- ✅ **Test coverage**: 90%+ coverage on parsing logic

### Validation
- ✅ **Integration test**: Query staging for the exact failing correlation ID
- ✅ **All existing tests pass** (24 tests in fleet.test.ts)
- ✅ **New tests added**: Edge cases, parse failures, level normalization

## Phases

### Phase 1: Root Cause Diagnosis (2-3 hours)
**Goal**: Identify the exact reason the error log was dropped

#### Tasks:
1. **Reproduce the issue locally**
   - Extract the exact error log line from staging
   - Create minimal test case: `parseDockerLogLine(errorLogLine, "llm-bot")`
   - Verify it returns `null` (confirming the bug)

2. **Identify failure point**
   - Add debug logging to parseDockerLogLine
   - Test regex match: `line.match(/\|\s*(\{.*\})/)`
   - Test JSON.parse step
   - Test normalizeLevel with actual values

3. **Document findings**
   - Update infrastructure-analysis.md with confirmed root cause
   - Add reproduction steps
   - Capture error stack trace if applicable

**Deliverables**:
- Confirmed root cause with evidence
- Minimal reproduction test case
- Updated analysis document

**Estimated Time**: 1-2 hours

---

### Phase 2: Immediate Fix (3-4 hours)
**Goal**: Fix the critical bug preventing error logs from appearing

#### Approach:
Based on most likely root causes (in priority order):

##### Option A: Fix Level Normalization (if severity uppercase issue)
```typescript
// log-parser.ts:87-95
export function normalizeLevel(level: string): LogLevel {
  const lower = level.toLowerCase();  // ← Ensure lowercase comparison
  if (lower === 'error' || lower === 'err' || lower === 'fatal') return 'error';
  if (lower === 'warn' || lower === 'warning') return 'warn';
  if (lower === 'info') return 'info';
  if (lower === 'debug') return 'debug';
  if (lower === 'trace') return 'trace';
  return 'info'; // Default
}
```

##### Option B: Add Error Logging (if parse exception)
```typescript
// log-parser.ts:33-67
export function parseDockerLogLine(line: string, serviceName: string): LogEntry | null {
  try {
    const composeMatch = line.match(/\|\s*(\{.*\})/);

    if (composeMatch) {
      return parseJsonLog(composeMatch[1], serviceName);
    }

    // ... fallback handling ...
  } catch (e) {
    // NEW: Log parse failures instead of silent drop
    if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_PARSER_DEBUG === 'true') {
      console.error('[log-parser] Failed to parse log line:', {
        error: e instanceof Error ? e.message : String(e),
        line: line.substring(0, 200), // First 200 chars
        serviceName
      });
    }
    return null;
  }
}
```

##### Option C: Fix Regex (if regex match fails)
```typescript
// Replace greedy regex with more precise JSON extraction
const composeMatch = line.match(/\|\s*(\{[^]*\})$/);  // Use [^] instead of . for multiline
// OR use a proper JSON start/end detector
```

#### Tasks:
1. **Implement the fix** based on confirmed root cause
2. **Add parse failure logging** (regardless of root cause)
3. **Add parse success/failure counters**
   ```typescript
   // Add to LogRetriever response
   {
     bit: string,
     logs: LogEntry[],
     stats: {
       scanned: number,
       parsed: number,
       failed: number,
       filtered: number
     }
   }
   ```

4. **Update tests**
   - Add test for the exact failing log line
   - Add tests for uppercase severity values
   - Add tests for malformed JSON

**Deliverables**:
- Bug fix committed
- Parse failure logging added
- Stats tracking implemented
- Tests added and passing

**Estimated Time**: 2-3 hours

---

### Phase 3: Validation (2 hours)
**Goal**: Verify the fix works in staging environment

#### Tasks:
1. **Local validation**
   ```bash
   npm test  # All existing tests pass
   npm run build
   ```

2. **Deploy to local environment**
   ```bash
   npm run local
   # Test with MCP client
   ```

3. **Integration test against staging**
   ```bash
   # Query the failing correlation ID
   fleet.logs({
     bit: "llm-bot",
     correlationId: "d75e7c4c-dcb5-4d5f-870f-6081a7e66df8",
     context: "staging"
   })
   # Verify error log at 22:45:31.975Z is now present
   ```

4. **Test level filtering**
   ```bash
   # Should return error logs (including the missing one)
   fleet.logs({
     bit: "llm-bot",
     level: ["error"],
     since: "2h",
     context: "staging"
   })
   ```

5. **Check stats output**
   - Verify scanned/parsed/failed counts make sense
   - Check for parse failure warnings in debug output

**Deliverables**:
- Validation results documented
- Screenshot/log showing error log now appears
- Stats output sample

**Estimated Time**: 1-2 hours

---

### Phase 4: Observability Enhancements (3-4 hours)
**Goal**: Prevent future silent failures through instrumentation

#### Tasks:
1. **Add pipeline metrics to MCP tool output**
   ```typescript
   // fleet.ts fleetLogsHandler response
   {
     bit: "llm-bot",
     count: 21,
     stats: {
       scanned: 2543,
       parsed: 2541,
       failed: 2,
       filtered: 2520,  // After level/correlation filtering
       returned: 21
     },
     logs: [...],
     warnings: [
       "2 log lines failed to parse (enable LOG_PARSER_DEBUG=true for details)"
     ]
   }
   ```

2. **Make Loki fallback explicit**
   ```typescript
   {
     backend: "loki" | "docker",
     lokiFallback: boolean,  // true if Loki was attempted but failed
     ...
   }
   ```

3. **Add result validation**
   ```typescript
   function validateLogEntry(entry: LogEntry): boolean {
     // Check required fields
     if (!entry.timestamp || !entry.level || !entry.service) {
       return false;
     }
     // Validate timestamp is valid ISO 8601
     if (isNaN(new Date(entry.timestamp).getTime())) {
       return false;
     }
     // Validate level is valid enum value
     if (!['error', 'warn', 'info', 'debug', 'trace'].includes(entry.level)) {
       return false;
     }
     return true;
   }
   ```

4. **Update formatter to show stats**
   ```typescript
   // formatText output header
   Retrieved 21 log entries from llm-bot (docker)
   Target: staging
   Stats: 2543 scanned, 2541 parsed, 2 failed, 2520 filtered
   Warnings: 2 parse failures (see debug logs)

   <logs>
   ```

**Deliverables**:
- Stats tracking fully implemented
- User-visible warnings for parse failures
- Backend/fallback information in output
- Validation layer added

**Estimated Time**: 2-3 hours

---

### Phase 5: Robustness Improvements (4-5 hours)
**Goal**: Handle edge cases and improve regex reliability

#### Tasks:
1. **Replace greedy regex** with robust JSON extraction
   ```typescript
   function extractJsonFromDockerLine(line: string): string | null {
     // Find pipe delimiter
     const pipeIndex = line.indexOf('|');
     if (pipeIndex === -1) return null;

     // Extract everything after pipe
     const afterPipe = line.substring(pipeIndex + 1).trim();

     // Check if it starts with {
     if (!afterPipe.startsWith('{')) return null;

     // Use JSON.parse to validate (it will throw if incomplete)
     try {
       JSON.parse(afterPipe);
       return afterPipe;
     } catch (e) {
       // Not valid JSON
       return null;
     }
   }
   ```

2. **Add comprehensive test suite**
   - Edge case: Nested JSON objects
   - Edge case: Arrays with objects
   - Edge case: Escaped quotes in strings
   - Edge case: Unicode characters
   - Edge case: Very long log lines (10KB+)
   - Edge case: Multiline JSON (shouldn't happen, but defensively handle)

3. **Add fuzzing tests**
   ```typescript
   // Generate random JSON-like strings and ensure no crashes
   for (let i = 0; i < 1000; i++) {
     const randomLine = generateRandomLogLine();
     const result = parseDockerLogLine(randomLine, "test-service");
     // Should either return LogEntry or null, never crash
   }
   ```

**Deliverables**:
- Regex replaced with robust JSON extraction
- 20+ edge case tests added
- Fuzzing test suite added
- All tests passing

**Estimated Time**: 3-4 hours

---

### Phase 6: Documentation & Cleanup (2 hours)
**Goal**: Document changes and ensure maintainability

#### Tasks:
1. **Update CLAUDE.md**
   - Document the bug and fix
   - Add section on fleet.logs debugging
   - Add examples of using stats output

2. **Update documentation/guides/fleet.md**
   - Add troubleshooting section
   - Document new stats output format
   - Add examples of parse failure debugging

3. **Add inline documentation**
   - JSDoc comments on all public functions
   - Explain non-obvious logic (regex, normalization)

4. **Create verification report**
   - Document all changes made
   - List all tests added
   - Validation results from staging

5. **Create retrospective**
   - What went wrong (silent failure anti-pattern)
   - What was learned
   - Process improvements (better testing, earlier integration tests)

**Deliverables**:
- Updated documentation
- Verification report
- Retrospective
- Key learnings document

**Estimated Time**: 1-2 hours

---

## Risk Mitigation

### Risk 1: Fix doesn't resolve the issue
**Likelihood**: Low
**Impact**: High
**Mitigation**:
- Reproduce issue FIRST before fixing
- Test fix against exact failing log line
- If first hypothesis wrong, iterate through other possibilities

### Risk 2: Fix introduces regressions
**Likelihood**: Medium
**Impact**: High
**Mitigation**:
- Run full test suite before and after
- Test against staging with real traffic
- Monitor parse failure rate (should decrease, not increase)

### Risk 3: Performance degradation
**Likelihood**: Low
**Impact**: Medium
**Mitigation**:
- Benchmark parsing before/after changes
- If stats add >10% overhead, make them optional

### Risk 4: Loki vs Docker inconsistency
**Likelihood**: Medium
**Impact**: Low
**Mitigation**:
- Test both backends with same query
- Document known differences
- Consider standardizing on one backend

## Timeline

**Total Estimated Time**: 16-20 hours (2-3 days)

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Diagnosis | 1-2h | None |
| Phase 2: Fix | 2-3h | Phase 1 complete |
| Phase 3: Validation | 1-2h | Phase 2 complete |
| Phase 4: Observability | 2-3h | Phase 2 complete (can overlap with Phase 3) |
| Phase 5: Robustness | 3-4h | Phase 2 complete (can be done in parallel) |
| Phase 6: Documentation | 1-2h | All phases complete |

**Recommended Schedule**:
- **Day 1**: Phases 1-3 (critical path, must be done sequentially)
- **Day 2**: Phases 4-5 (can be parallelized)
- **Day 3**: Phase 6 + final validation

## Rollout Strategy

### Testing
1. ✅ Local unit tests (all phases)
2. ✅ Local integration tests (Phase 3)
3. ✅ Staging validation (Phase 3)
4. ⏸️  Production rollout (post-sprint, after monitoring period)

### Deployment
- **Dev-MCP**: Deploy immediately after Phase 2 for local testing
- **Staging**: Deploy after Phase 3 validation
- **Production**: Deploy after 24h monitoring in staging

### Monitoring
- Track parse failure rate (new metric)
- Monitor query latency (ensure no regression)
- Count error log retrievals (should increase after fix)

## Dependencies

### External
- None (all changes internal to dev-mcp tooling)

### Internal
- Sprint 44/45 fix must be present (already merged in current branch)
- Docker must be running for local tests
- Staging environment must be accessible for validation

## Success Metrics

### Quantitative
- ✅ Parse failure rate < 0.1%
- ✅ Error log retrieval accuracy: 100%
- ✅ Test coverage: >90% on log-parser.ts
- ✅ Zero regressions in existing tests

### Qualitative
- ✅ Users can diagnose log retrieval issues (via stats output)
- ✅ Documentation is clear and comprehensive
- ✅ Code is maintainable (good comments, clear structure)

## Acceptance Criteria

### Must Have (P0)
- [ ] The missing error log (d75e7c4c-dcb5-4d5f-870f-6081a7e66df8) is retrievable
- [ ] Parse failures are logged (not silent)
- [ ] All existing tests pass
- [ ] At least 5 new tests added for edge cases

### Should Have (P1)
- [ ] Stats tracking implemented (scanned/parsed/failed)
- [ ] Integration test against staging passes
- [ ] Documentation updated

### Nice to Have (P2)
- [ ] Robust JSON extraction (replacing regex)
- [ ] Fuzzing test suite
- [ ] Comprehensive edge case coverage

## Approvals

- **Technical Owner**: Claude (implementer)
- **Stakeholder**: Christopher Navta (user who discovered the bug)
- **QA Validation**: Staging integration test results

---

## Next Steps

1. ✅ Review and approve this execution plan
2. ⏭️  Create prioritized YAML backlog
3. ⏭️  Create git worktree for sprint
4. ⏭️  Begin Phase 1: Root Cause Diagnosis

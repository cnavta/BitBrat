# Composition Debug Logging - Execution Plan

**Sprint**: 47
**Date**: 2026-09-08
**Lead Implementor**: Claude (navta3)
**Estimated Duration**: 18-25 hours

---

## Executive Summary

This sprint will add comprehensive trace/debug logging to the Composition subsystem (compiler, executor, registry, watcher) to enable rapid diagnosis of composition failures. Currently, only 5 debug statements exist across the entire composition directory, making production debugging nearly impossible.

**Deliverables**:
- 100+ structured log statements across compilation/execution pipeline
- Logger dependency injection in CompositionCompiler and CompositionExecutor
- Enhanced unit tests with log assertion coverage
- Integration validation in agent-dev environment
- Documentation updates for debugging compositions

---

## Implementation Phases

### Phase 1: Foundation - Logger Injection & Type Updates

**Duration**: 2-3 hours
**Priority**: CRITICAL (blocks all other phases)

#### Tasks

1. **Update CompositionCompiler constructor signature**
   - File: `src/common/composition/compiler.ts`
   - Add logger parameter to constructor
   - Import Pino Logger type
   - Store logger as private field

   ```typescript
   import { Logger } from 'pino';

   export class CompositionCompiler {
     constructor(
       private registry: ToolRegistryInterface,
       private logger: Logger
     ) {}
   }
   ```

2. **Update CompositionExecutor constructor signature**
   - File: `src/common/composition/executor.ts`
   - Add logger parameter to constructor
   - Import Pino Logger type
   - Store logger as private field

   ```typescript
   import { Logger } from 'pino';

   export class CompositionExecutor {
     constructor(
       private registry: ToolRegistryInterface,
       private logger: Logger
     ) {}
   }
   ```

3. **Update CompositionRegistry constructor signature**
   - File: `src/common/composition/registry.ts`
   - Add logger parameter to constructor
   - Pass logger to CompositionCompiler constructor
   - Store logger as private field

   ```typescript
   export class CompositionRegistry {
     private compiler: CompositionCompiler;

     constructor(
       private store: DocumentStore,
       private toolRegistry: ToolRegistryInterface,
       private logger: Logger
     ) {
       this.compiler = new CompositionCompiler(toolRegistry, logger);
     }
   }
   ```

4. **Update tool-gateway.ts instantiation**
   - File: `src/apps/tool-gateway.ts`
   - Update CompositionRegistry instantiation to pass logger
   - Update CompositionExecutor instantiation to pass logger

   ```typescript
   this.compositionRegistry = new CompositionRegistry(
     compositionStore,
     this.toolRegistry,
     this.logger.child({ component: 'composition:registry' })
   );

   this.compositionExecutor = new CompositionExecutor(
     this.toolRegistry,
     this.logger.child({ component: 'composition:executor' })
   );
   ```

5. **Update all test files**
   - Files: `compiler.test.ts`, `executor.test.ts`, `registry.test.ts`
   - Create mock logger fixture
   - Update all test instantiations

   ```typescript
   const mockLogger: Logger = {
     info: jest.fn(),
     debug: jest.fn(),
     trace: jest.fn(),
     warn: jest.fn(),
     error: jest.fn(),
     child: jest.fn(() => mockLogger),
   } as unknown as Logger;
   ```

6. **Verify build succeeds**
   - Run `npm run build`
   - Fix any TypeScript errors
   - Confirm no runtime issues

#### Success Criteria
- ✅ TypeScript compiles without errors
- ✅ All tests pass
- ✅ Logger is accessible in all compiler/executor/registry methods

---

### Phase 2: Compiler Logging Implementation

**Duration**: 4-6 hours
**Priority**: HIGH
**Dependencies**: Phase 1

#### Tasks

1. **Add compilation entry/exit logging**
   - Method: `compile()`
   - Log level: INFO
   - Fields: compositionName, duration, valid, contentHash, dependencies

2. **Add validation phase logging**
   - Method: `validate()`
   - Log level: DEBUG (start/complete), TRACE (sub-phases)
   - Fields: compositionName, stepCount, errorCount, warningCount

3. **Add tool resolution logging (CRITICAL)**
   - Method: `findTool()`
   - Log level: TRACE (all attempts), WARN (not found)
   - Fields: toolId, attemptedId, resolvedId, source, attemptsCount
   - Include all 5 lookup variants with individual trace logs

4. **Add cycle detection logging**
   - Method: `detectCycles()`
   - Log level: TRACE (start, graph built, no cycles), ERROR (cycle detected)
   - Fields: compositionName, graph, cycle

5. **Add reference validation logging**
   - Method: `validateReferences()`
   - Log level: TRACE (start, step IDs extracted), WARN (errors found)
   - Fields: compositionName, stepIds, errorCount, errors

6. **Add template validation logging**
   - Method: `validateTemplates()`
   - Log level: TRACE (start), DEBUG (complete)
   - Fields: compositionName, errorCount, warningCount

7. **Add dependency resolution logging**
   - Method: `resolveDependencies()`
   - Log level: TRACE
   - Fields: toolIds, dependencyCount

8. **Add content hash computation logging**
   - Method: `computeHash()`
   - Log level: TRACE
   - Fields: contentHash, canonicalSize

#### Success Criteria
- ✅ Compilation failures log full context before throwing
- ✅ Tool lookup attempts are traced with all variants tried
- ✅ Validation errors include structured error data
- ✅ All logs use standardized component/operation fields

---

### Phase 3: Executor Logging Implementation

**Duration**: 6-8 hours
**Priority**: HIGH
**Dependencies**: Phase 1

#### Tasks

1. **Add execution entry/exit logging**
   - Method: `execute()`
   - Log level: INFO
   - Fields: compositionId, compositionName, correlationId, sessionId, status, duration, stepsExecuted

2. **Add input validation logging**
   - Method: `validateInput()`
   - Log level: TRACE (start, passed), ERROR (failed)
   - Fields: errors (path, message)

3. **Add output validation logging**
   - Method: `validateOutput()`
   - Log level: TRACE (start, passed), ERROR (failed)
   - Fields: errors (path, message)

4. **Add step execution logging (CRITICAL)**
   - Loop in `execute()` method
   - Log level: DEBUG (start, complete, skipped)
   - Fields: stepId, stepType, duration, outputType, reason, correlationId
   - Include per-step timing

5. **Add condition evaluation logging**
   - Method: `evaluateCondition()`
   - Log level: DEBUG (when guard), TRACE (all condition types)
   - Fields: stepId, shouldExecute, conditionType, result

6. **Add tool invocation logging**
   - Method: `executeCallStep()`
   - Log level: TRACE (start, args resolved, complete), ERROR (not found)
   - Fields: stepId, toolId, argumentKeys, duration, resultType, correlationId

7. **Add reference resolution logging (CRITICAL)**
   - Method: `resolveReference()`
   - Log level: TRACE (start, resolved), ERROR (invalid namespace)
   - Fields: namespace, pointer, valueType, valueExists

8. **Add pointer traversal logging**
   - Method: `getByPointer()`
   - Log level: TRACE
   - Fields: pointer, parts, traversalDepth, valueFound

9. **Add template resolution logging**
   - Method: `resolveTemplate()`
   - Log level: TRACE (start, variable resolved, complete)
   - Fields: templateString, variableCount, variableName, resolvedType, resultLength

10. **Add value resolution logging**
    - Method: `resolveValue()`
    - Log level: TRACE
    - Fields: valueType (reference, template, array, object, literal)

11. **Add IfValueStep logging**
    - Method: `executeIfValueStep()`
    - Log level: DEBUG
    - Fields: stepId, conditionResult, branchTaken

#### Success Criteria
- ✅ Execution trace shows step-by-step progression
- ✅ Reference resolution failures log full pointer traversal
- ✅ Tool invocations log arguments and results
- ✅ Condition evaluation logs operands and outcomes
- ✅ Template interpolation logs variable resolution

---

### Phase 4: Registry Logging Implementation

**Duration**: 2-3 hours
**Priority**: MEDIUM
**Dependencies**: Phase 1

#### Tasks

1. **Add registration logging**
   - Method: `register()`
   - Log level: INFO (start, deduplicated, registered)
   - Fields: compositionName, compositionId, version, contentHash, existingId

2. **Add update logging**
   - Method: `update()`
   - Log level: INFO
   - Fields: compositionName, oldVersion, newVersion, contentHash

3. **Add lookup logging**
   - Method: `get()`
   - Log level: DEBUG (start, found), WARN (not found)
   - Fields: name, version, compositionId

4. **Add list logging**
   - Method: `list()`
   - Log level: DEBUG
   - Fields: resultCount, filters

5. **Add version listing logging**
   - Method: `listVersions()`
   - Log level: DEBUG
   - Fields: name, versionCount, versions

6. **Add deduplication logging**
   - Method: `findByContentHash()`
   - Log level: TRACE
   - Fields: contentHash, found, compositionId

#### Success Criteria
- ✅ Registration shows deduplication decisions
- ✅ Version management is traceable
- ✅ Lookup failures log attempted criteria

---

### Phase 5: Watcher Enhancement

**Duration**: 1 hour
**Priority**: LOW
**Dependencies**: None (watcher already has logging)

#### Tasks

1. **Add structured fields to existing logs**
   - File: `src/common/composition/composition-watcher.ts`
   - Add component field: `'composition:watcher'`
   - Add operation field for each log
   - Add correlationId where applicable

2. **Add composition reload success logging**
   - Currently only logs errors, not successes
   - Add INFO log for successful reloads
   - Fields: file, compositionName, version

#### Success Criteria
- ✅ Watcher logs are consistent with compiler/executor/registry format
- ✅ File change events are traceable to specific compositions

---

### Phase 6: MCP Tool Handler Enhancement

**Duration**: 2-3 hours
**Priority**: HIGH
**Dependencies**: Phase 2, Phase 3

#### Tasks

1. **Add logging to composition.register handler**
   - File: `src/apps/tool-gateway.ts`
   - Log level: INFO (start, complete, failed)
   - Fields: compositionName, compositionId, sessionId, duration

2. **Add logging to composition.execute handler**
   - Log level: INFO (start, complete, failed)
   - Generate correlationId
   - Pass correlationId to executor
   - Fields: compositionId, correlationId, sessionId, status, duration

3. **Add logging to composition.list handler**
   - Log level: DEBUG
   - Fields: filters, resultCount, sessionId

4. **Add logging to composition.get handler**
   - Log level: DEBUG
   - Fields: name, version, found, sessionId

5. **Add logging to composition.delete handler**
   - Log level: INFO
   - Fields: compositionId, name, version, sessionId

6. **Update ExecutionContext to include correlationId**
   - Ensure correlationId flows from MCP handler → executor → step execution
   - Add correlationId to all executor log statements

#### Success Criteria
- ✅ MCP tool invocations are traceable via correlationId
- ✅ Composition execution has end-to-end correlation
- ✅ User sessions are identifiable in logs

---

### Phase 7: Test Coverage & Validation

**Duration**: 3-4 hours
**Priority**: HIGH
**Dependencies**: All previous phases

#### Tasks

1. **Update compiler unit tests**
   - File: `src/common/composition/compiler.test.ts`
   - Add log assertion tests for all critical paths
   - Verify compilation_started/completed logs
   - Verify tool_not_found logs
   - Verify cycle detection logs
   - Example:
     ```typescript
     expect(mockLogger.info).toHaveBeenCalledWith(
       'compilation_started',
       expect.objectContaining({
         component: 'composition:compiler',
         operation: 'compile',
       })
     );
     ```

2. **Update executor unit tests**
   - File: `src/common/composition/executor.test.ts`
   - Add log assertion tests for all critical paths
   - Verify execution_started/completed logs
   - Verify step_started/completed logs
   - Verify reference resolution logs
   - Verify condition evaluation logs

3. **Update registry unit tests**
   - File: `src/common/composition/registry.test.ts`
   - Add log assertion tests
   - Verify registration logs
   - Verify deduplication logs

4. **Run full test suite**
   - Execute `npm test`
   - Fix any failing tests
   - Confirm 100% pass rate

5. **Integration testing in agent-dev**
   - Provision agent-dev context
   - Deploy tool-gateway with logging changes
   - Register test composition with errors (missing tool, circular dep, etc.)
   - Execute test composition
   - Retrieve logs via `fleet.logs({ bit: 'tool-gateway', level: ['trace'], limit: 500 })`
   - Verify log sequence and structured data

6. **Performance testing**
   - Execute composition 100 times
   - Measure p50, p95, p99 latency
   - Confirm logging overhead < 5%
   - Test with TRACE disabled (production mode)

#### Success Criteria
- ✅ All unit tests pass
- ✅ Log assertions cover critical paths
- ✅ Integration test shows complete execution trace
- ✅ Logging overhead is acceptable

---

### Phase 8: Documentation & Cleanup

**Duration**: 2 hours
**Priority**: MEDIUM
**Dependencies**: Phase 7

#### Tasks

1. **Update composition-usage.md guide**
   - File: `documentation/guides/composition-usage.md`
   - Add "Debugging Compositions" section
   - Document log levels and what to expect at each level
   - Provide example log queries for common debugging scenarios

2. **Create debugging-compositions.md guide** (NEW)
   - File: `documentation/guides/debugging-compositions.md`
   - Document log structure and fields
   - Provide troubleshooting flowcharts
   - Include example Loki/CloudWatch queries
   - List common error patterns and how to diagnose them

3. **Update CLAUDE.md patterns** (optional)
   - File: `CLAUDE.md`
   - Add "Debugging Compositions" pattern
   - Document how to use fleet.logs to diagnose composition issues

4. **Code cleanup**
   - Remove any commented-out code
   - Ensure consistent log message naming
   - Verify all logs use structured fields
   - Run linter: `npm run lint`

#### Success Criteria
- ✅ Documentation clearly explains how to debug compositions
- ✅ Examples demonstrate real-world debugging scenarios
- ✅ Code is clean and linted

---

## Rollout Strategy

### Development Environment
1. Complete all phases in sprint worktree
2. Test in local environment with LOG_LEVEL=trace
3. Verify no regressions in existing tests

### Agent-Dev Environment
1. Provision agent-dev context
2. Deploy tool-gateway with changes
3. Test with real compositions
4. Verify log output quality

### Staging Environment
1. Deploy with LOG_LEVEL=debug
2. Monitor log volume
3. Validate structured logging works with Loki/CloudWatch
4. Test correlation ID tracing

### Production Environment
1. Deploy with LOG_LEVEL=info (default)
2. Monitor for performance regressions
3. Enable DEBUG/TRACE on-demand for troubleshooting

---

## Success Metrics

### Quantitative
- **Log coverage**: 5 → 100+ log statements
- **Test coverage**: All new logs covered by unit tests
- **Performance**: Logging overhead < 5% (with TRACE disabled)
- **Build time**: No significant increase

### Qualitative
- **Debuggability**: Team can diagnose composition failures using logs alone
- **Traceability**: Can trace execution from MCP call → compilation → execution → result
- **Actionability**: Error logs provide clear remediation steps

---

## Risk Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance degradation | HIGH | LOW | Use conditional logging, default to INFO in prod |
| Log volume overflow | MEDIUM | MEDIUM | Structured logging enables efficient filtering |
| Breaking existing tests | HIGH | MEDIUM | Comprehensive test updates in Phase 7 |
| Logger injection complexity | MEDIUM | LOW | Phased approach, start with foundation |
| Log noise obscures issues | MEDIUM | MEDIUM | Clear log level semantics, structured fields |

---

## Dependencies

### External
- Pino logger available in tool-gateway
- Structured logging infrastructure (Loki/CloudWatch)
- Agent-dev environment for testing

### Internal
- Phase 1 must complete before all other phases
- Phases 2-6 can run in parallel after Phase 1
- Phase 7 requires all implementation phases complete
- Phase 8 requires Phase 7 complete

---

## Timeline

```
Week 1:
  Day 1: Phase 1 (Foundation) - 3 hours
  Day 2: Phase 2 (Compiler) - 6 hours
  Day 3: Phase 3 (Executor) - 8 hours
  Day 4: Phase 4 (Registry) + Phase 5 (Watcher) + Phase 6 (MCP) - 6 hours
  Day 5: Phase 7 (Testing) + Phase 8 (Docs) - 6 hours

Total: ~29 hours (fits within 1 week sprint)
```

---

## Acceptance Criteria

Sprint is complete when:
1. ✅ All 8 phases complete
2. ✅ TypeScript builds without errors
3. ✅ All tests pass (100% pass rate)
4. ✅ Integration test in agent-dev shows complete execution trace
5. ✅ Documentation updated with debugging guide
6. ✅ Performance overhead < 5%
7. ✅ PR reviewed and approved
8. ✅ Merged to main branch

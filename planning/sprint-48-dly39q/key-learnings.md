# Sprint 48 Key Learnings

**Sprint ID**: sprint-48-dly39q
**Title**: Composition Debug Logging Infrastructure
**Date**: 2026-09-08

---

## Technical Learnings

### 1. Logger Dependency Injection Architecture

**Learning**: Logger injection must happen at construction time, not as lazy initialization

**Context**:
```typescript
// ❌ BAD: Lazy logger initialization
export class CompositionCompiler {
  private logger?: Logger;
  compile(schema: CompositionSchema, logger?: Logger) {
    this.logger = logger || console;  // Fragile
  }
}

// ✅ GOOD: Constructor injection
export class CompositionCompiler {
  constructor(
    private registry: ToolRegistryInterface,
    private logger: Logger  // Required dependency
  ) {}
}
```

**Why it matters**:
- Ensures logger is ALWAYS available (no undefined checks)
- Prevents console.log fallback pollution
- Enables logger child strategy (`logger.child({ component })`)
- Makes dependency explicit in type system

**Apply to**: All future service/utility classes requiring logging

---

### 2. Log Event Naming Convention

**Learning**: Kebab-case with component prefix enables efficient log filtering

**Pattern**:
```
{component}_{operation}_{phase}_{outcome}
```

**Examples**:
- `compiler_schema_parsing_started` (component: compiler, operation: schema_parsing, phase: started)
- `executor_step_execution_succeeded` (component: executor, operation: step_execution, outcome: succeeded)
- `registry_register_deduplicated` (component: registry, operation: register, outcome: deduplicated)

**Loki Query Benefits**:
```logql
# All compiler events
{service="tool-gateway"} |~ "compiler_"

# All failures across composition system
{service="tool-gateway"} |~ "(compiler|executor|registry)_.*_(failed|error)"

# Step execution lifecycle
{service="tool-gateway"} |~ "executor_step_.*_(started|succeeded|failed)"
```

**Apply to**: All future structured logging implementations

---

### 3. Logging Severity Level Strategy

**Learning**: Use severity levels based on operational impact, not implementation complexity

**Level Assignment**:

| Level | Usage | Examples | Query Priority |
|-------|-------|----------|----------------|
| **trace** | Phase markers, hot paths | `compiler_compiling_tools`, `executor_resolving_value` | Development only |
| **debug** | Operational details | `compiler_tool_resolved`, `executor_variable_updated` | Active debugging |
| **info** | State changes, milestones | `registry_register_succeeded`, `executor_composition_completed` | Audit trail |
| **warn** | Recoverable issues | `registry_delete_not_found`, `executor_tool_missing` | Monitoring alerts |
| **error** | Failures requiring action | `compiler_compilation_failed`, `executor_composition_failed` | Incident response |

**Anti-pattern**:
```typescript
// ❌ BAD: Log level based on code location
this.logger.trace('Starting operation');  // Just because it's "early"
this.logger.info('Variable assignment');   // Over-promoting routine ops

// ✅ GOOD: Log level based on significance
this.logger.trace('resolver_checking_template');  // High-frequency, low-impact
this.logger.debug('resolver_value_resolved');     // Routine operational detail
this.logger.info('executor_composition_completed'); // Significant state change
```

**Apply to**: All future logging implementations, monitoring dashboard design

---

### 4. Metadata Consistency Across Log Events

**Learning**: Consistent metadata fields enable correlation and filtering

**Core Metadata Fields**:
```typescript
interface CompositionLogContext {
  correlationId?: string;     // Links events across service boundaries
  compositionId?: string;     // Identifies specific composition
  compositionName?: string;   // Human-readable composition identifier
  version?: number;           // Composition version
  stepIndex?: number;         // Current step position
  stepName?: string;          // Step identifier
  toolName?: string;          // Tool being invoked
  variableName?: string;      // Variable being manipulated
}
```

**Benefits**:
- **Correlation**: Follow single composition execution across all log events
- **Filtering**: Isolate issues to specific composition or step
- **Aggregation**: Count failures per composition, tool, or step
- **Debugging**: Reconstruct execution state from logs alone

**Example Usage**:
```logql
# All events for specific composition execution
{service="tool-gateway"} | json | correlationId="abc-123"

# All failures in specific step
{service="tool-gateway"} | json | stepName="fetch_user_data" | level="error"
```

**Apply to**: Event-driven architectures, distributed tracing, audit logging

---

### 5. Test-Driven Logging Implementation

**Learning**: Update test mocks BEFORE adding logging to catch API breaks early

**Process**:
1. **Add logger to constructor** → Tests fail (missing logger parameter)
2. **Update all test files** → Tests pass (logger mocked)
3. **Add logging calls** → Tests remain passing (logger.debug called)
4. **Verify log calls** (optional) → Tests validate logging behavior

**Example**:
```typescript
// Step 1: Update constructor (breaks tests)
export class CompositionCompiler {
  constructor(
    private registry: ToolRegistryInterface,
    private logger: Logger  // NEW - breaks existing tests
  ) {}
}

// Step 2: Update tests (fixes tests)
const mockLogger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
} as unknown as Logger;

const compiler = new CompositionCompiler(mockRegistry, mockLogger);

// Step 3: Add logging (tests still pass)
compile(schema: CompositionSchema) {
  this.logger.debug('compiler_schema_parsing_started', { compositionName: schema.name });
  // ...implementation...
}

// Step 4: Verify logging (optional)
expect(mockLogger.debug).toHaveBeenCalledWith(
  'compiler_schema_parsing_started',
  expect.objectContaining({ compositionName: 'test-composition' })
);
```

**Apply to**: Any infrastructure change requiring constructor parameter additions

---

### 6. Fail-Open Logging Design

**Learning**: Logging failures should NEVER block core functionality

**Implementation Patterns**:

```typescript
// ✅ GOOD: Logging wrapped in try/catch (if risky)
try {
  this.logger.debug('operation_started', metadata);
} catch (err) {
  // Silent failure - logging is observability, not functionality
}

// ✅ BETTER: Pino handles errors internally (no try/catch needed)
this.logger.debug('operation_started', metadata);
// Pino will log to stderr if serialization fails, but won't throw

// ❌ BAD: Logging failure blocks execution
const logMessage = buildComplexLogMessage();  // Throws if metadata invalid
this.logger.debug('operation', logMessage);   // Execution stops on error
```

**Why it matters**:
- Logging is for observability, not correctness
- Production systems should degrade gracefully
- Better to lose log event than fail user request

**Apply to**: All observability infrastructure (metrics, tracing, profiling)

---

### 7. Console.log Replacement Strategy

**Learning**: Identify and replace ALL console.* calls with structured logging

**Search Pattern**:
```bash
# Find all console.log/error/warn calls
grep -rn "console\." src/common/composition/
```

**Replacement Table**:
| Console Call | Logger Call | Metadata |
|--------------|-------------|----------|
| `console.log(msg)` | `logger.debug(event, {})` | Add structured metadata |
| `console.error(err)` | `logger.error(event, { error: err.message, stack: err.stack })` | Preserve stack trace |
| `console.warn(msg)` | `logger.warn(event, {})` | Add context |

**Example Replacement**:
```typescript
// ❌ BEFORE
console.error(`Failed to compile composition ${name}`, err);

// ✅ AFTER
this.logger.error('registry_list_compilation_failed', {
  compositionName: name,
  error: err.message,
  stack: err.stack
});
```

**Benefits**:
- All logs queryable in Loki
- Consistent log format
- Structured metadata enables filtering
- No stdout pollution

**Apply to**: All legacy code migration, new feature development

---

### 8. Logging in Error Paths

**Learning**: Error paths need MORE logging, not less

**Anti-pattern**:
```typescript
// ❌ BAD: Throw without logging
if (!tool) {
  throw new Error(`Tool ${toolName} not found`);
}
```

**Best Practice**:
```typescript
// ✅ GOOD: Log before throw (with context)
if (!tool) {
  this.logger.error('compiler_tool_not_found', {
    toolName,
    compositionName: schema.name,
    availableTools: this.registry.listTools().map(t => t.name)
  });
  throw new Error(`Tool ${toolName} not found`);
}

// ✅ BETTER: Log in catch block (preserve original error)
try {
  await tool.execute(args, context);
} catch (err) {
  this.logger.error('executor_tool_execution_failed', {
    toolName,
    stepName,
    correlationId,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
  throw err;  // Re-throw to preserve stack
}
```

**Why it matters**:
- Error logs are PRIMARY debugging tool
- Stack traces get lost without logging
- Context (composition name, step, tool) is essential
- Helps distinguish between error types

**Apply to**: All error handling, exception middleware, try/catch blocks

---

### 9. Log Event Catalog Maintenance

**Learning**: Maintain centralized log event catalog in sprint artifacts

**Structure** (backlog.yaml):
```yaml
tasks:
  - id: COMP-LOG-201
    title: Add schema parsing logging
    logEvents:
      - name: compiler_schema_parsing_started
        level: debug
        metadata: [compositionName, schemaKeys]
      - name: compiler_schema_parsed
        level: debug
        metadata: [compositionName, stepCount, toolCount]
```

**Benefits**:
- Pre-planning prevents duplicate event names
- Ensures consistent metadata across related events
- Documents logging coverage before implementation
- Serves as reference for future debugging

**Maintenance Process**:
1. Define log events in backlog during planning
2. Update phase completion docs with actual events
3. Create final log event catalog in verification report
4. Reference catalog when debugging issues

**Apply to**: All future logging sprints, monitoring dashboard design

---

### 10. Phase-Based Implementation Strategy

**Learning**: Foundation phases (DI, types) MUST complete before feature phases

**Sprint Structure**:
```
Phase 1 (Foundation): Logger injection, type updates
  ↓ (blocks all other phases)
Phase 2-N (Features): Actual logging implementation
```

**Why This Works**:
- Tests fail immediately if DI is incomplete
- Type errors catch missed injection points
- Feature phases can run in parallel (if desired)
- Clear separation of concerns

**Anti-pattern**:
```
Phase 1: Add compiler logging
Phase 2: Add executor logging
Phase 3: Inject logger dependencies  ❌ TOO LATE
```

**Apply to**: Any sprint requiring dependency injection, API changes, interface updates

---

## Process Learnings

### 11. Optional Phase Identification

**Learning**: Identify optional vs critical phases during planning, not execution

**Critical Phase Criteria**:
- ✅ Required for core user functionality
- ✅ Blocks subsequent phases
- ✅ Addresses primary sprint goal
- ✅ High impact on debugging/observability

**Optional Phase Criteria**:
- ❌ Convenience feature (not essential)
- ❌ Redundant with existing logging
- ❌ Low impact on core use cases
- ❌ Can be deferred without risk

**Example (This Sprint)**:
- **Critical**: Phases 1-4 (foundation, compiler, executor, registry)
- **Optional**: Phase 5 (watcher logging), Phase 6 (MCP tool logging)

**Apply to**: Sprint planning, mid-sprint scope adjustments

---

### 12. Documentation-As-You-Go

**Learning**: Write phase completion docs immediately after finishing each phase

**Benefits**:
- Details are fresh in memory
- Log events are in context
- Easier to write cumulative summaries
- Evidence available for verification report

**Template** (phase-N-completion-status.md):
```markdown
# Phase N Completion Status
**Date**: YYYY-MM-DD
**Status**: ✅ COMPLETE

## Summary
[What was accomplished]

## Completed Tasks
[Task-by-task breakdown with file changes]

## Verification
[Build status, test results]

## Log Event Catalog
[All events added with metadata]

## Key Learnings
[Phase-specific insights]
```

**Apply to**: All multi-phase sprints, especially infrastructure changes

---

### 13. Agent-Dev Skip Criteria

**Learning**: Agent-dev validation can be skipped for passive infrastructure changes

**Skip Criteria** (ALL must be true):
- ✅ No runtime behavior changes
- ✅ Fail-open design (failures don't block functionality)
- ✅ No new message handlers or subscriptions
- ✅ No architecture.yaml or deployment changes
- ✅ Unit tests provide sufficient validation
- ✅ No external service integrations

**ALWAYS Validate** (ANY is true):
- ❌ New services or message handlers
- ❌ Database schema changes
- ❌ Deployment configuration changes
- ❌ Integration with external services
- ❌ User-facing behavior changes
- ❌ Performance-critical code paths

**This Sprint**: Skipped agent-dev ✅ (logging is passive, fail-open, no behavior changes)

**Apply to**: Sprint planning, sprint completion criteria

---

## Meta-Learnings

### 14. Logging ROI vs Cost

**Investment**: ~6 hours implementation + testing
**Return**: 103 structured log events enabling:
- Rapid composition failure diagnosis
- Production debugging without code changes
- Audit trail for composition executions
- Performance profiling of step execution
- Tool usage analytics

**ROI Factors**:
- **High**: Complex subsystems with multi-step workflows (compositions)
- **Medium**: Event-driven flows with async operations
- **Low**: Simple CRUD operations with deterministic paths

**Apply to**: Prioritizing observability investments

---

### 15. Structured Logging as Documentation

**Insight**: Good log events document code behavior better than comments

**Example**:
```typescript
// ❌ Comments can go stale
// Check if composition already exists with same content hash
const existing = await this.store.get(/* ... */);

// ✅ Logs stay current (code wouldn't work without them)
this.logger.trace('registry_checking_deduplication', {
  compositionName: schema.name,
  contentHash: hash
});
const existing = await this.store.get(/* ... */);
if (existing) {
  this.logger.info('registry_register_deduplicated', {
    compositionName: schema.name,
    existingId: existing.id,
    existingVersion: existing.version
  });
}
```

**Why logs are better**:
- Executable documentation (proves code behavior)
- Always up-to-date (outdated logs break debugging)
- Queryable (comments aren't)
- Provides runtime evidence (comments are static)

**Apply to**: Code review standards, documentation strategy

---

## Actionable Takeaways

### For Future Logging Sprints
1. ✅ Start with logger DI in Phase 1 (foundation first)
2. ✅ Define log event catalog in backlog before implementation
3. ✅ Use consistent event naming (kebab-case, component prefix)
4. ✅ Match severity to operational impact, not code location
5. ✅ Include consistent metadata (correlationId, entityId, entityName)
6. ✅ Update tests before adding logging (catch DI issues early)
7. ✅ Document phase-by-phase as you go
8. ✅ Identify optional phases during planning

### For Code Reviews
1. ✅ Verify no console.log/error/warn (require structured logging)
2. ✅ Check log event naming consistency
3. ✅ Validate metadata includes correlation/entity IDs
4. ✅ Ensure appropriate severity levels
5. ✅ Confirm error paths have logging
6. ✅ Test logger injection and mocks

### For Production Debugging
1. ✅ Use log event prefixes for component filtering (`compiler_*`)
2. ✅ Correlate events by correlationId/compositionId
3. ✅ Filter by severity (error → warn → info → debug → trace)
4. ✅ Leverage structured metadata for aggregation
5. ✅ Reference log event catalogs in sprint artifacts

---

## Conclusion

Sprint 48 delivered not just **103 log events**, but a **reusable logging infrastructure pattern** applicable to all future BitBrat subsystems:

1. **Foundation-first** (logger DI in Phase 1)
2. **Structured events** (consistent naming, metadata, severity)
3. **Test-driven** (update tests before logging)
4. **Fail-open design** (logging never blocks functionality)
5. **Documentation** (log event catalogs, phase completion tracking)

These patterns will accelerate future observability sprints across event-router, persistence, ingress-egress, and other complex subsystems.

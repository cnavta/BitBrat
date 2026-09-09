# Composition Debug Logging Infrastructure Analysis

**Sprint**: 47
**Date**: 2026-09-08
**Lead Implementor**: Claude (navta3)

## Executive Summary

The Composition subsystem (compiler, executor, registry, watcher) has **critical observability gaps** that make debugging composition failures extremely difficult. Currently, only **5 debug log statements** exist across the entire composition directory, making it nearly impossible to diagnose:

- Compilation failures (why did validation fail?)
- Execution failures (which step failed, what was the state?)
- Runtime errors (tool resolution, reference resolution, condition evaluation)
- Performance issues (slow compilation, slow execution)

This sprint will add **comprehensive trace/debug logging** throughout the Composition pipeline to enable rapid diagnosis and resolution of composition issues.

---

## Current State Analysis

### Existing Logging Inventory

**Total log statements in `src/common/composition/`: 5**

File: `composition-watcher.ts`
- Line 47: `logger.debug('composition-watcher: watching directory', { dir: compositionDir })`
- Line 65: `logger.debug('composition-watcher: detected change', { file: fullPath })`
- Line 99: `logger.debug('composition-watcher: parsing composition', { file: filePath })`
- Line 116: `logger.warn('composition-watcher: validation failed', { file: filePath, errors, warnings })`
- Line 140: `logger.error('composition-watcher: failed to reload composition', { file: filePath, error: err.message })`

**Files with ZERO logging:**
- `compiler.ts` (747 lines) - ❌ No logging
- `executor.ts` (708 lines) - ❌ No logging
- `registry.ts` (>400 lines) - ❌ No logging
- `parser.ts` - ❌ No logging
- `types.ts` - ℹ️ Type definitions (N/A)
- `*.test.ts` - ℹ️ Test files (N/A)

### Critical Observability Gaps

#### 1. **Compilation Failures** - Cannot diagnose WHY validation fails

**Current behavior:**
```typescript
// compiler.ts:73-85
compile(def: CompositionDefinition): CompiledComposition {
  const report = this.validate(def);

  if (!report.valid) {
    throw new Error(`Composition validation failed:\n${errorList}`);
  }
  // ... no logging of what was attempted, what passed, what failed
}
```

**Missing diagnostics:**
- Which tools were resolved successfully vs. failed?
- What was the dependency graph before cycle detection?
- Which references were validated, which were forward references?
- What was the final content hash?
- Compilation duration?

**Impact**: Users see "Tool not found: X" but don't know:
- Was tool ID canonical or prefixed?
- What variants were tried (mcp_, mcp:, canonical)?
- What tools ARE available in the registry?
- What order were validations performed?

#### 2. **Execution Failures** - Cannot trace step-by-step execution

**Current behavior:**
```typescript
// executor.ts:111-192
async execute(composition: CompiledComposition, context: ExecutionContext): Promise<ExecutionResult> {
  // 1. Validate input - NO LOGGING
  // 2. Execute steps - NO LOGGING
  // 3. Resolve return - NO LOGGING
  // 4. Validate output - NO LOGGING

  return {
    status: ExecutionStatus.SUCCESS,
    output,
    executionTime: endTime - startTime,
    stepsExecuted: Object.keys(stepState).length,
  };
}
```

**Missing diagnostics:**
- Input validation result (what was validated, what passed/failed)?
- Step-by-step execution trace (step ID, tool called, arguments, result)?
- Reference resolution trace (what ref, what namespace, what pointer, what value)?
- Condition evaluation trace (which condition, operands, result)?
- Template interpolation trace (template string, variables, resolved values)?
- Per-step timing (which steps are slow)?
- Step state evolution (how did stepState grow during execution)?

**Impact**: When execution fails:
- No visibility into which step failed
- No visibility into step inputs/outputs
- No visibility into reference resolution
- No visibility into condition evaluation
- Cannot reproduce failures without full instrumentation

#### 3. **Tool Resolution Failures** - Cannot diagnose registry mismatches

**Current behavior:**
```typescript
// compiler.ts:195-225
private findTool(toolId: string): { id: string; inputSchema?: unknown; source?: string } | null {
  let tool = this.registry.getTool(toolId); // No logging
  if (tool) return tool;

  tool = this.registry.getTool(`mcp_${toolId}`); // No logging
  if (tool) return tool;

  // ... 5 different lookup attempts with NO logging
  return null;
}
```

**Missing diagnostics:**
- Which lookup variant succeeded/failed?
- What tools are in the registry (for comparison)?
- What was the final resolved tool ID?
- Was tool source 'composition' or 'mcp'?

**Impact**: Users get "Tool not found" errors with no context about:
- What was tried
- What is available
- How to fix the issue

#### 4. **Reference Resolution Failures** - Cannot trace pointer traversal

**Current behavior:**
```typescript
// executor.ts:366-391
private resolveReference(ref: Reference, input: unknown, context: unknown, stepState: StepState): unknown {
  const { namespace, pointer } = ref.$ref;

  let target: unknown;
  if (namespace === 'input') target = input;
  else if (namespace === 'context') target = context;
  else if (namespace === 'steps') target = stepState;
  else throw new ExecutionError(CompositionErrorCode.INVALID_NAMESPACE, ...);

  return this.getByPointer(target, pointer); // No logging
}
```

**Missing diagnostics:**
- What reference is being resolved?
- What namespace was selected?
- What was the target object structure?
- What pointer path was traversed?
- What value was extracted?
- Did pointer traversal encounter null/undefined mid-path?

**Impact**: Reference resolution failures are silent - no trace of:
- What was being referenced
- Why traversal failed
- What the actual data structure looked like

#### 5. **Performance Issues** - Cannot identify bottlenecks

**Current behavior:**
- Only top-level execution time is tracked
- No per-step timing
- No compilation phase timing
- No tool invocation timing
- No reference resolution timing

**Missing diagnostics:**
- Compilation duration (total + per-phase)
- Execution duration (total + per-step)
- Tool invocation duration
- Reference resolution duration
- Condition evaluation duration

**Impact**: Cannot diagnose:
- Slow compositions
- Slow steps
- Slow tool invocations
- Runaway recursion

---

## Root Cause Analysis

### Why Does Logging Not Exist?

1. **Initial implementation focused on correctness, not observability**
   - Compiler and executor written with comprehensive validation but no instrumentation
   - Tests provided observability during development, but not production

2. **No logger passed to classes**
   - `CompositionCompiler` and `CompositionExecutor` don't receive a logger in constructor
   - Would need dependency injection pattern update

3. **Error handling relies on exceptions**
   - Errors propagate via `throw new Error()` / `throw new ExecutionError()`
   - No intermediate logging before throwing

4. **Assumption that tests would catch issues**
   - Comprehensive test suite (compiler.test.ts, executor.test.ts)
   - But tests don't help diagnose production failures

---

## Proposed Solution Architecture

### Design Principles

1. **Structured logging with correlation IDs**
   - All logs include `compositionId`, `compositionName`, `correlationId` (execution)
   - Searchable, filterable, traceable

2. **Multi-level logging strategy**
   - **TRACE**: Step-by-step granular details (reference resolution, condition evaluation, tool lookups)
   - **DEBUG**: Phase completions, major checkpoints (compilation phases, step executions)
   - **INFO**: High-level operations (compilation started/completed, execution started/completed)
   - **WARN**: Non-fatal issues (unused variables, defensive fallbacks)
   - **ERROR**: Fatal issues (validation failures, execution failures, tool not found)

3. **Fail-fast logging**
   - Log BEFORE throwing errors (capture state before failure)
   - Log AFTER successful completions (confirm state after success)

4. **Performance-conscious**
   - Use conditional logging (`if (logger.isLevelEnabled('trace'))`)
   - Avoid expensive serialization unless trace is enabled
   - Log timing data for performance analysis

### Logging Injection Strategy

**Option 1: Constructor Injection (RECOMMENDED)**
```typescript
export class CompositionCompiler {
  constructor(
    private registry: ToolRegistryInterface,
    private logger: Logger // Pino logger
  ) {}
}

export class CompositionExecutor {
  constructor(
    private registry: ToolRegistryInterface,
    private logger: Logger // Pino logger
  ) {}
}
```

**Option 2: Static/Module Logger**
```typescript
import { getLogger } from '../common/logging';
const logger = getLogger('composition:compiler');
```

**Decision**: Use **Option 1 (Constructor Injection)** for:
- Testability (can inject mock logger)
- Consistency with Bit pattern
- Correlation ID propagation

### Logging Schema

**Standard fields for all composition logs:**
```typescript
{
  component: 'composition:compiler' | 'composition:executor' | 'composition:registry',
  operation: string,              // 'compile', 'execute', 'validate', 'resolveReference', etc.
  compositionId?: string,         // UUID (if available)
  compositionName?: string,       // Logical name
  correlationId?: string,         // Execution correlation ID
  duration?: number,              // Milliseconds (for timing logs)
  // ... operation-specific fields
}
```

---

## Implementation Phases

### Phase 1: Compiler Logging (Priority: HIGH)

**Files to modify:**
- `src/common/composition/compiler.ts`

**Logging points:**

#### 1.1 **Compilation Entry/Exit**
```typescript
compile(def: CompositionDefinition): CompiledComposition {
  const startTime = Date.now();
  this.logger.info('compilation_started', {
    component: 'composition:compiler',
    operation: 'compile',
    compositionName: def.metadata.name,
  });

  // ... compilation logic

  this.logger.info('compilation_completed', {
    component: 'composition:compiler',
    operation: 'compile',
    compositionId: compiled.id,
    compositionName: def.metadata.name,
    duration: Date.now() - startTime,
    valid: true,
    contentHash: compiled.contentHash,
    dependencies: compiled.dependencies.length,
  });
}
```

#### 1.2 **Validation Phase Logging**
```typescript
validate(def: CompositionDefinition): ValidationReport {
  this.logger.debug('validation_started', {
    component: 'composition:compiler',
    operation: 'validate',
    compositionName: def.metadata.name,
    stepCount: def.spec.steps.length,
  });

  // Log each validation sub-phase
  const toolIds = this.extractToolIds(def);
  this.logger.trace('extracted_tool_ids', {
    component: 'composition:compiler',
    operation: 'extractToolIds',
    toolIds,
    count: toolIds.length,
  });

  // ... validation logic

  this.logger.debug('validation_completed', {
    component: 'composition:compiler',
    operation: 'validate',
    compositionName: def.metadata.name,
    valid: report.valid,
    errorCount: report.errors.length,
    warningCount: report.warnings.length,
  });
}
```

#### 1.3 **Tool Resolution Logging (CRITICAL)**
```typescript
private findTool(toolId: string): Tool | null {
  this.logger.trace('tool_lookup_started', {
    component: 'composition:compiler',
    operation: 'findTool',
    toolId,
  });

  // Try exact match
  let tool = this.registry.getTool(toolId);
  if (tool) {
    this.logger.trace('tool_found_exact', {
      component: 'composition:compiler',
      operation: 'findTool',
      toolId,
      resolvedId: tool.id,
      source: tool.source,
    });
    return tool;
  }

  // Try with mcp_ prefix
  const prefixedId = `mcp_${toolId}`;
  tool = this.registry.getTool(prefixedId);
  if (tool) {
    this.logger.trace('tool_found_with_prefix', {
      component: 'composition:compiler',
      operation: 'findTool',
      toolId,
      attemptedId: prefixedId,
      resolvedId: tool.id,
      source: tool.source,
    });
    return tool;
  }

  // ... try other variants with logging

  this.logger.warn('tool_not_found', {
    component: 'composition:compiler',
    operation: 'findTool',
    toolId,
    attemptsCount: 5,
  });

  return null;
}
```

#### 1.4 **Cycle Detection Logging**
```typescript
private detectCycles(def: CompositionDefinition): string[] {
  this.logger.trace('cycle_detection_started', {
    component: 'composition:compiler',
    operation: 'detectCycles',
    compositionName: def.metadata.name,
  });

  // Build graph with logging
  const graph = ...;
  this.logger.trace('dependency_graph_built', {
    component: 'composition:compiler',
    operation: 'detectCycles',
    graph: Object.fromEntries(graph), // Log full graph for trace
  });

  // DFS with logging
  if (dfs(def.metadata.name)) {
    this.logger.error('circular_dependency_detected', {
      component: 'composition:compiler',
      operation: 'detectCycles',
      compositionName: def.metadata.name,
      cycle: cyclePath,
    });
    return cyclePath;
  }

  this.logger.trace('no_cycles_detected', {
    component: 'composition:compiler',
    operation: 'detectCycles',
    compositionName: def.metadata.name,
  });

  return [];
}
```

#### 1.5 **Reference Validation Logging**
```typescript
private validateReferences(def: CompositionDefinition): ValidationError[] {
  this.logger.trace('reference_validation_started', {
    component: 'composition:compiler',
    operation: 'validateReferences',
    compositionName: def.metadata.name,
  });

  const errors: ValidationError[] = [];
  const stepIds = new Set(def.spec.steps.map((s) => s.id));

  this.logger.trace('step_ids_extracted', {
    component: 'composition:compiler',
    operation: 'validateReferences',
    stepIds: Array.from(stepIds),
  });

  // ... validation logic with per-error logging

  if (errors.length > 0) {
    this.logger.warn('reference_validation_errors', {
      component: 'composition:compiler',
      operation: 'validateReferences',
      errorCount: errors.length,
      errors: errors.map(e => ({ code: e.code, message: e.message, location: e.location })),
    });
  }

  return errors;
}
```

#### 1.6 **Template Validation Logging**
```typescript
private validateTemplates(def: CompositionDefinition): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  this.logger.trace('template_validation_started', {
    component: 'composition:compiler',
    operation: 'validateTemplates',
    compositionName: def.metadata.name,
  });

  // ... validation logic

  this.logger.debug('template_validation_completed', {
    component: 'composition:compiler',
    operation: 'validateTemplates',
    errorCount: errors.length,
    warningCount: warnings.length,
  });

  return { errors, warnings };
}
```

---

### Phase 2: Executor Logging (Priority: HIGH)

**Files to modify:**
- `src/common/composition/executor.ts`

**Logging points:**

#### 2.1 **Execution Entry/Exit**
```typescript
async execute(composition: CompiledComposition, context: ExecutionContext): Promise<ExecutionResult> {
  const startTime = Date.now();

  this.logger.info('execution_started', {
    component: 'composition:executor',
    operation: 'execute',
    compositionId: composition.id,
    compositionName: composition.metadata.name,
    correlationId: context.correlationId,
    sessionId: context.sessionId,
  });

  // ... execution logic

  this.logger.info('execution_completed', {
    component: 'composition:executor',
    operation: 'execute',
    compositionId: composition.id,
    compositionName: composition.metadata.name,
    correlationId: context.correlationId,
    status: result.status,
    duration: Date.now() - startTime,
    stepsExecuted: result.stepsExecuted,
  });

  return result;
}
```

#### 2.2 **Input Validation Logging**
```typescript
private validateInput(input: unknown, schema: unknown): void {
  this.logger.trace('input_validation_started', {
    component: 'composition:executor',
    operation: 'validateInput',
  });

  const validate = this.ajv.compile(schema as object);
  const valid = validate(input);

  if (!valid) {
    const errors = validate.errors || [];
    this.logger.error('input_validation_failed', {
      component: 'composition:executor',
      operation: 'validateInput',
      errors: errors.map(e => ({ path: e.instancePath, message: e.message })),
    });
    throw new ExecutionError(...);
  }

  this.logger.trace('input_validation_passed', {
    component: 'composition:executor',
    operation: 'validateInput',
  });
}
```

#### 2.3 **Step Execution Logging (CRITICAL)**
```typescript
for (const step of composition.spec.steps) {
  const stepStartTime = Date.now();

  this.logger.debug('step_started', {
    component: 'composition:executor',
    operation: 'executeStep',
    stepId: step.id,
    stepType: isCallStep(step) ? 'call' : 'ifValue',
    correlationId: context.correlationId,
  });

  // Check conditional execution
  if (isCallStep(step) && step.when) {
    const shouldExecute = await this.evaluateCondition(step.when, ...);
    this.logger.debug('condition_evaluated', {
      component: 'composition:executor',
      operation: 'evaluateCondition',
      stepId: step.id,
      shouldExecute,
      correlationId: context.correlationId,
    });

    if (!shouldExecute) {
      this.logger.debug('step_skipped', {
        component: 'composition:executor',
        operation: 'executeStep',
        stepId: step.id,
        reason: 'condition_false',
        correlationId: context.correlationId,
      });
      continue;
    }
  }

  const stepOutput = await this.executeStep(step, ...);
  stepState[step.id] = stepOutput;

  this.logger.debug('step_completed', {
    component: 'composition:executor',
    operation: 'executeStep',
    stepId: step.id,
    duration: Date.now() - stepStartTime,
    outputType: typeof stepOutput,
    correlationId: context.correlationId,
  });
}
```

#### 2.4 **Tool Invocation Logging**
```typescript
private async executeCallStep(step: CallStep, ...): Promise<unknown> {
  this.logger.trace('tool_invocation_started', {
    component: 'composition:executor',
    operation: 'executeCallStep',
    stepId: step.id,
    toolId: step.call,
    correlationId: execContext.correlationId,
  });

  const tool = this.registry.getTool(step.call);

  if (!tool) {
    this.logger.error('tool_not_found_at_runtime', {
      component: 'composition:executor',
      operation: 'executeCallStep',
      stepId: step.id,
      toolId: step.call,
      correlationId: execContext.correlationId,
    });
    throw new ExecutionError(...);
  }

  // Resolve arguments
  let args: unknown = {};
  if (step.with) {
    args = await this.resolveValue(step.with, ...);
    this.logger.trace('arguments_resolved', {
      component: 'composition:executor',
      operation: 'executeCallStep',
      stepId: step.id,
      toolId: step.call,
      argumentKeys: Object.keys(args as object),
      correlationId: execContext.correlationId,
    });
  }

  // Invoke tool
  const toolStartTime = Date.now();
  const result = await tool.execute(args, execContext);

  this.logger.trace('tool_invocation_completed', {
    component: 'composition:executor',
    operation: 'executeCallStep',
    stepId: step.id,
    toolId: step.call,
    duration: Date.now() - toolStartTime,
    resultType: typeof result,
    correlationId: execContext.correlationId,
  });

  return result;
}
```

#### 2.5 **Reference Resolution Logging (CRITICAL)**
```typescript
private resolveReference(ref: Reference, input: unknown, context: unknown, stepState: StepState): unknown {
  const { namespace, pointer } = ref.$ref;

  this.logger.trace('reference_resolution_started', {
    component: 'composition:executor',
    operation: 'resolveReference',
    namespace,
    pointer,
  });

  let target: unknown;
  if (namespace === 'input') target = input;
  else if (namespace === 'context') target = context;
  else if (namespace === 'steps') target = stepState;
  else {
    this.logger.error('invalid_namespace', {
      component: 'composition:executor',
      operation: 'resolveReference',
      namespace,
      pointer,
    });
    throw new ExecutionError(...);
  }

  const value = this.getByPointer(target, pointer);

  this.logger.trace('reference_resolved', {
    component: 'composition:executor',
    operation: 'resolveReference',
    namespace,
    pointer,
    valueType: typeof value,
    valueExists: value !== undefined && value !== null,
  });

  return value;
}
```

#### 2.6 **Condition Evaluation Logging**
```typescript
private async evaluateCondition(condition: Condition, ...): Promise<boolean> {
  this.logger.trace('condition_evaluation_started', {
    component: 'composition:executor',
    operation: 'evaluateCondition',
    conditionType: Object.keys(condition)[0], // 'exists', 'equals', 'all', etc.
  });

  let result: boolean;

  if ('exists' in condition) {
    const value = await this.resolveValue(condition.exists, ...);
    result = value !== null && value !== undefined;
    this.logger.trace('exists_condition_evaluated', {
      component: 'composition:executor',
      operation: 'evaluateCondition',
      result,
      valueExists: result,
    });
  } else if ('equals' in condition) {
    const [left, right] = condition.equals;
    const leftValue = await this.resolveValue(left, ...);
    const rightValue = await this.resolveValue(right, ...);
    result = leftValue === rightValue;
    this.logger.trace('equals_condition_evaluated', {
      component: 'composition:executor',
      operation: 'evaluateCondition',
      result,
      leftType: typeof leftValue,
      rightType: typeof rightValue,
      equal: result,
    });
  }
  // ... other condition types with similar logging

  this.logger.trace('condition_evaluation_completed', {
    component: 'composition:executor',
    operation: 'evaluateCondition',
    result,
  });

  return result;
}
```

#### 2.7 **Template Resolution Logging**
```typescript
private async resolveTemplate(template: TemplateExpression, ...): Promise<string> {
  this.logger.trace('template_resolution_started', {
    component: 'composition:executor',
    operation: 'resolveTemplate',
    templateString: template.template,
    variableCount: Object.keys(template).length - 1,
  });

  const resolvedVariables: Record<string, string> = {};
  for (const [varName, varExpression] of Object.entries(variableDefinitions)) {
    const resolvedValue = await this.resolveValue(varExpression, ...);
    resolvedVariables[varName] = String(resolvedValue);

    this.logger.trace('template_variable_resolved', {
      component: 'composition:executor',
      operation: 'resolveTemplate',
      variableName: varName,
      resolvedType: typeof resolvedValue,
    });
  }

  const result = templateString.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return resolvedVariables[varName];
  });

  this.logger.trace('template_resolution_completed', {
    component: 'composition:executor',
    operation: 'resolveTemplate',
    resultLength: result.length,
  });

  return result;
}
```

---

### Phase 3: Registry Logging (Priority: MEDIUM)

**Files to modify:**
- `src/common/composition/registry.ts`

**Logging points:**

#### 3.1 **Registration Logging**
```typescript
async register(definition: CompositionDefinition): Promise<CompiledComposition> {
  this.logger.info('registration_started', {
    component: 'composition:registry',
    operation: 'register',
    compositionName: definition.metadata.name,
  });

  // Compile composition
  const compiled = this.compiler.compile(definition);

  // Check for deduplication
  const existing = await this.findByContentHash(compiled.contentHash);
  if (existing) {
    this.logger.info('composition_deduplicated', {
      component: 'composition:registry',
      operation: 'register',
      compositionName: definition.metadata.name,
      contentHash: compiled.contentHash,
      existingId: existing.id,
    });
    return existing.compiled;
  }

  // Determine version
  const versions = await this.listVersions(definition.metadata.name);
  const version = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;

  this.logger.info('composition_registered', {
    component: 'composition:registry',
    operation: 'register',
    compositionId: compiled.id,
    compositionName: definition.metadata.name,
    version,
    contentHash: compiled.contentHash,
  });

  return compiled;
}
```

#### 3.2 **Lookup Logging**
```typescript
async get(name: string, version?: number): Promise<CompiledComposition | null> {
  this.logger.debug('composition_lookup_started', {
    component: 'composition:registry',
    operation: 'get',
    name,
    version,
  });

  const composition = await /* lookup logic */;

  if (!composition) {
    this.logger.warn('composition_not_found', {
      component: 'composition:registry',
      operation: 'get',
      name,
      version,
    });
    return null;
  }

  this.logger.debug('composition_found', {
    component: 'composition:registry',
    operation: 'get',
    compositionId: composition.id,
    name,
    version: composition.metadata.version,
  });

  return composition;
}
```

---

### Phase 4: Watcher Logging (Priority: LOW - Already Exists)

**File**: `composition-watcher.ts`

**Current state**: Already has logging (5 statements)

**Enhancement**: Add correlation IDs and structured fields to existing logs.

---

### Phase 5: Tool Gateway Integration (Priority: HIGH)

**File**: `src/apps/tool-gateway.ts`

**Enhancement**: Ensure logger is passed to CompositionCompiler and CompositionExecutor constructors.

**Current instantiation** (line numbers estimated from read):
```typescript
// tool-gateway.ts (estimated line ~300-400)
this.compositionRegistry = new CompositionRegistry(compositionStore, toolRegistry);
this.compositionExecutor = new CompositionExecutor(toolRegistry);
```

**Updated instantiation**:
```typescript
this.compositionRegistry = new CompositionRegistry(compositionStore, toolRegistry, this.logger);
this.compositionExecutor = new CompositionExecutor(toolRegistry, this.logger);
```

**Composition MCP tool handlers enhancement**:
```typescript
// composition.execute handler
async execute(args: CompositionExecuteArgs, context: SessionContext) {
  const correlationId = randomUUID();

  this.logger.info('composition_mcp_execute_called', {
    component: 'tool-gateway',
    operation: 'composition.execute',
    compositionId: args.id,
    correlationId,
  });

  const result = await this.compositionExecutor.execute(compiled, {
    ...context,
    correlationId, // Pass correlation ID to executor
  });

  this.logger.info('composition_mcp_execute_completed', {
    component: 'tool-gateway',
    operation: 'composition.execute',
    compositionId: args.id,
    correlationId,
    status: result.status,
    duration: result.executionTime,
  });

  return result;
}
```

---

## Testing Strategy

### Unit Test Enhancements

**Files to modify:**
- `src/common/composition/compiler.test.ts`
- `src/common/composition/executor.test.ts`

**Enhancements:**
1. Add mock logger to all test cases
2. Assert that critical log statements are called
3. Verify log structured data contains expected fields

**Example test case**:
```typescript
describe('CompositionCompiler', () => {
  let mockLogger: Logger;
  let compiler: CompositionCompiler;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    compiler = new CompositionCompiler(toolRegistry, mockLogger);
  });

  it('should log compilation started and completed', () => {
    const definition = /* ... */;
    compiler.compile(definition);

    expect(mockLogger.info).toHaveBeenCalledWith('compilation_started', expect.objectContaining({
      component: 'composition:compiler',
      operation: 'compile',
    }));

    expect(mockLogger.info).toHaveBeenCalledWith('compilation_completed', expect.objectContaining({
      component: 'composition:compiler',
      operation: 'compile',
      valid: true,
    }));
  });

  it('should log tool not found errors with trace details', () => {
    const definition = /* ... with missing tool ... */;

    expect(() => compiler.compile(definition)).toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith('tool_not_found', expect.objectContaining({
      component: 'composition:compiler',
      operation: 'findTool',
      toolId: 'missing_tool',
    }));
  });
});
```

### Integration Test Enhancements

**Goal**: Verify logging in real execution scenarios

**Approach**:
1. Deploy composition to agent-dev context
2. Execute composition via MCP
3. Retrieve logs via `fleet.logs({ bit: 'tool-gateway', level: ['trace'] })`
4. Verify log sequence and structured data

---

## Success Criteria

### Quantitative Metrics

1. **Log coverage**: Increase from **5 log statements** to **100+ log statements** across compilation/execution
2. **Diagnostic completeness**: Every error path has TRACE/DEBUG logs before throwing
3. **Performance visibility**: Timing logs for all major operations
4. **Test coverage**: 100% of new log statements covered by unit tests

### Qualitative Criteria

1. **Debuggability**: Given a composition failure, logs provide enough context to diagnose root cause without code instrumentation
2. **Traceability**: Given a correlationId, logs provide complete execution trace from start to finish
3. **Actionability**: Error logs include remediation hints ("Use composition.list_tools to see available tools")

---

## Risk Assessment

### Risks

1. **Performance impact of excessive logging**
   - **Mitigation**: Use conditional logging (`if (logger.isLevelEnabled('trace'))`)
   - **Mitigation**: Avoid expensive serialization in hot paths

2. **Log volume in production**
   - **Mitigation**: Default to INFO level in production, DEBUG in staging, TRACE in local/agent-dev
   - **Mitigation**: Structured logging enables efficient filtering

3. **Logger injection breaking existing code**
   - **Mitigation**: Phased rollout (compiler first, executor second, registry third)
   - **Mitigation**: Comprehensive test coverage

4. **Log noise obscuring critical issues**
   - **Mitigation**: Use structured fields for filtering (component, operation, compositionId)
   - **Mitigation**: Clear log level semantics (TRACE = granular, DEBUG = phase, INFO = lifecycle)

### Assumptions

1. Tool Gateway has access to Pino logger instance
2. Logs are aggregated and searchable (Loki/CloudWatch/etc.)
3. Structured logging is supported in production environment

---

## Implementation Estimates

| Phase | Effort | Priority |
|-------|--------|----------|
| Phase 1: Compiler Logging | 4-6 hours | HIGH |
| Phase 2: Executor Logging | 6-8 hours | HIGH |
| Phase 3: Registry Logging | 2-3 hours | MEDIUM |
| Phase 4: Watcher Enhancement | 1 hour | LOW |
| Phase 5: Tool Gateway Integration | 2-3 hours | HIGH |
| Testing & Validation | 3-4 hours | HIGH |
| **TOTAL** | **18-25 hours** | |

---

## Conclusion

The Composition subsystem currently has **near-zero observability**, making debugging production issues extremely difficult. This sprint will add comprehensive trace/debug logging throughout the compilation and execution pipeline, enabling:

- **Rapid diagnosis** of compilation failures
- **Complete execution tracing** with step-by-step visibility
- **Performance profiling** of compositions and individual steps
- **Actionable error messages** with remediation hints

The proposed solution follows BitBrat's structured logging patterns, uses dependency injection for testability, and provides a clear phased implementation approach.

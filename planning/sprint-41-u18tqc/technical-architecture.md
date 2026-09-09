# Technical Architecture: Composition DSL & Runtime (Sprint 41)

**Sprint**: sprint-41-u18tqc
**Author**: Architect (Claude)
**Date**: 2026-09-02
**Status**: Draft
**Scope**: Foundation layer only - DSL, runtime, registry, tool-gateway integration

---

## 1. Executive Summary

This sprint implements the **foundational layer** for MCP Behavioral Compilation: the ability to define, validate, execute, and expose **Compositions** as callable tools. This enables manual composition authoring and sets the stage for future automated learning.

### 1.1 Sprint Scope

**IN SCOPE**:
- ✅ Composition DSL (YAML/JSON format)
- ✅ Composition parser, validator, compiler
- ✅ Composition executor (sequential execution)
- ✅ Composition registry (PostgreSQL storage)
- ✅ Tool-gateway integration (expose compositions as MCP tools)
- ✅ REST API (enable reflex service to invoke compositions)
- ✅ Manual composition authoring and registration

**OUT OF SCOPE** (future sprints):
- ❌ Observation system (no automatic pattern detection)
- ❌ Learning/promotion (no composition-learner service)
- ❌ Reflex enhancement (reflex just gets REST API access)
- ❌ Parallel execution blocks (V1 is sequential only)
- ❌ Automated candidate generation

### 1.2 Core Thesis

> Compositions are **manually authored reusable procedures** that combine multiple MCP tool calls into a single callable unit. They reduce complexity, improve consistency, and enable deterministic execution of common patterns.

### 1.3 Value Proposition

**For Platform Team**:
- Manually encode common patterns (e.g., "viewer_greeting", "user_lookup")
- Reduce duplication across prompts and tool calls
- Create building blocks for reflexes

**For LLM Agent**:
- Access higher-level capabilities via single tool call
- Smaller tool catalog (composed tools hide implementation details)
- More predictable behavior (validated, tested procedures)

**For Reflex Service**:
- Invoke multi-step procedures via REST API
- Deterministic dispatch without LLM reasoning

---

## 2. Architectural Overview

### 2.1 Component Diagram

```text
┌─────────────────────────────────────────────────────┐
│              tool-gateway (Enhanced)                │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │         ToolRegistry (Existing)              │  │
│  │  - Primitive tools from MCP servers          │  │
│  │  - Now also: Composed tools                  │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │      Composition Runtime (NEW)               │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │ Parser: YAML/JSON → AST                │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │ Compiler: Validate + Resolve           │  │  │
│  │  │  - Tool resolution                     │  │  │
│  │  │  - Cycle detection                     │  │  │
│  │  │  - Reference validation                │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │ Executor: Run steps sequentially       │  │  │
│  │  │  - Resolve references                  │  │  │
│  │  │  - Evaluate conditions                 │  │  │
│  │  │  - Invoke child tools                  │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │    Composition Registry (NEW)                │  │
│  │  - PostgreSQL storage                        │  │
│  │  - CRUD operations                           │  │
│  │  - Version management                        │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │         MCP Tool Facade                      │  │
│  │  - Register compositions as tools            │  │
│  │  - Expose via tools/list                     │  │
│  │  - Handle tools/call                         │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │         REST API (NEW)                       │  │
│  │  POST /compositions                          │  │
│  │  GET  /compositions/:id                      │  │
│  │  POST /compositions/:id/execute              │  │
│  │  GET  /compositions                          │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
           ▲                              ▲
           │                              │
           │ MCP                          │ REST
           │                              │
    ┌──────┴──────┐              ┌───────┴────────┐
    │   llm-bot   │              │  reflex service │
    └─────────────┘              └────────────────┘
```

### 2.2 Data Flow

**Composition Registration**:
```text
compositions/viewer_greeting.yaml
        ↓ (read file)
CompositionParser.parse()
        ↓ (AST)
CompositionCompiler.validate()
        ↓ (compiled)
CompositionRegistry.create()
        ↓ (stored)
tool-gateway.registerCompositionTool()
        ↓ (exposed)
MCP tools/list → includes "viewer_greeting"
```

**Composition Execution (via MCP)**:
```text
llm-bot: tools/call "viewer_greeting" {user_id: "123"}
        ↓
tool-gateway: route to composition
        ↓
CompositionExecutor.execute()
        ↓ (step 1)
invoke twitch.get_user
        ↓ (step 2)
invoke viewer_memory.get
        ↓ (step 3)
evaluate condition → greeting_type
        ↓ (step 4)
invoke obs.show_alert
        ↓ (return)
structured result → llm-bot
```

**Composition Execution (via REST)**:
```text
reflex: POST /compositions/viewer_greeting/execute
        Body: {input: {user_id: "123"}, context: {channel_id: "abc"}}
        ↓
tool-gateway: parse request
        ↓
CompositionExecutor.execute()
        ↓ (same execution as MCP)
JSON response → reflex
```

---

## 3. Composition DSL Specification

### 3.1 Format: `mcp-compose/v1`

**Authoring Format**: YAML (recommended) or JSON
**Canonical Representation**: JSON AST
**Storage**: PostgreSQL (compiled form)

### 3.2 Top-Level Structure

```yaml
apiVersion: mcp-compose/v1
kind: Composition

metadata:
  name: viewer_greeting             # Unique logical name
  description: >
    Resolve Twitch viewer, retrieve memory,
    choose greeting type, display alert.

spec:
  inputSchema:                       # Required: JSON Schema
    type: object
    properties:
      user_id:
        type: string
    required: [user_id]

  contextSchema:                     # Optional: execution context schema
    type: object
    properties:
      channel_id:
        type: string
    required: [channel_id]

  outputSchema:                      # Recommended: JSON Schema
    type: object
    properties:
      handled:
        type: boolean
      viewer_id:
        type: string
      greeting_type:
        type: string
        enum: [new_viewer, returning_viewer]
    required: [handled, viewer_id, greeting_type]

  steps:                             # Required: ordered execution steps
    - id: user                       # Step 1: Call primitive tool
      call: twitch.get_user
      with:
        id: $input/user_id

    - id: memory                     # Step 2: Call another tool
      call: viewer_memory.get
      with:
        user_id: $steps/user/id
        channel_id: $context/channel_id

    - id: greeting_type              # Step 3: Conditional value
      if:
        condition:
          equals:
            - $steps/memory/returning
            - true
        then: returning_viewer
        else: new_viewer

    - id: alert                      # Step 4: Call with derived values
      call: obs.show_alert
      with:
        template: $steps/greeting_type
        name: $steps/user/display_name

  return:                            # Required: output construction
    handled: true
    viewer_id: $steps/user/id
    greeting_type: $steps/greeting_type
```

### 3.3 Reference Syntax

Three namespaces:

```yaml
$input/user_id                       # Caller-provided arguments
$context/channel_id                  # Execution context (injected)
$steps/user/id                       # Output from previous step
$steps/memory/returning              # Nested path into step result
```

**Path Resolution**: JSON Pointer semantics (`/` = path separator, `~0` = `~`, `~1` = `/`)

### 3.4 Step Types

#### 3.4.1 Call Step

```yaml
- id: user
  call: twitch.get_user              # Logical tool ID (primitive or composition)
  with:                              # Optional: arguments
    id: $input/user_id
  when:                              # Optional: guard condition
    exists: $input/user_id
```

**Semantics**:
- `call` MUST resolve to a registered tool (primitive or composition)
- `with` is validated against target tool's input schema
- If `when` evaluates false, step is skipped, result is `null`
- Result stored at `$steps/<id>`

#### 3.4.2 Conditional Value Step

```yaml
- id: greeting_type
  if:
    condition:
      equals:
        - $steps/memory/returning
        - true
    then: returning_viewer
    else: new_viewer
```

**Semantics**:
- `condition` is evaluated deterministically
- Result is `then` value if condition is true, `else` value otherwise
- Result stored at `$steps/<id>`

### 3.5 Condition Operators

V1 operators (deterministic, no code evaluation):

```yaml
# Existence check
exists: $steps/user/org_id

# Equality
equals:
  - $steps/memory/returning
  - true

# Comparisons
greaterThan:
  - $steps/order/total
  - 1000

lessThan:
  - $input/age
  - 18

greaterThanOrEqual:
  - $steps/reputation
  - 50

lessThanOrEqual:
  - $steps/balance
  - 0

# Logical combinators
all:
  - exists: $steps/user/id
  - greaterThan: [$steps/user/reputation, 50]

any:
  - equals: [$input/mode, admin]
  - equals: [$input/mode, moderator]

not:
  equals:
    - $input/status
    - blocked
```

**Type Rules**:
- Comparison operators require compatible scalar types
- `all`/`any` take arrays of conditions
- `not` takes a single condition
- Missing references are errors unless checked with `exists`

### 3.6 Return Expression

```yaml
return:
  handled: true                      # Literal value
  viewer_id: $steps/user/id          # Reference
  greeting_type: $steps/greeting_type
  metadata:                          # Nested object
    processed_at: $context/timestamp
```

**Validation**: Result MUST match `outputSchema` (if present).

---

## 4. Component Implementation

### 4.1 TypeScript Type Definitions

**Location**: `src/common/composition/types.ts`

```typescript
// Top-level composition definition
export interface CompositionDefinition {
  apiVersion: 'mcp-compose/v1';
  kind: 'Composition';
  metadata: CompositionMetadata;
  spec: CompositionSpec;
}

export interface CompositionMetadata {
  name: string;
  description?: string;
  version?: number;                  // Auto-assigned by registry
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface CompositionSpec {
  inputSchema: JSONSchema;           // JSON Schema draft 2020-12
  contextSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  steps: Step[];
  return: ValueExpression;
}

// Step types
export type Step = CallStep | IfValueStep;

export interface CallStep {
  id: string;
  call: string;                      // Logical tool ID
  with?: Record<string, ValueExpression>;
  when?: Condition;
}

export interface IfValueStep {
  id: string;
  if: {
    condition: Condition;
    then: ValueExpression;
    else: ValueExpression;
  };
}

// Value expressions (references or literals)
export type ValueExpression =
  | Reference
  | LiteralValue
  | Record<string, ValueExpression>
  | ValueExpression[];

export interface Reference {
  $ref: {
    namespace: 'input' | 'context' | 'steps';
    pointer: string;                 // JSON Pointer path
  };
}

export type LiteralValue = string | number | boolean | null;

// Conditions
export type Condition =
  | { exists: Reference }
  | { equals: [ValueExpression, ValueExpression] }
  | { greaterThan: [ValueExpression, ValueExpression] }
  | { lessThan: [ValueExpression, ValueExpression] }
  | { greaterThanOrEqual: [ValueExpression, ValueExpression] }
  | { lessThanOrEqual: [ValueExpression, ValueExpression] }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

// Compiled form (after validation)
export interface CompiledComposition {
  id: string;                        // UUID
  metadata: CompositionMetadata;
  spec: CompositionSpec;
  compiledAt: Date;
  contentHash: string;               // SHA-256 of canonical AST
  dependencies: ToolDependency[];
  validationReport: ValidationReport;
}

export interface ToolDependency {
  toolId: string;                    // Logical tool ID
  schemaFingerprint: string;         // SHA-256 of tool's schema
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;                      // e.g., "COMPOSE-REF-001"
  message: string;
  location?: string;                 // JSON path to error location
}

export interface ValidationWarning {
  code: string;
  message: string;
  location?: string;
}
```

### 4.2 Composition Parser

**Location**: `src/common/composition/parser.ts`

```typescript
import yaml from 'js-yaml';
import { CompositionDefinition, Reference, ValueExpression } from './types';

export class CompositionParser {
  /**
   * Parse YAML or JSON into CompositionDefinition.
   * @param source - YAML string, JSON string, or object
   */
  parse(source: string | object): CompositionDefinition {
    let obj: any;

    if (typeof source === 'string') {
      // Try YAML first, fall back to JSON
      try {
        obj = yaml.load(source);
      } catch {
        obj = JSON.parse(source);
      }
    } else {
      obj = source;
    }

    // Validate top-level structure
    this.validateTopLevel(obj);

    // Canonicalize references (convert shorthand to $ref objects)
    return this.canonicalize(obj);
  }

  private validateTopLevel(obj: any): void {
    if (obj.apiVersion !== 'mcp-compose/v1') {
      throw new Error(`Invalid apiVersion: ${obj.apiVersion}`);
    }
    if (obj.kind !== 'Composition') {
      throw new Error(`Invalid kind: ${obj.kind}`);
    }
    if (!obj.metadata?.name) {
      throw new Error('Missing metadata.name');
    }
    if (!obj.spec) {
      throw new Error('Missing spec');
    }
  }

  /**
   * Canonicalize shorthand references to explicit $ref objects.
   * Example: "$input/user_id" → {$ref: {namespace: "input", pointer: "/user_id"}}
   */
  private canonicalize(obj: any): CompositionDefinition {
    return {
      apiVersion: obj.apiVersion,
      kind: obj.kind,
      metadata: obj.metadata,
      spec: {
        inputSchema: obj.spec.inputSchema,
        contextSchema: obj.spec.contextSchema,
        outputSchema: obj.spec.outputSchema,
        steps: obj.spec.steps.map((s: any) => this.canonicalizeStep(s)),
        return: this.canonicalizeValue(obj.spec.return),
      },
    };
  }

  private canonicalizeStep(step: any): any {
    if (step.call) {
      return {
        id: step.id,
        call: step.call,
        with: step.with ? this.canonicalizeObject(step.with) : undefined,
        when: step.when ? this.canonicalizeCondition(step.when) : undefined,
      };
    } else if (step.if) {
      return {
        id: step.id,
        if: {
          condition: this.canonicalizeCondition(step.if.condition),
          then: this.canonicalizeValue(step.if.then),
          else: this.canonicalizeValue(step.if.else),
        },
      };
    }
    throw new Error(`Invalid step: ${JSON.stringify(step)}`);
  }

  private canonicalizeValue(val: any): ValueExpression {
    // Shorthand reference: "$input/foo" → {$ref: ...}
    if (typeof val === 'string' && val.startsWith('$')) {
      return this.parseReference(val);
    }

    // Array
    if (Array.isArray(val)) {
      return val.map(v => this.canonicalizeValue(v));
    }

    // Object
    if (val && typeof val === 'object' && !val.$ref) {
      return this.canonicalizeObject(val);
    }

    // Literal or already canonical reference
    return val;
  }

  private canonicalizeObject(obj: Record<string, any>): Record<string, ValueExpression> {
    const result: Record<string, ValueExpression> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = this.canonicalizeValue(val);
    }
    return result;
  }

  private parseReference(ref: string): Reference {
    // Format: $namespace/path
    const match = ref.match(/^\$([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid reference: ${ref}`);
    }

    const namespace = match[1] as 'input' | 'context' | 'steps';
    const pointer = '/' + match[2].replace(/\//g, '/');  // JSON Pointer format

    if (!['input', 'context', 'steps'].includes(namespace)) {
      throw new Error(`Invalid namespace: ${namespace}`);
    }

    return { $ref: { namespace, pointer } };
  }

  private canonicalizeCondition(cond: any): any {
    // Recursively canonicalize condition values
    if (cond.exists) {
      return { exists: this.canonicalizeValue(cond.exists) };
    }
    if (cond.equals) {
      return { equals: cond.equals.map((v: any) => this.canonicalizeValue(v)) };
    }
    if (cond.greaterThan) {
      return { greaterThan: cond.greaterThan.map((v: any) => this.canonicalizeValue(v)) };
    }
    // ... similar for other operators
    if (cond.all) {
      return { all: cond.all.map((c: any) => this.canonicalizeCondition(c)) };
    }
    if (cond.any) {
      return { any: cond.any.map((c: any) => this.canonicalizeCondition(c)) };
    }
    if (cond.not) {
      return { not: this.canonicalizeCondition(cond.not) };
    }
    return cond;
  }
}
```

### 4.3 Composition Compiler

**Location**: `src/common/composition/compiler.ts`

```typescript
import { createHash } from 'crypto';
import { CompositionDefinition, CompiledComposition, ValidationReport, ValidationError } from './types';
import type { ToolRegistry } from '../../services/llm-bot/tools/registry';

export class CompositionCompiler {
  constructor(private registry: ToolRegistry) {}

  /**
   * Validate and compile a composition.
   */
  compile(def: CompositionDefinition): CompiledComposition {
    const report = this.validate(def);

    if (!report.valid) {
      throw new Error(`Composition validation failed:\n${report.errors.map(e => `  ${e.code}: ${e.message}`).join('\n')}`);
    }

    const dependencies = this.resolveDependencies(def);
    const contentHash = this.computeHash(def);

    return {
      id: '',  // Will be assigned by registry
      metadata: def.metadata,
      spec: def.spec,
      compiledAt: new Date(),
      contentHash,
      dependencies,
      validationReport: report,
    };
  }

  /**
   * Validate composition structure, references, and dependencies.
   */
  validate(def: CompositionDefinition): ValidationReport {
    const errors: ValidationError[] = [];
    const warnings: any[] = [];

    // 1. Resolve all tool dependencies
    const toolIds = this.extractToolIds(def);
    for (const toolId of toolIds) {
      const tool = this.registry.getTool(toolId);
      if (!tool) {
        errors.push({
          code: 'COMPOSE-TOOL-001',
          message: `Tool not found: ${toolId}`,
        });
      }
    }

    // 2. Detect cycles
    const cycles = this.detectCycles(def);
    if (cycles.length > 0) {
      errors.push({
        code: 'COMPOSE-CYCLE-001',
        message: `Circular dependency detected: ${cycles.join(' → ')}`,
      });
    }

    // 3. Validate references
    const refErrors = this.validateReferences(def);
    errors.push(...refErrors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private extractToolIds(def: CompositionDefinition): string[] {
    return def.spec.steps
      .filter((s: any) => s.call)
      .map((s: any) => s.call);
  }

  private detectCycles(def: CompositionDefinition): string[] {
    // Build dependency graph
    const graph: Map<string, string[]> = new Map();

    for (const step of def.spec.steps) {
      if ((step as any).call) {
        const toolId = (step as any).call;
        const tool = this.registry.getTool(toolId);

        // If tool is a composition, add edge
        if (tool?.source === 'composition') {
          // This would require looking up the composition's dependencies
          // For V1, we'll do simple direct cycle detection
          graph.set(def.metadata.name, [toolId]);
        }
      }
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const stack = new Set<string>();
    const cycle: string[] = [];

    const dfs = (node: string): boolean => {
      if (stack.has(node)) {
        // Cycle detected
        return true;
      }
      if (visited.has(node)) {
        return false;
      }

      visited.add(node);
      stack.add(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (dfs(neighbor)) {
          cycle.push(neighbor);
          return true;
        }
      }

      stack.delete(node);
      return false;
    };

    if (dfs(def.metadata.name)) {
      cycle.reverse();
      return cycle;
    }

    return [];
  }

  private validateReferences(def: CompositionDefinition): ValidationError[] {
    const errors: ValidationError[] = [];
    const stepIds = new Set(def.spec.steps.map(s => s.id));

    // Walk all references in steps and return
    // ... detailed reference validation logic

    return errors;
  }

  private resolveDependencies(def: CompositionDefinition): any[] {
    const toolIds = this.extractToolIds(def);
    return toolIds.map(toolId => {
      const tool = this.registry.getTool(toolId);
      return {
        toolId,
        schemaFingerprint: tool ? this.hashSchema(tool.inputSchema) : '',
      };
    });
  }

  private computeHash(def: CompositionDefinition): string {
    // Hash canonical AST for content-addressable storage
    const canonical = JSON.stringify(def, null, 0);
    return createHash('sha256').update(canonical).digest('hex');
  }

  private hashSchema(schema: any): string {
    const canonical = JSON.stringify(schema, null, 0);
    return createHash('sha256').update(canonical).digest('hex');
  }
}
```

### 4.4 Composition Executor

**Location**: `src/common/composition/executor.ts`

```typescript
import { CompiledComposition, ValueExpression, Reference, Condition, Step } from './types';
import type { ToolRegistry } from '../../services/llm-bot/tools/registry';
import { Logger } from '../logging';

export interface ExecutionContext {
  input: any;                        // Caller-provided arguments
  context: any;                      // Execution context (channel_id, etc.)
  sessionId: string;
  correlationId: string;
  userRoles: string[];
}

export interface ExecutionState {
  input: any;
  context: any;
  steps: Map<string, any>;           // Step results keyed by step.id
}

export class CompositionExecutor {
  constructor(
    private registry: ToolRegistry,
    private logger: Logger
  ) {}

  /**
   * Execute a compiled composition.
   */
  async execute(
    compiled: CompiledComposition,
    ctx: ExecutionContext
  ): Promise<any> {
    const startTime = Date.now();

    this.logger.debug('composition.execute.start', {
      composition: compiled.metadata.name,
      correlationId: ctx.correlationId,
    });

    // Validate input against inputSchema
    // (Using AJV or similar JSON Schema validator)
    // ... input validation

    // Validate context against contextSchema (if present)
    // ... context validation

    // Initialize execution state
    const state: ExecutionState = {
      input: ctx.input,
      context: ctx.context,
      steps: new Map(),
    };

    // Execute steps sequentially
    for (const step of compiled.spec.steps) {
      try {
        const result = await this.executeStep(step, state, ctx);
        state.steps.set(step.id, result);

        this.logger.debug('composition.step.completed', {
          composition: compiled.metadata.name,
          stepId: step.id,
          correlationId: ctx.correlationId,
        });
      } catch (err) {
        this.logger.error('composition.step.failed', {
          composition: compiled.metadata.name,
          stepId: step.id,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    // Construct return value
    const result = this.resolveValue(compiled.spec.return, state);

    // Validate output against outputSchema (if present)
    // ... output validation

    const durationMs = Date.now() - startTime;

    this.logger.info('composition.execute.completed', {
      composition: compiled.metadata.name,
      correlationId: ctx.correlationId,
      durationMs,
    });

    return result;
  }

  private async executeStep(
    step: Step,
    state: ExecutionState,
    ctx: ExecutionContext
  ): Promise<any> {
    if ((step as any).call) {
      return this.executeCallStep(step as any, state, ctx);
    } else if ((step as any).if) {
      return this.executeIfStep(step as any, state);
    }
    throw new Error(`Unknown step type: ${JSON.stringify(step)}`);
  }

  private async executeCallStep(
    step: any,
    state: ExecutionState,
    ctx: ExecutionContext
  ): Promise<any> {
    // Evaluate guard condition (if present)
    if (step.when) {
      const shouldExecute = this.evaluateCondition(step.when, state);
      if (!shouldExecute) {
        this.logger.debug('composition.step.skipped', { stepId: step.id });
        return null;  // Skipped
      }
    }

    // Resolve arguments
    const args = step.with ? this.resolveValue(step.with, state) : {};

    // Invoke tool
    const tool = this.registry.getTool(step.call);
    if (!tool) {
      throw new Error(`Tool not found: ${step.call}`);
    }

    const result = await tool.execute(args, {
      sessionId: ctx.sessionId,
      correlationId: ctx.correlationId,
      userRoles: ctx.userRoles,
    });

    // Extract structured result
    if (result.isError) {
      throw new Error(`Tool execution failed: ${step.call}`);
    }

    // Parse structured content
    const content = result.content?.[0];
    if (content?.type === 'text') {
      try {
        return JSON.parse(content.text);
      } catch {
        return content.text;
      }
    }

    return null;
  }

  private executeIfStep(step: any, state: ExecutionState): any {
    const conditionResult = this.evaluateCondition(step.if.condition, state);
    return conditionResult
      ? this.resolveValue(step.if.then, state)
      : this.resolveValue(step.if.else, state);
  }

  /**
   * Resolve a value expression (references, literals, objects, arrays).
   */
  private resolveValue(expr: ValueExpression, state: ExecutionState): any {
    // Reference
    if (expr && typeof expr === 'object' && (expr as any).$ref) {
      return this.resolveReference((expr as Reference), state);
    }

    // Array
    if (Array.isArray(expr)) {
      return expr.map(item => this.resolveValue(item, state));
    }

    // Object
    if (expr && typeof expr === 'object') {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(expr)) {
        result[key] = this.resolveValue(val, state);
      }
      return result;
    }

    // Literal
    return expr;
  }

  private resolveReference(ref: Reference, state: ExecutionState): any {
    const { namespace, pointer } = ref.$ref;

    let root: any;
    if (namespace === 'input') {
      root = state.input;
    } else if (namespace === 'context') {
      root = state.context;
    } else if (namespace === 'steps') {
      // Special handling: pointer starts with step ID
      const parts = pointer.split('/').filter(Boolean);
      const stepId = parts[0];
      const stepResult = state.steps.get(stepId);
      if (stepResult === undefined) {
        throw new Error(`Step not found: ${stepId}`);
      }
      if (parts.length === 1) {
        return stepResult;
      }
      // Navigate into step result
      root = stepResult;
      const restPath = '/' + parts.slice(1).join('/');
      return this.navigatePointer(root, restPath);
    } else {
      throw new Error(`Invalid namespace: ${namespace}`);
    }

    return this.navigatePointer(root, pointer);
  }

  private navigatePointer(obj: any, pointer: string): any {
    const parts = pointer.split('/').filter(Boolean);
    let current = obj;

    for (const part of parts) {
      // Unescape JSON Pointer tokens
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (current === null || current === undefined) {
        throw new Error(`Cannot navigate path: ${pointer}`);
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Evaluate a deterministic condition.
   */
  private evaluateCondition(cond: Condition, state: ExecutionState): boolean {
    if ((cond as any).exists) {
      try {
        const val = this.resolveValue((cond as any).exists, state);
        return val !== null && val !== undefined;
      } catch {
        return false;
      }
    }

    if ((cond as any).equals) {
      const [left, right] = (cond as any).equals;
      return this.resolveValue(left, state) === this.resolveValue(right, state);
    }

    if ((cond as any).greaterThan) {
      const [left, right] = (cond as any).greaterThan;
      return this.resolveValue(left, state) > this.resolveValue(right, state);
    }

    if ((cond as any).lessThan) {
      const [left, right] = (cond as any).lessThan;
      return this.resolveValue(left, state) < this.resolveValue(right, state);
    }

    if ((cond as any).greaterThanOrEqual) {
      const [left, right] = (cond as any).greaterThanOrEqual;
      return this.resolveValue(left, state) >= this.resolveValue(right, state);
    }

    if ((cond as any).lessThanOrEqual) {
      const [left, right] = (cond as any).lessThanOrEqual;
      return this.resolveValue(left, state) <= this.resolveValue(right, state);
    }

    if ((cond as any).all) {
      return (cond as any).all.every((c: Condition) => this.evaluateCondition(c, state));
    }

    if ((cond as any).any) {
      return (cond as any).any.some((c: Condition) => this.evaluateCondition(c, state));
    }

    if ((cond as any).not) {
      return !this.evaluateCondition((cond as any).not, state);
    }

    throw new Error(`Unknown condition: ${JSON.stringify(cond)}`);
  }
}
```

### 4.5 Composition Registry

**Location**: `src/common/composition/registry.ts`

**Storage Pattern**: **DocumentStore** (BitBrat platform standard)

**Collection**: `compositions`

**Document Structure**:

```typescript
interface CompositionDocument {
  // Primary fields
  id: string;                        // UUID
  name: string;                      // Logical name (unique within active status)
  version: number;                   // Version number
  status: 'draft' | 'active' | 'archived';

  // Source
  sourceYaml: string;                // Original YAML
  canonicalAst: CompositionSpec;     // Canonical JSON representation

  // Schemas
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  contextSchema?: JSONSchema;

  // Metadata
  description?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;

  // Compilation
  contentHash: string;               // SHA-256 of canonical AST
  compiledAt: string;                // ISO 8601 timestamp
  dependencies: ToolDependency[];    // Array of {toolId, schemaFingerprint}

  // Audit
  createdAt: string;                 // ISO 8601 timestamp
  updatedAt: string;                 // ISO 8601 timestamp
}
```

**Optional Performance Indexes** (PostgreSQL backend):

```sql
-- Optional: Add GIN indexes for fast JSONB queries
-- (Not required - DocumentStore works without these, but improves performance)

-- Index on name field for fast lookup
CREATE INDEX IF NOT EXISTS idx_compositions_name
  ON documents ((data->>'name'))
  WHERE collection = 'compositions';

-- Index on status field for filtering
CREATE INDEX IF NOT EXISTS idx_compositions_status
  ON documents ((data->>'status'))
  WHERE collection = 'compositions';

-- Index on contentHash for deduplication
CREATE INDEX IF NOT EXISTS idx_compositions_content_hash
  ON documents ((data->>'contentHash'))
  WHERE collection = 'compositions';

-- Composite index for active compositions by name
CREATE INDEX IF NOT EXISTS idx_compositions_active_name
  ON documents ((data->>'status'), (data->>'name'))
  WHERE collection = 'compositions' AND (data->>'status') = 'active';
```

**Repository Interface**:

```typescript
// src/common/composition/registry.ts
import { CompiledComposition, CompositionDefinition } from './types';

export interface CompositionRegistry {
  /**
   * Create a new composition.
   */
  create(compiled: CompiledComposition, sourceYaml: string): Promise<string>;

  /**
   * Get composition by ID.
   */
  get(id: string): Promise<CompiledComposition | null>;

  /**
   * Get composition by name (latest version).
   */
  getByName(name: string): Promise<CompiledComposition | null>;

  /**
   * List all active compositions.
   */
  listActive(): Promise<CompiledComposition[]>;

  /**
   * Update composition status.
   */
  updateStatus(id: string, status: 'draft' | 'active' | 'archived'): Promise<void>;

  /**
   * Delete composition.
   */
  delete(id: string): Promise<void>;
}
```

**Implementation** (DocumentStore):

```typescript
import { IDocumentStore } from '../persistence/interfaces';
import { CompiledComposition, CompositionDefinition } from './types';
import { randomUUID } from 'crypto';

/**
 * DocumentStore-based composition registry.
 * Works with both Firestore and PostgreSQL backends.
 */
export class DocumentStoreCompositionRegistry implements CompositionRegistry {
  private readonly collection = 'compositions';

  constructor(private documentStore: IDocumentStore) {}

  async create(compiled: CompiledComposition, sourceYaml: string): Promise<string> {
    const id = randomUUID();

    const doc: CompositionDocument = {
      id,
      name: compiled.metadata.name,
      version: compiled.metadata.version || 1,
      status: 'active',
      sourceYaml,
      canonicalAst: compiled.spec,
      inputSchema: compiled.spec.inputSchema,
      outputSchema: compiled.spec.outputSchema,
      contextSchema: compiled.spec.contextSchema,
      description: compiled.metadata.description,
      labels: compiled.metadata.labels,
      annotations: compiled.metadata.annotations,
      contentHash: compiled.contentHash,
      compiledAt: new Date().toISOString(),
      dependencies: compiled.dependencies,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.documentStore.set(this.collection, id, doc);

    return id;
  }

  async get(id: string): Promise<CompiledComposition | null> {
    const doc = await this.documentStore.get<CompositionDocument>(this.collection, id);

    if (!doc) {
      return null;
    }

    return this.docToCompiled(doc);
  }

  async getByName(name: string): Promise<CompiledComposition | null> {
    // Query for active composition with matching name
    const results = await this.documentStore.query<CompositionDocument>(
      this.collection,
      {
        filters: [
          { field: 'name', operator: '==', value: name },
          { field: 'status', operator: '==', value: 'active' },
        ],
        orderBy: { field: 'version', direction: 'desc' },
        limit: 1,
      }
    );

    if (results.length === 0) {
      return null;
    }

    return this.docToCompiled(results[0]);
  }

  async listActive(): Promise<CompiledComposition[]> {
    const results = await this.documentStore.query<CompositionDocument>(
      this.collection,
      {
        filters: [
          { field: 'status', operator: '==', value: 'active' },
        ],
        orderBy: { field: 'name', direction: 'asc' },
      }
    );

    return results.map(doc => this.docToCompiled(doc));
  }

  async updateStatus(id: string, status: 'draft' | 'active' | 'archived'): Promise<void> {
    const doc = await this.documentStore.get<CompositionDocument>(this.collection, id);

    if (!doc) {
      throw new Error(`Composition not found: ${id}`);
    }

    // Merge update using DocumentStore's merge capability
    await this.documentStore.set(
      this.collection,
      id,
      {
        status,
        updatedAt: new Date().toISOString(),
      },
      true  // merge = true (preserves other fields)
    );
  }

  async delete(id: string): Promise<void> {
    await this.documentStore.delete(this.collection, id);
  }

  private docToCompiled(doc: CompositionDocument): CompiledComposition {
    return {
      id: doc.id,
      metadata: {
        name: doc.name,
        version: doc.version,
        description: doc.description,
        labels: doc.labels,
        annotations: doc.annotations,
      },
      spec: doc.canonicalAst,
      compiledAt: new Date(doc.compiledAt),
      contentHash: doc.contentHash,
      dependencies: doc.dependencies,
      validationReport: {
        valid: true,
        errors: [],
        warnings: [],
      },
    };
  }
}
```

---

## 5. Tool-Gateway Integration

### 5.1 Composition Loading on Startup

**Location**: `src/apps/tool-gateway.ts`

```typescript
export class ToolGatewayServer extends Bit {
  private compositionRegistry: CompositionRegistry;
  private compositionExecutor: CompositionExecutor;

  constructor() {
    super({ serviceName: SERVICE_NAME, mcpExposure: 'platform+domain' });

    // Get DocumentStore from resources (already initialized by Bit)
    const documentStore = this.getResource<IDocumentStore>('documentStore');

    if (!documentStore) {
      this.getLogger().warn('tool_gateway.composition.disabled', {
        reason: 'DocumentStore not available',
      });
      // Graceful degradation - compositions disabled
      return;
    }

    // Initialize composition subsystem using DocumentStore
    this.compositionRegistry = new DocumentStoreCompositionRegistry(documentStore);
    this.compositionExecutor = new CompositionExecutor(this.registry, this.getLogger());

    this.setupApp(this.getApp() as any);
    this.registerGatewayTools();
  }

  async setup(): Promise<void> {
    await super.setup();

    // Load all active compositions and register as MCP tools
    await this.loadCompositions();
  }

  private async loadCompositions(): Promise<void> {
    const compositions = await this.compositionRegistry.listActive();

    this.getLogger().info('tool_gateway.compositions.loading', {
      count: compositions.length,
    });

    for (const comp of compositions) {
      await this.registerCompositionTool(comp);
    }

    this.getLogger().info('tool_gateway.compositions.loaded', {
      count: compositions.length,
    });
  }

  private async registerCompositionTool(comp: CompiledComposition): Promise<void> {
    const toolName = comp.metadata.name;

    // Register in ToolRegistry (used for MCP facade)
    this.registry.registerTool({
      id: toolName,
      displayName: toolName,
      description: comp.metadata.description || `Composition: ${toolName}`,
      inputSchema: comp.spec.inputSchema,
      execute: async (args: any, extra?: any) => {
        return this.executeComposition(comp, args, extra);
      },
      source: 'composition',  // Mark as composition
    });

    // Also register via Bit's MCP interface
    this.registerTool(
      toolName,
      comp.metadata.description || `Composition: ${toolName}`,
      comp.spec.inputSchema,
      async (args: any, extra?: any) => {
        return this.executeComposition(comp, args, extra);
      }
    );

    this.getLogger().debug('tool_gateway.composition.registered', {
      name: toolName,
    });
  }

  private async executeComposition(
    comp: CompiledComposition,
    args: any,
    extra?: any
  ): Promise<any> {
    const ctx: ExecutionContext = {
      input: args,
      context: extra?.context || {},
      sessionId: extra?.sessionId || '',
      correlationId: extra?.correlationId || '',
      userRoles: extra?.userRoles || [],
    };

    try {
      const result = await this.compositionExecutor.execute(comp, ctx);

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      };
    } catch (err) {
      this.getLogger().error('composition.execution.failed', {
        composition: comp.metadata.name,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [{ type: 'text', text: `Composition execution failed: ${err}` }],
        isError: true,
      };
    }
  }
}
```

### 5.2 REST API for Composition Management

**Endpoints**:

```typescript
// POST /compositions - Create/register new composition
app.post('/compositions', async (req: Request, res: Response) => {
  try {
    const parser = new CompositionParser();
    const compiler = new CompositionCompiler(this.registry);

    const def = parser.parse(req.body);
    const compiled = compiler.compile(def);

    const id = await this.compositionRegistry.create(compiled, req.body);

    // Register as MCP tool
    await this.registerCompositionTool(compiled);

    res.json({ id, name: compiled.metadata.name });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /compositions - List all compositions
app.get('/compositions', async (req: Request, res: Response) => {
  const compositions = await this.compositionRegistry.listActive();
  res.json({
    compositions: compositions.map(c => ({
      id: c.id,
      name: c.metadata.name,
      description: c.metadata.description,
    }))
  });
});

// GET /compositions/:id - Get composition details
app.get('/compositions/:id', async (req: Request, res: Response) => {
  const comp = await this.compositionRegistry.get(req.params.id);
  if (!comp) {
    return res.status(404).json({ error: 'Composition not found' });
  }
  res.json(comp);
});

// POST /compositions/:id/execute - Execute composition via REST
app.post('/compositions/:id/execute', async (req: Request, res: Response) => {
  const comp = await this.compositionRegistry.get(req.params.id);
  if (!comp) {
    return res.status(404).json({ error: 'Composition not found' });
  }

  const ctx: ExecutionContext = {
    input: req.body.input || {},
    context: req.body.context || {},
    sessionId: req.body.sessionId || 'rest',
    correlationId: req.body.correlationId || randomUUID(),
    userRoles: req.body.userRoles || ['reflex'],
  };

  try {
    const result = await this.compositionExecutor.execute(comp, ctx);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /compositions/:id - Delete composition
app.delete('/compositions/:id', async (req: Request, res: Response) => {
  await this.compositionRegistry.delete(req.params.id);
  res.json({ deleted: true });
});
```

---

## 6. Reflex Integration

The reflex service can now invoke compositions via the REST API:

```typescript
// In reflex-service.ts
async function executeComposition(compositionId: string, input: any, context: any): Promise<any> {
  const response = await fetch(`http://tool-gateway:3000/compositions/${compositionId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, context }),
  });

  if (!response.ok) {
    throw new Error(`Composition execution failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.result;
}
```

---

## 7. Example Composition

**File**: `compositions/viewer_greeting.yaml`

```yaml
apiVersion: mcp-compose/v1
kind: Composition

metadata:
  name: viewer_greeting
  description: >
    Resolve Twitch viewer, retrieve viewer memory,
    determine greeting type, and display OBS alert.

spec:
  inputSchema:
    type: object
    properties:
      user_id:
        type: string
        description: Twitch user ID
    required:
      - user_id

  contextSchema:
    type: object
    properties:
      channel_id:
        type: string
    required:
      - channel_id

  outputSchema:
    type: object
    properties:
      handled:
        type: boolean
      viewer_id:
        type: string
      greeting_type:
        type: string
        enum: [new_viewer, returning_viewer]
    required:
      - handled
      - viewer_id
      - greeting_type

  steps:
    # Step 1: Fetch user from Twitch
    - id: user
      call: twitch.get_user
      with:
        id: $input/user_id

    # Step 2: Retrieve viewer memory
    - id: memory
      call: viewer_memory.get
      with:
        user_id: $steps/user/id
        channel_id: $context/channel_id

    # Step 3: Determine greeting type
    - id: greeting_type
      if:
        condition:
          equals:
            - $steps/memory/returning
            - true
        then: returning_viewer
        else: new_viewer

    # Step 4: Display OBS alert
    - id: alert
      call: obs.show_alert
      with:
        template: $steps/greeting_type
        name: $steps/user/display_name

  return:
    handled: true
    viewer_id: $steps/user/id
    greeting_type: $steps/greeting_type
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Parser Tests** (`src/common/composition/parser.test.ts`):
- ✅ Valid YAML → AST
- ✅ Valid JSON → AST
- ✅ Reference canonicalization ($input/foo → {$ref: ...})
- ✅ Invalid structure → Error

**Compiler Tests** (`src/common/composition/compiler.test.ts`):
- ✅ Tool resolution (all tools exist)
- ✅ Cycle detection (A → B → A)
- ✅ Reference validation (step IDs exist)
- ✅ Invalid tool → Error

**Executor Tests** (`src/common/composition/executor.test.ts`):
- ✅ Sequential step execution
- ✅ Reference resolution ($input, $context, $steps)
- ✅ Condition evaluation (equals, greaterThan, etc.)
- ✅ Guarded steps (when: false → skip)
- ✅ Nested object/array resolution

### 8.2 Integration Tests

**End-to-End Composition** (`tests/integration/composition-e2e.test.ts`):
1. Load `viewer_greeting.yaml`
2. Parse & compile
3. Register in tool-gateway
4. Verify appears in `tools/list`
5. Execute via MCP `tools/call`
6. Verify structured output

**REST API Tests** (`tests/apps/tool-gateway-composition-rest.test.ts`):
- ✅ POST /compositions (create)
- ✅ GET /compositions (list)
- ✅ POST /compositions/:id/execute (execute)
- ✅ DELETE /compositions/:id (delete)

### 8.3 Agent-Dev Validation

**Validation Protocol**:
1. Deploy tool-gateway to agent-dev context
2. Register sample composition (`viewer_greeting.yaml`)
3. Invoke via MCP client (simulate llm-bot)
4. Verify execution trace in logs
5. Test REST API invocation (simulate reflex)

---

## 9. Migration & Rollout

### 9.1 Phase 1: Manual Composition Authoring

**Week 1**: Infrastructure
- Implement parser, compiler, executor
- Create DocumentStore indexes (optional performance optimization)
- Create DocumentStoreCompositionRegistry implementation

**Week 2**: Tool-Gateway Integration
- Load compositions on startup
- Register as MCP tools
- Add REST API endpoints

**Week 3**: Testing & Validation
- Unit tests (parser, compiler, executor)
- Integration tests (E2E composition execution)
- Agent-dev validation

### 9.2 Phase 2: Production Rollout

**Week 4**: Deploy to Staging
- Create 2-3 sample compositions (viewer_greeting, user_lookup)
- Deploy tool-gateway with composition support
- Validate via test harness

**Week 5**: Production Deployment
- Deploy to production
- Monitor composition execution metrics
- Gather feedback from LLM agent behavior

---

## 10. Success Criteria

### 10.1 Acceptance Criteria

Sprint complete when:

1. ✅ Load a YAML composition from disk
2. ✅ Parse, validate, and compile composition
3. ✅ Detect and reject circular dependencies
4. ✅ Execute 3-step composition calling primitive tools
5. ✅ Composition appears in MCP `tools/list`
6. ✅ LLM agent can invoke composition via `tools/call`
7. ✅ Reflex can invoke composition via REST API
8. ✅ Nested composition works (composition calls composition)
9. ✅ All unit tests pass
10. ✅ Integration test validates E2E flow
11. ✅ Agent-dev validation confirms functionality

### 10.2 Metrics

| Metric | Target |
|--------|--------|
| Composition load time | <100ms per composition |
| Execution overhead | <10ms (vs direct tool calls) |
| Compilation success rate | 100% for valid YAML |
| Unit test coverage | >80% |

---

## 11. Future Enhancements (Post-Sprint)

Deferred to future sprints:

- **Observation System**: Capture emergent tool-use patterns
- **Automated Learning**: Pattern detection + candidate generation
- **Promotion Workflow**: Candidate → Validated → Published
- **Reflex Enhancement**: Composition targets in reflex DSL
- **Parallel Execution**: Parallel step blocks
- **Advanced Conditions**: String matching, regex, contains
- **Foreach Loops**: Iterate over bounded arrays
- **Retry/Fallback**: Error handling strategies

---

## 12. Open Questions

1. **Composition Discovery**: Should compositions be stored in files or database?
   - **Decision**: DocumentStore (vendor-neutral abstraction) for dynamic loading, file-based for source control

2. **Versioning Strategy**: How to handle composition updates?
   - **Decision**: V1 uses simple replacement (no versioning), future sprint adds version support

3. **Authorization**: Should compositions inherit caller's roles or have their own?
   - **Decision**: Inherit caller's roles (no privilege escalation)

4. **Debugging**: How to debug composition execution?
   - **Decision**: Detailed logging + execution trace in response (future: step-through debugger)

---

## 13. Conclusion

This sprint establishes the **foundational layer** for MCP Behavioral Compilation. By implementing the Composition DSL & Runtime and integrating it into tool-gateway, we enable:

- Manual authoring of reusable multi-step procedures
- Exposure of compositions as first-class MCP tools
- REST API access for reflex service
- Foundation for future automated learning

The design is intentionally minimal (no observation, no learning, no promotion) to deliver a working, testable foundation in a single sprint. Future sprints will build on this foundation to enable automated pattern detection and reflex promotion.

---

## Appendix A: File Structure

```text
src/
  common/
    composition/
      types.ts                       # Core types
      parser.ts                      # YAML/JSON → AST
      compiler.ts                    # Validator + compiler
      executor.ts                    # Runtime executor
      registry.ts                    # DocumentStore registry
      parser.test.ts                 # Parser unit tests
      compiler.test.ts               # Compiler unit tests
      executor.test.ts               # Executor unit tests

  apps/
    tool-gateway.ts                  # Enhanced with composition support

compositions/
  examples/
    viewer_greeting.yaml             # Example composition
    user_lookup.yaml                 # Example composition

tests/
  integration/
    composition-e2e.test.ts          # End-to-end tests
  apps/
    tool-gateway-composition-rest.test.ts  # REST API tests
```

---

**End of Technical Architecture Document**

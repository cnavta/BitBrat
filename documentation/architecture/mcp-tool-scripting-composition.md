# MCP Tool Scripting & Composition

**Feature**: Declarative scripting language for composing MCP tools into multi-step workflows

**Status**: Architecture Design

**Intent**: Enable simple orchestration of multiple MCP tools without TypeScript/LLM overhead, creating a learning path from ad-hoc (LLM decides) → composed (pre-defined sequences) → reflex (pattern-matched triggers).

---

## Executive Summary

| Aspect | Description |
|--------|-------------|
| **Problem** | - Reflex Bit can only invoke ONE MCP tool per reflex (Sprint 332 limitation)<br>- Creating composite tools requires full TypeScript implementation<br>- No declarative way to sequence multiple tools<br>- LLM is required for all multi-tool orchestration (slow, expensive, unpredictable) |
| **Solution** | Add lightweight scripting DSL for tool composition with three progressively sophisticated approaches: **JSON Workflows** (simplest), **YAML Pipelines** (readable), and **Expression Language** (most powerful). |
| **Learning Path** | **Ad-hoc** (LLM chooses tools at runtime) → **Composed** (pre-defined multi-tool sequences) → **Reflex** (pattern-triggered instant execution) |
| **Use Cases** | 1. Reflex multi-tool orchestration (`!fail` → hide camera + show fail overlay + play sound)<br>2. Composite MCP tools (`scene.switch` = disable old sources + enable new sources + update state)<br>3. Event-driven pipelines (user follows → send DM + update stats + trigger celebration) |

---

## Current Architecture Analysis

### Pattern 1: Single Tool Invocation (Reflex Bit, Sprint 332)

**Current** Capability:
```yaml
# reflex.create - Pattern-triggered single tool invocation
match:
  type: exact
  pattern: "!fail"
  field: message.text

action:
  tool: "mcp_obs-set-scene-item-enabled"
  parameters:
    sceneName: "MainScene"
    sceneItemId: 5
    sceneItemEnabled: true
  timeout: 5000

candidateTemplate: "Fail overlay activated!"
```

**Limitations**:
- ❌ Only ONE tool per reflex
- ❌ No conditional logic
- ❌ No error handling beyond timeout
- ❌ No data flow between tools
- ❌ No loops or iterations

**Current Workarounds**:
1. Create separate reflexes (but they execute independently, no orchestration)
2. Create custom TypeScript MCP tool that wraps multiple calls (heavy, requires deployment)
3. Use LLM to orchestrate tools (slow, expensive, unpredictable)

---

### Pattern 2: Template-Based Parameter Interpolation (Working)

**Existing Infrastructure** (src/services/reflex/parameter-builder.ts:1-151):
```typescript
// ALREADY WORKING: {{event.field.path}} interpolation
const template = {
  sourceName: "{{scene}}", // Event data interpolation
  visible: true,            // Static values
  metadata: {
    user: "{{identity.user.displayName}}", // Nested interpolation
  }
};
```

**Capabilities**:
- ✅ Dot-notation field access (`{{identity.user.displayName}}`)
- ✅ Nested object interpolation
- ✅ Type preservation (strings interpolate, numbers/booleans pass through)
- ✅ Dual-context interpolation (`{{event.*}}` and `{{result.*}}` in candidateTemplate)

**Can Be Extended For**:
- Tool output references (`{{tool1.result.sceneId}}`)
- Conditional values
- Array operations

---

### Pattern 3: JsonLogic in Event Router (Existing)

**Current Usage** (src/apps/event-router-service.ts):
```javascript
// JsonLogic rules for routing slip generation
{
  "if": [
    {"==": [{"var": "type"}, "chat.message.v1"]},
    ["internal.reflex.v1", "internal.llmbot.v1"],
    ["internal.llmbot.v1"]
  ]
}
```

**Why It Works**:
- ✅ JSON-serializable (store in Firestore/PostgreSQL)
- ✅ No eval() security issues
- ✅ Predictable evaluation
- ✅ Battle-tested (event-router uses it extensively)

**Could Be Used For**:
- Conditional tool execution
- Parameter computation
- Loop conditions
- Error handling decisions

---

## Proposed Architecture: Three Tiers

### Tier 1: JSON Workflows (Simplest, Ship First)

**Syntax**: Pure JSON, minimal extensions to current reflex format

```json
{
  "id": "fail-overlay-sequence",
  "name": "Fail Overlay Sequence",
  "match": {
    "type": "exact",
    "pattern": "!fail",
    "field": "message.text"
  },
  "workflow": {
    "steps": [
      {
        "id": "hide_camera",
        "tool": "mcp_obs-set-scene-item-enabled",
        "parameters": {
          "sceneName": "MainScene",
          "sceneItemId": 3,
          "sceneItemEnabled": false
        },
        "timeout": 3000
      },
      {
        "id": "show_fail_overlay",
        "tool": "mcp_obs-set-scene-item-enabled",
        "parameters": {
          "sceneName": "MainScene",
          "sceneItemId": 5,
          "sceneItemEnabled": true
        },
        "timeout": 3000,
        "dependencies": ["hide_camera"]
      },
      {
        "id": "play_sound",
        "tool": "mcp_obs-trigger-source",
        "parameters": {
          "sourceName": "FailSound"
        },
        "timeout": 1000,
        "dependencies": ["show_fail_overlay"]
      }
    ],
    "onError": "continue",
    "timeout": 10000
  },
  "candidateTemplate": "Fail sequence executed! Camera hidden, overlay shown, sound played."
}
```

**Features**:
- Sequential execution with dependency graph
- Timeout per step + global timeout
- Error handling modes (`stop`, `continue`, `retry`)
- References to previous step results: `"{{$steps.hide_camera.result.success}}"`

**Implementation Complexity**: **Low** (2-3 days)
- Extend `Reflex` type with optional `workflow` field
- Create `WorkflowExecutor` class (similar to reflex-executor)
- Reuse existing parameter interpolation
- Add step result accumulator

---

### Tier 2: YAML Pipelines (Readable, GitHub Actions-like)

**Syntax**: YAML with familiar GitHub Actions/GitLab CI syntax

```yaml
id: scene-switcher
name: Scene Switcher
match:
  type: exact
  pattern: "!scene {{sceneName}}"
  field: message.text
  capture:
    sceneName: \w+

pipeline:
  variables:
    oldScene: MainScene
    newScene: "{{match.sceneName}}"

  stages:
    - name: disable_old_sources
      parallel: true  # Run all steps in parallel
      steps:
        - tool: mcp_obs-set-scene-item-enabled
          args:
            sceneName: "{{oldScene}}"
            sceneItemId: 3
            sceneItemEnabled: false

        - tool: mcp_obs-set-scene-item-enabled
          args:
            sceneName: "{{oldScene}}"
            sceneItemId: 5
            sceneItemEnabled: false

    - name: enable_new_sources
      depends_on: [disable_old_sources]
      steps:
        - tool: mcp_obs-set-scene-item-enabled
          args:
            sceneName: "{{newScene}}"
            sceneItemId: 1
            sceneItemEnabled: true

    - name: update_state
      depends_on: [enable_new_sources]
      steps:
        - tool: state.mutation
          args:
            path: currentScene
            value: "{{newScene}}"

  onFailure:
    - tool: state.mutation
      args:
        path: lastError
        value: "{{$error.message}}"
```

**Features**:
- Stage-based organization (like CI/CD)
- Parallel execution within stages
- Named variables for readability
- Capture groups from pattern match
- Failure hooks

**Implementation Complexity**: **Medium** (4-5 days)
- YAML parser (js-yaml already dep)
- Stage/dependency resolver
- Parallel execution coordinator
- Variable scope management

---

### Tier 3: Expression Language (Most Powerful)

**Syntax**: Custom DSL with JsonLogic for conditionals, template syntax for data flow

```yaml
id: smart-raid-response
name: Smart Raid Response
match:
  type: regex
  pattern: "^(?<username>\\w+) is raiding with (?<viewerCount>\\d+) viewers!$"
  field: message.text

script:
  # Variable declarations
  vars:
    username: "{{match.username}}"
    viewers: "{{match.viewerCount | parseInt}}"
    isLargeRaid: {">=": [{"var": "viewers"}, 100]}

  # Conditional execution using JsonLogic
  if:
    condition: {"var": "isLargeRaid"}
    then:
      - tool: mcp_obs-set-scene-item-enabled
        args:
          sceneName: MainScene
          sceneItemId: 7  # Big raid alert
          sceneItemEnabled: true

      - tool: state.mutation
        args:
          path: lastLargeRaid
          value:
            username: "{{username}}"
            viewers: "{{viewers}}"
            timestamp: "{{$now}}"

    else:
      - tool: mcp_obs-set-scene-item-enabled
        args:
          sceneName: MainScene
          sceneItemId: 8  # Small raid alert
          sceneItemEnabled: true

  # Always execute (finally block)
  finally:
    - tool: mcp_send-chat-message
      args:
        channel: "{{ingress.channel}}"
        message: "Thanks for the raid, {{username}}! Welcome {{viewers}} viewers!"
```

**Features**:
- JsonLogic conditionals (if/else/switch)
- Built-in filters (`parseInt`, `toLowerCase`, `toString`, etc.)
- Built-in variables (`$now`, `$random`, `$error`, `$user`)
- Try/catch error handling
- Loops (for-each over arrays)
- Scoped variable assignments

**Implementation Complexity**: **High** (7-10 days)
- JsonLogic integration for conditionals
- Template filter system
- Scope/context stack for variable resolution
- Loop execution engine
- Error boundary handling

---

## Detailed Design: Tier 1 (JSON Workflows) - Ship This First

### Schema Extension

```typescript
// src/types/reflex.ts - Extend Reflex interface

/**
 * Multi-step workflow configuration (alternative to single action).
 * When workflow is present, action field is ignored.
 */
export interface ReflexWorkflow {
  /** Ordered list of workflow steps */
  steps: WorkflowStep[];

  /** Global workflow timeout (milliseconds, default: 30000) */
  timeout?: number;

  /** Error handling strategy */
  onError?: 'stop' | 'continue' | 'retry';

  /** Retry configuration (when onError: 'retry') */
  retry?: {
    maxAttempts: number;
    delayMs: number;
    backoff?: 'linear' | 'exponential';
  };

  /** Execute steps in parallel (default: false, sequential) */
  parallel?: boolean;
}

/**
 * Single step in a multi-step workflow
 */
export interface WorkflowStep {
  /** Unique step ID (used for references) */
  id: string;

  /** MCP tool to invoke */
  tool: string;

  /** Tool parameters (supports interpolation + step references) */
  parameters: Record<string, any>;

  /** Step-level timeout (milliseconds, default: 5000) */
  timeout?: number;

  /** IDs of steps that must complete before this step runs */
  dependencies?: string[];

  /** Condition for step execution (JsonLogic) */
  condition?: any; // JsonLogic expression

  /** Execute on error only (try/catch pattern) */
  onErrorOnly?: boolean;
}

// Extend Reflex interface
export interface Reflex {
  // ... existing fields ...

  /**
   * Multi-step workflow (alternative to single action).
   * Mutually exclusive with action field.
   */
  workflow?: ReflexWorkflow;
}
```

---

### Workflow Executor

```typescript
// src/services/reflex/workflow-executor.ts

import { Reflex, ReflexWorkflow, WorkflowStep } from '../../types/reflex';
import { InternalEventV2, CandidateV1 } from '../../types/events';
import { buildParameters } from './parameter-builder';
import { executeTool } from './tool-executor';
import { buildCandidates } from './candidate-builder';

export interface WorkflowExecutionResult {
  status: 'success' | 'partial' | 'error';
  steps: WorkflowStepResult[];
  candidates?: CandidateV1[];
  error?: { message: string; code?: string };
  latency: number;
}

export interface WorkflowStepResult {
  stepId: string;
  status: 'success' | 'skipped' | 'error';
  result?: any;
  error?: string;
  latency: number;
}

/**
 * Executes a multi-step workflow defined in a reflex.
 *
 * Execution Modes:
 * - Sequential (default): Steps execute in dependency order, one at a time
 * - Parallel: Steps without dependencies execute concurrently
 *
 * Error Handling:
 * - stop (default): Halt workflow on first error
 * - continue: Log error, continue to next step
 * - retry: Retry failed step with backoff
 *
 * Step References:
 * - Parameters can reference previous step results: "{{$steps.step1.result.value}}"
 * - Event data still accessible: "{{event.identity.user.displayName}}"
 */
export class WorkflowExecutor {
  /**
   * Execute workflow steps with dependency resolution
   */
  async execute(
    reflex: Reflex,
    event: InternalEventV2,
    config: { authToken?: string; correlationId?: string } = {}
  ): Promise<WorkflowExecutionResult> {
    const startTime = Date.now();
    const { workflow } = reflex;

    if (!workflow || !workflow.steps || workflow.steps.length === 0) {
      throw new Error('Workflow has no steps');
    }

    // Build execution context (accumulates step results)
    const context: WorkflowContext = {
      event,
      steps: {},  // Step results keyed by stepId
      authToken: config.authToken,
      correlationId: config.correlationId || event.correlationId,
      userRoles: event.identity?.user?.roles || [],
    };

    const stepResults: WorkflowStepResult[] = [];
    const onError = workflow.onError || 'stop';

    try {
      // Resolve execution order (topological sort)
      const executionOrder = this.resolveDependencies(workflow.steps);

      // Execute steps in order (or parallel if workflow.parallel = true)
      if (workflow.parallel) {
        await this.executeParallel(executionOrder, workflow, context, stepResults, onError);
      } else {
        await this.executeSequential(executionOrder, workflow, context, stepResults, onError);
      }

      // Check if any steps failed
      const hasErrors = stepResults.some(r => r.status === 'error');
      const status = hasErrors ? (stepResults.some(r => r.status === 'success') ? 'partial' : 'error') : 'success';

      // Generate candidates if template provided
      let candidates: CandidateV1[] | undefined;
      if (reflex.candidateTemplate) {
        // Make step results available for interpolation
        const resultContext = {
          ...event,
          $steps: context.steps,
        };
        candidates = buildCandidates(reflex.candidateTemplate, reflex, resultContext as any, {});
      }

      return {
        status,
        steps: stepResults,
        candidates,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'error',
        steps: stepResults,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'WORKFLOW_ERROR',
        },
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute steps sequentially with dependency order
   */
  private async executeSequential(
    executionOrder: WorkflowStep[],
    workflow: ReflexWorkflow,
    context: WorkflowContext,
    stepResults: WorkflowStepResult[],
    onError: 'stop' | 'continue' | 'retry'
  ): Promise<void> {
    for (const step of executionOrder) {
      const stepResult = await this.executeStep(step, workflow, context);
      stepResults.push(stepResult);

      // Store result in context for later steps
      context.steps[step.id] = stepResult;

      // Handle errors based on strategy
      if (stepResult.status === 'error') {
        if (onError === 'stop') {
          break; // Stop execution
        } else if (onError === 'retry' && workflow.retry) {
          // Retry logic
          const retryResult = await this.retryStep(step, workflow, context);
          if (retryResult.status === 'success') {
            context.steps[step.id] = retryResult;
            stepResults[stepResults.length - 1] = retryResult; // Replace error result
          } else if (onError === 'stop') {
            break; // Still failed after retry
          }
        }
        // continue: Log and proceed to next step
      }
    }
  }

  /**
   * Execute independent steps in parallel
   */
  private async executeParallel(
    executionOrder: WorkflowStep[],
    workflow: ReflexWorkflow,
    context: WorkflowContext,
    stepResults: WorkflowStepResult[],
    onError: 'stop' | 'continue' | 'retry'
  ): Promise<void> {
    // Group steps by dependency level
    const levels = this.groupByDependencyLevel(executionOrder);

    for (const level of levels) {
      // Execute all steps in this level concurrently
      const promises = level.map(step => this.executeStep(step, workflow, context));
      const results = await Promise.allSettled(promises);

      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const step = level[i];

        if (result.status === 'fulfilled') {
          stepResults.push(result.value);
          context.steps[step.id] = result.value;
        } else {
          const errorResult: WorkflowStepResult = {
            stepId: step.id,
            status: 'error',
            error: result.reason?.message || String(result.reason),
            latency: 0,
          };
          stepResults.push(errorResult);
          context.steps[step.id] = errorResult;

          if (onError === 'stop') {
            throw new Error(`Step ${step.id} failed: ${errorResult.error}`);
          }
        }
      }
    }
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    workflow: ReflexWorkflow,
    context: WorkflowContext
  ): Promise<WorkflowStepResult> {
    const startTime = Date.now();

    try {
      // Evaluate condition (if present)
      if (step.condition) {
        const conditionResult = this.evaluateCondition(step.condition, context);
        if (!conditionResult) {
          return {
            stepId: step.id,
            status: 'skipped',
            latency: Date.now() - startTime,
          };
        }
      }

      // Build parameters with step reference support
      const parameters = this.buildStepParameters(step.parameters, context);

      // Execute MCP tool
      const result = await executeTool(step.tool, parameters, {
        authToken: context.authToken,
        timeout: step.timeout || 5000,
        correlationId: context.correlationId,
        userRoles: context.userRoles,
      });

      return {
        stepId: step.id,
        status: 'success',
        result,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        stepId: step.id,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * Build step parameters with support for step result references
   */
  private buildStepParameters(
    template: Record<string, any>,
    context: WorkflowContext
  ): Record<string, any> {
    // Extend context with $steps for interpolation
    const extendedEvent = {
      ...context.event,
      $steps: context.steps,
    };

    return buildParameters(template, extendedEvent as any);
  }

  /**
   * Resolve dependency order (topological sort)
   */
  private resolveDependencies(steps: WorkflowStep[]): WorkflowStep[] {
    // Simple topological sort
    const sorted: WorkflowStep[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (step: WorkflowStep) => {
      if (visited.has(step.id)) return;
      if (visiting.has(step.id)) {
        throw new Error(`Circular dependency detected: ${step.id}`);
      }

      visiting.add(step.id);

      // Visit dependencies first
      if (step.dependencies) {
        for (const depId of step.dependencies) {
          const depStep = steps.find(s => s.id === depId);
          if (!depStep) {
            throw new Error(`Missing dependency: ${depId} for step ${step.id}`);
          }
          visit(depStep);
        }
      }

      visiting.delete(step.id);
      visited.add(step.id);
      sorted.push(step);
    };

    for (const step of steps) {
      visit(step);
    }

    return sorted;
  }

  /**
   * Group steps by dependency level for parallel execution
   */
  private groupByDependencyLevel(steps: WorkflowStep[]): WorkflowStep[][] {
    const levels: WorkflowStep[][] = [];
    const assigned = new Set<string>();

    while (assigned.size < steps.length) {
      const level: WorkflowStep[] = [];

      for (const step of steps) {
        if (assigned.has(step.id)) continue;

        // Check if all dependencies are assigned
        const allDepsAssigned = !step.dependencies ||
          step.dependencies.every(depId => assigned.has(depId));

        if (allDepsAssigned) {
          level.push(step);
          assigned.add(step.id);
        }
      }

      if (level.length === 0) {
        throw new Error('Circular dependency detected or missing dependencies');
      }

      levels.push(level);
    }

    return levels;
  }

  /**
   * Retry a failed step with backoff
   */
  private async retryStep(
    step: WorkflowStep,
    workflow: ReflexWorkflow,
    context: WorkflowContext
  ): Promise<WorkflowStepResult> {
    const retry = workflow.retry!;
    let lastError: string = '';

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      // Wait before retry (except first attempt)
      if (attempt > 1) {
        const delay = retry.backoff === 'exponential'
          ? retry.delayMs * Math.pow(2, attempt - 2)
          : retry.delayMs;

        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const result = await this.executeStep(step, workflow, context);
      if (result.status === 'success') {
        return result;
      }

      lastError = result.error || 'Unknown error';
    }

    // All retries failed
    return {
      stepId: step.id,
      status: 'error',
      error: `Failed after ${retry.maxAttempts} attempts: ${lastError}`,
      latency: 0,
    };
  }

  /**
   * Evaluate JsonLogic condition
   */
  private evaluateCondition(condition: any, context: WorkflowContext): boolean {
    // For Tier 1, keep it simple - just support basic equality checks
    // Tier 3 will integrate full JsonLogic
    if (typeof condition === 'boolean') {
      return condition;
    }

    // Placeholder for now - Tier 3 will use json-logic-js library
    return true;
  }
}

interface WorkflowContext {
  event: InternalEventV2;
  steps: Record<string, WorkflowStepResult>;
  authToken?: string;
  correlationId: string;
  userRoles: string[];
}
```

---

### Integration with Reflex Bit

```typescript
// src/services/reflex/reflex-executor.ts - Extend executeReflex()

export async function executeReflex(
  reflex: Reflex,
  event: InternalEventV2,
  config: { authToken?: string; correlationId?: string } = {}
): Promise<ReflexExecutionResult> {
  const startTime = Date.now();

  try {
    // Check if reflex uses workflow (multi-step) or action (single-step)
    if (reflex.workflow) {
      // Multi-step workflow execution
      const executor = new WorkflowExecutor();
      const result = await executor.execute(reflex, event, config);

      return {
        status: result.status === 'success' ? 'success' : 'error',
        result: result.steps,  // Array of step results
        candidates: result.candidates,
        error: result.error,
        latency: result.latency,
      };
    } else if (reflex.action) {
      // Existing single-tool execution (Sprint 332 behavior)
      // ... existing code ...
    } else {
      throw new Error('Reflex must have either action or workflow');
    }
  } catch (error) {
    // ... error handling ...
  }
}
```

---

### MCP Tool Registration (Reflex Bit)

```typescript
// src/apps/reflex-service.ts - Update reflex.create tool schema

this.registerTool(
  'reflex.create',
  'Create a new reflex with pattern matching and MCP tool invocation OR multi-step workflow',
  z.object({
    name: z.string(),
    match: z.object({...}),

    // Mutually exclusive: action OR workflow
    action: z.object({
      tool: z.string(),
      parameters: z.record(z.any()),
      timeout: z.number().optional(),
    }).optional(),

    workflow: z.object({
      steps: z.array(z.object({
        id: z.string(),
        tool: z.string(),
        parameters: z.record(z.any()),
        timeout: z.number().optional(),
        dependencies: z.array(z.string()).optional(),
        condition: z.any().optional(),
      })),
      timeout: z.number().optional(),
      onError: z.enum(['stop', 'continue', 'retry']).optional(),
      retry: z.object({
        maxAttempts: z.number(),
        delayMs: z.number(),
        backoff: z.enum(['linear', 'exponential']).optional(),
      }).optional(),
      parallel: z.boolean().optional(),
    }).optional(),

    candidateTemplate: z.union([z.string(), z.array(z.string())]).optional(),
  }).refine(
    (data) => !!data.action || !!data.workflow,
    { message: 'Must provide either action or workflow' }
  ).refine(
    (data) => !(data.action && data.workflow),
    { message: 'Cannot provide both action and workflow' }
  ),
  async (args) => {
    // ... create reflex with workflow support ...
  }
);
```

---

## Composite MCP Tools (Alternative Pattern)

**Instead of reflexes, create reusable composite tools that can be invoked by LLM or other services.**

```typescript
// src/services/composite-tools/scene-switcher.ts

import { z } from 'zod';

/**
 * Composite Tool: Scene Switcher
 *
 * Orchestrates multiple OBS operations to switch scenes cleanly:
 * 1. Disable all sources in old scene
 * 2. Enable all sources in new scene
 * 3. Update current scene state
 */
export function createSceneSwitcherTool(registry: ToolRegistry) {
  registry.registerTool({
    id: 'obs.scene.switch',
    displayName: 'Switch OBS Scene',
    description: 'Switches OBS scenes by disabling old sources and enabling new sources',
    inputSchema: z.object({
      fromScene: z.string().describe('Current scene name'),
      toScene: z.string().describe('Target scene name'),
      sourceIds: z.object({
        [fromScene]: z.array(z.number()),
        [toScene]: z.array(z.number()),
      }).describe('Source IDs for each scene'),
    }),
    execute: async (args, extra) => {
      const results = [];

      // Step 1: Disable old sources
      for (const sourceId of args.sourceIds[args.fromScene]) {
        const result = await registry.getTool('mcp_obs-set-scene-item-enabled').execute({
          sceneName: args.fromScene,
          sceneItemId: sourceId,
          sceneItemEnabled: false,
        }, extra);
        results.push({ step: 'disable', sourceId, result });
      }

      // Step 2: Enable new sources
      for (const sourceId of args.sourceIds[args.toScene]) {
        const result = await registry.getTool('mcp_obs-set-scene-item-enabled').execute({
          sceneName: args.toScene,
          sceneItemId: sourceId,
          sceneItemEnabled: true,
        }, extra);
        results.push({ step: 'enable', sourceId, result });
      }

      // Step 3: Update state
      await registry.getTool('state.mutation').execute({
        path: 'currentScene',
        value: args.toScene,
      }, extra);

      return {
        content: [{
          type: 'text',
          text: `Scene switched from ${args.fromScene} to ${args.toScene}. ${results.length} operations completed.`,
        }],
      };
    },
    source: 'composite',
  });
}
```

**Benefits vs. Workflows**:
- ✅ Reusable across reflexes, LLM invocations, and event-driven flows
- ✅ TypeScript type safety
- ✅ Can be unit tested independently
- ✅ Versioned and deployed like regular code

**Drawbacks vs. Workflows**:
- ❌ Requires TypeScript implementation (not declarative)
- ❌ Requires rebuild/redeploy to change behavior
- ❌ Not user-editable (requires coding skills)

---

## Learning Path: Ad-Hoc → Composed → Reflex

### Stage 1: Ad-Hoc (LLM Orchestration)

**User Experience**: Natural language commands, LLM decides which tools to call

```
User: "Switch to the gaming scene and turn on my face cam"

LLM thinks:
  1. Need to call obs.scene.switch to change scene
  2. Need to call obs.set-scene-item-enabled for face cam
  3. Call tool 1... wait for result
  4. Call tool 2... wait for result
  5. Generate response
```

**Characteristics**:
- ⏱️ Slow (multiple LLM round trips, sequential tool calls)
- 💰 Expensive ($0.03-0.05 per interaction for GPT-4)
- 🎲 Unpredictable (LLM might choose different tools each time)
- ✅ Flexible (handles novel requests without pre-programming)

**When to Use**:
- Exploring new workflows
- One-off commands
- Complex reasoning required

---

### Stage 2: Composed (Pre-Defined Workflows)

**User Experience**: Same natural language, but LLM calls ONE composite tool

```
User: "Switch to the gaming scene and turn on my face cam"

LLM thinks:
  1. This matches the scene.switch.gaming composite tool
  2. Call scene.switch.gaming (single tool, orchestrates internally)
  3. Wait for result
  4. Generate response
```

**Implementation Option A**: Composite MCP Tool (TypeScript)
```typescript
registry.registerTool({
  id: 'scene.switch.gaming',
  execute: async () => {
    // 1. Switch scene
    // 2. Enable face cam
    // 3. Disable overlays
    // 4. Update state
    // All in ONE tool invocation
  }
});
```

**Implementation Option B**: JSON Workflow (Declarative)
```json
{
  "tool": "workflow.execute",
  "args": {
    "workflowId": "scene-switch-gaming",
    "steps": [...]
  }
}
```

**Characteristics**:
- ⏱️ Faster (1 LLM round trip instead of N)
- 💰 Cheaper (single tool call)
- 🎯 Predictable (same sequence every time)
- ❌ Less flexible (must match pre-defined patterns)

**When to Use**:
- Repeated commands ("switch scene" happens 100x per stream)
- Multi-step procedures that don't vary
- Cost/latency optimization

---

### Stage 3: Reflex (Pattern-Triggered Instant Execution)

**User Experience**: Command triggers instant response, no LLM involved

```
User types: "!gaming"

Reflex:
  Pattern: exact "!gaming"
  Workflow:
    1. Switch scene
    2. Enable face cam
    3. Disable overlays
    4. Update state
  Response: "Switched to gaming scene! Face cam enabled."

Total time: <200ms (vs. 2-3s for LLM)
Total cost: $0 (vs. $0.03 for LLM)
```

**Characteristics**:
- ⚡ Instant (<200ms, no LLM)
- 💸 Free (no API costs)
- 🎯 Deterministic (exact same behavior every time)
- ❌ Rigid (only matches exact patterns)

**When to Use**:
- Chat commands (!fail, !scene, !timer)
- Event-driven automations (user follows → action)
- Real-time reactions (performance-critical)

---

### Migration Path Example

**Week 1: Ad-Hoc Discovery**
```
User: "When someone raids me, I want to show a raid alert, play a sound, and thank them in chat"

LLM: *orchestrates 3 tools*
  1. obs.set-scene-item-enabled (raid alert)
  2. obs.trigger-source (sound)
  3. send-chat-message (thank you)
```

**Week 2: Compose into Workflow**
```yaml
# Save as raid-celebration.yaml
workflow:
  steps:
    - tool: mcp_obs-set-scene-item-enabled
      args: {sceneName: Main, sceneItemId: 10, sceneItemEnabled: true}
    - tool: mcp_obs-trigger-source
      args: {sourceName: RaidSound}
    - tool: send-chat-message
      args: {message: "Thanks {{username}} for the raid!"}
```

Register as composite tool:
```typescript
registry.registerTool({
  id: 'raid.celebrate',
  workflowFile: 'raid-celebration.yaml'
});
```

LLM now calls `raid.celebrate` (1 tool instead of 3).

**Week 3: Promote to Reflex**
```yaml
# Create reflex-raid-celebration
match:
  type: regex
  pattern: "^(?<username>\\w+) is raiding with (?<viewers>\\d+) viewers!$"
  field: message.text

workflow:
  # Same workflow from Week 2
  steps: [...]

candidateTemplate: "Thanks {{match.username}} for raiding with {{match.viewers}} viewers!"
```

Now raid celebrations happen instantly without LLM involvement.

---

## Implementation Roadmap

### Phase 1: JSON Workflows (Week 1-2) - **SHIP THIS FIRST**

**Deliverables**:
1. `WorkflowExecutor` class (src/services/reflex/workflow-executor.ts)
2. Extended `Reflex` type with `workflow` field
3. Update `reflex.create` MCP tool to accept workflows
4. Step result interpolation (`{{$steps.stepId.result.field}}`)
5. Basic error handling (stop/continue)
6. Comprehensive tests (20+ test cases)

**Success Criteria**:
- Create reflex with 3-step workflow
- Execute workflow with dependency order
- Reference step results in later steps
- Handle step failures with stop/continue modes
- Generate candidates using step results

**Risk**: Low (builds on existing infrastructure)

---

### Phase 2: Composite MCP Tools (Week 3)

**Deliverables**:
1. Composite tool registration pattern
2. Example composite tools:
   - `obs.scene.switch` (disable old + enable new + update state)
   - `raid.celebrate` (alert + sound + chat message)
   - `timer.start` (create state + schedule callback + send confirmation)
3. Documentation for creating composite tools

**Success Criteria**:
- LLM can invoke `obs.scene.switch` as single tool
- Composite tools appear in tool-gateway registry
- Execution logs show sub-tool invocations

**Risk**: Low (pure TypeScript, no new abstractions)

---

### Phase 3: YAML Pipelines (Week 4-5) - **Optional Enhancement**

**Deliverables**:
1. YAML parser integration
2. Stage/dependency resolver
3. Parallel execution coordinator
4. Variable scope management
5. GitHub Actions-like syntax

**Success Criteria**:
- Load workflow from YAML file
- Execute stages in dependency order
- Run parallel steps within stage
- Reference named variables

**Risk**: Medium (new syntax, tooling, validation)

---

### Phase 4: Expression Language (Week 6-8) - **Future**

**Deliverables**:
1. JsonLogic integration for conditionals
2. Template filter system (parseInt, toLowerCase, etc.)
3. Built-in variables ($now, $random, $error, $user)
4. Loop execution (for-each over arrays)
5. Try/catch error boundaries

**Success Criteria**:
- Conditional tool execution (if/else)
- Loops over dynamic arrays
- Filter application in templates
- Error handling with fallbacks

**Risk**: High (complex language design, scope creep potential)

---

## Comparison Matrix

| Feature | Ad-Hoc (LLM) | Composite Tools | JSON Workflows | YAML Pipelines | Expression Lang |
|---------|-------------|-----------------|----------------|----------------|-----------------|
| **Latency** | 2-3s | 2-3s | 100-300ms | 100-300ms | 100-500ms |
| **Cost** | $0.03-0.05 | $0.03-0.05 | $0 | $0 | $0 |
| **Flexibility** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Predictability** | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Ease of Creation** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Requires Code** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **User-Editable** | N/A | ❌ | ✅ | ✅ | ✅ |
| **Conditionals** | ✅ (LLM) | ✅ (code) | ❌ | ❌ | ✅ (JsonLogic) |
| **Loops** | ✅ (LLM) | ✅ (code) | ❌ | ❌ | ✅ (for-each) |
| **Parallel Execution** | ❌ | ✅ (code) | ✅ (flag) | ✅ (stages) | ✅ (explicit) |
| **Error Handling** | ✅ (LLM) | ✅ (code) | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Impl Complexity** | N/A | Low | Low | Medium | High |
| **Maintenance** | N/A | High | Low | Low | Medium |

---

## Security & Safety Considerations

| Risk | Mitigation |
|------|-----------|
| **Infinite loops** | - Global workflow timeout (30s default)<br>- Max step count limit (100 steps)<br>- Loop iteration cap (1000 iterations) |
| **Resource exhaustion** | - Per-step timeout (5s default)<br>- Parallel execution limit (10 concurrent)<br>- Rate limiting on workflow creation |
| **Injection attacks** | - Template interpolation escapes HTML/JSON<br>- JsonLogic prevents code execution<br>- Tool parameters validated by Zod schemas |
| **Privilege escalation** | - RBAC enforced at tool-gateway<br>- Workflows inherit reflex creator's permissions<br>- Step-level role requirements |
| **Circular dependencies** | - Topological sort detects cycles<br>- Fail fast on circular dependencies |
| **Data leakage** | - Step results not logged in detail<br>- Sensitive data masked in error messages<br>- Audit log for workflow executions |

---

## Alternative Considered: Full-Fledged Scripting Language

**Option**: Embed Lua, Python sandbox, or JavaScript VM

**Example**:
```lua
-- raid-celebration.lua
function onRaid(event)
  local username = event.match.username
  local viewers = tonumber(event.match.viewers)

  if viewers >= 100 then
    obs.setSceneItemEnabled("MainScene", 10, true)  -- Large raid alert
  else
    obs.setSceneItemEnabled("MainScene", 11, true)  -- Small raid alert
  end

  obs.triggerSource("RaidSound")
  chat.sendMessage("Thanks " .. username .. " for raiding!")
end
```

**Pros**:
- ✅ Full programming language power
- ✅ Familiar syntax (Lua/Python/JS)
- ✅ Rich ecosystem (libraries, tooling)

**Cons**:
- ❌ **Security nightmare** (sandboxing is hard)
- ❌ **Performance overhead** (VM startup, GC pauses)
- ❌ **Complexity explosion** (debugging, error handling)
- ❌ **Scope creep** (becomes a full application platform)
- ❌ **Maintenance burden** (keep VM up to date, fix vulnerabilities)

**Verdict**: **Rejected**. Declarative DSL strikes better balance between power and simplicity.

---

## Success Metrics

### Phase 1 (JSON Workflows) Success:
- ✅ 10+ reflexes using multi-step workflows in production
- ✅ 90%+ workflow execution success rate
- ✅ <200ms average workflow latency (3-step workflows)
- ✅ Zero security incidents related to workflows
- ✅ 80%+ user satisfaction ("easier than TypeScript composite tools")

### Learning Path Adoption:
- ✅ 50%+ of repeated commands migrated from Ad-Hoc → Composed
- ✅ 30%+ of chat commands migrated from Composed → Reflex
- ✅ 70% reduction in LLM API costs for migrated commands
- ✅ 10x latency improvement for reflex-based commands

---

## Summary & Recommendation

**Recommended Approach**: **Tier 1 (JSON Workflows)** first, then evaluate Tier 2/3 based on user feedback.

**Why JSON Workflows First**:
1. ✅ Minimal implementation complexity (2-3 days)
2. ✅ Builds on existing infrastructure (parameter interpolation, tool execution)
3. ✅ Immediate value for reflex multi-tool orchestration
4. ✅ Low security risk (no arbitrary code execution)
5. ✅ Clear upgrade path to YAML/Expression language if needed

**Timeline**:
- **Week 1-2**: Implement JSON Workflows (Phase 1)
- **Week 3**: Create 5-10 example composite workflows
- **Week 4**: Production validation, gather feedback
- **Week 5+**: Decide on Phase 2 (YAML Pipelines) vs. Phase 2b (Composite MCP Tools)

**Key Insight**: The learning path (Ad-Hoc → Composed → Reflex) is MORE valuable than the scripting language itself. Focus on making migration easy, not language perfection.

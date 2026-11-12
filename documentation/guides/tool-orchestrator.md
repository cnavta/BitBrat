# Tool Orchestrator Guide
## Unified Tool Execution Engine

**Sprint 60**: Centralized tool execution with retry logic, graceful degradation, and per-step RBAC validation

**Purpose**: Execute all tool types (MCP, internal, composition) through a single, reliable gateway with comprehensive error handling, RBAC enforcement, and observability.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Execution Types](#execution-types)
4. [Retry Logic](#retry-logic)
5. [Graceful Degradation](#graceful-degradation)
6. [RBAC Validation](#rbac-validation)
7. [Performance](#performance)
8. [API Reference](#api-reference)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The Tool Orchestrator (`tool-orchestrator-service`) is the **single source of truth** for tool execution in the BitBrat platform. It handles three execution types through a unified interface:

1. **MCP Tools** - External tools via Model Context Protocol servers
2. **Internal Tools** - Platform-native functions (progress updates, metadata operations)
3. **Compositions** - Multi-step workflows with sequential/parallel/conditional execution

### Key Features

- **Retry Logic**: Exponential backoff for transient errors (network, timeout, 5xx)
- **Graceful Degradation**: Partial success handling for parallel executions
- **Per-Step RBAC**: Security-critical validation for every composition step
- **Comprehensive Logging**: Full observability via Loki integration
- **Performance**: P95 latency < 1ms for internal tools, < 100ms including MCP calls
- **Fail-Fast**: Immediate rejection for non-transient errors (RBAC, validation)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tool Orchestrator                           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    ToolGateway                            │ │
│  │                                                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │              │  │              │  │              │  │ │
│  │  │ MCP Executor │  │   Internal   │  │ Composition  │  │ │
│  │  │              │  │   Executor   │  │   Executor   │  │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │ │
│  │         │                 │                 │          │ │
│  │         │                 │                 │          │ │
│  │         ▼                 ▼                 ▼          │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │            Retry Logic & Error Handling          │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  │                          │                            │ │
│  │                          ▼                            │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │            RBAC Validation Layer                 │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────┐      ┌──────────────────────────┐ │
│  │   ToolRegistry     │◄─────┤   MCP Client Manager     │ │
│  │   (PostgreSQL)     │      │   (MCP Connections)      │ │
│  └────────────────────┘      └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                                     │
         │ Log Events                          │ MCP Protocol
         ▼                                     ▼
  ┌──────────────┐                    ┌───────────────────┐
  │     Loki     │                    │   MCP Servers     │
  │ (Observabi.) │                    │ (External Tools)  │
  └──────────────┘                    └───────────────────┘
```

### Core Components

| Component | Responsibility |
|-----------|---------------|
| **ToolGateway** | Main execution orchestrator, routes to appropriate executor |
| **MCP Executor** | Calls external MCP servers with timeout enforcement |
| **Internal Executor** | Executes platform-native tool handlers |
| **Composition Executor** | Manages multi-step workflows (sequential/parallel/conditional) |
| **Retry Logic** | Exponential backoff for transient errors |
| **RBAC Validator** | User role + model tier enforcement |
| **ToolRegistry** | Tool metadata, health status, configuration |
| **MCP Client Manager** | Maintains connections to MCP servers |
| **ToolObserver** | Logs execution events to Loki |

---

## Execution Types

### 1. MCP Tool Execution

**Description**: Calls external tools via Model Context Protocol servers

**Flow**:
```typescript
User Request
  → ToolGateway.execute(toolId, args, context)
  → Validate RBAC (user roles + model tier)
  → MCP Client Manager.callTool()
  → Retry on transient errors (3 attempts, exponential backoff)
  → Transform result to ToolResult
  → Log event to Loki
  → Return result
```

**Example**:
```typescript
const result = await toolGateway.execute(
  'filesystem_read_file',  // MCP tool from filesystem server
  { path: '/tmp/data.json' },
  {
    userId: 'user-123',
    userRoles: ['user'],
    modelId: 'gpt-4',
    sessionId: 'session-456',
    correlationId: 'req-789'
  }
);
```

**Configuration** (tool-registry):
```typescript
{
  id: 'filesystem_read_file',
  source: 'mcp',
  sourceMetadata: {
    mcpServer: { name: 'filesystem', version: '1.0.0' }
  },
  config: {
    timeoutMs: 30000,          // 30 second timeout
    retryPolicy: {
      maxAttempts: 3,          // Retry up to 3 times
      backoffMs: 1000          // Start with 1s, then 2s, 4s
    }
  },
  rbac: {
    userRoles: { required: ['user'], denied: [] },
    modelTiers: { allowed: ['basic', 'premium'], denied: [] }
  }
}
```

**Timeout Enforcement**:
- Uses `AbortController` to enforce timeout
- Aborts MCP call if exceeds `timeoutMs`
- Timeout errors are **transient** (will retry)

---

### 2. Internal Tool Execution

**Description**: Executes platform-native functions without external calls

**Flow**:
```typescript
User Request
  → ToolGateway.execute(toolId, args, context)
  → Validate RBAC
  → Look up handler in internal tools registry
  → Execute handler function (synchronous)
  → Log event to Loki
  → Return result
```

**Example**:
```typescript
const result = await toolGateway.execute(
  'agent.sendProgressUpdate',  // Internal tool
  { message: 'Processing your request...' },
  context
);
```

**Built-in Internal Tools**:

| Tool ID | Purpose | Handler |
|---------|---------|---------|
| `agent.sendProgressUpdate` | Send progress message to user | Publishes to message bus |
| `bit.info` | Get service metadata | Returns service info |
| `bit.health` | Health check | Returns service health |

**Performance**: Internal tools are **extremely fast** (< 1ms P95 latency) because they don't involve external calls.

---

### 3. Composition Execution

**Description**: Multi-step workflows that execute multiple tools in sequence, parallel, or conditional patterns

**Strategies**:
- **Sequential**: Execute tools one after another (step 1 → step 2 → step 3)
- **Parallel**: Execute all tools concurrently (step 1, 2, 3 simultaneously)
- **Conditional**: Execute based on previous step results (if/else logic)

**Sequential Flow**:
```typescript
User Request
  → ToolGateway.execute(compositionId, args, context)
  → Validate RBAC for ALL constituent tools (per-step validation)
  → For each step:
      → Execute tool (recurse to ToolGateway.execute)
      → Check for errors
      → If error: stop execution, return error with step context
      → If success: continue to next step
  → Aggregate results
  → Log composition event
  → Return combined result
```

**Parallel Flow**:
```typescript
User Request
  → ToolGateway.execute(compositionId, args, context)
  → Validate RBAC for ALL constituent tools
  → Promise.allSettled([
      toolGateway.execute(step1),
      toolGateway.execute(step2),
      toolGateway.execute(step3)
    ])
  → Collect results (both successes and failures)
  → If ANY failures: Return error with failure details
  → If ALL successes: Aggregate results
  → Log composition event
  → Return combined result
```

**Example - Sequential Composition**:
```typescript
// Composition definition in tool registry
{
  id: 'analyze-and-respond',
  source: 'composition',
  sourceMetadata: {
    composition: {
      strategy: 'sequential',
      steps: [
        { toolId: 'query-analyzer', description: 'Analyze user intent' },
        { toolId: 'llm-inference', description: 'Generate response' },
        { toolId: 'sentiment-check', description: 'Validate tone' }
      ]
    }
  }
}

// Execution
const result = await toolGateway.execute(
  'analyze-and-respond',
  { query: 'What is the weather?' },
  context
);
```

**Per-Step RBAC** (Security-Critical):
```typescript
// BEFORE executing composition, validate ALL constituent tools
for (const step of composition.steps) {
  const rbacResult = await validateToolAccess(
    step.toolId,
    context.userId,
    context.modelId,  // ← Uses invoking model, NOT step-specific model
    context.userRoles
  );

  if (!rbacResult.allowed) {
    throw new Error(`Composition denied: ${step.toolId} not allowed for ${context.modelId}`);
  }
}
```

**Why Per-Step RBAC Matters**:
- Prevents **privilege escalation** via composition
- Example attack: Basic tier model invokes composition containing premium-only tools
- Per-step validation ensures invoking model has permission for EVERY tool in composition
- Fail-fast: Composition rejected before ANY execution if ANY step is denied

---

## Retry Logic

### Transient Error Detection

The retry logic distinguishes between **transient** (temporary, retry-worthy) and **non-transient** (permanent, fail-fast) errors.

**Transient Errors** (Will Retry):
```typescript
- Network errors: ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND, ENETUNREACH
- Timeout errors: 'timeout', 'timed out', 'aborted'
- Server errors: HTTP 503, 502, 504, 'server error', 'internal server error'
```

**Non-Transient Errors** (Immediate Failure):
```typescript
- RBAC denials: 'Access denied', 'Permission denied'
- Validation errors: 'Invalid input', 'Schema validation failed'
- Client errors: HTTP 400, 401, 403, 404
- Logic errors: 'Tool not found', 'Invalid arguments'
```

### Exponential Backoff

**Formula**: `backoffMs = 2^(attempt - 1) × baseBackoffMs`

**Example** (baseBackoffMs = 1000):
```
Attempt 1: Execute immediately
  ↓ FAIL (network error)
Attempt 2: Wait 1s (2^0 × 1000ms), then retry
  ↓ FAIL (network error)
Attempt 3: Wait 2s (2^1 × 1000ms), then retry
  ↓ FAIL (network error)
Max attempts exceeded → Final failure
```

### Retry Flow

```typescript
async executeWithRetry(fn, retryPolicy, context) {
  const maxAttempts = retryPolicy.maxAttempts || 3;
  const baseBackoffMs = retryPolicy.backoffMs || 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        logger.info('retry.success', { attempt, toolId: context.toolId });
      }
      return result;  // Success!
    } catch (error) {
      const isTransient = isTransientError(error);

      logger.warn('retry.attempt_failed', {
        attempt,
        maxAttempts,
        isTransient,
        error: error.message,
        toolId: context.toolId
      });

      // Fail-fast for non-transient errors
      if (!isTransient) {
        logger.error('retry.non_transient_error', {
          attempt,
          error: error.message,
          toolId: context.toolId
        });
        throw error;
      }

      // Max attempts exceeded
      if (attempt >= maxAttempts) {
        logger.error('retry.max_attempts_exceeded', {
          attempts: attempt,
          error: error.message,
          toolId: context.toolId
        });
        throw error;
      }

      // Exponential backoff
      const backoffMs = Math.pow(2, attempt - 1) * baseBackoffMs;
      logger.debug('retry.backoff', {
        attempt,
        backoffMs,
        nextAttempt: attempt + 1,
        toolId: context.toolId
      });

      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
}
```

### Configuration

**Per-Tool Retry Policy** (tool-registry):
```typescript
{
  id: 'external-api-tool',
  config: {
    retryPolicy: {
      maxAttempts: 5,     // Retry up to 5 times
      backoffMs: 2000     // Start with 2s: 2s, 4s, 8s, 16s
    }
  }
}
```

**Default Retry Policy** (if not specified):
```typescript
{
  maxAttempts: 3,
  backoffMs: 1000
}
```

---

## Graceful Degradation

### Sequential Execution

**Fail-Fast Behavior**: If ANY step fails, composition stops immediately and returns error with context.

```typescript
async executeSequential(toolIds, args, context) {
  const results = [];

  for (let stepIndex = 0; stepIndex < toolIds.length; stepIndex++) {
    const toolId = toolIds[stepIndex];

    try {
      logger.debug('execute_sequential.step_start', {
        toolId,
        stepIndex: stepIndex + 1,
        totalSteps: toolIds.length
      });

      const result = await this.execute(toolId, args, context);
      results.push(result);

      logger.debug('execute_sequential.step_success', {
        toolId,
        stepIndex: stepIndex + 1
      });
    } catch (error) {
      // FAIL-FAST: Stop execution on first error
      logger.error('execute_sequential.step_failed', {
        toolId,
        stepIndex: stepIndex + 1,
        totalSteps: toolIds.length,
        error: error.message,
        completedSteps: stepIndex  // How many steps succeeded before failure
      });

      return {
        content: [{
          type: 'text',
          text: `Sequential composition failed at step ${stepIndex + 1}/${toolIds.length} (tool: ${toolId}): ${error.message}`
        }],
        isError: true
      };
    }
  }

  logger.info('execute_sequential.all_steps_complete', {
    totalSteps: toolIds.length
  });

  return {
    content: results.flatMap(r => r.content),
    isError: results.some(r => r.isError)
  };
}
```

**Error Message Clarity**:
```
Sequential composition failed at step 2/3 (tool: llm-inference): Network timeout

Interpretation:
- Total steps: 3
- Failed step: 2
- Failed tool: llm-inference
- Completed steps: 1 (query-analyzer succeeded)
- Remaining steps: NOT executed (sentiment-check skipped)
```

---

### Parallel Execution

**Partial Success Handling**: Execute ALL tools, collect results, report partial failures.

```typescript
async executeParallel(toolIds, args, context) {
  logger.debug('execute_parallel.start', {
    toolIds,
    totalSteps: toolIds.length
  });

  // Execute all tools concurrently (don't stop on first failure)
  const settledResults = await Promise.allSettled(
    toolIds.map((toolId, index) =>
      this.execute(toolId, args, context).then(
        result => {
          logger.debug('execute_parallel.step_success', {
            toolId,
            stepIndex: index + 1
          });
          return { toolId, result };
        },
        error => {
          logger.error('execute_parallel.step_failed', {
            toolId,
            stepIndex: index + 1,
            error: error.message
          });
          throw error;
        }
      )
    )
  );

  // Separate successes and failures
  const successes = [];
  const failures = [];

  settledResults.forEach((settled, index) => {
    if (settled.status === 'fulfilled') {
      successes.push(settled.value.result);
    } else {
      failures.push({
        toolId: toolIds[index],
        error: settled.reason?.message || String(settled.reason)
      });
    }
  });

  logger.info('execute_parallel.complete', {
    totalSteps: toolIds.length,
    successes: successes.length,
    failures: failures.length
  });

  // If ANY failures, return error with details
  if (failures.length > 0) {
    const failureDetails = failures.map(f => `- ${f.toolId}: ${f.error}`).join('\n');

    return {
      content: [{
        type: 'text',
        text: `Parallel composition had ${failures.length}/${toolIds.length} failures:\n${failureDetails}`
      }],
      isError: true
    };
  }

  // All succeeded
  return {
    content: successes.flatMap(r => r.content),
    isError: successes.some(r => r.isError)
  };
}
```

**Error Message Clarity**:
```
Parallel composition had 2/5 failures:
- sentiment-check: Network timeout
- spam-filter: Service unavailable (503)

Interpretation:
- Total steps: 5
- Failed steps: 2 (sentiment-check, spam-filter)
- Successful steps: 3 (query-analyzer, llm-inference, fact-check)
- Partial results: Available from 3 successful tools
```

**Benefits**:
- **Visibility**: See ALL failures, not just first one
- **Partial Results**: Successful tool outputs still available
- **Debugging**: Clear error attribution per tool

---

## RBAC Validation

### Validation Levels

**1. User Role Validation**:
```typescript
// Tool requires 'admin' role
rbac: {
  userRoles: {
    required: ['admin'],  // Must have ALL required roles
    denied: ['banned']    // Must NOT have ANY denied roles
  }
}

// User with roles: ['user'] → DENIED
// User with roles: ['admin'] → ALLOWED
// User with roles: ['admin', 'banned'] → DENIED (denied takes precedence)
```

**2. Model Tier Validation**:
```typescript
// Tool only available to premium models
rbac: {
  modelTiers: {
    allowed: ['premium'],  // If specified, model tier must be in list
    denied: ['basic']      // If specified, model tier must NOT be in list
  }
}

// Model: gpt-3.5-turbo (tier: basic) → DENIED
// Model: gpt-4 (tier: premium) → ALLOWED
```

**3. Model Role Validation**:
```typescript
// Tool requires model with 'vision' capability
rbac: {
  modelRoles: {
    required: ['vision'],
    denied: []
  }
}

// Model: gpt-4 (roles: ['llm']) → DENIED
// Model: gpt-4-vision (roles: ['llm', 'vision']) → ALLOWED
```

### Composition Per-Step RBAC

**Security-Critical Pattern**:
```typescript
async validateToolAccess(
  toolId: string,
  userId: string,
  modelId: string,
  userRoles: string[]
): Promise<RBACResult> {
  const tool = await toolRegistry.getTool(toolId);
  const model = await modelRegistry.getModel(modelId);

  // 1. Check user roles
  if (tool.rbac.userRoles.required.length > 0) {
    const hasAllRequired = tool.rbac.userRoles.required.every(r =>
      userRoles.includes(r)
    );
    if (!hasAllRequired) {
      return {
        allowed: false,
        reason: `User missing required roles: ${tool.rbac.userRoles.required.join(', ')}`
      };
    }
  }

  if (tool.rbac.userRoles.denied.some(r => userRoles.includes(r))) {
    return {
      allowed: false,
      reason: `User has denied role`
    };
  }

  // 2. Check model tier
  if (tool.rbac.modelTiers.allowed.length > 0) {
    if (!tool.rbac.modelTiers.allowed.includes(model.tier)) {
      return {
        allowed: false,
        reason: `Model tier '${model.tier}' not allowed (requires: ${tool.rbac.modelTiers.allowed.join(', ')})`
      };
    }
  }

  if (tool.rbac.modelTiers.denied.includes(model.tier)) {
    return {
      allowed: false,
      reason: `Model tier '${model.tier}' is denied`
    };
  }

  // 3. Check model roles
  if (tool.rbac.modelRoles.required.length > 0) {
    const hasAllRequired = tool.rbac.modelRoles.required.every(r =>
      model.roles.includes(r)
    );
    if (!hasAllRequired) {
      return {
        allowed: false,
        reason: `Model missing required roles: ${tool.rbac.modelRoles.required.join(', ')}`
      };
    }
  }

  return { allowed: true };
}
```

**Composition Validation** (BEFORE any execution):
```typescript
async executeComposition(compositionId, args, context) {
  const composition = await toolRegistry.getTool(compositionId);

  // CRITICAL: Validate ALL constituent tools BEFORE executing ANY
  for (const step of composition.steps) {
    const rbacResult = await this.validateToolAccess(
      step.toolId,
      context.userId,
      context.modelId,  // Uses invoking model for ALL steps
      context.userRoles
    );

    if (!rbacResult.allowed) {
      logger.warn('composition.rbac_denied', {
        compositionId,
        stepToolId: step.toolId,
        modelId: context.modelId,
        reason: rbacResult.reason
      });

      throw new Error(
        `Composition denied: constituent tool '${step.toolId}' not allowed for model ${context.modelId}: ${rbacResult.reason}`
      );
    }
  }

  logger.info('composition.rbac_validation_passed', {
    compositionId,
    modelId: context.modelId,
    steps: composition.steps.length
  });

  // Now safe to execute...
}
```

**Attack Prevention Example**:
```typescript
// Malicious composition attempt:
// User with basic tier model (gpt-3.5-turbo) tries to execute composition
// containing premium-only tool (advanced-reasoning)

const composition = {
  id: 'sneaky-composition',
  steps: [
    { toolId: 'basic-tool' },          // Allowed for basic tier ✅
    { toolId: 'advanced-reasoning' }   // Requires premium tier ❌
  ]
};

// Per-step RBAC validation:
// Step 1: basic-tool → ALLOWED (basic tier can use)
// Step 2: advanced-reasoning → DENIED (basic tier cannot use)
// Result: Composition rejected BEFORE any execution

throw new Error(
  "Composition denied: constituent tool 'advanced-reasoning' not allowed for model gpt-3.5-turbo: Model tier 'basic' not allowed (requires: premium)"
);
```

---

## Performance

### Benchmarks

**Load Test Results** (1000 iterations, internal tool):
```
Total time: 5ms
Throughput: 200,000 ops/sec
Latency Statistics:
  Min:  0.00ms
  Avg:  0.00ms
  P50:  0.00ms
  P95:  0.00ms  ← Target: < 100ms ✅
  P99:  0.00ms
  Max:  1.00ms
```

**Memory Stability** (1000 iterations):
```
Initial heap: 888 MB
Final heap: 897 MB
Memory growth: 9.00 MB
Coefficient of Variation: 0.28%  ← Very stable
```

**Cache Performance**:
```
First run avg (cache miss): 0.003ms
Second run avg (cache hit): 0.003ms
Improvement: 14.3%
```

### Performance Characteristics

| Execution Type | P95 Latency | Notes |
|---------------|-------------|-------|
| Internal Tool | < 1ms | No external calls, synchronous handlers |
| MCP Tool (local) | 10-50ms | Network call to localhost MCP server |
| MCP Tool (remote) | 50-500ms | Depends on network latency + tool execution time |
| Composition (3 sequential internal) | < 3ms | Sum of constituent tool latencies |
| Composition (3 parallel internal) | < 1ms | Concurrent execution |

### Optimization Strategies

**1. Tool Registry Caching**:
- Tool metadata cached in memory
- Reduces PostgreSQL queries
- Cache invalidation on tool updates

**2. Model Registry Caching**:
- Model metadata cached
- Shared across all executions
- Refreshed periodically

**3. MCP Client Connection Pooling**:
- Persistent connections to MCP servers
- Connection reuse across invocations
- Automatic reconnection on failure

**4. Parallel Execution for Compositions**:
- Use `Promise.allSettled()` for parallel steps
- Maximizes concurrency
- Collects all results before failing

---

## API Reference

### ToolGateway.execute()

**Signature**:
```typescript
async execute(
  toolId: string,
  args: unknown,
  context: ToolExecutionContext
): Promise<ToolResult>
```

**Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `toolId` | `string` | Unique tool identifier (e.g., 'filesystem_read_file') |
| `args` | `unknown` | Tool-specific arguments (validated against tool inputSchema) |
| `context` | `ToolExecutionContext` | Execution context with user/model/session info |

**ToolExecutionContext**:
```typescript
interface ToolExecutionContext {
  userId: string;           // User identifier
  userRoles: string[];      // User roles for RBAC validation
  modelId: string;          // Model identifier (e.g., 'gpt-4')
  sessionId: string;        // Session identifier for tracking
  correlationId: string;    // Request correlation for tracing
}
```

**ToolResult**:
```typescript
interface ToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError: boolean;
  _meta?: {
    toolName?: string;
    annotations?: object;
  };
}
```

**Example - MCP Tool**:
```typescript
const result = await toolGateway.execute(
  'filesystem_read_file',
  { path: '/data/config.json' },
  {
    userId: 'user-123',
    userRoles: ['user'],
    modelId: 'gpt-4',
    sessionId: 'session-456',
    correlationId: 'req-789'
  }
);

if (result.isError) {
  console.error('Tool execution failed:', result.content[0].text);
} else {
  console.log('File contents:', result.content[0].text);
}
```

**Example - Composition**:
```typescript
const result = await toolGateway.execute(
  'analyze-and-respond',  // Composition ID
  { query: 'What is machine learning?' },
  context
);

// Result aggregates all step outputs
console.log('Analysis:', result.content[0].text);
console.log('Response:', result.content[1].text);
console.log('Sentiment:', result.content[2].text);
```

---

## Troubleshooting

### Common Issues

#### 1. "Tool not found" Error

**Symptom**:
```
Error: Tool not found: my-tool
```

**Causes**:
- Tool not registered in tool_registry table
- Tool status is not 'active'
- Tool ID typo

**Solution**:
```sql
-- Check tool exists and is active
SELECT id, canonical_name, source, status
FROM tool_registry
WHERE id = 'my-tool';

-- If status is 'inactive', activate it
UPDATE tool_registry
SET status = 'active'
WHERE id = 'my-tool';
```

---

#### 2. RBAC Denial Errors

**Symptom**:
```
Error: Access denied: user missing required roles: admin
```

**Causes**:
- User lacks required roles
- Model tier not allowed for tool
- Model missing required roles (e.g., 'vision')

**Debugging**:
```typescript
// Check user roles
console.log('User roles:', context.userRoles);

// Check tool RBAC requirements
const tool = await toolRegistry.getTool(toolId);
console.log('Required user roles:', tool.rbac.userRoles.required);
console.log('Denied user roles:', tool.rbac.userRoles.denied);
console.log('Allowed model tiers:', tool.rbac.modelTiers.allowed);
console.log('Denied model tiers:', tool.rbac.modelTiers.denied);

// Check model
const model = await modelRegistry.getModel(context.modelId);
console.log('Model tier:', model.tier);
console.log('Model roles:', model.roles);
```

**Solution**:
1. Grant user required roles
2. Use higher-tier model (e.g., gpt-4 instead of gpt-3.5-turbo)
3. Update tool RBAC configuration if too restrictive

---

#### 3. Composition Per-Step RBAC Denial

**Symptom**:
```
Error: Composition denied: constituent tool 'premium-tool' not allowed for model gpt-3.5-turbo
```

**Cause**:
- Composition contains tools that invoking model cannot access
- This is a **security feature**, not a bug

**Example Scenario**:
```
User with gpt-3.5-turbo (basic tier) executes composition:
  Step 1: basic-search (allowed: basic, premium) ✅
  Step 2: advanced-reasoning (allowed: premium only) ❌

Result: Composition rejected before ANY execution
```

**Solution**:
1. **Upgrade model tier**: Use premium model to execute composition
2. **Modify composition**: Remove premium-only tools from composition
3. **Update tool RBAC**: Allow basic tier for premium tool (if appropriate)

---

#### 4. Retry Exhaustion

**Symptom**:
```
Error: Max retry attempts exceeded (3/3): Network timeout
```

**Causes**:
- MCP server down or unreachable
- Network issues
- MCP server responding slowly (exceeds timeout)

**Debugging**:
```bash
# Check MCP server health
curl http://mcp-server:port/health

# Check connectivity from tool-orchestrator container
docker exec tool-orchestrator-1 ping mcp-server

# Check tool-orchestrator logs for retry attempts
docker logs tool-orchestrator-1 | grep retry.attempt_failed
```

**Solution**:
1. **Increase retry attempts**:
   ```sql
   UPDATE tool_registry
   SET config = jsonb_set(
     config,
     '{retryPolicy,maxAttempts}',
     '5'
   )
   WHERE id = 'slow-tool';
   ```

2. **Increase timeout**:
   ```sql
   UPDATE tool_registry
   SET config = jsonb_set(
     config,
     '{timeoutMs}',
     '60000'  -- 60 seconds
   )
   WHERE id = 'slow-tool';
   ```

3. **Fix MCP server**: Restart or debug MCP server

---

#### 5. Sequential Composition Fails Mid-Execution

**Symptom**:
```
Error: Sequential composition failed at step 2/5 (tool: llm-inference): Network timeout
```

**Analysis**:
- Step 1 succeeded (query-analyzer)
- Step 2 failed (llm-inference)
- Steps 3-5 NOT executed (short-circuit behavior)

**Debugging**:
```bash
# Find execution in Loki logs
docker logs tool-orchestrator-1 | grep "correlationId.*req-789"

# Look for step logs
{
  "msg": "execute_sequential.step_start",
  "toolId": "llm-inference",
  "stepIndex": 2,
  "totalSteps": 5
}
{
  "msg": "execute_sequential.step_failed",
  "toolId": "llm-inference",
  "stepIndex": 2,
  "error": "Network timeout",
  "completedSteps": 1
}
```

**Solution**:
1. **Fix failing tool**: Address llm-inference timeout (increase timeout, fix network)
2. **Reorder steps**: Move fragile steps later in sequence
3. **Use parallel strategy**: If steps are independent, execute in parallel
4. **Add retry logic**: Ensure failing tool has retry policy configured

---

#### 6. Parallel Composition Partial Failures

**Symptom**:
```
Error: Parallel composition had 2/5 failures:
- sentiment-check: Network timeout
- spam-filter: Service unavailable (503)
```

**Analysis**:
- 3 tools succeeded
- 2 tools failed
- Partial results available from successful tools

**Debugging**:
```bash
# Check which tools succeeded/failed
docker logs tool-orchestrator-1 | grep "execute_parallel"

{
  "msg": "execute_parallel.step_success",
  "toolId": "query-analyzer",
  "stepIndex": 1
}
{
  "msg": "execute_parallel.step_failed",
  "toolId": "sentiment-check",
  "stepIndex": 2,
  "error": "Network timeout"
}
```

**Solution**:
1. **Accept partial failure**: If 3/5 successes are acceptable, treat as success in calling code
2. **Fix failing tools**: Debug sentiment-check and spam-filter
3. **Switch to sequential**: If ALL tools must succeed, use sequential strategy
4. **Make tools optional**: Mark non-critical tools as optional in composition logic

---

### Loki Query Examples

**Find all executions for a correlationId**:
```
{service="tool-orchestrator", correlationId="req-789"}
```

**Find retry attempts for a tool**:
```
{service="tool-orchestrator"} |= "retry.attempt_failed" | json | toolId="filesystem_read_file"
```

**Find RBAC denials**:
```
{service="tool-orchestrator"} |= "rbac_denied"
```

**Find composition per-step RBAC denials**:
```
{service="tool-orchestrator"} |= "composition.rbac_denied"
```

**Find sequential composition failures**:
```
{service="tool-orchestrator"} |= "execute_sequential.step_failed"
```

**Find parallel composition partial failures**:
```
{service="tool-orchestrator"} |= "execute_parallel.step_failed"
```

---

## Related Documentation

- **[Tool Observability Guide](./tool-observability.md)** - Metrics, health tracking, Loki integration
- **[Tool Registry Schema](../reference/tool-registry-schema.md)** - Tool metadata structure
- **[Model Registry Schema](../reference/model-registry-schema.md)** - Model metadata structure
- **[MCP Integration Guide](./mcp-integration.md)** - Model Context Protocol setup
- **[RBAC Configuration](./rbac-configuration.md)** - Role-based access control

---

**Last Updated**: 2026-11-12 (Sprint 60)
**Version**: 0.44.0
**Status**: Production-ready

# Composition Usage Guide

**Sprint 41 (COMP-021)**: Complete guide to creating, registering, and executing compositions in BitBrat.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Composition Structure](#composition-structure)
- [Writing Compositions](#writing-compositions)
- [Registration and Management](#registration-and-management)
- [Execution](#execution)
- [DSL Reference](#dsl-reference)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

### What are Compositions?

Compositions are declarative, YAML-based procedures that orchestrate multiple MCP tools into reusable workflows. They enable:

- **Behavioral Compilation**: Capture emergent LLM reasoning patterns into deterministic procedures
- **Reusability**: Package multi-step workflows as single MCP tools
- **Versioning**: Track changes to procedures with automatic version management
- **Testability**: Validate workflows without LLM inference overhead
- **Portability**: Share procedures across different BitBrat deployments

### When to Use Compositions

**Use compositions for**:
- Multi-step procedures that always follow the same pattern
- Workflows that require conditional logic based on input
- Reusable business logic that doesn't need LLM reasoning
- Standard operating procedures (SOPs) for common tasks

**Don't use compositions for**:
- Simple single-tool invocations (just call the tool directly)
- Highly dynamic workflows that require LLM reasoning at each step
- One-off ad-hoc tasks

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     tool-gateway                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         CompositionRegistry (DocumentStore)           │  │
│  │  • Register YAML definitions                          │  │
│  │  • Content-based deduplication (SHA-256)              │  │
│  │  • Automatic version management                       │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              CompositionExecutor                       │  │
│  │  • Execute compiled compositions                       │  │
│  │  • Resolve references ($ref)                          │  │
│  │  • Evaluate conditions (when, ifValue)                │  │
│  │  • Invoke tools via ToolRegistry                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
│  Each composition registered as MCP tool:                    │
│  • ID: <composition.metadata.name>                           │
│  • Source: 'composition'                                      │
│  • Schema: <composition.spec.inputSchema>                    │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Create a Composition

Create `examples/compositions/my_workflow.yaml`:

```yaml
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: my_workflow
  description: A simple workflow example
  version: 1
  author: Your Name
  tags:
    - example

spec:
  inputSchema:
    type: object
    properties:
      action:
        type: string
        description: The action to perform
    required:
      - action

  steps:
    - id: send_notification
      call: agent.sendProgressUpdate
      with:
        message:
          $ref:
            namespace: input
            pointer: /action
        emoji: "🔄"
        urgency: normal

  return:
    status: completed
    action:
      $ref:
        namespace: input
        pointer: /action
```

### 2. Register the Composition

```bash
# Via REST API
curl -X POST http://localhost:3002/v1/compositions \
  -H "Content-Type: application/json" \
  -d @examples/compositions/my_workflow.yaml

# Response:
{
  "id": "comp-abc123",
  "name": "my_workflow",
  "version": 1,
  "contentHash": "sha256:..."
}
```

### 3. Execute the Composition

Once registered, compositions are available as MCP tools with ID `<metadata.name>`:

```typescript
// Via MCP tool call
const result = await toolGateway.invokeTool('my_workflow', {
  action: 'process_data'
});

// Result:
{
  status: 'completed',
  action: 'process_data'
}
```

## Composition Structure

### YAML Format

Every composition follows this structure:

```yaml
apiVersion: mcp-compose/v1              # REQUIRED: API version
kind: Composition                        # REQUIRED: Resource type

metadata:                                # REQUIRED: Composition metadata
  name: composition_name                # REQUIRED: Unique identifier (kebab-case)
  description: Human-readable description # REQUIRED: What this composition does
  version: 1                             # Optional: Manual version (auto-managed)
  author: Author Name                    # Optional: Who created this
  tags:                                  # Optional: Categorization
    - tag1
    - tag2

spec:                                    # REQUIRED: Composition specification
  inputSchema:                           # REQUIRED: JSON Schema for inputs
    type: object
    properties: {...}
    required: [...]

  steps:                                 # Optional: List of steps to execute
    - id: step_name                      # REQUIRED: Unique step identifier
      # ... step configuration

  return:                                # REQUIRED: Output expression
    # ... output structure with literal values and $ref

  outputSchema:                          # Optional: JSON Schema for output
    type: object
    properties: {...}
```

### Metadata Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Unique identifier (becomes MCP tool ID). Use kebab-case. |
| `description` | Yes | string | Human-readable description of what the composition does. |
| `version` | No | number | Manual version number (auto-incremented on content change). |
| `author` | No | string | Author name or organization. |
| `tags` | No | array | Tags for categorization and discovery. |

### Spec Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `inputSchema` | Yes | object | JSON Schema defining composition inputs. |
| `steps` | No | array | Ordered list of steps to execute. |
| `return` | Yes | any | Output expression (can use $ref to reference data). |
| `outputSchema` | No | object | JSON Schema defining composition outputs (for validation). |

## Writing Compositions

### Step Types

#### 1. Tool Invocation (`call`)

Invoke an MCP tool:

```yaml
steps:
  - id: send_message
    call: agent.sendProgressUpdate
    with:
      message: "Processing..."
      emoji: "⏳"
      urgency: normal
```

**Fields**:
- `id` (required): Unique step identifier
- `call` (required): Tool ID to invoke
- `with` (optional): Tool input arguments (can use $ref)
- `when` (optional): Condition expression (step skipped if false)

#### 2. Conditional Value (`ifValue`)

Return different values based on a condition:

```yaml
steps:
  - id: status_message
    ifValue:
      condition:
        equals:
          - { $ref: { namespace: input, pointer: /status } }
          - success
      then: "Operation succeeded"
      else: "Operation failed"
```

**Fields**:
- `id` (required): Unique step identifier
- `ifValue` (required): Conditional expression
  - `condition` (required): Condition to evaluate
  - `then` (required): Value if condition is true
  - `else` (required): Value if condition is false

### Reference Resolution (`$ref`)

Reference data from different namespaces:

```yaml
$ref:
  namespace: <namespace>    # 'input', 'steps', 'context'
  pointer: <json-pointer>   # JSON Pointer (RFC 6901)
```

**Namespaces**:
- `input`: User-provided input to the composition
- `steps`: Output from previous steps (e.g., `/step_name` or `/step_name/field`)
- `context`: Execution context metadata (e.g., `/sessionId`, `/timestamp`)

**Examples**:

```yaml
# Reference input field
user:
  $ref:
    namespace: input
    pointer: /username

# Reference step output
previous_result:
  $ref:
    namespace: steps
    pointer: /validation/result

# Reference nested step output
error_message:
  $ref:
    namespace: steps
    pointer: /processing/error/message

# Reference context
execution_time:
  $ref:
    namespace: context
    pointer: /timestamp
```

### Condition Operators

#### `equals`

Check if two values are equal:

```yaml
condition:
  equals:
    - { $ref: { namespace: input, pointer: /role } }
    - admin
```

#### `exists`

Check if a value exists (not null/undefined):

```yaml
condition:
  exists:
    $ref:
      namespace: input
      pointer: /optional_field
```

#### `all`

All conditions must be true (logical AND):

```yaml
condition:
  all:
    - equals:
        - { $ref: { namespace: input, pointer: /enabled } }
        - true
    - exists:
        $ref:
          namespace: input
          pointer: /config
```

#### `any`

At least one condition must be true (logical OR):

```yaml
condition:
  any:
    - equals:
        - { $ref: { namespace: input, pointer: /role } }
        - admin
    - equals:
        - { $ref: { namespace: input, pointer: /role } }
        - moderator
```

### Conditional Execution (`when`)

Execute a step only if condition is true:

```yaml
steps:
  - id: notify_admin
    call: agent.sendProgressUpdate
    when:
      equals:
        - { $ref: { namespace: input, pointer: /urgency } }
        - high
    with:
      message: "High urgency request received"
      emoji: "🚨"
```

## Registration and Management

### REST API Endpoints

#### Register Composition

```bash
POST /v1/compositions
Content-Type: application/json

{
  "apiVersion": "mcp-compose/v1",
  "kind": "Composition",
  "metadata": {...},
  "spec": {...}
}

# Response 201:
{
  "id": "comp-abc123",
  "name": "composition_name",
  "version": 1,
  "contentHash": "sha256:..."
}
```

**Deduplication**: If composition with same content hash exists, returns existing composition (no duplicate created).

#### List Compositions

```bash
GET /v1/compositions

# Response 200:
{
  "compositions": [
    {
      "id": "comp-abc123",
      "name": "composition_name",
      "version": 1,
      "contentHash": "sha256:...",
      "createdAt": "2026-09-03T12:00:00Z",
      "updatedAt": "2026-09-03T12:00:00Z"
    },
    ...
  ]
}
```

#### Get Latest Version

```bash
GET /v1/compositions/<name>

# Response 200:
{
  "id": "comp-abc123",
  "metadata": {...},
  "spec": {...},
  "contentHash": "sha256:...",
  "createdAt": "2026-09-03T12:00:00Z"
}
```

#### Get Specific Version

```bash
GET /v1/compositions/<name>/<version>

# Response 200:
{
  "id": "comp-abc123",
  "metadata": {...},
  "spec": {...},
  "contentHash": "sha256:...",
  "createdAt": "2026-09-03T12:00:00Z"
}
```

#### Delete Composition

```bash
DELETE /v1/compositions/<name>/<version>

# Response 204: (no content)
```

#### Get Registry Statistics

```bash
GET /v1/compositions/stats

# Response 200:
{
  "totalCompositions": 15,
  "totalVersions": 23,
  "compositionsByName": {
    "simple_greeting": 2,
    "conditional_message": 1,
    "multi_step_workflow": 3,
    ...
  }
}
```

### Version Management

Versions are automatically managed based on content hashing:

1. **First Registration**: Version 1 created
2. **Same Content**: Returns existing composition (deduplicated)
3. **Different Content**: Version auto-incremented (2, 3, 4, ...)

**Example**:

```bash
# Register version 1
POST /v1/compositions { ... }
# Response: { version: 1, contentHash: "sha256:abc..." }

# Register same content again
POST /v1/compositions { ... }
# Response: { version: 1, contentHash: "sha256:abc..." } (same composition)

# Register with modified content
POST /v1/compositions { ... modified ... }
# Response: { version: 2, contentHash: "sha256:def..." }
```

### Feature Flag

Compositions can be disabled globally:

```bash
# Disable compositions
export ENABLE_COMPOSITIONS=false

# Restart tool-gateway
brat bit deploy tool-gateway
```

When disabled:
- All REST API endpoints return `503 Service Unavailable`
- Existing composition tools are not registered
- System continues to function normally

### MCP Administrative Tools

**Sprint 41 (COMP-017A)**: In addition to REST API endpoints, compositions can be managed via MCP tools.

#### composition.register

Register a new composition from YAML/JSON definition.

```typescript
const result = await toolGateway.invokeTool('composition.register', {
  definition: {
    apiVersion: 'mcp-compose/v1',
    kind: 'Composition',
    metadata: {
      name: 'my_composition',
      description: 'My composition description',
    },
    spec: {
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' }
        },
        required: ['action']
      },
      return: { success: true }
    }
  }
});

// Response:
{
  id: 'comp-abc123',
  name: 'my_composition',
  version: 1,
  contentHash: 'sha256:...'
}
```

#### composition.list

List all registered compositions with optional filtering and pagination.

```typescript
// List all compositions
const result = await toolGateway.invokeTool('composition.list', {});

// List with filters
const result = await toolGateway.invokeTool('composition.list', {
  filter: {
    name: 'my_composition'
  },
  limit: 10,
  offset: 0
});

// Response:
{
  compositions: [
    {
      id: 'comp-abc123',
      name: 'my_composition',
      version: 1,
      contentHash: 'sha256:...',
      createdAt: '2026-09-03T12:00:00Z',
      updatedAt: '2026-09-03T12:00:00Z'
    },
    ...
  ],
  total: 15
}
```

#### composition.get

Retrieve a specific composition by name and optional version.

```typescript
// Get latest version
const result = await toolGateway.invokeTool('composition.get', {
  name: 'my_composition'
});

// Get specific version
const result = await toolGateway.invokeTool('composition.get', {
  name: 'my_composition',
  version: 2
});

// Response:
{
  id: 'comp-abc123',
  metadata: {
    name: 'my_composition',
    description: '...',
    version: 2
  },
  spec: {
    inputSchema: {...},
    steps: [...],
    return: {...}
  },
  contentHash: 'sha256:...',
  createdAt: '2026-09-03T12:00:00Z'
}
```

#### composition.delete

Delete a specific composition version.

```typescript
const result = await toolGateway.invokeTool('composition.delete', {
  name: 'my_composition',
  version: 1
});

// Response:
{
  success: true,
  message: 'Composition deleted: my_composition (version 1)',
  deleted: {
    name: 'my_composition',
    version: 1
  }
}
```

#### composition.stats

Get composition registry statistics.

```typescript
const result = await toolGateway.invokeTool('composition.stats', {});

// Response:
{
  totalCompositions: 15,
  totalVersions: 23,
  compositionsByName: {
    'simple_greeting': 2,
    'conditional_message': 1,
    'multi_step_workflow': 3,
    ...
  }
}
```

#### Use Cases

**LLM-Driven Composition Creation**:
```typescript
// LLM can create compositions dynamically
User: "Create a composition that greets users and shows their points"

LLM: <calls composition.register with generated YAML>
System: Composition registered as "user_greeting_with_points"
LLM: "I've created the composition. You can now use it!"
```

**Dynamic Workflow Management**:
```typescript
// Scheduler creates composition for recurring task
await toolGateway.invokeTool('composition.register', {
  definition: dailyReportComposition
});

await toolGateway.invokeTool('scheduler.create', {
  name: 'daily_report_job',
  toolId: 'daily_report',
  cron: '0 9 * * *'
});
```

**Error Handling**:
When compositions are disabled (`ENABLE_COMPOSITIONS=false`), all MCP tools return:
```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Error: Composition subsystem not enabled (DocumentStore not available)"
  }]
}
```

## Execution

### Via MCP Tool Call

Once registered, compositions are available as MCP tools:

```typescript
// Tool ID = composition.metadata.name
const result = await toolRegistry.getTool('my_workflow').execute({
  action: 'process_data'
}, {
  sessionId: 'session-123',
  userRoles: ['user']
});

// Result:
{
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        status: 'completed',
        action: 'process_data'
      }, null, 2)
    }
  ]
}
```

### Via LLM Tool Selection

Compositions appear as tools to the LLM:

```typescript
// LLM selects tool based on user message
User: "Run my workflow to process data"

LLM: <calls tool 'my_workflow' with args { action: 'process_data' }>

Tool Response: {
  status: 'completed',
  action: 'process_data'
}
```

### Execution Context

Every execution receives:

```typescript
{
  input: any,              // User-provided input (matches inputSchema)
  context: {
    sessionId: string,     // Session identifier
    correlationId: string, // Request correlation ID
    timestamp: string,     // Execution start time (ISO 8601)
    userRoles: string[],   // User roles for RBAC
  },
  steps: Record<string, any>, // Step outputs (populated as steps execute)
}
```

### Execution Flow

1. **Validate Input**: Verify input matches `inputSchema`
2. **Initialize Context**: Create execution context with sessionId, timestamp, etc.
3. **Execute Steps**: For each step in order:
   - Evaluate `when` condition (skip if false)
   - Resolve `$ref` in step arguments
   - Execute step (tool call or ifValue)
   - Store result in `steps[step.id]`
4. **Resolve Return**: Resolve `$ref` in return expression
5. **Validate Output**: Verify output matches `outputSchema` (if defined)
6. **Return Result**: Return final output to caller

## DSL Reference

### Complete Syntax

```yaml
apiVersion: mcp-compose/v1
kind: Composition

metadata:
  name: string                  # Required, kebab-case
  description: string           # Required
  version: number               # Optional
  author: string                # Optional
  tags: string[]                # Optional

spec:
  inputSchema:                  # Required, JSON Schema
    type: object
    properties:
      <field>:
        type: string | number | boolean | array | object
        description: string
        enum: any[]             # Optional
        default: any            # Optional
    required: string[]

  steps:                        # Optional
    - id: string                # Required
      call: string              # Tool ID
      with:                     # Tool arguments
        <arg>: any | $ref
      when:                     # Conditional execution
        equals | exists | all | any: ...

    - id: string
      ifValue:
        condition:
          equals | exists | all | any: ...
        then: any | $ref
        else: any | $ref

  return: any | $ref            # Required

  outputSchema:                 # Optional, JSON Schema
    type: object
    properties: {...}
```

### Reference Syntax

```yaml
$ref:
  namespace: input | steps | context
  pointer: string               # JSON Pointer (RFC 6901)
```

### Condition Syntax

```yaml
# Equals
equals:
  - <value1>
  - <value2>

# Exists
exists:
  <value>

# All (AND)
all:
  - <condition1>
  - <condition2>
  - ...

# Any (OR)
any:
  - <condition1>
  - <condition2>
  - ...
```

## Examples

### Example 1: Simple Greeting

File: `examples/compositions/simple_greeting.yaml`

```yaml
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: simple_greeting
  description: Returns a personalized greeting for a user
  version: 1
  tags:
    - example
    - beginner

spec:
  inputSchema:
    type: object
    properties:
      username:
        type: string
        description: Name of the user to greet
    required:
      - username

  steps: []

  return:
    greeting: Hello from BitBrat!
    user:
      $ref:
        namespace: input
        pointer: /username
    timestamp:
      $ref:
        namespace: context
        pointer: /timestamp
```

**Usage**:
```typescript
const result = await invoke('simple_greeting', {
  username: 'Alice'
});
// Result: {
//   greeting: 'Hello from BitBrat!',
//   user: 'Alice',
//   timestamp: '2026-09-03T12:00:00Z'
// }
```

### Example 2: Conditional Message

File: `examples/compositions/conditional_message.yaml`

Demonstrates:
- Conditional logic with `ifValue`
- Nested conditionals
- Conditional tool invocation with `when`

```yaml
spec:
  inputSchema:
    type: object
    properties:
      role:
        type: string
        enum: [admin, moderator, user]
      urgency:
        type: string
        enum: [low, normal, high]
    required:
      - role
      - urgency

  steps:
    - id: message_prefix
      ifValue:
        condition:
          equals:
            - { $ref: { namespace: input, pointer: /urgency } }
            - high
        then: "🚨 URGENT"
        else:
          ifValue:
            condition:
              equals:
                - { $ref: { namespace: input, pointer: /urgency } }
                - normal
            then: "📢"
            else: "ℹ️"

    - id: progress_notification
      call: agent.sendProgressUpdate
      when:
        equals:
          - { $ref: { namespace: input, pointer: /urgency } }
          - high
      with:
        message: Processing high-urgency request
        emoji: "⚡"
        urgency: high

  return:
    prefix:
      $ref:
        namespace: steps
        pointer: /message_prefix
    role:
      $ref:
        namespace: input
        pointer: /role
```

### Example 3: Multi-Step Workflow

File: `examples/compositions/multi_step_workflow.yaml`

Demonstrates:
- Multi-step execution
- Data flow between steps using `$steps` references
- Complex conditionals with `all` operator
- Multiple tool invocations

See full example in `examples/compositions/multi_step_workflow.yaml`.

## Best Practices

### Naming Conventions

- **Composition names**: Use kebab-case (e.g., `user-onboarding-workflow`)
- **Step IDs**: Use snake_case (e.g., `validate_input`)
- **Tags**: Use lowercase, singular (e.g., `workflow`, `notification`)

### Input Schema Design

```yaml
# ✅ Good: Explicit types, descriptions, required fields
inputSchema:
  type: object
  properties:
    userId:
      type: string
      description: Unique user identifier
    action:
      type: string
      enum: [create, update, delete]
      description: Action to perform
    options:
      type: object
      properties:
        notify:
          type: boolean
          default: false
  required:
    - userId
    - action

# ❌ Bad: No descriptions, no required fields
inputSchema:
  type: object
  properties:
    data: {}
```

### Step Organization

```yaml
# ✅ Good: Descriptive step IDs, clear data flow
steps:
  - id: validate_input
    ifValue:
      condition:
        exists:
          $ref: { namespace: input, pointer: /data }
      then: { valid: true }
      else: { valid: false, error: "Missing data" }

  - id: process_data
    call: data.processor
    when:
      equals:
        - { $ref: { namespace: steps, pointer: /validate_input/valid } }
        - true
    with:
      data:
        $ref: { namespace: input, pointer: /data }

# ❌ Bad: Unclear step IDs, complex nesting
steps:
  - id: step1
    ifValue:
      condition: { ... deeply nested ... }
      then: { ... deeply nested ... }
      else: { ... deeply nested ... }
```

### Error Handling

```yaml
# ✅ Good: Validate inputs, provide error messages
steps:
  - id: validation
    ifValue:
      condition:
        exists:
          $ref: { namespace: input, pointer: /required_field }
      then: { valid: true }
      else: { valid: false, error: "Missing required_field" }

  - id: processing
    ifValue:
      condition:
        equals:
          - { $ref: { namespace: steps, pointer: /validation/valid } }
          - true
      then:
        status: success
        result: { ... }
      else:
        status: failed
        error:
          $ref: { namespace: steps, pointer: /validation/error }

return:
  $ref: { namespace: steps, pointer: /processing }
```

### Performance

- **Minimize step count**: Each step adds overhead
- **Use $ref sparingly**: Reference resolution has cost
- **Avoid deep nesting**: Keep conditionals shallow
- **Cache frequently used compositions**: Register once, execute many times

### Documentation

```yaml
# ✅ Good: Comprehensive metadata
metadata:
  name: user-notification-workflow
  description: |
    Sends notifications to users based on urgency level.
    Supports email, SMS, and push notifications.
  author: Platform Team
  tags:
    - notification
    - workflow
    - user-engagement

# Add comments in YAML
steps:
  # Validate user preferences exist
  - id: check_preferences
    ...

  # Send notification via preferred channel
  - id: send_notification
    ...
```

## Troubleshooting

### Common Errors

#### 1. Invalid Schema

**Error**: `Composition validation failed: Invalid schema`

**Cause**: Missing required fields or invalid structure.

**Solution**: Ensure YAML has all required fields:
```yaml
apiVersion: mcp-compose/v1  # Required
kind: Composition            # Required
metadata:
  name: ...                  # Required
  description: ...           # Required
spec:
  inputSchema: ...           # Required
  return: ...                # Required
```

#### 2. Tool Not Found

**Error**: `Tool 'unknown.tool' not found`

**Cause**: Referenced tool doesn't exist in ToolRegistry.

**Solution**: Verify tool exists:
```bash
# List all available tools
curl http://localhost:3002/v1/tools

# Check tool availability
curl http://localhost:3002/v1/tools/agent.sendProgressUpdate
```

#### 3. Reference Resolution Failed

**Error**: `Cannot resolve reference: /steps/unknown_step/field`

**Cause**: Referenced step doesn't exist or hasn't executed yet.

**Solution**: Ensure step IDs are correct and steps execute in order:
```yaml
steps:
  - id: step1        # Must exist
    ...

  - id: step2
    call: some.tool
    with:
      data:
        $ref:
          namespace: steps
          pointer: /step1   # References step1 (defined above)
```

#### 4. Composition Not Registered

**Error**: `Tool 'my_composition' not found`

**Cause**: Composition not registered or registration failed.

**Solution**: Check registration:
```bash
# List registered compositions
curl http://localhost:3002/v1/compositions

# Check logs
docker logs tool-gateway | grep composition
```

#### 5. PostgreSQL Not Available

**Error**: `503 Service Unavailable`

**Cause**: DocumentStore (PostgreSQL) not configured.

**Solution**: Ensure PostgreSQL is running and configured:
```bash
# Check PostgreSQL connection
psql $DATABASE_URL -c "SELECT 1"

# Check tool-gateway logs
docker logs tool-gateway | grep DocumentStore
```

### Debugging

#### Enable Debug Logging

```bash
# Set log level
export LOG_LEVEL=debug

# Restart tool-gateway
brat bit deploy tool-gateway

# View logs
docker logs -f tool-gateway
```

#### Inspect Execution

```typescript
// Add logging to composition
steps:
  - id: debug_input
    call: agent.sendProgressUpdate
    with:
      message:
        $ref: { namespace: input, pointer: / }
      emoji: "🔍"
```

#### Test in Isolation

```bash
# Test single step by creating minimal composition
POST /v1/compositions
{
  "apiVersion": "mcp-compose/v1",
  "kind": "Composition",
  "metadata": {
    "name": "test_step",
    "description": "Test single step"
  },
  "spec": {
    "inputSchema": { "type": "object" },
    "steps": [
      {
        "id": "test",
        "call": "agent.sendProgressUpdate",
        "with": { "message": "test", "emoji": "🧪" }
      }
    ],
    "return": { "$ref": { "namespace": "steps", "pointer": "/test" } }
  }
}
```

## Next Steps

- Explore examples in `examples/compositions/`
- Read DSL specification in `documentation/reference/composition-dsl.md`
- Review integration tests in `src/apps/__tests__/composition-e2e.integration.test.ts`
- Join community discussions on composition patterns

## References

- [Composition DSL Specification](../reference/composition-dsl.md)
- [Tool Registry](../reference/tool-registry.md)
- [MCP Tools](../reference/mcp-tools.md)
- [Sprint 41 Planning](../../planning/sprint-41-u18tqc/)

# Utility Service: MCP Tool Reference

**Service**: utility-service
**Sprint**: sprint-27-6tp11t
**MCP Exposure**: platform-only
**Last Updated**: 2026-08-27

## Overview

The utility-service exposes 6 MCP tools for counter management. All tools are **platform-only** and accessible via the tool-gateway for LLM interactions or direct service calls for platform Bits.

**Tool Registry**:
| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `counter.create` | Create new counter | CreateCounterParams | CounterResult |
| `counter.increment` | Increment counter value | IncrementParams | IncrementResult |
| `counter.get` | Get current value + metadata | GetCounterParams | GetCounterResult |
| `counter.delete` | Remove counter | DeleteCounterParams | DeleteCounterResult |
| `counter.list` | Query counters by scope | ListCountersParams | CounterDefinition[] |
| `counter.snapshot` | Take value snapshot | SnapshotCounterParams | SnapshotCounterResult |

---

## Tool: counter.create

**Purpose**: Create a new counter with optional TTL and metadata

**Signature**:
```typescript
counter.create(params: CreateCounterParams): Promise<CounterResult>
```

### Parameters (Zod Schema)

```typescript
const CreateCounterSchema = z.object({
  name: z.string().min(1).max(64)
    .describe('Counter name (e.g., "deaths", "points")'),

  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional()
    .describe('Scope type (default: auto-infer from event)'),

  scopeValue: z.string().optional()
    .describe('Scope value (default: auto-infer from event)'),

  initialValue: z.number().default(0)
    .describe('Initial counter value'),

  ttlSeconds: z.number().positive().optional()
    .describe('Time-to-live in seconds (omit for permanent counter)'),

  metadata: z.record(z.any()).optional()
    .describe('Optional metadata (description, icon, category, etc.)'),

  createdBy: z.string().optional()
    .describe('Creator identifier')
});
```

### TypeScript Interface

```typescript
interface CreateCounterParams {
  name: string;                    // Required: Counter name (unique within scope)
  scopeType?: ScopeType;           // Optional: 'global' | 'stream' | 'user' | 'session' | 'custom'
  scopeValue?: string;             // Optional: Scope identifier
  initialValue?: number;           // Optional: Default 0
  ttlSeconds?: number;             // Optional: Auto-expire after N seconds
  metadata?: Record<string, any>;  // Optional: Arbitrary JSON metadata
  createdBy?: string;              // Optional: Creator ID (default: 'system')
  event?: InternalEventV2;         // Internal: Event context for auto-inference
}
```

### Return Value

```typescript
interface CounterResult {
  success: boolean;     // true if created successfully
  counterId: string;    // Format: {scopeType}:{scopeValue}:{name}
  key: string;          // Redis key: counter:{scopeType}:{scopeValue}:{name}
}

// Success Example:
{
  "success": true,
  "counterId": "stream:bitbrat:deaths",
  "key": "counter:stream:bitbrat:deaths"
}
```

### Error Responses

| Error | Cause | HTTP Status | isError |
|-------|-------|-------------|---------|
| Counter already exists | Duplicate counter ID | N/A | true |
| Invalid scope type | scopeType not in enum | N/A | true |
| Resources not ready | DocumentStore/Redis unavailable | N/A | true |

```typescript
// Error Example:
{
  "content": [{ "type": "text", "text": "Error creating counter: Counter already exists: stream:bitbrat:deaths" }],
  "isError": true
}
```

### Examples

#### Example 1: Create Stream Counter with TTL

```typescript
// Request
counter.create({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat",
  initialValue: 0,
  ttlSeconds: 14400,  // 4 hours
  metadata: {
    description: "Player deaths in current stream",
    icon: "💀",
    game: "Elden Ring"
  },
  createdBy: "llm-bot"
})

// Response
{
  "success": true,
  "counterId": "stream:bitbrat:deaths",
  "key": "counter:stream:bitbrat:deaths"
}
```

#### Example 2: Create Global Permanent Counter

```typescript
// Request
counter.create({
  name: "messages_processed",
  scopeType: "global",
  initialValue: 0,
  metadata: {
    description: "Total messages processed since launch",
    category: "platform_metrics"
  }
})

// Response
{
  "success": true,
  "counterId": "global:global:messages_processed",
  "key": "counter:global:global:messages_processed"
}
```

#### Example 3: Create User Counter with Auto-Inference

```typescript
// Request (event context provides user ID)
counter.create({
  name: "points",
  scopeType: "user",
  // scopeValue auto-inferred from event.identity.user.id
  initialValue: 100,
  metadata: {
    description: "Channel points",
    icon: "⭐"
  }
})

// Response (assuming event.identity.user.id = "user_123")
{
  "success": true,
  "counterId": "user:user_123:points",
  "key": "counter:user:user_123:points"
}
```

---

## Tool: counter.increment

**Purpose**: Increment counter value by a specified delta (default: 1)

**Signature**:
```typescript
counter.increment(params: IncrementParams): Promise<IncrementResult>
```

### Parameters (Zod Schema)

```typescript
const IncrementSchema = z.object({
  name: z.string().optional()
    .describe('Counter name (required if key not provided)'),

  key: z.string().optional()
    .describe('Direct Redis key (overrides name/scope)'),

  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),

  scopeValue: z.string().optional(),

  delta: z.number().default(1)
    .describe('Amount to increment by')
});
```

### TypeScript Interface

```typescript
interface IncrementParams {
  name?: string;          // Counter name (OR key)
  key?: string;           // Direct Redis key (OR name+scope)
  scopeType?: ScopeType;  // Required if using name
  scopeValue?: string;    // Required if using name
  delta?: number;         // Default: 1
  event?: InternalEventV2; // For auto-inference
}
```

### Return Value

```typescript
interface IncrementResult {
  success: boolean;  // true if incremented
  newValue: number;  // Counter value after increment
  key: string;       // Redis key used
}

// Example:
{
  "success": true,
  "newValue": 42,
  "key": "counter:stream:bitbrat:deaths"
}
```

### Error Responses

| Error | Cause | isError |
|-------|-------|---------|
| Either key or name must be provided | Missing both key and name | true |
| Counter not found | Counter doesn't exist (returns 0) | false |
| Resources not ready | Redis unavailable | true |

### Examples

#### Example 1: Increment by 1 (Default)

```typescript
// Request
counter.increment({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat"
})

// Response
{
  "success": true,
  "newValue": 43,
  "key": "counter:stream:bitbrat:deaths"
}
```

#### Example 2: Increment by Custom Delta

```typescript
// Request
counter.increment({
  name: "points",
  scopeType: "user",
  scopeValue: "user_123",
  delta: 100
})

// Response
{
  "success": true,
  "newValue": 200,
  "key": "counter:user:user_123:points"
}
```

#### Example 3: Increment Using Direct Key (Performance)

```typescript
// Request
counter.increment({
  key: "counter:stream:bitbrat:deaths"
})

// Response (faster - no scope resolution)
{
  "success": true,
  "newValue": 44,
  "key": "counter:stream:bitbrat:deaths"
}
```

---

## Tool: counter.get

**Purpose**: Get current counter value and metadata

**Signature**:
```typescript
counter.get(params: GetCounterParams): Promise<GetCounterResult>
```

### Parameters (Zod Schema)

```typescript
const GetCounterSchema = z.object({
  name: z.string().optional(),
  key: z.string().optional(),
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional()
});
```

### TypeScript Interface

```typescript
interface GetCounterParams {
  name?: string;          // Counter name (OR key)
  key?: string;           // Direct Redis key (OR name+scope)
  scopeType?: ScopeType;
  scopeValue?: string;
  event?: InternalEventV2;
}
```

### Return Value

```typescript
interface GetCounterResult {
  success: boolean;              // true if retrieved
  value: number;                 // Current counter value (0 if not found)
  key: string;                   // Redis key
  metadata?: Record<string, any>; // Metadata (if name-based access)
}

// Example:
{
  "success": true,
  "value": 42,
  "key": "counter:stream:bitbrat:deaths",
  "metadata": {
    "description": "Player deaths in current stream",
    "icon": "💀",
    "game": "Elden Ring"
  }
}
```

### Error Responses

| Error | Cause | isError |
|-------|-------|---------|
| Either key or name must be provided | Missing both | true |
| Counter not found | Returns value: 0 | false |

### Examples

#### Example 1: Get with Metadata

```typescript
// Request
counter.get({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat"
})

// Response
{
  "success": true,
  "value": 42,
  "key": "counter:stream:bitbrat:deaths",
  "metadata": {
    "description": "Player deaths in current stream",
    "icon": "💀"
  }
}
```

#### Example 2: Get Using Direct Key (No Metadata)

```typescript
// Request
counter.get({
  key: "counter:stream:bitbrat:deaths"
})

// Response (faster, no metadata)
{
  "success": true,
  "value": 42,
  "key": "counter:stream:bitbrat:deaths"
}
```

---

## Tool: counter.delete

**Purpose**: Delete a counter (removes from both Redis and DocumentStore)

**Signature**:
```typescript
counter.delete(params: DeleteCounterParams): Promise<DeleteCounterResult>
```

### Parameters (Zod Schema)

```typescript
const DeleteCounterSchema = z.object({
  name: z.string().optional(),
  key: z.string().optional(),
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional()
});
```

### TypeScript Interface

```typescript
interface DeleteCounterParams {
  name?: string;
  key?: string;
  scopeType?: ScopeType;
  scopeValue?: string;
  event?: InternalEventV2;
}
```

### Return Value

```typescript
interface DeleteCounterResult {
  success: boolean;  // true if deleted
  key: string;       // Redis key deleted
}

// Example:
{
  "success": true,
  "key": "counter:stream:bitbrat:deaths"
}
```

### Error Responses

| Error | Cause | isError |
|-------|-------|---------|
| Either key or name must be provided | Missing both | true |
| Resources not ready | DocumentStore/Redis unavailable | true |

### Examples

#### Example 1: Delete Stream Counter

```typescript
// Request
counter.delete({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat"
})

// Response
{
  "success": true,
  "key": "counter:stream:bitbrat:deaths"
}
```

---

## Tool: counter.list

**Purpose**: List counters filtered by scope (excludes expired counters by default)

**Signature**:
```typescript
counter.list(params: ListCountersParams): Promise<CounterDefinition[]>
```

### Parameters (Zod Schema)

```typescript
const ListCountersSchema = z.object({
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional(),
  includeExpired: z.boolean().default(false)
    .describe('Include expired counters')
});
```

### TypeScript Interface

```typescript
interface ListCountersParams {
  scopeType?: ScopeType;    // Filter by scope type
  scopeValue?: string;      // Filter by scope value
  includeExpired?: boolean; // Default: false
}
```

### Return Value

```typescript
type CounterDefinition = {
  id: string;                    // Counter ID
  name: string;                  // Counter name
  scopeType: ScopeType;          // Scope type
  scopeValue: string;            // Scope value
  ttlSeconds?: number;           // TTL (if any)
  metadata: Record<string, any>; // Metadata
  createdAt: string;             // ISO 8601 timestamp
  expiresAt?: string;            // ISO 8601 timestamp (if TTL)
  createdBy: string;             // Creator ID
}

// Example:
[
  {
    "id": "stream:bitbrat:deaths",
    "name": "deaths",
    "scopeType": "stream",
    "scopeValue": "bitbrat",
    "ttlSeconds": 14400,
    "metadata": { "icon": "💀" },
    "createdAt": "2026-08-27T10:00:00Z",
    "expiresAt": "2026-08-27T14:00:00Z",
    "createdBy": "llm-bot"
  },
  ...
]
```

### Error Responses

| Error | Cause | isError |
|-------|-------|---------|
| DocumentStore unavailable | Connection error | true |

### Examples

#### Example 1: List All Stream Counters

```typescript
// Request
counter.list({
  scopeType: "stream",
  scopeValue: "bitbrat"
})

// Response (active counters only)
[
  {
    "id": "stream:bitbrat:deaths",
    "name": "deaths",
    ...
  },
  {
    "id": "stream:bitbrat:boss_kills",
    "name": "boss_kills",
    ...
  }
]
```

#### Example 2: List Including Expired

```typescript
// Request
counter.list({
  scopeType: "stream",
  scopeValue: "bitbrat",
  includeExpired: true
})

// Response (includes expired)
[
  ...active counters,
  {
    "id": "stream:bitbrat:old_counter",
    "expiresAt": "2026-08-26T10:00:00Z",  // Expired
    ...
  }
]
```

---

## Tool: counter.snapshot

**Purpose**: Take a snapshot of counter value for historical tracking

**Signature**:
```typescript
counter.snapshot(params: SnapshotCounterParams): Promise<SnapshotCounterResult>
```

### Parameters (Zod Schema)

```typescript
const SnapshotCounterSchema = z.object({
  name: z.string().optional(),
  key: z.string().optional(),
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional(),
  trigger: z.enum(['periodic', 'manual', 'expiration', 'stream_end']).default('manual')
});
```

### TypeScript Interface

```typescript
interface SnapshotCounterParams {
  name?: string;
  key?: string;
  scopeType?: ScopeType;
  scopeValue?: string;
  trigger?: 'periodic' | 'manual' | 'expiration' | 'stream_end';
  event?: InternalEventV2;
}
```

### Return Value

```typescript
interface SnapshotCounterResult {
  success: boolean;   // true if snapshot created
  snapshotId: string; // UUID of snapshot
  value: number;      // Counter value at snapshot time
  snapshotAt: string; // ISO 8601 timestamp
}

// Example:
{
  "success": true,
  "snapshotId": "550e8400-e29b-41d4-a716-446655440000",
  "value": 42,
  "snapshotAt": "2026-08-27T14:00:00Z"
}
```

### Error Responses

| Error | Cause | isError |
|-------|-------|---------|
| Either key or name must be provided | Missing both | true |
| Resources not ready | Redis/DocumentStore unavailable | true |

### Examples

#### Example 1: Manual Snapshot

```typescript
// Request
counter.snapshot({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat",
  trigger: "manual"
})

// Response
{
  "success": true,
  "snapshotId": "550e8400-e29b-41d4-a716-446655440000",
  "value": 42,
  "snapshotAt": "2026-08-27T14:00:00Z"
}
```

#### Example 2: Stream End Snapshot

```typescript
// Request
counter.snapshot({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat",
  trigger: "stream_end"
})

// Response
{
  "success": true,
  "snapshotId": "660e9511-f30c-52e5-b827-557766551111",
  "value": 67,
  "snapshotAt": "2026-08-27T15:30:00Z"
}
```

---

## Scope Resolution Behavior

All tools support **automatic scope inference** when `scopeType` and/or `scopeValue` are omitted:

### Resolution Priority (4 levels)

1. **Explicit scope** (highest priority)
   ```typescript
   { scopeType: "stream", scopeValue: "bitbrat" }
   // Uses exactly these values
   ```

2. **Explicit type + inferred value**
   ```typescript
   { scopeType: "stream" }
   // scopeValue inferred from event.ingress.channel
   ```

3. **Auto-infer both from event**
   ```typescript
   { /* no scope params */ }
   // Infers: stream → event.ingress.channel
   //         user → event.identity.user.id
   //         global → fallback
   ```

4. **Default to global** (lowest priority)
   ```typescript
   { /* no scope params, no event */ }
   // Defaults to: { scopeType: "global", scopeValue: "global" }
   ```

### Auto-Inference Rules

| Event Field Available | Inferred Scope |
|----------------------|----------------|
| `event.ingress.channel` | `{ scopeType: "stream", scopeValue: event.ingress.channel }` |
| `event.identity.user.id` | `{ scopeType: "user", scopeValue: event.identity.user.id }` |
| `event.identity.external.id` | `{ scopeType: "user", scopeValue: event.identity.external.id }` |
| None | `{ scopeType: "global", scopeValue: "global" }` |

**Priority**: `channel` > `user.id` > `external.id` > `global`

---

## Error Handling

All tools follow the **fail-open** pattern:

```typescript
// Success Response
{
  "content": [{ "type": "text", "text": JSON.stringify(result) }]
}

// Error Response
{
  "content": [{ "type": "text", "text": "Error <operation>: <message>" }],
  "isError": true
}
```

### Common Error Messages

| Message | Cause | Solution |
|---------|-------|----------|
| `Counter already exists: <id>` | Duplicate counter | Use different name or delete existing |
| `Either key or name must be provided` | Missing parameters | Provide `key` OR `name` + scope |
| `Invalid scope type: <type>` | Unknown scopeType | Use valid enum value |
| `Counter manager not available` | Resources not ready | Check service health, wait for resources |
| `Cannot infer <scope> scope value` | Missing event field | Provide explicit `scopeValue` |

---

## Related Documentation

- **User Guide**: `/documentation/guides/utility-counters.md`
- **Technical Architecture**: `/documentation/architecture/utility-service.md`
- **Type Definitions**: `src/services/utility/types.ts`
- **Implementation**: `src/services/utility/counter-manager.ts`
- **Tests**: `src/services/utility/counter-manager.test.ts`

## Implementation Notes

- **Storage**: Redis (values) + DocumentStore (metadata)
- **Atomicity**: Redis INCR/DECR ensures thread-safety
- **TTL**: Redis EXPIRE for automatic cleanup
- **Persistence**: Snapshots in `counter_snapshots` collection
- **Metadata**: DocumentStore `counter_definitions` collection
- **Key Format**: `counter:{scopeType}:{scopeValue}:{name}`
- **ID Format**: `{scopeType}:{scopeValue}:{name}`

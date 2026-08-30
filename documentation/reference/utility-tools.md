# Utility Service: MCP Tool Reference

**Service**: utility-service
**Sprints**: sprint-27-6tp11t (counters), sprint-29-49pmm9 (bidding)
**MCP Exposure**: platform-only
**Last Updated**: 2026-08-29

## Overview

The utility-service exposes **14 MCP tools** for counter management (6 tools) and bidding systems (8 tools). All tools are **platform-only** and accessible via the tool-gateway for LLM interactions or direct service calls for platform Bits.

**Counter Tools (6)**:
| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `counter.create` | Create new counter | CreateCounterParams | CounterResult |
| `counter.increment` | Increment counter value | IncrementParams | IncrementResult |
| `counter.get` | Get current value + metadata | GetCounterParams | GetCounterResult |
| `counter.delete` | Remove counter | DeleteCounterParams | DeleteCounterResult |
| `counter.list` | Query counters by scope | ListCountersParams | CounterDefinition[] |
| `counter.snapshot` | Take value snapshot | SnapshotCounterParams | SnapshotCounterResult |

**Bidding Tools (8)**:
| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `bid.create` | Create bidding session | CreateBidSessionParams | BidSessionResult |
| `bid.submit` | Submit/update bid | SubmitBidParams | SubmitBidResult |
| `bid.getMax` | Query highest bid | GetMaxBidParams | BidEntry |
| `bid.getMin` | Query lowest bid | GetMinBidParams | BidEntry |
| `bid.getClosest` | Query closest to target | GetClosestBidParams | BidEntry |
| `bid.close` | Close session with results | CloseBidSessionParams | CloseBidSessionResult |
| `bid.list` | List bid sessions | ListBidSessionsParams | BidSession[] |
| `bid.results` | Query historical results | GetBidResultsParams | BidResult[] |

---

# Counter Tools

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

---

# Bidding Tools

---

## Tool: bid.create

**Purpose**: Create a new bidding session with optional target value and TTL

**Signature**:
```typescript
bid.create(params: CreateBidSessionParams): Promise<BidSessionResult>
```

### Parameters (Zod Schema)

```typescript
const CreateBidSessionSchema = z.object({
  name: z.string().min(1).max(64)
    .describe('Session name (e.g., "price-guess", "auction-item-5")'),

  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional()
    .describe('Scope type (default: auto-infer from event)'),

  scopeValue: z.string().optional()
    .describe('Scope value (default: auto-infer from event)'),

  targetValue: z.number().optional()
    .describe('Target value for closest-to queries (optional)'),

  ttlSeconds: z.number().positive().optional()
    .describe('Time-to-live in seconds (omit for permanent session)'),

  metadata: z.record(z.any()).optional()
    .describe('Optional metadata (description, prize, rules, etc.)'),

  createdBy: z.string().optional()
    .describe('Creator identifier')
});
```

### TypeScript Interface

```typescript
interface CreateBidSessionParams extends ScopeParams {
  name: string;                    // Required: Session name (unique within scope)
  scopeType?: ScopeType;           // Optional: scope type
  scopeValue?: string;             // Optional: scope identifier
  targetValue?: number;            // Optional: target for getClosest queries
  ttlSeconds?: number;             // Optional: auto-expire after N seconds
  metadata?: Record<string, any>;  // Optional: arbitrary JSON metadata
  createdBy?: string;              // Optional: creator ID (default: 'system')
  event?: InternalEventV2;         // Internal: event context for auto-inference
}
```

### Return Value

```typescript
interface BidSessionResult {
  success: boolean;      // true if created successfully
  sessionId: string;     // Format: {scopeType}:{scopeValue}:{name}
  sessionKey: string;    // Redis hash key: bid:session:{sessionId}
  expiresAt?: string;    // ISO 8601 (if TTL set)
  error?: string;        // Error message (if success is false)
}

// Success Example:
{
  "success": true,
  "sessionId": "stream:bitbrat:price-guess",
  "sessionKey": "bid:session:stream:bitbrat:price-guess",
  "expiresAt": "2026-08-29T13:00:00Z"
}
```

### Examples

```typescript
// Example 1: Stream-scoped game with target and TTL
bid.create({
  name: "price-guess-round-1",
  scopeType: "stream",
  scopeValue: "bitbrat",
  targetValue: 100,
  ttlSeconds: 300,  // 5 minutes
  metadata: {
    description: "Guess the secret number!",
    prize: "100 channel points",
    icon: "🎯"
  }
})

// Example 2: Global auction (no target, highest wins)
bid.create({
  name: "charity-auction",
  scopeType: "global",
  scopeValue: "global",
  metadata: {
    description: "Signed poster auction",
    prize: "Signed poster",
    minBid: 10
  }
})
```

---

## Tool: bid.submit

**Purpose**: Submit a new bid or update an existing bid (atomic upsert)

**Signature**:
```typescript
bid.submit(params: SubmitBidParams): Promise<SubmitBidResult>
```

### Parameters (Zod Schema)

```typescript
const SubmitBidSchema = z.object({
  session: z.string()
    .describe('Session ID (from bid.create result)'),

  user: z.string()
    .describe('User ID'),

  value: z.number()
    .describe('Bid value (supports decimals)'),

  userName: z.string().optional()
    .describe('Display name (optional)'),

  metadata: z.record(z.any()).optional()
    .describe('Custom metadata (optional)')
});
```

### TypeScript Interface

```typescript
interface SubmitBidParams {
  session: string;    // Session ID
  user: string;       // User ID
  value: number;      // Bid value (supports decimals)
  userName?: string;  // Display name (optional)
  metadata?: Record<string, any>;
}
```

### Return Value

```typescript
interface SubmitBidResult {
  success: boolean;
  entryId: string;         // Format: {sessionId}:{userId}
  previousValue?: number;  // Previous bid if updating
  newValue?: number;       // New bid value
  error?: string;
}

// Success Example (new bid):
{
  "success": true,
  "entryId": "stream:bitbrat:price-guess:alice",
  "newValue": 95
}

// Success Example (update):
{
  "success": true,
  "entryId": "stream:bitbrat:price-guess:alice",
  "previousValue": 95,
  "newValue": 103
}
```

### Examples

```typescript
// Submit first bid
bid.submit({
  session: "stream:bitbrat:price-guess",
  user: "alice",
  value: 95
})

// Update bid (upsert)
bid.submit({
  session: "stream:bitbrat:price-guess",
  user: "alice",
  value: 103  // Updates previous value
})
```

---

## Tool: bid.getMax

**Purpose**: Query the highest bid in an active session

**Signature**:
```typescript
bid.getMax(params: GetMaxBidParams): Promise<BidEntry>
```

### Parameters (Zod Schema)

```typescript
const GetMaxBidSchema = z.object({
  session: z.string()
    .describe('Session ID')
});
```

### TypeScript Interface

```typescript
interface GetMaxBidParams {
  session: string;  // Session ID
}
```

### Return Value

```typescript
interface BidEntry {
  sessionId: string;
  userId: string;
  userName?: string;
  value: number;
  submittedAt: string;  // ISO 8601 (approximate)
  difference?: number;  // Only in getClosest results
}

// Example:
{
  "sessionId": "stream:bitbrat:price-guess",
  "userId": "bob",
  "userName": "bob",
  "value": 120,
  "submittedAt": "2026-08-29T12:30:00Z"
}
```

### Error Handling

Throws error if session has no bids.

### Example

```typescript
bid.getMax({ session: "stream:bitbrat:price-guess" })
// Bids: alice:95, bob:120, charlie:88
// Result: { userId: "bob", value: 120, ... }
```

---

## Tool: bid.getMin

**Purpose**: Query the lowest bid in an active session

**Signature**:
```typescript
bid.getMin(params: GetMinBidParams): Promise<BidEntry>
```

### Parameters (Zod Schema)

```typescript
const GetMinBidSchema = z.object({
  session: z.string()
    .describe('Session ID')
});
```

### TypeScript Interface

```typescript
interface GetMinBidParams {
  session: string;  // Session ID
}
```

### Return Value

Same as `bid.getMax` (BidEntry interface).

### Example

```typescript
bid.getMin({ session: "stream:bitbrat:price-guess" })
// Bids: alice:95, bob:120, charlie:88
// Result: { userId: "charlie", value: 88, ... }
```

---

## Tool: bid.getClosest

**Purpose**: Query the bid closest to the target value

**Signature**:
```typescript
bid.getClosest(params: GetClosestBidParams): Promise<BidEntry>
```

### Parameters (Zod Schema)

```typescript
const GetClosestBidSchema = z.object({
  session: z.string()
    .describe('Session ID'),

  target: z.number().optional()
    .describe('Override session target value (optional)')
});
```

### TypeScript Interface

```typescript
interface GetClosestBidParams {
  session: string;  // Session ID
  target?: number;  // Override session target (optional)
}
```

### Return Value

```typescript
interface BidEntry {
  sessionId: string;
  userId: string;
  userName?: string;
  value: number;
  submittedAt: string;
  difference?: number;  // Absolute distance to target
}

// Example:
{
  "sessionId": "stream:bitbrat:price-guess",
  "userId": "alice",
  "value": 95,
  "difference": 5,  // |95 - 100| = 5
  "submittedAt": "2026-08-29T12:30:00Z"
}
```

### Target Resolution

1. Use `target` parameter if provided
2. Use session's `targetValue` from creation
3. Error if neither available

### Examples

```typescript
// Use session target
bid.getClosest({ session: "stream:bitbrat:price-guess" })
// Target: 100, Bids: alice:95, bob:120, charlie:88
// Result: { userId: "alice", value: 95, difference: 5 }

// Override target
bid.getClosest({
  session: "stream:bitbrat:price-guess",
  target: 90  // Override
})
// Result: { userId: "charlie", value: 88, difference: 2 }
```

---

## Tool: bid.close

**Purpose**: Close a session, compute statistics, determine winner, and snapshot to DocumentStore

**Signature**:
```typescript
bid.close(params: CloseBidSessionParams): Promise<CloseBidSessionResult>
```

### Parameters (Zod Schema)

```typescript
const CloseBidSessionSchema = z.object({
  session: z.string()
    .describe('Session ID'),

  computeWinner: z.boolean().default(true)
    .describe('Compute winner (requires targetValue)'),

  deleteRedisHash: z.boolean().default(false)
    .describe('Delete Redis hash after closing')
});
```

### TypeScript Interface

```typescript
interface CloseBidSessionParams {
  session: string;           // Session ID
  computeWinner?: boolean;   // Default: true
  deleteRedisHash?: boolean; // Default: false
}
```

### Return Value

```typescript
interface CloseBidSessionResult {
  success: boolean;
  sessionId: string;
  closedAt: string;  // ISO 8601
  finalCount: number;
  winner?: {
    userId: string;
    value: number;
    difference?: number
  };
  statistics?: {
    max: number;
    min: number;
    mean: number;
    median: number;
  };
  error?: string;
}

// Example:
{
  "success": true,
  "sessionId": "stream:bitbrat:price-guess",
  "closedAt": "2026-08-29T12:35:00Z",
  "finalCount": 5,
  "winner": {
    "userId": "alice",
    "value": 95,
    "difference": 5
  },
  "statistics": {
    "max": 120,
    "min": 88,
    "mean": 101,
    "median": 95
  }
}
```

### Side Effects

1. Updates session status to `'closed'` in DocumentStore
2. Creates snapshot in `bid_results` collection
3. Optionally deletes Redis hash (if `deleteRedisHash` true)

### Examples

```typescript
// Close with winner
bid.close({
  session: "stream:bitbrat:price-guess",
  computeWinner: true
})

// Close without winner
bid.close({
  session: "stream:bitbrat:auction",
  computeWinner: false
})

// Close and cleanup
bid.close({
  session: "global:global:flash-game",
  deleteRedisHash: true  // Free Redis memory
})
```

---

## Tool: bid.list

**Purpose**: List bid sessions with optional filters

**Signature**:
```typescript
bid.list(params: ListBidSessionsParams): Promise<BidSession[]>
```

### Parameters (Zod Schema)

```typescript
const ListBidSessionsSchema = z.object({
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional(),
  status: z.enum(['active', 'closed', 'expired']).optional(),
  limit: z.number().positive().default(50)
});
```

### TypeScript Interface

```typescript
interface ListBidSessionsParams {
  scopeType?: ScopeType;
  scopeValue?: string;
  status?: 'active' | 'closed' | 'expired';
  limit?: number;  // Default: 50
}
```

### Return Value

```typescript
type BidSession = {
  id: string;
  name: string;
  scopeType: ScopeType;
  scopeValue: string;
  targetValue?: number;
  ttlSeconds?: number;
  metadata: Record<string, any>;
  createdAt: string;
  expiresAt?: string;
  closedAt?: string;
  createdBy: string;
  status: 'active' | 'closed' | 'expired';
}

// Example:
[
  {
    "id": "stream:bitbrat:price-guess",
    "name": "price-guess",
    "scopeType": "stream",
    "scopeValue": "bitbrat",
    "targetValue": 100,
    "status": "active",
    "createdAt": "2026-08-29T12:00:00Z",
    "expiresAt": "2026-08-29T12:05:00Z"
  },
  ...
]
```

### Examples

```typescript
// List all active sessions in a stream
bid.list({
  scopeType: "stream",
  scopeValue: "bitbrat",
  status: "active"
})

// List all closed sessions
bid.list({ status: "closed", limit: 10 })

// List all sessions
bid.list({})
```

---

## Tool: bid.results

**Purpose**: Query historical bid results for analytics

**Signature**:
```typescript
bid.results(params: GetBidResultsParams): Promise<BidResult[]>
```

### Parameters (Zod Schema)

```typescript
const GetBidResultsSchema = z.object({
  sessionId: z.string().optional()
    .describe('Filter by specific session'),

  scopeType: z.string().optional(),
  scopeValue: z.string().optional(),

  limit: z.number().positive().default(50),

  orderBy: z.enum(['closedAt', 'totalEntries']).default('closedAt')
    .describe('Sort order')
});
```

### TypeScript Interface

```typescript
interface GetBidResultsParams {
  sessionId?: string;
  scopeType?: string;
  scopeValue?: string;
  limit?: number;          // Default: 50
  orderBy?: 'closedAt' | 'totalEntries';  // Default: 'closedAt'
}
```

### Return Value

```typescript
type BidResult = {
  id: string;              // {sessionId}:{timestamp}
  sessionId: string;
  closedAt: string;
  totalEntries: number;
  winner?: {
    userId: string;
    userName?: string;
    value: number;
    difference?: number;
  };
  statistics: {
    max: number;
    min: number;
    mean: number;
    median: number;
    stdDev?: number;
  };
  allEntries: Array<{
    userId: string;
    userName?: string;
    value: number;
    submittedAt: string;
  }>;
  metadata: Record<string, any>;
}

// Example:
[
  {
    "id": "stream:bitbrat:price-guess:1735484400000",
    "sessionId": "stream:bitbrat:price-guess",
    "closedAt": "2026-08-29T12:35:00Z",
    "totalEntries": 5,
    "winner": { "userId": "alice", "value": 95, "difference": 5 },
    "statistics": { "max": 120, "min": 88, "mean": 101, "median": 95 },
    "allEntries": [
      { "userId": "alice", "value": 95, "submittedAt": "2026-08-29T12:30:00Z" },
      { "userId": "bob", "value": 120, "submittedAt": "2026-08-29T12:31:00Z" },
      ...
    ]
  },
  ...
]
```

### Examples

```typescript
// Get results for specific session
bid.results({ sessionId: "stream:bitbrat:price-guess-1" })

// Get all results for a stream
bid.results({
  scopeType: "stream",
  scopeValue: "bitbrat",
  orderBy: "closedAt",
  limit: 20
})

// Get sessions with most entries
bid.results({ orderBy: "totalEntries", limit: 10 })
```

---

## Bidding System Architecture

### Storage Layers

| Data | Storage | Lifetime | Purpose |
|------|---------|----------|---------|
| Active bids | Redis Hash | Until close or TTL | Fast queries |
| Session metadata | DocumentStore (bid_sessions) | Permanent | Queryability, audit trail |
| Results snapshot | DocumentStore (bid_results) | Permanent | Analytics, history |

### Redis Hash Structure

**Key Pattern**: `bid:session:{sessionId}`

**Fields**:
- `_metadata`: JSON string with `{ targetValue, createdAt }`
- `user:{userId}`: Bid value (string representation of number)

**Example**:
```
Key: bid:session:stream:bitbrat:price-guess

Fields:
  _metadata: {"targetValue":100,"createdAt":"2026-08-29T12:00:00Z"}
  user:alice: "95"
  user:bob: "120"
  user:charlie: "88"
```

### Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| bid.create | O(1) | Single DocumentStore write + Redis HSET |
| bid.submit | O(1) | Atomic Redis HSET |
| bid.getMax | O(n) | HGETALL + Array.reduce |
| bid.getMin | O(n) | HGETALL + Array.reduce |
| bid.getClosest | O(n log n) | HGETALL + Array.sort |
| bid.close | O(n log n) | HGETALL + statistics + sort for winner |
| bid.list | O(m) | DocumentStore query (m = result count) |
| bid.results | O(m) | DocumentStore query (m = result count) |

**Scalability**: Acceptable for <1000 bids per session.

---

## Bidding Tools - Related Documentation

- **User Guide**: `/documentation/guides/bidding-system.md`
- **Type Definitions**: `src/services/utility/types.ts`
- **Implementation**: `src/services/utility/bid-manager.ts`
- **Tests**: `src/services/utility/bid-manager.test.ts`
- **Sprint Artifacts**: `planning/sprint-29-49pmm9/`

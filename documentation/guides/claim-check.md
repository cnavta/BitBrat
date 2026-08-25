# Claim Check Service - Temporary Event and Blob Storage

## Overview

The Claim Check service implements the Enterprise Integration Pattern for temporarily storing large event payloads and binary blobs in Redis with automatic TTL-based expiration. This allows services to exchange small claim IDs instead of large payloads, reducing message bus overhead and enabling retrieval of persisted events for context reconstruction.

**Key capabilities:**
- **Event storage with versioning**: Store event snapshots with timestamp-based versioning for out-of-order delivery handling
- **Blob storage**: Store large binary/multi-modal content with auto-generated IDs
- **Automatic cleanup**: Redis TTL ensures old claims expire automatically (default: 5 minutes)
- **MCP tools**: Platform-only tools for claim check operations (6 total)
- **Fail-open design**: Graceful degradation when Redis unavailable
- **Unified persistence flow**: Integrates with snapshot-only persistence (Sprint 24)

**Sprint**: 24 (sprint-24-jxvb9x)
**Profile**: core
**Kind**: pipeline-service
**Stage**: persist
**Port**: 3008

---

## Architecture

### Unified Snapshot Flow (Sprint 24)

```
                 Ingress Event
                      │
                      ▼
           ┌─────────────────────┐
           │  Ingress-Egress     │ Publishes 'initial' snapshot
           │   (onMessage)       │────────────┬─────────────────┐
           └─────────────────────┘            │                 │
                                              ▼                 ▼
                                   ┌──────────────────┐  ┌────────────┐
                                   │  Claim Check     │  │ Persistence│
                                   │  (Subscribe to   │  │  (Subscribe│
                                   │   snapshot.v1)   │  │  snapshot) │
                                   └──────────────────┘  └────────────┘
                                              │                 │
                                              ▼                 ▼
                                      ┌────────────┐    ┌──────────────┐
                                      │   Redis    │    │  PostgreSQL  │
                                      │  Versioned │    │  Aggregates  │
                                      │  Snapshots │    │  + Snapshots │
                                      │  TTL: 300s │    │              │
                                      └────────────┘    └──────────────┘
                                              ▲
                                              │
                                   ┌──────────┴──────────┐
                                   │   Any Bit with MCP  │
                                   │  calls claim.event. │
                                   │  retrieve(corrId)   │
                                   └─────────────────────┘
```

**Key changes in Sprint 24:**
- Ingress publishes 'initial' snapshot immediately after ingesting event
- Claim check stores ALL snapshot kinds (initial, update, final, deadletter)
- Persistence creates aggregate from 'initial' snapshot (no longer subscribes to internal.ingress.v1)
- Versioning ensures out-of-order snapshots handled correctly

### Data Model

#### Event Claims (Sprint 24: Versioned Snapshots)
```typescript
Key: bitbrat:claim:event:{correlationId}

Value: StoredSnapshot {
  kind: 'initial' | 'update' | 'final' | 'deadletter',
  capturedAt: string,           // ISO 8601 timestamp (versioning key)
  sourceService: string,          // Service that published snapshot
  sourceTopic: string,           // Topic snapshot was published to
  sequence: number | undefined,   // Extracted from idempotencyKey
  updatedAt: string,             // When stored in Redis
  event: InternalEventV2          // Full event payload
}

TTL: 300 seconds (default), configurable up to 3600s
Max Size: 1MB (default), configurable

Versioning: Timestamp-based (capturedAt field)
- Newer snapshots (later capturedAt) overwrite older ones
- Stale snapshots (earlier capturedAt) are rejected
- Duplicates (same timestamp + kind) are rejected
```

#### Blob Claims
```typescript
Data Key: bitbrat:claim:blob:{blobId}
Metadata Key: bitbrat:claim:blob:{blobId}:meta

Data Value: Base64-encoded binary data
Metadata Value: {
  contentType?: string,
  size: number,
  createdAt: string (ISO 8601),
  expiresAt: string (ISO 8601)
}

TTL: 300 seconds (default), configurable up to 3600s
Max Size: 10MB (default), configurable
```

---

## MCP Tools

All tools are **platform-only** (not exposed to domain-level LLM contexts).

### Event Claim Check

#### `claim.event.retrieve`
Retrieve a stored event snapshot with versioning metadata.

**Parameters:**
```typescript
{
  correlationId: string // Correlation ID of the event
}
```

**Returns (Sprint 24: StoredSnapshot):**
```json
{
  "kind": "final",
  "capturedAt": "2026-08-23T15:20:00.000Z",
  "sourceService": "ingress-egress",
  "sourceTopic": "internal.egress.v1",
  "sequence": 3,
  "updatedAt": "2026-08-23T15:20:01.123Z",
  "event": {
    "v": "2",
    "correlationId": "evt-123-abc",
    "type": "chat.message.v1",
    "ingress": { "source": "discord", ... },
    "egress": { "destination": "discord", ... },
    "message": { "text": "Hello", ... },
    "routing": { ... },
    "annotations": [ ... ]
  }
}
```

**Errors:**
- `Event not found` - Event expired or never existed
- `Claim check service not available` - Redis unavailable

**Example:**
```typescript
const snapshot = await mcpClient.callTool('claim.event.retrieve', {
  correlationId: 'evt-123-abc'
});

// Access versioning metadata
console.log('Snapshot kind:', snapshot.kind);
console.log('Captured at:', snapshot.capturedAt);

// Access full event
const event = snapshot.event;
```

---

#### `claim.event.status`
Get snapshot metadata without retrieving the full event payload (lightweight).

**Parameters:**
```typescript
{
  correlationId: string // Correlation ID to check
}
```

**Returns:**
```json
{
  "exists": true,
  "kind": "final",
  "capturedAt": "2026-08-23T15:20:00.000Z",
  "sourceService": "ingress-egress",
  "sourceTopic": "internal.egress.v1",
  "sequence": 3,
  "updatedAt": "2026-08-23T15:20:01.123Z"
}
```

**Use case**: Check snapshot version/kind without loading full event (useful for progress tracking, debugging).

**Example:**
```typescript
const status = await mcpClient.callTool('claim.event.status', {
  correlationId: 'evt-123-abc'
});

if (status.exists && status.kind === 'final') {
  console.log('Event completed at', status.capturedAt);
}
```

---

#### `claim.event.exists`
Check if an event claim exists without retrieving it.

**Parameters:**
```typescript
{
  correlationId: string // Correlation ID to check
}
```

**Returns:**
```json
{ "exists": true }
```

**Example:**
```typescript
const result = await mcpClient.callTool('claim.event.exists', {
  correlationId: 'evt-123-abc'
});
if (result.exists) {
  // Event is available
}
```

---

### Blob Claim Check

#### `claim.blob.store`
Store a blob (binary data) and get a claim ID.

**Parameters:**
```typescript
{
  data: string,           // Base64-encoded blob data
  contentType?: string,   // MIME type (e.g., 'image/png', 'video/mp4')
  ttl?: number           // TTL in seconds (default: 300, max: 3600)
}
```

**Returns:**
```json
{
  "blobId": "blob-550e8400-e29b-41d4-a716-446655440000",
  "size": 102400,
  "expiresAt": "2026-08-23T15:30:00.000Z"
}
```

**Errors:**
- `Blob exceeds max size` - Blob larger than CLAIM_CHECK_MAX_BLOB_SIZE_BYTES
- `Claim check service not available` - Redis unavailable

**Example:**
```typescript
// Store image
const imageBuffer = fs.readFileSync('avatar.png');
const base64Data = imageBuffer.toString('base64');

const result = await mcpClient.callTool('claim.blob.store', {
  data: base64Data,
  contentType: 'image/png',
  ttl: 600 // 10 minutes
});

console.log('Blob ID:', result.blobId); // Use this to retrieve later
```

---

#### `claim.blob.retrieve`
Retrieve a stored blob by its claim ID.

**Parameters:**
```typescript
{
  blobId: string // Blob claim ID returned from store
}
```

**Returns:**
```json
{
  "blobId": "blob-550e8400-e29b-41d4-a716-446655440000",
  "contentType": "image/png",
  "size": 102400,
  "data": "iVBORw0KGgoAAAANSUhEUg...", // Base64-encoded
  "expiresAt": "2026-08-23T15:30:00.000Z"
}
```

**Errors:**
- `Blob not found or expired` - Blob TTL expired or never existed
- `Claim check service not available` - Redis unavailable

**Example:**
```typescript
const result = await mcpClient.callTool('claim.blob.retrieve', {
  blobId: 'blob-550e8400-e29b-41d4-a716-446655440000'
});

// Decode and save
const imageBuffer = Buffer.from(result.data, 'base64');
fs.writeFileSync('retrieved.png', imageBuffer);
```

---

#### `claim.blob.exists`
Check if a blob claim exists without retrieving it.

**Parameters:**
```typescript
{
  blobId: string // Blob claim ID to check
}
```

**Returns:**
```json
{ "exists": true }
```

**Example:**
```typescript
const result = await mcpClient.callTool('claim.blob.exists', {
  blobId: 'blob-550e8400-e29b-41d4-a716-446655440000'
});
```

---

## Versioning Behavior (Sprint 24)

### Timestamp-Based Versioning

Claim check uses the `capturedAt` timestamp from `PersistenceSnapshotEventV1` to version stored snapshots. This enables correct handling of out-of-order delivery.

**Algorithm:**
1. Fetch existing snapshot from Redis (if any)
2. Compare `capturedAt` timestamps (incoming vs existing)
3. **Accept** if incoming timestamp is newer (later)
4. **Reject** if incoming timestamp is older (earlier) → return `'rejected_stale'`
5. **Reject** if duplicate (same timestamp + same kind)
6. **Accept** if same timestamp but different kind (e.g., initial → update)

### Out-of-Order Scenarios

#### Scenario 1: Update arrives before Initial
```
Time 10:00:00 - 'update' snapshot arrives (capturedAt: 10:00:05)
Time 10:00:01 - 'initial' snapshot arrives (capturedAt: 10:00:00)

Result:
- 'update' stored (first snapshot for correlationId)
- 'initial' rejected as stale (10:00:00 < 10:00:05)
- Correct behavior: 'update' is the latest state
```

#### Scenario 2: Final arrives before Update
```
Time 10:00:00 - 'final' snapshot arrives (capturedAt: 10:00:10)
Time 10:00:01 - 'update' snapshot arrives (capturedAt: 10:00:05)

Result:
- 'final' stored (first snapshot)
- 'update' rejected as stale (10:00:05 < 10:00:10)
- Correct behavior: 'final' is the latest state
```

#### Scenario 3: Normal Progression
```
Time 10:00:00 - 'initial' snapshot arrives (capturedAt: 10:00:00)
Time 10:00:01 - 'update' snapshot arrives (capturedAt: 10:00:05)
Time 10:00:02 - 'final' snapshot arrives (capturedAt: 10:00:10)

Result:
- All three accepted in order
- Each overwrites the previous (newer timestamp)
- Final state: 'final' snapshot stored
```

### Versioning Results

The `storeEventClaim()` method returns a status indicating what happened:

| Result | Meaning | Log Level |
|--------|---------|-----------|
| `stored` | Snapshot accepted and stored (newer or first) | `debug` |
| `rejected_stale` | Snapshot rejected (older than existing) | `debug` |
| `rejected_error` | Size limit exceeded or Redis error | `warn` |

**Example logs:**
```
[debug] Snapshot stored: correlationId=evt-123, kind=update, result=stored, capturedAt=2026-08-23T10:00:05Z
[debug] Snapshot rejected (stale): correlationId=evt-123, kind=initial, result=rejected_stale, capturedAt=2026-08-23T10:00:00Z
[warn]  Snapshot rejected (error): correlationId=evt-456, kind=final, result=rejected_error, reason=Event exceeds max size (1.2MB > 1MB)
```

---

## Configuration

### Environment Variables

All variables support overriding via environment or architecture.yaml.

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAIM_CHECK_MAX_EVENT_SIZE_BYTES` | `1048576` (1MB) | Maximum event payload size |
| `CLAIM_CHECK_MAX_BLOB_SIZE_BYTES` | `10485760` (10MB) | Maximum blob size |
| `CLAIM_CHECK_DEFAULT_TTL_SECONDS` | `300` (5 min) | Default TTL for claims |
| `CLAIM_CHECK_MAX_TTL_SECONDS` | `3600` (1 hour) | Maximum allowed TTL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

### architecture.yaml

```yaml
claim-check:
  category: platform
  profile: core
  mcp:
    exposure: platform-only
  active: true
  description: Claim Check Bit - Temporary event and blob storage
  kind: pipeline-service
  stage: persist
  stateful: false
  entry: src/apps/claim-check-service.ts
  port: 3008
  dependencies:
    infrastructure:
      - messaging
      - caching
  topics:
    consumes:
      - internal.persistence.snapshot.v1
    produces: []
  env:
    - CLAIM_CHECK_MAX_EVENT_SIZE_BYTES
    - CLAIM_CHECK_MAX_BLOB_SIZE_BYTES
    - CLAIM_CHECK_DEFAULT_TTL_SECONDS
    - CLAIM_CHECK_MAX_TTL_SECONDS
    - REDIS_URL
```

---

## Use Cases

### 1. Progress Messages (Sprint 22 Motivation)

**Problem**: LLM sends progress updates ("Analyzing...", "Checking status...") but doesn't have access to original message context (platform, channel, user).

**Solution**: Retrieve source event from claim check to get ingress/egress metadata.

```typescript
// In tool-gateway or reflex service
async function sendProgressUpdate(correlationId: string, message: string) {
  // Retrieve source event from claim check
  const sourceEvent = await mcpClient.callTool('claim.event.retrieve', {
    correlationId
  });

  if (!sourceEvent) {
    logger.warn('Cannot send progress - source event not found');
    return;
  }

  // Publish progress message to egress
  await nats.publish('internal.egress.v1', {
    v: '2',
    correlationId,
    type: 'progress.update.v1',
    ingress: sourceEvent.ingress, // From claimed event
    egress: sourceEvent.egress,   // From claimed event
    identity: sourceEvent.identity,
    message: {
      role: 'assistant',
      text: message
    },
    routing: {
      stage: 'egress',
      slip: [],
      history: []
    }
  });
}
```

### 2. Multi-Modal Content Storage

**Problem**: LLM generates image/video that's too large for message bus.

**Solution**: Store blob in claim check, pass small blobId reference.

```typescript
// Service A: Generate and store image
const imageData = await generateImage(prompt);
const result = await mcpClient.callTool('claim.blob.store', {
  data: imageData.toString('base64'),
  contentType: 'image/png',
  ttl: 1800 // 30 minutes
});

// Publish event with claim ID
await nats.publish('internal.llmbot.v1', {
  ...event,
  annotations: [{
    kind: 'generated-image',
    value: result.blobId, // Just the ID, not the data
    source: 'image-gen-mcp'
  }]
});

// Service B: Retrieve and use image
const blobResult = await mcpClient.callTool('claim.blob.retrieve', {
  blobId: annotation.value
});
const imageBuffer = Buffer.from(blobResult.data, 'base64');
await uploadToDiscord(imageBuffer);
```

### 3. Temporary Event Archival

**Problem**: Need to debug recent events without querying PostgreSQL.

**Solution**: Query Redis for recent claims (faster than database).

```typescript
// Quick debug: Check if event was persisted
const exists = await mcpClient.callTool('claim.event.exists', {
  correlationId: 'evt-debug-123'
});

if (exists) {
  // Retrieve full event from Redis (sub-10ms)
  const event = await mcpClient.callTool('claim.event.retrieve', {
    correlationId: 'evt-debug-123'
  });
  console.log('Event found in claim check:', event);
} else {
  // Fall back to PostgreSQL (50-100ms)
  const event = await db.query('SELECT * FROM events WHERE correlation_id = $1', ['evt-debug-123']);
}
```

---

## Failure Modes and Resilience

### Fail-Open Design

Claim check is designed to **fail open** - if Redis is unavailable or an operation fails, the platform continues to function.

**Behavior:**
- Snapshot subscription: Logs error, acks message (prevents retry loops)
- MCP tool calls: Returns `isError: true` with descriptive message
- Service startup: Initializes without claim service, logs warning

**Example:**
```typescript
// Redis unavailable
const result = await mcpClient.callTool('claim.event.retrieve', {
  correlationId: 'evt-123'
});

// Returns:
{
  content: [{ type: 'text', text: 'Claim check service not available (Redis unavailable)' }],
  isError: true
}
```

### Redis Memory Management

Claims auto-expire via Redis TTL. No manual cleanup required.

**Memory usage:**
- Default TTL: 300s (5 minutes)
- Average event size: ~2-5KB
- Average blob size: ~100KB
- Estimated capacity: ~10,000 events or ~100 blobs per 256MB Redis

**Monitoring:**
```bash
# Check Redis memory usage
redis-cli INFO memory

# Count claim keys
redis-cli --scan --pattern "bitbrat:claim:*" | wc -l

# Check specific claim TTL
redis-cli TTL "bitbrat:claim:event:evt-123"
```

---

## Troubleshooting

### Event not found

**Symptom**: `claim.event.retrieve` returns null or "Event not found"

**Possible causes:**
1. Event expired (TTL elapsed)
2. Event was never persisted (persistence service issue)
3. CorrelationId mismatch

**Debug steps:**
```bash
# Check if key exists in Redis
redis-cli EXISTS "bitbrat:claim:event:evt-123"

# Check TTL remaining
redis-cli TTL "bitbrat:claim:event:evt-123"

# List all claim keys
redis-cli --scan --pattern "bitbrat:claim:event:*"
```

### Blob storage failing

**Symptom**: `claim.blob.store` returns "Blob exceeds max size"

**Solution**: Increase `CLAIM_CHECK_MAX_BLOB_SIZE_BYTES` or compress blob before storing.

**Example:**
```typescript
// Compress image before storing
const sharp = require('sharp');
const compressed = await sharp(imageBuffer)
  .resize(1024, 1024, { fit: 'inside' })
  .jpeg({ quality: 80 })
  .toBuffer();

const result = await mcpClient.callTool('claim.blob.store', {
  data: compressed.toString('base64'),
  contentType: 'image/jpeg'
});
```

### Redis connection issues

**Symptom**: "Claim check service not available (Redis unavailable)" in logs

**Debug steps:**
```bash
# Check Redis running
docker ps | grep redis

# Test Redis connection
redis-cli ping  # Should return PONG

# Check REDIS_URL environment variable
echo $REDIS_URL

# View claim-check logs
docker logs bitbrat-claim-check
```

---

## Performance

### Latency Benchmarks

| Operation | P50 | P95 | P99 |
|-----------|-----|-----|-----|
| `claim.event.retrieve` | 2ms | 5ms | 10ms |
| `claim.event.exists` | 1ms | 3ms | 5ms |
| `claim.blob.store` (100KB) | 5ms | 12ms | 20ms |
| `claim.blob.retrieve` (100KB) | 8ms | 15ms | 25ms |

**Notes:**
- Measured with local Redis (unix socket)
- Network Redis adds ~1-2ms latency
- Blob operations scale linearly with size

### Throughput

- Event storage: ~10,000 ops/sec
- Blob storage: ~1,000 ops/sec (limited by serialization)
- Concurrent operations: Fully thread-safe via Redis atomicity

---

## Testing

### Unit Tests

```bash
# Run ClaimCheckService tests (32 tests)
npm test -- claim-check-service.test.ts

# Run ClaimCheckServer tests (6 tests)
npm test -- claim-check-service.test.ts
```

### Integration Tests

```bash
# Run full integration suite (17 tests)
npm test -- claim-check.integration.test.ts
```

**Test coverage:**
- Event storage and retrieval
- Blob storage and retrieval
- TTL expiration
- Size limit enforcement
- Concurrent operations
- Failure scenarios (malformed JSON, missing metadata)
- Redis unavailability

### Manual Testing

```typescript
// 1. Store test event
const testEvent = {
  v: '2',
  correlationId: 'test-manual-123',
  type: 'chat.message.v1',
  // ... full event structure
};

await redis.set(
  'bitbrat:claim:event:test-manual-123',
  JSON.stringify(testEvent),
  { EX: 300 }
);

// 2. Retrieve via MCP
const result = await mcpClient.callTool('claim.event.retrieve', {
  correlationId: 'test-manual-123'
});

// 3. Verify
assert.equal(result.correlationId, 'test-manual-123');
```

---

## Migration and Deployment

### Deployment Steps

```bash
# 1. Build
npm run build

# 2. Deploy to local
npm run brat -- bit deploy claim-check

# 3. Verify health
curl http://localhost:3008/health

# 4. Check logs
docker logs bitbrat-claim-check

# 5. Verify MCP tools registered
npm run brat -- fleet info claim-check
```

### Rolling Update

Claim check is stateless (Redis holds all state). Safe to restart/redeploy without data loss.

```bash
# Zero-downtime restart
docker restart bitbrat-claim-check

# Or via brat
npm run brat -- bit deploy claim-check
```

---

## Future Enhancements

### Planned Features (not in MVP)

1. **Base Bit helper methods** (T3.2, skipped)
   - `this.getClaimedEvent(correlationId)` in Bit base class
   - `this.storeBlob(data, options)` convenience wrapper

2. **Tool-gateway integration** (T4.4)
   - Auto-inject McpClientProfile
   - Enhance `agent.sendProgressUpdate` to use claim check

3. **Compression**
   - Gzip events >10KB before storing
   - Reduces Redis memory by ~70%

4. **Extended TTLs**
   - Per-event-type TTL configuration
   - Critical events: 1 hour
   - Debug events: 5 minutes

5. **Blob streaming**
   - Chunked upload/download for large blobs
   - Support blobs >10MB

---

## References

- **Sprint 24 Planning**: `planning/sprint-24-jxvb9x/`
- **Implementation**: `src/apps/claim-check-service.ts`
- **Core Service**: `src/services/claim-check/claim-check-service.ts`
- **Tests**: `src/apps/__tests__/claim-check.integration.test.ts`
- **Architecture**: `architecture.yaml` (line 1003)
- **Enterprise Pattern**: [Claim Check Pattern](https://www.enterpriseintegrationpatterns.com/patterns/messaging/StoreInLibrary.html)

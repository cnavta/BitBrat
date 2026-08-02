# Long-Running Task Feedback (Sprint 377)

**Status:** Production Ready (Phase 1: Template Messages)
**Version:** 1.0.0
**Last Updated:** 2026-07-31

## Overview

The Long-Running Task Feedback feature automatically provides progress updates to users when operations exceed configured time thresholds. This prevents user confusion during slow LLM requests, API calls, or other time-consuming operations.

**Key Benefits:**
- **User Transparency**: Automatic "still working" messages prevent timeout anxiety
- **Contextual Updates**: Progress messages reference the original user request
- **Zero Configuration**: Works out-of-the-box with sensible defaults
- **Non-Blocking**: Progress failures never block operations

## How It Works

### Event Flow

```
1. User sends message → ingress-egress → internal.ingress.v1
2. Event routes to llm-bot (or other service)
3. FeedbackMiddleware detects operation start
4. If operation exceeds 2s → Initial progress message sent
5. Every 5s → Update progress message sent
6. After 30s → Timeout warning sent
7. Operation completes → Tracking stops
```

### Architecture Components

| Component | Purpose | File |
|-----------|---------|------|
| **FeedbackMiddleware** | Detects slow operations, emits progress events | `src/common/middleware/feedback-middleware.ts` |
| **Derived Events** | Creates progress events with correlation tracking | `src/common/events/derived-event.ts` |
| **Event-Router Rule** | Routes progress events to llm-bot | `progress-to-llm-bot` routing rule |
| **LLM-Bot Integration** | Adds operation_context for contextual messages | `src/apps/llm-bot-service.ts` |

## Configuration

### Environment Variables

```bash
# Feature Control
PROGRESS_ENABLED=true                    # Enable/disable feature (default: true)
PROGRESS_USE_CUSTOM=false                # Use LLM messages vs templates (default: false, Phase 1)

# Thresholds (milliseconds)
PROGRESS_INITIAL_THRESHOLD_MS=2000       # Time before first message (default: 2s)
PROGRESS_UPDATE_INTERVAL_MS=5000         # Time between updates (default: 5s)
PROGRESS_TIMEOUT_THRESHOLD_MS=30000      # Time before timeout warning (default: 30s)
```

### Per-Service Configuration (architecture.yaml)

```yaml
services:
  my-service:
    env:
      PROGRESS_ENABLED: "true"
      PROGRESS_INITIAL_THRESHOLD_MS: "3000"  # Custom threshold for this service
```

### Disable Progress Feedback

To completely disable the feature:

```yaml
# env/local/global.yaml
PROGRESS_ENABLED: "false"
```

Or for specific service:

```yaml
services:
  my-service:
    env:
      PROGRESS_ENABLED: "false"
```

## Usage Examples

### Scenario 1: Slow LLM Request (Default Behavior)

**User action:**
```
User: @BitBrat write a detailed analysis of quantum computing
```

**System behavior:**
```
[0s]   User message received
[2s]   → "Still working on your request..." (initial)
[7s]   → "Still processing..." (update)
[12s]  → "Almost there..." (update)
[15s]  LLM response complete → User sees final answer
```

### Scenario 2: Very Slow Operation (Timeout Warning)

**User action:**
```
User: @BitBrat summarize this 500-page document
```

**System behavior:**
```
[0s]   User message received
[2s]   → "Still working on your request..."
[7s]   → "Still processing..."
[30s]  → "This is taking longer than expected..." (timeout warning)
[45s]  Operation completes → User sees result
```

## Phase 1 vs Phase 2

### Phase 1: Template Messages (Current)

**Status:** ✅ Production Ready
**Messages:** Pre-defined templates
**Configuration:** `PROGRESS_USE_CUSTOM=false`

**Template Messages:**
- **Initial:** "Still working on your request..."
- **Update:** "Still processing..."
- **Timeout:** "This is taking longer than expected..."

**Pros:**
- Fast (no LLM call required)
- Predictable
- Low latency

**Cons:**
- Generic messages
- No context about user's specific request

### Phase 2: LLM-Generated Messages (Future)

**Status:** ⏳ Not Yet Deployed
**Messages:** Contextual, AI-generated
**Configuration:** `PROGRESS_USE_CUSTOM=true`

**Example LLM Messages:**
```
User: "Write a story about a dragon"
Progress: "✍️ Crafting your dragon tale..."

User: "Analyze this code for bugs"
Progress: "🔍 Reviewing your code for issues..."
```

**Pros:**
- Contextual and relevant
- Engaging user experience
- References original request

**Cons:**
- Requires additional LLM call
- Slightly higher latency

**To Enable Phase 2:**
```bash
PROGRESS_USE_CUSTOM=true
```

## Technical Details

### Derived Events

Progress events are "derived" from the original user event, preserving:
- Correlation ID chain (for traceability)
- Platform context (channel, user)
- Routing context (egress destination)

**Example derived_from annotation:**
```json
{
  "kind": "derived_from",
  "value": {
    "correlationId": "original-event-id",
    "type": "chat.message.v1",
    "source": "feedback-middleware",
    "derivedAt": "2026-07-31T22:00:00Z"
  },
  "source": "feedback-middleware",
  "id": "annotation-id",
  "createdAt": "2026-07-31T22:00:00Z"
}
```

### Operation Context Annotation

llm-bot adds an `operation_context` annotation to track operation details:

```json
{
  "kind": "operation_context",
  "value": {
    "operation": "llm_request",
    "originalMessage": "User's original message text",
    "eventType": "chat.message.v1",
    "startedAt": 1722460800000
  },
  "source": "llm-bot",
  "id": "annotation-id",
  "createdAt": "2026-07-31T22:00:00Z"
}
```

### Progress Event Type

Progress events use the `chat.progress.v1` event type, which routes to llm-bot via the `progress-to-llm-bot` routing rule.

### Error Handling

**Design Principle:** Progress failures NEVER block operations.

```typescript
try {
  await sendProgressMessage(event, state, stage, elapsedMs);
} catch (err) {
  logger.error('Failed to send progress message', { error: err });
  // Don't throw - operation continues normally
}
```

**Failure Scenarios:**
- Message bus unavailable → Operation proceeds, no progress sent
- LLM timeout → Falls back to template (Phase 2 only)
- Invalid routing → Operation proceeds, error logged

## Monitoring & Observability

### Structured Logging

All progress lifecycle events are logged with structured metadata:

```json
{
  "msg": "Operation tracking started",
  "correlationId": "abc-123",
  "operation": "llm_request",
  "originalMessage": "User's message"
}
```

**Key Log Events:**
- `FeedbackMiddleware initialized` - Middleware startup
- `Operation tracking started` - Operation begins
- `Sending template progress message` - Progress message sent (Phase 1)
- `Sending LLM progress message` - Progress message sent (Phase 2)
- `Operation tracking completed` - Operation finished
- `Failed to send progress message` - Error occurred

### Log Filtering

**View all progress-related logs:**
```bash
# Local Docker
brat fleet logs llm-bot --context local | grep -i progress

# Agent-dev
brat fleet logs llm-bot --context agent-dev-xxx | grep -i progress
```

**Debug specific correlation:**
```bash
brat fleet trace <correlation-id>
```

### Metrics (Future)

Planned metrics for Phase 3:
- `progress.messages.sent` - Counter of progress messages
- `progress.latency.p95` - 95th percentile latency
- `progress.failures` - Failed progress attempts
- `progress.operations.tracked` - Operations being tracked

## Deployment

### Prerequisites

1. **PostgreSQL** with routing rules seeded
2. **Event-router** with `progress-to-llm-bot` rule
3. **LLM-bot** with operation_context integration
4. **Message bus** (NATS or Pub/Sub)

### Deployment Steps

**1. Verify Seed Data:**
```bash
# Check routing rule exists
brat fleet info event-router --context <env>

# Query database
docker exec <postgres-container> psql -U bitbrat -d bitbrat \
  -c "SELECT id FROM routing_rules WHERE id = 'progress-to-llm-bot';"
```

**2. Deploy Services:**
```bash
# Deploy all services with progress support
brat deploy services --all --context staging

# Or specific services
brat deploy service llm-bot --context staging
brat deploy service event-router --context staging
```

**3. Verify Deployment:**
```bash
# Check service health
brat fleet list --context staging

# View logs
brat fleet logs llm-bot --context staging
```

**4. Smoke Test:**
```bash
# Send test message that triggers slow operation
brat chat --context staging
> @BitBrat write a detailed analysis (should trigger progress messages)
```

### Rollback

If issues occur, disable the feature without redeployment:

```bash
# Update environment variable
kubectl set env deployment/llm-bot PROGRESS_ENABLED=false

# Or via architecture.yaml + redeploy
```

## Troubleshooting

### Progress Messages Not Appearing

**Symptoms:** No progress messages even for slow operations

**Check:**
1. Feature enabled: `PROGRESS_ENABLED=true`
2. Thresholds configured: Check `PROGRESS_INITIAL_THRESHOLD_MS`
3. Routing rule exists: Query `routing_rules` table
4. llm-bot healthy: `brat fleet health llm-bot`
5. Logs for errors: `brat fleet logs llm-bot | grep -i progress`

### Too Many Progress Messages

**Symptoms:** Progress messages spam the user

**Solution:** Increase thresholds
```yaml
env:
  PROGRESS_INITIAL_THRESHOLD_MS: "5000"  # 5s instead of 2s
  PROGRESS_UPDATE_INTERVAL_MS: "10000"   # 10s instead of 5s
```

### Progress Messages for Fast Operations

**Symptoms:** Progress sent for operations that complete quickly

**Cause:** Thresholds too low

**Solution:** Increase `PROGRESS_INITIAL_THRESHOLD_MS`:
```yaml
PROGRESS_INITIAL_THRESHOLD_MS: "3000"  # 3 seconds
```

## Testing

### Unit Tests

```bash
# Test derived events
npm test -- derived-event.test.ts

# Test feedback middleware
npm test -- feedback-middleware.test.ts
```

### Integration Tests

```bash
# Test full routing flow
npm test -- progress-event-routing.integration.test.ts
```

### Agent-Dev Environment Testing

```bash
# Provision ephemeral environment
brat agent_dev.provision

# Start services
brat agent_dev.start --name agent-dev-xxx

# Seed data
brat seed --context agent-dev-xxx

# Test manually
docker exec -it <llm-bot-container> sh
```

## References

- **Technical Architecture:** `planning/sprint-377-long-running-task-feedback/technical-architecture.md`
- **Implementation Status:** `planning/sprint-377-long-running-task-feedback/IMPLEMENTATION_STATUS.md`
- **Derived Events API:** `src/common/events/derived-event.ts`
- **Feedback Middleware:** `src/common/middleware/feedback-middleware.ts`
- **Routing Rule Reference:** `documentation/reference/setup/progress_to_llm_bot_rule.json`

## Future Enhancements

### Phase 2: LLM-Generated Messages
- **Status:** Code ready, not yet deployed
- **Requirement:** Set `PROGRESS_USE_CUSTOM=true`
- **Benefit:** Contextual, engaging progress messages

### Phase 3: Advanced Features
- Progress percentage/ETA estimation
- User preferences (opt-in/opt-out)
- Platform-specific formatting (emoji support)
- Metrics and monitoring dashboard

### Phase 4: Multi-Operation Tracking
- Track multiple concurrent operations per user
- Operation priority queues
- Resource contention detection

---

**End of Long-Running Task Feedback Guide**

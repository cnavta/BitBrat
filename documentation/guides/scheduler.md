# Scheduler Service Guide

**Platform-agnostic scheduled task execution with internal timer.**

The scheduler service enables timed and recurring event execution without external cron infrastructure. It operates independently on Docker, GCP, AWS, Azure, and self-hosted environments.

**Sprint:** 369
**Status:** Production-ready
**Dependencies:** PostgreSQL + NATS only

---

## Quick Reference

| Feature | Description |
|---------|-------------|
| **Schedule Types** | `once` (single execution), `cron` (recurring) |
| **Tick Interval** | `SCHEDULER_TICK_INTERVAL_MS` (default: 60s, range: 1s-1h) |
| **Event Topics** | `internal.ingress.v1` (default), `internal.egress.v1` |
| **MCP Tools** | `create_schedule`, `list_schedules`, `get_schedule`, `update_schedule`, `delete_schedule` |
| **Manual Trigger** | `POST /tick` endpoint |
| **Execution Precision** | Within 1 tick interval of `nextRun` |

---

## Core Concepts

### Schedule Types

| Type | Description | Value Format | Use Case |
|------|-------------|--------------|----------|
| **once** | Single execution at specific time | ISO 8601 timestamp | One-time reminders, delayed actions |
| **cron** | Recurring execution | Cron expression (5 fields) | Daily reports, periodic cleanup, reminders |

### Event Structure

Schedules publish `InternalEventV2` messages to the message bus. The `event` field defines what gets published:

```typescript
{
  type: 'llm.request.v1',           // Event type
  message: { ... },                 // Optional message payload
  annotations: [ ... ],             // Optional annotations (e.g., prompts)
  egress: { ... },                  // Optional delivery target
  identity: { ... }                 // Optional identity override
}
```

### Lifecycle

1. **Creation**: Schedule created via `create_schedule` MCP tool
2. **Scheduling**: `nextRun` calculated from schedule type/value
3. **Execution**: Ticker finds due schedules every `SCHEDULER_TICK_INTERVAL_MS`
4. **Publishing**: Event published to configured topic
5. **Update**: `lastRun` updated, `nextRun` recalculated
6. **Completion**: `once` schedules auto-disable after execution

---

## Creating Schedules

### Once Schedule (Single Execution)

Execute a task at a specific future time:

```typescript
// Via MCP tool
{
  "title": "Reminder in 1 hour",
  "schedule": {
    "type": "once",
    "value": "2026-07-27T13:00:00Z"  // ISO 8601 timestamp
  },
  "event": {
    "type": "llm.request.v1",
    "message": {
      "role": "system",
      "text": "Time for your meeting!"
    },
    "egress": {
      "connector": "twitch",
      "destination": "twitch",
      "channel": "#mychannel"
    }
  },
  "enabled": true
}
```

**Once Schedule Behavior:**
- Executes exactly once when `nextRun` is reached
- Automatically disabled after execution (`enabled: false`)
- If `value` is in the past, `nextRun` is `null` (never executes)

### Cron Schedule (Recurring)

Execute a task on a recurring schedule:

```typescript
// Via MCP tool
{
  "title": "Daily standup reminder",
  "schedule": {
    "type": "cron",
    "value": "0 9 * * 1-5"  // 9 AM weekdays (Mon-Fri)
  },
  "event": {
    "type": "llm.request.v1",
    "message": {
      "role": "system",
      "text": "Time for standup!"
    },
    "annotations": [
      {
        "id": "prompt-1",
        "kind": "prompt",
        "source": "scheduler",
        "createdAt": "2026-07-27T00:00:00Z",
        "value": "Generate a friendly standup reminder with today's agenda"
      }
    ]
  },
  "enabled": true
}
```

**Cron Schedule Behavior:**
- Executes repeatedly based on cron expression
- Remains enabled after each execution
- `nextRun` recalculated after each execution

**Cron Expression Format:**
```
 ┌──────── minute (0-59)
 │ ┌────── hour (0-23)
 │ │ ┌──── day of month (1-31)
 │ │ │ ┌── month (1-12)
 │ │ │ │ ┌ day of week (0-7, both 0 and 7 = Sunday)
 * * * * *
```

**Common Cron Examples:**

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour (on the hour) |
| `0 0 * * *` | Every day at midnight |
| `0 9 * * 1-5` | Weekdays at 9 AM |
| `0 0 1 * *` | First day of every month |
| `0 12 * * 0` | Every Sunday at noon |

---

## Event Definition

### Minimal Event

The simplest schedule just specifies an event type:

```typescript
{
  "title": "Ping every hour",
  "schedule": { "type": "cron", "value": "0 * * * *" },
  "event": { "type": "system.ping.v1" }
}
```

Server fills in defaults:
- `ingress.source`: `"scheduler"`
- `ingress.connector`: `"system"`
- `egress.destination`: `"system"`
- `egress.connector`: `"system"`
- `correlationId`, `traceId`: Generated UUIDs

### LLM Request with Prompt

Schedule an LLM request with a prompt annotation:

```typescript
{
  "title": "Daily weather summary",
  "schedule": { "type": "cron", "value": "0 7 * * *" },
  "event": {
    "type": "llm.request.v1",
    "annotations": [
      {
        "id": "prompt-weather",
        "kind": "prompt",
        "source": "scheduler",
        "createdAt": "2026-07-27T00:00:00Z",
        "value": "What's the weather forecast for today in San Francisco?"
      }
    ],
    "egress": {
      "connector": "twitch",
      "destination": "twitch",
      "channel": "#weather"
    }
  }
}
```

**Important:** A "prompt" is NOT an event type—it's an `AnnotationV1` of `kind: 'prompt'`. The event type is `llm.request.v1`.

### Custom Ingress Metadata

Override ingress connector/channel for event routing:

```typescript
{
  "event": {
    "type": "llm.request.v1",
    "ingress": {
      "connector": "discord",
      "channel": "#scheduled-tasks"
    }
  }
}
```

### Publishing to Different Topics

By default, schedules publish to `internal.ingress.v1`. You can override:

```typescript
{
  "title": "Direct egress event",
  "topic": "internal.egress.v1",  // Publish directly to egress
  "event": {
    "type": "system.notification.v1",
    "egress": {
      "connector": "twitch",
      "destination": "twitch",
      "channel": "#alerts"
    },
    "message": {
      "text": "Scheduled notification"
    }
  }
}
```

**Allowed Topics:**
- `internal.ingress.v1` (default - enters event router)
- `internal.egress.v1` (direct delivery - bypasses router)

---

## Managing Schedules

### List All Schedules

```typescript
// Via MCP tool: list_schedules
{
  "enabledOnly": false  // false = all schedules, true = enabled only
}

// Response:
[
  {
    "id": "schedule-uuid",
    "title": "Daily standup",
    "schedule": { "type": "cron", "value": "0 9 * * 1-5" },
    "enabled": true,
    "lastRun": "2026-07-26T09:00:00Z",
    "nextRun": "2026-07-27T09:00:00Z",
    "createdAt": "2026-07-20T00:00:00Z",
    "updatedAt": "2026-07-26T09:00:00Z"
  }
]
```

### Get Schedule Details

```typescript
// Via MCP tool: get_schedule
{
  "id": "schedule-uuid"
}

// Response: Full schedule document with event definition
```

### Update Schedule

Modify an existing schedule:

```typescript
// Via MCP tool: update_schedule
{
  "id": "schedule-uuid",
  "enabled": false  // Disable without deleting
}

// Or change schedule timing:
{
  "id": "schedule-uuid",
  "schedule": {
    "type": "cron",
    "value": "0 10 * * 1-5"  // Change from 9 AM to 10 AM
  }
}
```

**Partial Updates Supported:**
- `title`: Update description
- `schedule`: Change type or value (recalculates `nextRun`)
- `event`: Update event definition
- `enabled`: Enable/disable execution
- `topic`: Change publish destination

### Delete Schedule

Permanently remove a schedule:

```typescript
// Via MCP tool: delete_schedule
{
  "id": "schedule-uuid"
}
```

---

## Configuration

### Environment Variables

```yaml
# env/local/scheduler.yaml (responsive for local dev)
SCHEDULER_TICK_INTERVAL_MS: "10000"  # 10 seconds

# env/staging/scheduler.yaml (production default)
SCHEDULER_TICK_INTERVAL_MS: "60000"  # 60 seconds
```

**Configuration Validation:**
- **Minimum:** 1,000 ms (1 second)
- **Maximum:** 3,600,000 ms (1 hour)
- **Default:** 60,000 ms (1 minute)

Invalid values cause service startup failure.

### Tick Interval Trade-offs

| Interval | Precision | Load | Use Case |
|----------|-----------|------|----------|
| **1s** | Very high | High CPU/DB | Development, urgent tasks |
| **10s** | High | Medium | Local dev, responsive testing |
| **60s** | Standard | Low | Production default |
| **300s** | Low | Very low | Low-priority background tasks |

**Recommendation:** 60s for production, 10s for local development.

---

## Manual Triggering

For testing or on-demand execution:

```bash
# Trigger tick manually (executes all due schedules immediately)
POST http://localhost:3000/tick

# Response:
{
  "success": true,
  "message": "Tick executed successfully"
}
```

**Use Cases:**
- Testing schedule execution without waiting
- Catching up after downtime
- Development/debugging

---

## Performance Characteristics

### Batch Processing

Schedules execute in batches of 10 concurrent tasks:

```
100 due schedules → 10 batches → ~10 seconds total (at default tick interval)
```

- **Concurrency Limit:** 10 (hardcoded)
- **Error Isolation:** `Promise.allSettled` - one failure doesn't block others
- **Publisher Caching:** Reuses message publishers by topic

### Database Queries

Efficient due schedule lookup:

```sql
SELECT * FROM schedules
WHERE enabled = true
  AND nextRun IS NOT NULL
  AND nextRun <= NOW()
ORDER BY nextRun ASC;
```

**Index:** Partial index on `(enabled, nextRun)` for fast lookups (see `infrastructure/postgres/migrations/014_add_schedules_due_index.sql`).

### Execution Precision

Schedules execute within **1 tick interval** of `nextRun`:

- Tick interval: 60s → Execution within 0-60s of target time
- Tick interval: 10s → Execution within 0-10s of target time

**Not suitable for** sub-second precision or hard real-time requirements.

---

## Common Patterns

### Daily Report at 9 AM

```typescript
{
  "title": "Daily analytics report",
  "schedule": { "type": "cron", "value": "0 9 * * *" },
  "event": {
    "type": "llm.request.v1",
    "annotations": [{
      "kind": "prompt",
      "value": "Generate yesterday's analytics summary",
      ...
    }],
    "egress": { "connector": "slack", "channel": "#analytics" }
  }
}
```

### Reminder in 30 Minutes

```typescript
{
  "title": "Meeting reminder",
  "schedule": {
    "type": "once",
    "value": new Date(Date.now() + 30 * 60 * 1000).toISOString()
  },
  "event": {
    "type": "notification.v1",
    "message": { "text": "Meeting starts in 30 minutes!" }
  }
}
```

### Weekly Team Update (Mondays at 10 AM)

```typescript
{
  "title": "Weekly team update",
  "schedule": { "type": "cron", "value": "0 10 * * 1" },
  "event": {
    "type": "llm.request.v1",
    "annotations": [{
      "kind": "prompt",
      "value": "Summarize this week's team accomplishments",
      ...
    }]
  }
}
```

### Hourly Health Check

```typescript
{
  "title": "System health check",
  "schedule": { "type": "cron", "value": "0 * * * *" },
  "event": { "type": "system.health_check.v1" }
}
```

---

## Troubleshooting

See `documentation/guides/scheduler-troubleshooting.md` for detailed troubleshooting guide.

### Quick Diagnostics

**Schedule not executing:**
1. Check `enabled: true`
2. Verify `nextRun` is in the future: `get_schedule`
3. Check scheduler service is running: `docker ps | grep scheduler`
4. Verify tick interval: Logs should show `scheduler.tick.started` every N seconds
5. Manual trigger test: `POST /tick`

**Cron schedule not recurring:**
- Verify cron expression syntax: [crontab.guru](https://crontab.guru/)
- Check `enabled` remains `true` after execution (should not change for cron)
- Check logs for `calculateNextRun` errors

**Events not being delivered:**
- Verify topic is correct (`internal.ingress.v1` or `internal.egress.v1`)
- Check message bus is running (NATS or Pub/Sub)
- Check egress connector configuration
- View correlation ID in logs for tracing

---

## Limits and Constraints

| Limit | Value | Notes |
|-------|-------|-------|
| **Max schedules** | Unlimited | Limited by PostgreSQL capacity |
| **Concurrent execution** | 10 schedules | Hardcoded batch size |
| **Tick interval range** | 1s - 1h | Validated at startup |
| **Execution precision** | ±1 tick interval | Not suitable for sub-second timing |
| **Cron expression** | 5 fields | Standard cron format (no seconds field) |
| **Schedule retention** | Indefinite | Manual deletion required |

---

## Migration from GCP Cloud Scheduler

**Sprint 369 removes GCP Cloud Scheduler dependency.** Migration is automatic:

1. **No data migration needed** - Existing schedules work as-is
2. **No configuration changes** - Existing schedules use same format
3. **New configuration** - Add `SCHEDULER_TICK_INTERVAL_MS` to env files
4. **Remove external job** - Delete GCP Cloud Scheduler job (if exists)

**Behavioral Changes:**
- Tick interval now configurable (was fixed at 60s)
- Manual `/tick` trigger remains available
- Schedules execute within 1 tick interval (same as before)

---

## See Also

- **Troubleshooting:** `documentation/guides/scheduler-troubleshooting.md`
- **MCP Context:** `context://scheduler/guide` (available in MCP tools)
- **Event Schema:** `context://schema/internal-event-v2`
- **Service Implementation:** `src/apps/scheduler-service.ts`
- **Tests:** `src/apps/scheduler-service.test.ts`
- **Sprint Documentation:** `planning/sprint-369-scheduler-redesign/`

---

**Platform-Agnostic Design:** This scheduler works identically on Docker, GCP Cloud Run, AWS ECS, Azure Container Instances, and self-hosted environments. Zero external dependencies beyond PostgreSQL and NATS.

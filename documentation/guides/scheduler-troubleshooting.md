# Scheduler Service Troubleshooting Guide

**Diagnosing and resolving common scheduler issues.**

This guide helps you diagnose and fix common problems with the scheduler service (Sprint 369).

---

## Quick Diagnostic Checklist

Before deep troubleshooting, run through this checklist:

- [ ] Scheduler service is running (`docker ps | grep scheduler` or `kubectl get pods`)
- [ ] Schedule is enabled (`enabled: true`)
- [ ] `nextRun` is in the future (check with `get_schedule`)
- [ ] Message bus (NATS/Pub/Sub) is operational
- [ ] PostgreSQL database is accessible
- [ ] `SCHEDULER_TICK_INTERVAL_MS` is valid (1000-3600000)
- [ ] Logs show periodic `scheduler.tick.started` events

---

## Common Issues

### Schedule Not Executing

**Symptoms:**
- Schedule `nextRun` has passed but event not published
- No `scheduler.schedule.executed` log entries
- Schedule remains in database with old `lastRun`

**Diagnosis:**

1. **Check if schedule is enabled:**
```typescript
// Via MCP: get_schedule
{
  "id": "your-schedule-id"
}

// Look for:
"enabled": false  // ← Problem: disabled schedule
```

**Solution:** Enable the schedule:
```typescript
// Via MCP: update_schedule
{
  "id": "your-schedule-id",
  "enabled": true
}
```

2. **Check nextRun value:**
```typescript
// Via MCP: get_schedule response
{
  "nextRun": null  // ← Problem: no next run calculated
  // OR
  "nextRun": "2026-07-20T00:00:00Z"  // ← Problem: in the past
}
```

**Solution for `null nextRun`:**
- **Once schedule:** `value` is in the past - schedule will never execute
- **Cron schedule:** Invalid cron expression - check logs for `calculateNextRun.error`

**Solution for past `nextRun`:**
- Wait for next tick (within `SCHEDULER_TICK_INTERVAL_MS`)
- Or manually trigger: `POST /tick`

3. **Check scheduler service is running:**
```bash
# Docker
docker ps | grep scheduler

# Cloud Run
gcloud run services list | grep scheduler

# Kubernetes
kubectl get pods -l app=scheduler
```

**Solution:** Start the service:
```bash
# Docker Compose
docker compose up scheduler

# Cloud Run (redeploy)
npm run brat -- deploy service scheduler
```

4. **Check tick interval logs:**
```bash
# Look for periodic tick events in logs
docker logs scheduler 2>&1 | grep "scheduler.tick.started"

# Should see entries every SCHEDULER_TICK_INTERVAL_MS
```

**Solution if no ticks:**
- Service crashed - check `docker logs scheduler` for errors
- Invalid `SCHEDULER_TICK_INTERVAL_MS` - check startup logs
- Timer not starting - restart service

---

### Missed Schedules (Schedule Drift)

**Symptoms:**
- Schedule executes but timing is inconsistent
- Large gap between expected `nextRun` and actual `lastRun`
- Events published late

**Diagnosis:**

**1. Check tick interval:**
```yaml
# env/local/scheduler.yaml or env/staging/scheduler.yaml
SCHEDULER_TICK_INTERVAL_MS: "60000"  # 60 seconds
```

Schedules execute within 0-60 seconds of `nextRun` (default tick interval).

**2. Check system clock:**
```bash
# Verify server time is correct
date -u

# Check for clock skew
docker exec scheduler date -u
```

**3. Check service restart times:**
```bash
# Docker
docker inspect scheduler | grep StartedAt

# Logs
docker logs scheduler | grep "base_server.listening"
```

**Common Causes:**

| Cause | Symptom | Solution |
|-------|---------|----------|
| **Long tick interval** | Schedules late by up to interval | Reduce `SCHEDULER_TICK_INTERVAL_MS` (e.g., 10s for dev) |
| **Service downtime** | Schedules missed during outage | Manual `/tick` after restart |
| **Clock skew** | Inconsistent execution times | Synchronize server clocks (NTP) |
| **Heavy load** | Tick processing takes >interval | Reduce schedule count or increase resources |

**Solutions:**

**Reduce tick interval (local dev):**
```yaml
# env/local/scheduler.yaml
SCHEDULER_TICK_INTERVAL_MS: "10000"  # 10 seconds for better precision
```

**Catch up after downtime:**
```bash
# Manually trigger tick to execute overdue schedules
curl -X POST http://localhost:3000/tick
```

---

### Cron Schedule Stops Recurring

**Symptoms:**
- Cron schedule executes once then stops
- `enabled` changes to `false` after first execution
- `nextRun` becomes `null`

**Diagnosis:**

**1. Check if schedule type was changed:**
```typescript
// Via MCP: get_schedule
{
  "schedule": {
    "type": "once",  // ← Problem: was cron, now once
    "value": "0 9 * * *"
  }
}
```

**Solution:** Fix schedule type:
```typescript
// Via MCP: update_schedule
{
  "id": "your-schedule-id",
  "schedule": {
    "type": "cron",
    "value": "0 9 * * *"
  }
}
```

**2. Check for cron expression errors:**
```bash
# Look for calculateNextRun errors in logs
docker logs scheduler 2>&1 | grep "calculateNextRun.error"
```

**Common Cron Errors:**

| Error | Example | Problem | Fix |
|-------|---------|---------|-----|
| **Invalid syntax** | `9 * * *` | Missing field | Add 5th field: `0 9 * * *` |
| **Out of range** | `0 25 * * *` | Hour 25 invalid | Use 0-23: `0 9 * * *` |
| **Wrong order** | `* * * 9 *` | Fields swapped | Correct order: `0 9 * * *` |

**Solution:** Validate cron expression:
- Use [crontab.guru](https://crontab.guru/) to test
- Update with correct expression via `update_schedule`

---

### Events Not Being Delivered

**Symptoms:**
- Schedule executes (logs show `scheduler.schedule.executed`)
- Events published to message bus
- But recipient never receives message

**Diagnosis:**

**1. Check topic configuration:**
```typescript
// Via MCP: get_schedule
{
  "topic": "internal.wrong.topic.v1"  // ← Problem: incorrect topic
}
```

**Solution:** Use correct topic:
```typescript
// Via MCP: update_schedule
{
  "id": "your-schedule-id",
  "topic": "internal.ingress.v1"  // For event router processing
  // OR
  "topic": "internal.egress.v1"   // For direct delivery
}
```

**2. Check egress configuration:**
```typescript
// Via MCP: get_schedule event definition
{
  "event": {
    "egress": {
      "connector": "twitch",
      "destination": "twitch",
      "channel": "#wrongchannel"  // ← Problem: wrong channel
    }
  }
}
```

**Solution:** Fix egress target:
```typescript
// Via MCP: update_schedule
{
  "id": "your-schedule-id",
  "event": {
    "egress": {
      "connector": "twitch",
      "destination": "twitch",
      "channel": "#correct-channel"
    }
  }
}
```

**3. Check message bus connectivity:**
```bash
# NATS (local/dev)
docker logs nats 2>&1 | grep -i error

# Pub/Sub (GCP)
gcloud logging read "resource.type=pubsub_topic" --limit 50
```

**4. Trace event with correlation ID:**
```bash
# Find correlation ID from scheduler logs
docker logs scheduler 2>&1 | grep "scheduler.executing_event"

# Trace through system
docker logs ingress-egress 2>&1 | grep "correlation-id-here"
docker logs event-router 2>&1 | grep "correlation-id-here"
```

---

### Database Performance Issues

**Symptoms:**
- Slow tick execution (logs show high `durationMs`)
- Database CPU/memory spikes every tick interval
- `getDueSchedules` query takes >1 second

**Diagnosis:**

**1. Check index exists:**
```sql
-- Connect to PostgreSQL
psql $DATABASE_URL

-- Check for schedules index
\d schedules

-- Look for partial index on (enabled, nextRun)
```

**Solution:** Create missing index:
```sql
-- Run migration
-- File: infrastructure/postgres/migrations/015_add_schedules_due_index.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_schedules_due
  ON schedules ((data->>'enabled'), (data->>'nextRun'))
  WHERE (data->>'enabled')::boolean = true
    AND (data->>'nextRun') IS NOT NULL;
```

**2. Check schedule count:**
```sql
-- Count total schedules
SELECT COUNT(*) FROM schedules;

-- Count enabled schedules
SELECT COUNT(*) FROM schedules
WHERE (data->>'enabled')::boolean = true;

-- Count due schedules
SELECT COUNT(*) FROM schedules
WHERE (data->>'enabled')::boolean = true
  AND (data->>'nextRun')::timestamp <= NOW();
```

**Performance Guidelines:**

| Schedule Count | Expected Tick Duration | Recommendation |
|----------------|------------------------|----------------|
| <100 | <100ms | No action needed |
| 100-1,000 | 100ms-1s | Monitor, ensure index exists |
| 1,000-10,000 | 1s-10s | Consider partitioning or archiving old schedules |
| >10,000 | >10s | Increase tick interval, archive completed schedules |

**3. Analyze slow query:**
```sql
-- Enable query logging
SET log_statement = 'all';
SET log_min_duration_statement = 100;  -- Log queries >100ms

-- Run manual query
EXPLAIN ANALYZE
SELECT * FROM schedules
WHERE (data->>'enabled')::boolean = true
  AND (data->>'nextRun') IS NOT NULL
  AND (data->>'nextRun')::timestamp <= NOW()
ORDER BY (data->>'nextRun')::timestamp ASC;
```

**Solution if index not used:**
- Rebuild index: `REINDEX INDEX CONCURRENTLY idx_schedules_due;`
- Update statistics: `ANALYZE schedules;`
- Check PostgreSQL version supports JSONB indexes

---

### Configuration Errors

**Symptoms:**
- Scheduler service fails to start
- Error: `Invalid SCHEDULER_TICK_INTERVAL_MS`
- Service immediately exits after start

**Common Configuration Errors:**

| Error | Example | Problem | Fix |
|-------|---------|---------|-----|
| **Too low** | `SCHEDULER_TICK_INTERVAL_MS: "500"` | Below 1000ms minimum | Set to 1000 or higher |
| **Too high** | `SCHEDULER_TICK_INTERVAL_MS: "5000000"` | Above 3600000ms (1h) | Set to 3600000 or lower |
| **Not a number** | `SCHEDULER_TICK_INTERVAL_MS: "abc"` | Invalid integer | Use numeric string |
| **Missing** | (not set) | Uses default 60000 | Explicitly set if needed |

**Diagnosis:**
```bash
# Check startup logs for validation error
docker logs scheduler 2>&1 | grep "Invalid SCHEDULER_TICK_INTERVAL_MS"

# Check environment variable
docker exec scheduler printenv SCHEDULER_TICK_INTERVAL_MS
```

**Solution:**
```yaml
# env/local/scheduler.yaml (correct format)
SCHEDULER_TICK_INTERVAL_MS: "10000"  # String containing integer 1000-3600000
```

---

### Memory Leaks / Resource Exhaustion

**Symptoms:**
- Scheduler memory usage grows over time
- Service OOM killed
- Docker container restarts frequently

**Diagnosis:**

**1. Check for timer leaks:**
```bash
# Monitor memory usage over time
docker stats scheduler

# Look for steadily increasing memory
```

**2. Check shutdown hooks:**
```bash
# Verify clean shutdown
docker stop scheduler

# Check logs for cleanup
docker logs scheduler | grep "scheduler.ticker.stopped"
```

**Solution:**

**Proper shutdown:**
```bash
# Gracefully stop service (calls onShutdown hooks)
docker stop scheduler

# Verify timer was cleared
docker logs scheduler | tail -20 | grep "ticker.stopped"
```

**If memory still leaks:**
- Restart service periodically (workaround)
- File GitHub issue with memory profile
- Check for unclosed database connections

---

## Diagnostic Commands

### Check Service Health

```bash
# Service status
docker ps | grep scheduler

# Recent logs
docker logs scheduler --tail 50

# Follow logs in real-time
docker logs scheduler --follow

# Check for errors
docker logs scheduler 2>&1 | grep -i error

# Check for tick events
docker logs scheduler 2>&1 | grep "scheduler.tick"
```

### Manual Testing

```bash
# Trigger tick manually
curl -X POST http://localhost:3000/tick

# Check service health endpoint
curl http://localhost:3000/healthz

# Check readiness
curl http://localhost:3000/readyz
```

### Database Inspection

```sql
-- List all schedules
SELECT id, data->>'title', data->>'enabled', data->>'nextRun'
FROM schedules
ORDER BY (data->>'nextRun')::timestamp;

-- Find overdue schedules
SELECT id, data->>'title', data->>'nextRun'
FROM schedules
WHERE (data->>'enabled')::boolean = true
  AND (data->>'nextRun')::timestamp < NOW();

-- Check schedule by ID
SELECT data FROM schedules WHERE id = 'schedule-uuid-here';
```

---

## Log Analysis

### Important Log Events

| Log Event | Meaning | Frequency |
|-----------|---------|-----------|
| `scheduler.ticker.starting` | Ticker initialized | Once at startup |
| `scheduler.tick.started` | Tick cycle begins | Every TICK_INTERVAL_MS |
| `scheduler.tick.completed` | Tick cycle ends | Every TICK_INTERVAL_MS |
| `scheduler.schedule.executing` | Processing single schedule | Per due schedule |
| `scheduler.schedule.executed` | Schedule published successfully | Per due schedule |
| `scheduler.schedule.error` | Schedule execution failed | On errors |
| `scheduler.ticker.stopped` | Ticker cleaned up | Once at shutdown |

### Sample Log Analysis

**Healthy Operation:**
```json
{"level":"info","msg":"scheduler.ticker.starting","intervalMs":60000}
{"level":"info","msg":"scheduler.tick.started","count":5}
{"level":"debug","msg":"scheduler.schedule.executing","id":"abc123","type":"cron"}
{"level":"info","msg":"scheduler.schedule.executed","id":"abc123","nextRun":"2026-07-27T10:00:00Z"}
{"level":"info","msg":"scheduler.tick.completed","durationMs":245,"executedCount":5,"errorCount":0}
```

**Problem Indicators:**
```json
// High error count
{"level":"info","msg":"scheduler.tick.completed","errorCount":10}

// Long duration (>5 seconds for <100 schedules)
{"level":"info","msg":"scheduler.tick.completed","durationMs":12000}

// Calculate error
{"level":"error","msg":"scheduler.calculate_next_run.error","type":"cron","value":"invalid"}

// Publish error
{"level":"error","msg":"scheduler.schedule.error","error":"Publish failed"}
```

---

## Getting Help

If you've tried the troubleshooting steps above and still have issues:

1. **Gather diagnostic information:**
   - Scheduler logs (last 100 lines)
   - Schedule definition (`get_schedule` output)
   - Environment configuration (`SCHEDULER_TICK_INTERVAL_MS`, etc.)
   - Database query results (due schedules count)

2. **Check known issues:**
   - Review Sprint 369 documentation: `planning/sprint-369-scheduler-redesign/`
   - Search codebase for similar errors: `git log --grep="scheduler"`

3. **File an issue:**
   - Include all diagnostic information
   - Provide reproduction steps
   - Note your deployment environment (Docker, GCP, AWS, etc.)

---

## Prevention Best Practices

### Design Time

- **Use cron expressions correctly** - Validate at [crontab.guru](https://crontab.guru/)
- **Set reasonable tick intervals** - 60s for production, 10s for local dev
- **Limit active schedules** - Archive completed `once` schedules
- **Test before deploying** - Use `POST /tick` to test immediately

### Runtime

- **Monitor scheduler health** - Check logs for errors periodically
- **Set up alerts** - Alert on `errorCount > 0` or `durationMs > 5000`
- **Regular maintenance** - Delete old disabled schedules monthly
- **Graceful shutdowns** - Always use `docker stop` (not `kill`)

### Database

- **Ensure index exists** - Run migration 014 on all environments
- **Monitor query performance** - Track `getDueSchedules` duration
- **Archive old schedules** - Move completed schedules to archive table
- **Regular VACUUM** - Keep PostgreSQL statistics updated

---

## See Also

- **Usage Guide:** `documentation/guides/scheduler.md`
- **Service Implementation:** `src/apps/scheduler-service.ts`
- **Tests:** `src/apps/scheduler-service.test.ts`
- **Sprint Documentation:** `planning/sprint-369-scheduler-redesign/`
- **MCP Context:** `context://scheduler/guide`

---

**Remember:** The scheduler operates within 1 tick interval precision. If you need sub-second timing or hard real-time guarantees, consider alternative approaches or external scheduling infrastructure.

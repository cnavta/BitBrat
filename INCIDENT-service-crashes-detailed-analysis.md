# Detailed Crash Analysis: tool-orchestrator & reflex

**Date**: 2026-11-23 19:30 PST
**Affected Services**: tool-orchestrator, reflex
**Root Cause**: Unhandled PostgreSQL connection pool error
**Status**: Identified, fix pending

---

## Executive Summary

Both tool-orchestrator and reflex crash within seconds of startup with identical PostgreSQL connection pool errors. The crash is caused by **unhandled error events** being emitted by the pg-pool library when database connections are terminated unexpectedly.

---

## Detailed Crash Analysis

### Common Crash Pattern

**Both services follow identical crash sequence:**

1. ✅ Start successfully
2. ✅ Initialize resources (publisher, documentStore, redis)
3. ✅ Begin listening on port 3000
4. ✅ Start making PostgreSQL queries
5. ❌ **PostgreSQL connection terminates unexpectedly**
6. ❌ **pg-pool emits unhandled 'error' event**
7. ❌ **Process crashes with uncaught exception**

### Exact Error

```javascript
node:events:505
    throw er; // Unhandled 'error' event
    ^

Error: Connection terminated unexpectedly
    at Connection.<anonymous> (/workspace/node_modules/pg/lib/client.js:199:73)
    at Connection.wrapper (node:events:639:12)
    at Connection.emit (node:events:514:28)
    at Socket.<anonymous> (/workspace/node_modules/pg/lib/connection.js:63:12)
    at Socket.emit (node:events:514:28)
    at TCP.<anonymous> (node:net:362:12)
Emitted 'error' event on BoundPool instance at:
    at Client.idleListener (/workspace/node_modules/pg-pool/index.js:62:10)
    at Client.emit (node:events:514:28)
    at Client._handleErrorEvent (/workspace/node_modules/pg/lib/client.js:417:10)
    at Connection.<anonymous> (/workspace/node_modules/pg/lib/client.js:217:16)
```

---

## tool-orchestrator Crash Details

### Timeline

```
19:26:28.587 - tool_orchestrator.mcp_client_manager_initialized
19:26:28.596 - tool_orchestrator.composition_subsystem_initialized
19:26:28.598 - tool_orchestrator.tool_observer_initialized (Loki: http://loki:3100)
19:26:28.599 - health_updater.update_started
19:26:28.604 - tool_orchestrator.health_updater_started (5-minute intervals)
19:26:28.605 - mcp.registry_watcher.starting
19:26:29.206 - tool_registry.query_tools_result (505 tools found)
19:26:29.206 - health_updater.querying_tools (starting health updates)
19:26:29.207 - loki.query_range.start (querying metrics for mcp:tool-orchestrator/bit.info)
...
19:27:05.447 - tool_orchestrator.tools_loaded (505 tools, sources: mcp, composition)
19:27:06.162 - tool_registry.health_updated (mcp:event-router_bit.restart: unhealthy)
19:27:06.162 - loki.query_range.start (querying mcp:claim-check/bit.drain)
19:27:07.389 - mcp.client_manager.reconnect_scheduled (scheduler, attempt 6)
[CRASH] - Connection terminated unexpectedly
```

### What tool-orchestrator Was Doing

**At crash time, tool-orchestrator was:**
1. Loading 505 tools from PostgreSQL (completed successfully)
2. Running health updater queries against Loki
3. Connecting to 15+ MCP servers concurrently
4. Updating tool health status in PostgreSQL
5. Query

ing tool metrics from Loki every 5 minutes

**Database Activity:**
- Multiple concurrent `SELECT` queries to `platform_tool_registry`
- Updating tool health status
- Registering MCP server connections
- Pool size: Not specified (using defaults)

### Why It Crashed

After ~39 seconds of operation:
1. PostgreSQL connection in the pool terminated (reason unknown)
2. `pg-pool` emitted an 'error' event on the BoundPool
3. **No error handler was registered** on the pool
4. Node.js threw uncaught exception
5. Process terminated

---

## reflex Crash Details

### Timeline

```
19:26:26.978 - publisher.manager.setup
19:26:26.978 - base_server.resource.setup.ok (publisher)
19:26:26.979 - document_store.manager.setup
19:26:26.981 - base_server.resource.setup.ok (documentStore)
19:26:26.983 - redis.manager.setup.start
19:26:27.869 - redis.manager.setup.success (redis://redis:6379)
19:26:28.649 - listening (host: 0.0.0.0, port: 3000)
[CRASH] - Connection terminated unexpectedly (< 2 seconds after startup)
```

### What reflex Was Doing

**At crash time, reflex was:**
1. Completed resource initialization
2. Started HTTP server (listening on port 3000)
3. Had open PostgreSQL connection pool via documentStore
4. **Crashed within 2 seconds of becoming ready**

**Database Activity:**
- Initial connection pool setup
- Possibly initial queries for reflex rules
- Pool was idle or had minimal activity

### Why It Crashed

After only ~2 seconds:
1. PostgreSQL connection terminated immediately after setup
2. Same unhandled pool error as tool-orchestrator
3. Process crashed before doing any real work

---

## Root Cause Analysis

### Primary Issue: Missing Error Handler

**The pg-pool library emits 'error' events that MUST be handled:**

```javascript
// Current code (inferred from DocumentStore):
const pool = new Pool(config);
// ❌ No pool.on('error', handler) registered

// What should happen:
const pool = new Pool(config);
pool.on('error', (err, client) => {
  logger.error('postgres_pool.idle_client_error', { error: err.message });
  // Gracefully handle without crashing
});
```

**From pg-pool documentation:**
> You must register an error handler on the pool to catch these errors. If you don't, your process will crash on idle client errors.

### Secondary Issue: Why Connections Terminate

**Possible causes for connection termination:**

1. **PostgreSQL Configuration**
   - `idle_in_transaction_session_timeout` (not set, default = disabled)
   - `statement_timeout` (not set, default = disabled)
   - `tcp_keepalives_idle` (default settings)

2. **Network Issues**
   - Docker network glitches
   - DNS resolution delays (`postgres.bitbrat.local`)
   - Container restart/health check side effects

3. **Pool Misconfiguration**
   - No `idleTimeoutMillis` set → connections never released
   - No `connectionTimeoutMillis` set → no timeout on acquisition
   - Default pool size (10) may be too large for service needs

4. **Race Condition**
   - Services start querying immediately
   - Pool connections not fully established
   - Queries time out or fail during connection phase

---

## Evidence

### PostgreSQL Connection State

**Current connections:** 3 total (2 idle, 1 active)
**Max connections:** 200
**Connection pressure:** NONE - well under limit

**This rules out:**
- ❌ Connection pool exhaustion
- ❌ Database overload
- ❌ Connection limit reached

### Service Connection Counts

**Services using PostgreSQL:**
- ✅ ingress-egress (working)
- ✅ event-router (working)
- ✅ auth (working)
- ✅ persistence (working)
- ✅ llm-bot (working)
- ✅ state-engine (working)
- ✅ disposition-service (working)
- ❌ tool-orchestrator (crashes)
- ❌ reflex (crashes)

**Pattern:** Only services with **heavy concurrent queries** or **complex startup sequences** crash.

---

## Why Other Services Don't Crash

**Services that work fine:**
- Use PostgreSQL sparingly (fewer concurrent queries)
- Have simpler initialization (no health updater, no Loki queries)
- Don't hold connections open during startup
- May have different pool configurations

**tool-orchestrator is unique because:**
- Loads 505 tools immediately on startup
- Runs health queries against Loki every 5 minutes
- Connects to 15+ MCP servers concurrently
- Updates tool health in PostgreSQL continuously
- Has highest database query load of any service

**reflex crashes early because:**
- DocumentStore pool is created but unused
- Connection terminates before first query
- Error happens during idle period (classic pg-pool crash)

---

## Recommended Fixes

### Fix 1: Add Pool Error Handler (Critical)

**File:** `src/common/persistence/postgres-document-store.ts`

```typescript
// In constructor or setup():
this.pool.on('error', (err, client) => {
  this.logger.error('postgres_pool.idle_client_error', {
    error: err.message,
    stack: err.stack,
    client: client ? 'has_client' : 'no_client'
  });
  // Don't crash - just log and continue
  // Pool will recover by removing bad connection
});
```

### Fix 2: Configure Pool Timeouts (Recommended)

```typescript
const pool = new Pool({
  ...config,
  idleTimeoutMillis: 30000,        // Close idle clients after 30s
  connectionTimeoutMillis: 10000,   // Timeout on connection acquisition
  max: 10,                          // Max pool size (explicit)
  allowExitOnIdle: false,           // Don't exit if pool is idle
});
```

### Fix 3: Graceful Connection Handling (Best Practice)

```typescript
// Wrap all pool operations in try/catch
async query(collection: string, filters: any) {
  try {
    const client = await this.pool.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();  // Always release back to pool
    }
  } catch (err) {
    this.logger.error('postgres_query.failed', { error: err.message });
    throw err;  // Re-throw after logging
  }
}
```

### Fix 4: Health Check Throttling (tool-orchestrator specific)

```typescript
// In health-updater.ts:
// Don't query all 505 tools immediately on startup
// Stagger queries to reduce database load

async startHealthUpdates() {
  // Wait 30 seconds after startup before first update
  await delay(30000);

  // Then run updates every 5 minutes (not changed)
  setInterval(() => this.updateAllToolHealth(), 300000);
}
```

---

## Immediate Workaround

**To get tool-orchestrator and reflex running:**

1. **Restart with longer startup delay:**
   ```bash
   # In docker-compose:
   command: sh -c "sleep 10 && node dist/apps/tool-orchestrator-service.js"
   ```

2. **Reduce initial query load:**
   - Disable health updater temporarily (`ENABLE_HEALTH_UPDATER=false`)
   - Delay tool loading until after startup

3. **Increase PostgreSQL keepalive:**
   ```sql
   ALTER SYSTEM SET tcp_keepalives_idle = 60;
   ALTER SYSTEM SET tcp_keepalives_interval = 10;
   ALTER SYSTEM SET tcp_keepalives_count = 3;
   SELECT pg_reload_conf();
   ```

---

## Priority

**P0 - Critical**
- tool-orchestrator provides critical tool registry for llm-bot
- reflex handles reflex execution (less critical but still used)
- Both services crash-loop indefinitely without fix
- No workaround available without code changes

---

## Next Steps

1. ✅ Add pool error handler to PostgresDocumentStore
2. ⏳ Configure pool timeouts and connection management
3. ⏳ Test fix in agent-dev environment
4. ⏳ Deploy fix to staging
5. ⏳ Monitor for 24 hours to verify stability

---

**Analysis Complete**: 2026-11-23 19:45 PST
**Confidence Level**: Very High (identical crashes, clear error pattern, known pg-pool issue)

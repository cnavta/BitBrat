# Event-Router Rule Matching: Query Flow and Enabled Check Analysis

## Overview

This document traces how the event-router service queries routing rules from the database and explains why rule matching can fail even when `"enabled": true` is set in the database.

## 1. Where Event-Router Queries Routing Rules

### Query Initialization

**File**: `src/apps/event-router-service.ts` (lines 82-86)
```typescript
const documentStore = this.getResource('documentStore');
const db = this.getResource<Firestore>('firestore');
const dbOrStore = documentStore || db;
const ruleLoader = createRuleLoader(dbOrStore);
```

The event-router automatically selects between:
- **PostgreSQL backend** (via `documentStore`) - Primary
- **Firestore backend** (via `db`) - Legacy fallback

### Rule Loader Factory

**File**: `src/services/router/rule-loader.ts` (lines 371-394)
```typescript
export function createRuleLoader(
  dbOrStore?: any,
  collectionOrTable?: string,
  refreshIntervalMs = 60000
): FirestoreRuleLoader | DocumentStoreRuleLoader {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreRuleLoader(collectionOrTable || 'configs/routingRules/rules');
  }

  // Check if IDocumentStore (has get/set/query methods)
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreRuleLoader(collectionOrTable || 'routing_rules', refreshIntervalMs);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    return new DocumentStoreRuleLoader(collectionOrTable || 'routing_rules', refreshIntervalMs);
  }

  // Fallback to Firestore (legacy)
  return new FirestoreRuleLoader(collectionOrTable || 'configs/routingRules/rules');
}
```

## 2. How Rules Are Loaded: Two Backends

### PostgreSQL (Primary) - DocumentStoreRuleLoader

**File**: `src/services/router/rule-loader.ts` (lines 277-358)

#### Initialization
```typescript
async start(store: any) {
  this.store = store;

  // Warm load
  try {
    await this.refresh();
    logger.debug('rule_loader.warm_loaded', { count: this.cache.length, backend: 'postgres' });
  } catch (e: any) {
    logger.error('rule_loader.warm_load_error', { error: e?.message || String(e), backend: 'postgres' });
  }

  // Start polling for updates (every 60 seconds by default)
  if (this.refreshIntervalMs > 0) {
    this.pollInterval = setInterval(async () => {
      try {
        await this.refresh();
        logger.debug('rule_loader.poll_refreshed', { count: this.cache.length, backend: 'postgres' });
      } catch (e: any) {
        logger.error('rule_loader.poll_error', { error: e?.message || String(e), backend: 'postgres' });
      }
    }, this.refreshIntervalMs);
  }
}
```

#### Database Query
```typescript
async refresh(): Promise<void> {
  try {
    // Query all enabled documents from the table
    // We filter for enabled=true at the query level for efficiency
    const results = await this.store.query(this.tableName, {
      filters: [
        { field: 'enabled', operator: '==', value: true }
      ]
    });

    const rules: RuleDoc[] = [];
    for (const row of results) {
      const rule = validateRule(row, row.id || '');
      if (rule) {
        rules.push(rule);
      }
    }

    this.cache = sortRules(rules);
  } catch (e: any) {
    logger.error('rule_loader.refresh_error', { error: e?.message || String(e) });
    throw e;
  }
}
```

**Key points:**
- Queries at database level: `WHERE enabled = true`
- Polls every 60 seconds (configurable via `refreshIntervalMs`)
- **Cache update frequency**: 60 second lag between database change and router awareness

### Firestore (Legacy) - FirestoreRuleLoader

**File**: `src/services/router/rule-loader.ts` (lines 195-271)

```typescript
async start(db: any) {
  const path = normalize(this.collectionPath);
  const col = db.collection(path);
  
  // Warm load
  try {
    const snap = await col.get();
    this.refreshFromSnapshot(snap);
    logger.debug('rule_loader.warm_loaded', { count: this.cache.length });
  } catch (e: any) {
    logger.error('rule_loader.warm_load_error', { error: e?.message || String(e) });
  }
  
  // Real-time subscribe for updates
  try {
    this.unsub = col.onSnapshot((snap: any) => {
      try {
        this.refreshFromSnapshot(snap);
        logger.debug('rule_loader.snapshot_applied', { count: this.cache.length });
      } catch (e: any) {
        logger.error('rule_loader.snapshot_error', { error: e?.message || String(e) });
      }
    });
  } catch (e: any) {
    logger.error('rule_loader.subscribe_error', { error: e?.message || String(e) });
  }
}

private refreshFromSnapshot(snap: any) {
  const next: RuleDoc[] = [];
  const docs: any[] = Array.isArray(snap?.docs) ? snap.docs : [];
  for (const d of docs) {
    const id = String(d?.id || '');
    const data = typeof d?.data === 'function' ? d.data() : undefined;
    const rule = validateRule(data, id);
    if (rule) next.push(rule);
    else if (data && data.enabled !== false) {
      logger.warn('rule_loader.invalid_doc', { id });
    }
  }
  this.cache = sortRules(next);
}
```

**Key points:**
- No database-level filtering; Firestore returns all documents
- Real-time updates via `onSnapshot` (reactive)
- Validates each document client-side

## 3. How Event-Router Checks If a Rule Is "Enabled"

### The Critical Enabled Check

**File**: `src/services/router/rule-loader.ts` (lines 135-182)

```typescript
function validateRule(raw: any, id: string): RuleDoc | null {
  if (!isObject(raw)) return null;
  
  // CRITICAL: Only cache rules where enabled === true (strict equality)
  if (raw.enabled !== true) return null;
  
  const priority = raw.priority;
  if (typeof priority !== 'number' || Number.isNaN(priority)) return null;
  
  // ... rest of validation
  
  return {
    id,
    enabled: true,  // Returned rule always has enabled: true
    priority,
    // ... other fields
  };
}
```

### Strict Equality Check

The function uses **strict equality** (`!==` not `!=`):
```typescript
if (raw.enabled !== true) return null;
```

This means:
- ✅ `enabled: true` → ACCEPTED
- ❌ `enabled: "true"` → REJECTED (string, not boolean)
- ❌ `enabled: 1` → REJECTED (number, not boolean)
- ❌ `enabled: false` → REJECTED
- ❌ `enabled: null` → REJECTED
- ❌ `enabled: undefined` → REJECTED (missing field)

### Rule Caching

**File**: `src/services/router/rule-loader.ts` (lines 184-189)

```typescript
function sortRules(rules: RuleDoc[]): RuleDoc[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority; // ascending
    return a.id.localeCompare(b.id);
  });
}
```

Rules are:
1. Filtered (only `enabled === true` allowed)
2. Sorted by priority ascending, then by ID
3. Cached in memory: `this.cache = sortRules(next);`

## 4. Rule Evaluation During Routing

### Getting Rules for Evaluation

**File**: `src/apps/event-router-service.ts` (lines 113-125)

```typescript
await this.onMessage<InternalEventV2>(
  { destination: inputTopic, queue: 'event-router', ack: 'explicit' },
  async (v2In: InternalEventV2, _attributes: AttributeMap, ctx) => {
    try {
      const tracer = (this as any).getTracer?.();
      const run = async () => {
        // Route using rules (first-match-wins, default path)
        const { slip, decision, evtOut } = await engine.route(v2In, ruleLoader.getRules(), this.getConfig());
        // ...
      };
    }
  }
);
```

**File**: `src/services/router/rule-loader.ts` (lines 201-202)

```typescript
getRules(): ReadonlyArray<RuleDoc> {
  return this.cache;  // Returns in-memory cache (already filtered)
}
```

### Rule Matching Process

**File**: `src/services/routing/router-engine.ts` (lines 70-199)

```typescript
async route(evt: InternalEventV2, rules: ReadonlyArray<RuleDoc> = [], config?: IConfig): Promise<RouteResult> {
  // Build evaluation context from event
  const ctx = this.evaluator.buildContext(evt, undefined, undefined, config);

  // ... create output event copy

  let chosen: RoutingStep[] | null = null;
  let meta: RoutingDecisionMeta | null = null;
  const matchedRuleIds: string[] = [];

  // First-match-wins: iterate rules in order (already sorted by priority asc)
  for (const rule of rules) {
    try {
      const ok = this.evaluator.evaluate(rule.logic, ctx);  // Evaluate JsonLogic
      if (ok) {
        matchedRuleIds.push(rule.id);

        if (!chosen) {
          // ... apply routing slip, enrichments, etc.
          chosen = normalizeSlip(rule.routing.slip);
          meta = { matched: true, ruleId: rule.id, priority: rule.priority, selectedTopic, matchedRuleIds };
          // ... SHORT-CIRCUIT: stop checking remaining rules
          break;  // Implicit (don't continue loop)
        }
      }
    } catch (e: any) {
      logger.error('router_engine.enrichment_error', { id: rule.id, error: e?.message });
    }
  }

  if (!chosen) {
    chosen = defaultSlip();  // Default route to DLQ if no rule matches
    meta = { matched: false, selectedTopic: chosen[0].nextTopic!, matchedRuleIds };
  }

  return { slip: chosen, decision: meta!, evtOut };
}
```

**Logic evaluation**: `src/services/router/jsonlogic-evaluator.ts` (lines 98-121)

```typescript
export function evaluate(logic: unknown, context: EvalContext): boolean {
  try {
    let expr: any = null;
    if (typeof logic === 'string') {
      try {
        expr = JSON.parse(logic);  // Parse if stored as JSON string
      } catch {
        return false;  // Invalid JSON → rule does not match
      }
    } else if (logic && typeof logic === 'object') {
      expr = logic as any;
    } else {
      return false;
    }

    registerOperatorsOnce();
    const result = jsonLogic.apply(expr, context);  // Apply JsonLogic library
    return result === true || result === 1;  // Strict boolean check
  } catch {
    return false;  // Any error in evaluation → rule does not match
  }
}
```

## 5. Why Rule Matching Fails: Common Causes

### Cause 1: Wrong Data Type for `enabled`

**Scenario**: Database has `enabled: "true"` (string) instead of `true` (boolean)

**What happens**:
```typescript
if (raw.enabled !== true) return null;  // "true" !== true → rule REJECTED
```

**Result**: Rule never reaches evaluation; cached rules are empty

**Solution**: Ensure database stores boolean `true`, not string `"true"`

### Cause 2: Missing `enabled` Field

**Scenario**: Database record has no `enabled` field

**What happens**:
```typescript
if (raw.enabled !== true) return null;  // undefined !== true → rule REJECTED
```

**Result**: Rule not cached; routing defaults to DLQ

### Cause 3: PostgreSQL Polling Lag (60-Second Delay)

**Scenario**: You update a rule in PostgreSQL, then immediately send an event

**What happens**:
1. Event arrives at event-router
2. Event-router uses in-memory cache (last polled 30 seconds ago)
3. Next poll happens in 30 more seconds
4. Rule update hasn't reached the cache yet

**Result**: Rule doesn't match even though database is correct

**Solution**: Wait up to 60 seconds, or manually trigger refresh via MCP tools

### Cause 4: Invalid JsonLogic Expression

**Scenario**: Rule has `"logic": "invalid json"` or malformed JsonLogic

**What happens**:
```typescript
expr = JSON.parse(logic);  // Throws or returns invalid expression
// Falls through to: return false;
```

**Result**: Rule is cached but never matches events

**Debug**: Check logs for `router_engine.enrichment_error` or evaluation failures

### Cause 5: Invalid Priority (Not a Number)

**Scenario**: Rule has `"priority": "high"` instead of `"priority": 10`

**What happens**:
```typescript
const priority = raw.priority;
if (typeof priority !== 'number' || Number.isNaN(priority)) return null;
```

**Result**: Rule rejected during validation; not cached

### Cause 6: Invalid Routing Configuration

**Scenario**: Rule has no `routing` field or `routing.slip` is not an array

**What happens**:
```typescript
const rawRouting = isObject(raw.routing) ? raw.routing : null;
if (!rawRouting || typeof rawRouting.stage !== 'string' || !Array.isArray(rawRouting.slip)) return null;
```

**Result**: Rule rejected; not cached

### Cause 7: Firestore Collection Path Mismatch

**Scenario**: You're querying from the wrong Firestore collection path

**Default paths**:
- Event-router: `configs/routingRules/rules`
- Admin tool: checks same path

**What happens**: Rules exist in database but loader queries wrong collection

**Result**: Cache empty; no rules match

## 6. Debugging Checklist

### Step 1: Verify Backend

```bash
# Check which persistence driver is active
npm run brat -- config show | grep PERSISTENCE_DRIVER

# PostgreSQL = primary, Firestore = legacy
```

### Step 2: Check Rule Data Type

```bash
# For PostgreSQL
SELECT id, enabled, priority, description FROM routing_rules LIMIT 5;
# Verify `enabled` column is boolean (true/false), not string ("true"/"false")

# For Firestore
npm run brat -- fleet info event-router | grep -A 20 "rules"
```

### Step 3: Verify Rule Is Cached

```bash
# Use MCP tool to list active rules
npm run brat -- code  # Start coding agent
# Then in your agent: run_tool("event-router:list_rules")
# Should see all enabled rules with correct priority

# Verify via debug endpoint
curl http://localhost:3000/_debug/counters  # Check router.rules.matched counter
```

### Step 4: Check JsonLogic Expression

```bash
# Retrieve full rule
npm run brat -- code
# run_tool("event-router:get_rule", { id: "your-rule-id" })

# Verify logic is valid JSON:
# If logic is a string, it must be JSON-parseable
# If it's an object, it must be valid JsonLogic syntax
```

### Step 5: Monitor Cache Refresh

```bash
# Watch event-router logs
npm run local:logs | grep "rule_loader"

# For PostgreSQL, should see:
# rule_loader.warm_loaded
# rule_loader.poll_refreshed (every 60 seconds)

# For Firestore, should see:
# rule_loader.warm_loaded
# rule_loader.snapshot_applied (real-time)
```

### Step 6: Trace Rule Evaluation

```bash
# Enable debug logging on event-router
npm run brat -- fleet log event-router --level debug

# Send test event and watch logs for:
# "router.decision" → shows matched/unmatched decision
# "router_engine.enrichment_error" → evaluation failed
```

## 7. Summary Table: Rule Rejection Reasons

| Condition | Check | Result | Log Message |
|-----------|-------|--------|------------|
| `enabled !== true` | `validateRule()` | REJECTED | (none - silent) |
| `priority` not a number | `validateRule()` | REJECTED | (none - silent) |
| `priority` is NaN | `validateRule()` | REJECTED | (none - silent) |
| `routing` missing or invalid | `validateRule()` | REJECTED | (none - silent) |
| `routing.slip` not an array | `validateRule()` | REJECTED | (none - silent) |
| `logic` invalid JSON | `evaluate()` | NO MATCH | (none - silent) |
| `logic` throws in evaluator | `evaluate()` | NO MATCH | `router_engine.enrichment_error` |
| PostgreSQL query filter fails | `refresh()` | NO RULES | `rule_loader.refresh_error` |
| Firestore snapshot error | `refreshFromSnapshot()` | NO UPDATE | `rule_loader.snapshot_error` |

## 8. File References

| File | Purpose | Key Function |
|------|---------|---------------|
| `src/apps/event-router-service.ts` | Service entry point | Initializes rule loader, subscribes to topics |
| `src/services/router/rule-loader.ts` | Rule loading & caching | `validateRule()`, `getRules()` |
| `src/services/routing/router-engine.ts` | Rule evaluation & routing | `route()`, `evaluator.evaluate()` |
| `src/services/router/jsonlogic-evaluator.ts` | JsonLogic evaluation | `evaluate()`, custom operators |

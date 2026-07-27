# Event-Router Rule Matching Analysis - Complete Index

Complete analysis of how the event-router service queries routing rules from the database and evaluates them for matching.

## Documents

### 1. Comprehensive Technical Analysis
**File**: `/planning/event-router-rule-matching-analysis.md` (15 KB)

Deep dive into the entire rule matching flow with code excerpts. Contains:
- Query initialization and backend selection
- PostgreSQL vs Firestore loading mechanisms
- Strict enabled field validation
- Rule caching and sorting
- Rule evaluation during routing
- 7 common failure modes with explanations
- 6-step debugging checklist
- Summary table of rejection reasons
- Full file references

**Best for**: Understanding the complete architecture and troubleshooting complex issues.

### 2. Quick Reference Guide
**File**: `/planning/event-router-quick-reference.md` (8.9 KB)

Practical reference guide for common tasks. Contains:
- TL;DR summary
- Key files and what they do
- 3 most common issues with solutions
- Complete validation rules checklist
- Available evaluation context paths
- All custom JsonLogic operators
- Rule testing procedures
- Common mistakes table
- PostgreSQL polling timing diagram
- Logging patterns to watch

**Best for**: Quick lookups, debugging in production, testing rules.

## Key Findings Summary

### Question 1: Where Does Event-Router Query Rules?

- **Initialization**: `src/apps/event-router-service.ts` lines 82-86
- **PostgreSQL Backend** (primary):
  - Query: `SELECT * FROM routing_rules WHERE enabled = true`
  - Polls every 60 seconds
  - Database-level filtering for efficiency
  - Cached in memory
  
- **Firestore Backend** (legacy):
  - Returns all documents from `configs/routingRules/rules`
  - Real-time `onSnapshot` subscription
  - Client-side filtering via `validateRule()`

### Question 2: How Does It Check if Rule is "Enabled"?

**File**: `src/services/router/rule-loader.ts` line 137
```typescript
if (raw.enabled !== true) return null;
```

Uses **strict equality** (`!==`):
- `enabled: true` → ACCEPTED
- `enabled: "true"` → REJECTED (string)
- `enabled: 1` → REJECTED (number)
- `enabled: undefined` → REJECTED (missing)

**No exceptions**: Invalid rules silently rejected from cache without error log.

### Question 3: Why Would Matching Fail With `"enabled": true`?

**7 Common Causes**:

1. **Type mismatch**: `enabled: "true"` (string, not boolean)
2. **Missing field**: No `enabled` field in database
3. **PostgreSQL lag**: 60-second polling delay between DB update and cache refresh
4. **Bad JsonLogic**: Invalid expression syntax in logic field
5. **Invalid priority**: `priority: "10"` (string, not number)
6. **Invalid routing**: Missing or malformed routing object
7. **Wrong path**: Firestore querying wrong collection

**Most Common**: PostgreSQL polling lag (cause #3)

## Critical Rules

### Rule Validation (All Must Pass)

- `enabled === true` (boolean, strict equality)
- `priority` is a number
- `priority` is not NaN
- `routing.stage` is a string
- `routing.slip` is a non-empty array
- Each slip step has `id` and `nextTopic` strings
- `logic` is a non-empty string (JSON-parseable) OR object

If ANY check fails → rule is silently rejected.

### Rule Evaluation

- Rules sorted by priority ascending, then ID ascending
- First rule whose logic evaluates to `true` is used (first-match-wins)
- Remaining rules skipped (short-circuit)
- If no match → event routes to DLQ (`INTERNAL_ROUTER_DLQ_V1`)

### PostgreSQL Polling Timing

```
T=0s:   Update database
T=0-60s: Events use stale cache
T=60s:  Polling updates cache
T=60+s: Events use updated cache
```

Solution: Wait 60s or restart service after updating rules.

## Debugging Checklist

1. **List cached rules** (should not be empty):
   ```bash
   npm run brat -- code
   # run_tool("event-router:list_rules")
   ```

2. **Check database** (verify enabled is boolean, not string):
   ```bash
   psql -d bitbrat -c "SELECT id, enabled, priority FROM routing_rules;"
   ```

3. **Get full rule** (check logic field):
   ```bash
   # run_tool("event-router:get_rule", { id: "rule_id" })
   ```

4. **Enable debug** (watch routing decision):
   ```bash
   npm run brat -- fleet log event-router --level debug
   # Send test event
   # Look for "router.decision" in logs
   ```

5. **Check PostgreSQL lag** (only applies to PostgreSQL backend):
   - Wait 60 seconds after updating rule
   - OR restart service

6. **Validate JsonLogic** (use http://jsonlogic.com):
   - Copy logic field from rule
   - Validate syntax

## File References

### Core Service Files

| File | Purpose |
|------|---------|
| `src/apps/event-router-service.ts` | Service entry point, message subscription |
| `src/services/router/rule-loader.ts` | Rule loading, validation, caching |
| `src/services/routing/router-engine.ts` | Rule evaluation, routing decision |
| `src/services/router/jsonlogic-evaluator.ts` | JsonLogic evaluation, custom operators |

### Related Files

| File | Purpose |
|------|---------|
| `src/types/events.ts` | Event type definitions |
| `src/common/logging.ts` | Structured logging |
| `src/services/router/__tests__/rule-loader.test.ts` | Rule loader tests |
| `src/services/routing/__tests__/router-engine.test.ts` | Router engine tests |

## Context Paths for JsonLogic

Available in rule `logic` field:

- `type` - Event type (e.g., "chat.message.v1")
- `identity.*` - User identity
- `annotations[]` - Annotations array
- `candidates[]` - Candidates array
- `message.*` - Message object
- `payload.*` - Platform payload
- `routingSlip[]` - Routing slip steps
- `egress.*` - Egress info
- `now` - ISO8601 timestamp
- `ts` - Epoch milliseconds

Legacy paths (backward compat):
- `source`, `channel`, `userId`, `user`, `auth`

## Custom JsonLogic Operators

Available in rule `logic` field:

- `ci_eq(a, b)` - Case-insensitive equality
- `re_test(value, pattern[, flags])` - Regex test
- `slip_complete(routingSlip)` - Check if routing complete
- `has_role(roles[], role[, ci])` - Role membership
- `has_annotation(annotations[], key[, value])` - Annotation check
- `has_candidate(candidates[])` - Candidate presence
- `text_contains(value, needle[, ci])` - Substring search

## Examples

### Valid Rule (PostgreSQL)

```sql
INSERT INTO routing_rules (id, enabled, priority, description, logic, routing, enrichments)
VALUES (
  'rule_greeting',
  true,                          -- boolean, not "true"
  10,                            -- number, not "10"
  'Route greeting messages',
  '{"re_test": [{"var": "message.text"}, "^(hi|hello|hey)"]}',
  '{
    "stage": "analysis",
    "slip": [
      {
        "id": "route_step_1",
        "nextTopic": "internal.analysis.v1"
      }
    ]
  }',
  '{}'
);
```

### Valid Rule (Firestore)

```javascript
db.collection('configs/routingRules/rules').add({
  enabled: true,                  // boolean
  priority: 10,                   // number
  description: 'Route greeting messages',
  logic: '{"re_test": [{"var": "message.text"}, "^(hi|hello|hey)"]}',
  routing: {
    stage: 'analysis',
    slip: [
      {
        id: 'route_step_1',
        nextTopic: 'internal.analysis.v1'
      }
    ]
  },
  enrichments: {}
});
```

## Logging Patterns

Watch these logs for debugging:

- `rule_loader.warm_loaded` - Initial cache loaded
- `rule_loader.poll_refreshed` - PostgreSQL poll updated (every 60s)
- `rule_loader.invalid_doc` - Rule failed validation
- `rule_loader.refresh_error` - Query failed
- `router.decision` - Rule matching decision (matched=true/false)
- `router_engine.enrichment_error` - Logic evaluation threw error

## Performance Characteristics

- **PostgreSQL**: 60-second polling lag, database-level filtering
- **Firestore**: Real-time updates via onSnapshot, client-side filtering
- **Cache**: In-memory, not persisted
- **Evaluation**: First-match-wins, short-circuit on first match
- **Default route**: DLQ if no rule matches

## Version Information

- Analysis created: 2026-07-26
- Platform: BitBrat (Event-driven LLM orchestration)
- Backend: PostgreSQL (primary), Firestore (legacy)
- Messaging: NATS (local), Cloud Pub/Sub (production)

## See Also

- Full architectural overview: `CLAUDE.md` (see "Common Development Patterns")
- Event flow: `documentation/concepts/platform-flow.md`
- Bit model: `documentation/concepts/bit-model.md`
- Routing concepts: `documentation/concepts/agent-flow-stages.md`

---

**Status**: Complete  
**Last Updated**: 2026-07-26  
**Maintainer**: Claude Code  
**Questions Addressed**: 3/3

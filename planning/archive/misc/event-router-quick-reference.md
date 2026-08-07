# Event-Router Rule Matching: Quick Reference Guide

## TL;DR

The event-router doesn't fail silently - it's precise:

1. **Only rules with `enabled === true` (boolean, not string) are cached**
2. **PostgreSQL rules are polled every 60 seconds** (not real-time like Firestore)
3. **Invalid rules are silently rejected** (no log unless enabled field is present and not false)
4. **First rule to match wins** (priority ascending, then ID ascending)
5. **If no rule matches, event goes to DLQ** (`INTERNAL_ROUTER_DLQ_V1`)

## Key Files

| File | What It Does |
|------|--------------|
| `src/apps/event-router-service.ts` | Service startup & message subscription |
| `src/services/router/rule-loader.ts` | Database query + validation + caching |
| `src/services/routing/router-engine.ts` | Rule iteration + logic evaluation |
| `src/services/router/jsonlogic-evaluator.ts` | JsonLogic expression evaluation |

## Most Common Issues

### Issue 1: No Rules in Cache

**Symptom**: `list_rules` MCP tool returns empty array

**Causes** (in priority order):
1. `enabled` field is string `"true"` instead of boolean `true`
2. `enabled` field is missing entirely
3. PostgreSQL query failed (`rule_loader.refresh_error` in logs)
4. Wrong Firestore collection path (`configs/routingRules/rules` vs actual)
5. Service not started or crashing

**Debug**:
```bash
# Check database directly
psql -d bitbrat -c "SELECT id, enabled, priority FROM routing_rules;"
# Should show: id | enabled | priority
#             r1 | t       | 10
# NOT:        r1 | "true"  | 10

# Check cache in event-router
npm run brat -- fleet info event-router
```

### Issue 2: Rule Exists but Doesn't Match

**Symptom**: `list_rules` shows rule, but events still go to DLQ

**Causes**:
1. JsonLogic expression syntax error
2. JsonLogic references wrong context path
3. Custom operator name typo (ci_eq, re_test, etc.)
4. PostgreSQL cache hasn't updated yet (60-second lag)
5. Rule logic evaluates to false for your event data

**Debug**:
```bash
# Get the rule and check logic syntax
npm run brat -- code
# run_tool("event-router:get_rule", { id: "rule_123" })
# Copy the logic JSON and validate it

# Enable debug logging
npm run brat -- fleet log event-router --level debug
# Send test event
# Watch for "router.decision" log entry

# Check custom operators are registered
# In jsonlogic-evaluator.ts: ci_eq, re_test, slip_complete, has_role, has_annotation, has_candidate, text_contains
```

### Issue 3: Rule Works Sometimes, Not Always (PostgreSQL Only)

**Symptom**: Rule matching works 60-90 seconds after updating, then works consistently

**Cause**: PostgreSQL polls every 60 seconds, not real-time

**Fix**:
- Firestore: Updates are real-time
- PostgreSQL: Wait 60 seconds after creating/updating rule before testing
- OR: Restart event-router service to force immediate refresh

## Validation Rules (Strict)

For a rule to be cached, ALL of these must be true:

```javascript
rule.enabled === true                              // Exact boolean true
typeof rule.priority === 'number'                  // Not string, not NaN
!Number.isNaN(rule.priority)                       // Not NaN
typeof rule.routing.stage === 'string'             // stage must exist
Array.isArray(rule.routing.slip)                   // slip must be array
rule.routing.slip.length > 0                       // slip must have items
rule.routing.slip.every(s => 
  typeof s.id === 'string' && 
  typeof s.nextTopic === 'string'
)                                                   // All slip steps valid
typeof rule.logic === 'string' && rule.logic.trim() !== ''  // Logic is non-empty string
// OR
typeof rule.logic === 'object'                     // OR logic is object
```

If ANY check fails, the rule is **silently rejected** during validation.

## Evaluation Context Available to JsonLogic

When you write a rule's `logic` field, you can reference:

```javascript
// New paths (V2)
type                    // Event type (e.g., "chat.message.v1")
identity.*              // User identity object
annotations[]           // Array of annotations
candidates[]            // Array of candidates
message.*               // Message object (message.text, message.role)
payload.*               // Platform payload
routingSlip[]           // Current routing slip steps
egress.*                // Egress info
correlationId           // Request correlation ID

// Legacy paths (backward compat)
source                  // Maps to ingress.source
channel                 // Maps to ingress.channel
userId                  // Maps to identity.external.id
user                    // Maps to identity.user
auth                    // Maps to identity.auth

// Metadata
now                     // ISO8601 timestamp
ts                      // Epoch milliseconds
```

## Custom JsonLogic Operators

```javascript
// Case-insensitive string equality
ci_eq(a, b)

// Regex test (flags optional)
re_test(value, pattern[, flags])
re_test(value, [pattern, flags])

// Check if routing slip is complete
slip_complete(routingSlip)

// Check if user has role
has_role(roles[], role[, caseInsensitive])

// Check if annotation exists
has_annotation(annotations[], key[, value])
has_annotation(event, key[, value])

// Check if candidate exists
has_candidate(candidates[])
has_candidate(candidates[], provider)
has_candidate(event, provider)

// Substring search
text_contains(value, needle[, caseInsensitive])
```

## Rule Sorting & Priority

Rules are sorted **ascending by priority**, then **ascending by ID**:

```
Priority 1  ┐
Priority 1  ├─ Checked in order (first match wins)
Priority 2  │
Priority 10 ┘

Within same priority:
  rule_aaa (ID alphabetically first)
  rule_bbb
  rule_zzz (ID alphabetically last)
```

## Backend Selection Logic

Event-router auto-detects backend:

```
1. If documentStore available → PostgreSQL (polling every 60s)
2. Else if Firestore available → Firestore (real-time)
3. Else check PERSISTENCE_DRIVER env var
   - postgres/postgresql → PostgreSQL
   - (default) → Firestore
```

## Logging Patterns to Watch

| Log Pattern | Meaning | Severity |
|-------------|---------|----------|
| `rule_loader.warm_loaded` | Initial cache load successful | INFO |
| `rule_loader.poll_refreshed` | PostgreSQL poll updated cache | DEBUG |
| `rule_loader.snapshot_applied` | Firestore snapshot received | DEBUG |
| `rule_loader.invalid_doc` | Rule failed validation | WARN |
| `rule_loader.refresh_error` | Database query failed | ERROR |
| `rule_loader.subscribe_error` | Firestore subscription failed | ERROR |
| `router.decision` | Rule matching decision | DEBUG |
| `router_engine.enrichment_error` | Rule evaluation threw exception | ERROR |
| `router.rules.matched` | Counter increment | (counter) |
| `router.rules.defaulted` | Counter increment (no match) | (counter) |

## Testing a Rule

1. **Get list of rules**:
   ```bash
   npm run brat -- code
   # run_tool("event-router:list_rules")
   ```

2. **Get full rule details**:
   ```bash
   # run_tool("event-router:get_rule", { id: "rule_id" })
   ```

3. **Verify logic syntax**:
   ```bash
   # Copy "logic" field, check it's valid JSON if it's a string
   # Use JsonLogic reference: http://jsonlogic.com/
   ```

4. **Send test event**:
   ```bash
   npm run brat -- chat
   # Type message in chat
   # Watch event-router logs for "router.decision"
   ```

5. **Enable debug logging**:
   ```bash
   npm run brat -- fleet log event-router --level debug
   # Now re-test
   ```

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| `enabled: "true"` | String, not boolean | Use `true` without quotes |
| `priority: "10"` | String, not number | Use `10` without quotes |
| `logic: "{ \"==\" }"` | JSON parsing fails | Use JSON in double-quotes: `"{ \"==\": ... }"` |
| Missing `routing` | Validation fails | Add routing object with stage & slip |
| `routing.slip: []` | Empty slip array | Add at least one step to slip |
| Wrong context path | Evaluation fails silently | Use exact paths from list above |
| `if/then/else` | Not supported by JsonLogic | Use conditional operator: `{ "?": [cond, true_val, false_val] }` |
| Typo in operator | Evaluation fails | Check spelling: `ci_eq`, `re_test`, etc. |

## PostgreSQL Polling Timing

```
T=0s:   Rule created/updated in database
        └─ Not yet in event-router cache

T=0-60s: Event arrives at event-router
         └─ Uses stale cache (rule not there)
         └─ Event routes to DLQ

T=60s:  PostgreSQL poll runs
        └─ Fetches updated rules
        └─ Cache refreshed

T=60+s: Event arrives at event-router
        └─ Uses fresh cache (rule there)
        └─ Event routes correctly
```

**Solution**: After creating/updating a rule, wait 60 seconds or restart service.

## See Also

- Full analysis: `/planning/event-router-rule-matching-analysis.md`
- JsonLogic reference: http://jsonlogic.com/
- Rule examples: `/documentation/guides/routing-rules.md` (if exists)
- Custom operators: `src/services/router/jsonlogic-evaluator.ts`

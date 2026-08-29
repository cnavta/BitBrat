# MCP Token Security Fix

**Date**: 2026-08-28
**Sprint**: sprint-27-6tp11t
**Priority**: P0 (Critical Security Issue)
**Status**: ✅ Fixed, Tested, Awaiting Deployment

---

## Executive Summary

**Security Vulnerability**: Services were resolving `${MCP_AUTH_TOKEN}` environment variables at registration time and persisting actual token values in the `service_registry` database table, exposing secrets to anyone with database access.

**Fix**: Changed registration payload to send variable references (e.g., `Bearer ${MCP_AUTH_TOKEN}`) instead of resolved values. Tool-gateway's existing `client-manager.ts:resolveConfig()` method handles runtime resolution.

**Impact**: ALL services using MCP authentication (18+ services in staging/production)

---

## The Vulnerability

### Code Location
**File**: `src/common/base-server.ts:1973-1975` (before fix)

```typescript
env: process.env.MCP_AUTH_TOKEN ? {
  Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}`  // ❌ Resolves to actual token!
} : {},
```

### Database Exposure

**Before Fix** (`service_registry` table):
```json
{
  "name": "utility",
  "env": {
    "Authorization": "Bearer b581fac8-cbc5-4de6-bb89-edf4ea2a5b04"  // ❌ Actual token exposed!
  },
  "url": "http://utility.bitbrat.local:3020/sse"
}
```

**After Fix**:
```json
{
  "name": "utility",
  "env": {
    "Authorization": "Bearer ${MCP_AUTH_TOKEN}"  // ✅ Variable reference only
  },
  "url": "http://utility.bitbrat.local:3020/sse"
}
```

### Security Impact

1. **Database Compromise**: Anyone with read access to `service_registry` could extract MCP auth tokens
2. **Token Rotation Failure**: Rotating `MCP_AUTH_TOKEN` env var didn't update persisted DB values
3. **Audit Trail**: Tokens logged in database change history and backups
4. **Credential Exposure**: Tokens visible in Firestore/PostgreSQL admin consoles

---

## The Fix

### Code Changes

**File**: `src/common/base-server.ts:1973-1977`

```typescript
// Sprint 27: Send variable reference, not resolved value (security fix).
// Tool-gateway's client-manager.ts:resolveConfig() will interpolate at runtime.
env: process.env.MCP_AUTH_TOKEN ? {
  Authorization: 'Bearer ${MCP_AUTH_TOKEN}'  // ✅ Variable reference
} : {},
```

### Why This Works

Tool-gateway already has runtime resolution infrastructure:

**File**: `src/common/mcp/client-manager.ts:135-170`

```typescript
private resolveConfig(config: McpServerConfig): McpServerConfig {
  // ... existing code ...

  if (config.env && Object.keys(config.env).length > 0) {
    const r = interpolateEnvRecord(config.env, process.env);
    env = r.value;  // ✅ Resolves ${MCP_AUTH_TOKEN} here
    // ...
  }

  return { ...config, env, args };
}
```

When connecting to MCP servers (line 242):
```typescript
transport = new SSEClientTransport(new URL(config.url), {
  requestInit: {
    headers: resolved.env  // ✅ Uses resolved env with actual token
  }
});
```

**Key Insight**: The infrastructure for runtime variable resolution already existed! We just needed to stop resolving too early (at registration) and let the existing resolution happen at the right time (at connection).

---

## Testing

### Test File
**Created**: `src/common/__tests__/base-server-mcp-registration.test.ts`

### Test Results
```
PASS src/common/__tests__/base-server-mcp-registration.test.ts
  Bit MCP Registration - Variable Reference Preservation
    ✓ should send variable reference ${MCP_AUTH_TOKEN}, not resolved value
    ✓ should omit env when MCP_AUTH_TOKEN is not set
    ✓ should include other registration metadata correctly

Test Suites: 1 passed
Tests:       3 passed
```

### Critical Assertion
```typescript
// SECURITY CHECK: Should NOT contain actual token value
expect(payload.env.Authorization).toBe('Bearer ${MCP_AUTH_TOKEN}');
expect(payload.env.Authorization).not.toContain('test-secret-token-12345');
```

---

## Migration

### Migration Script
**File**: `planning/sprint-27-6tp11t/migrate-mcp-tokens.ts`

### Usage

**Step 1: Dry Run (Check What Will Change)**
```bash
npx ts-node planning/sprint-27-6tp11t/migrate-mcp-tokens.ts --context=staging
```

**Step 2: Apply Migration**
```bash
npx ts-node planning/sprint-27-6tp11t/migrate-mcp-tokens.ts --context=staging --live
```

### Migration Output Example
```
=== MCP Token Migration (staging) ===
Mode: DRY RUN (no changes)

Found 18 service registry entries

  🔒 utility: Found resolved token (b581fac8...)
     [DRY RUN] Would update to: Bearer ${MCP_AUTH_TOKEN}
  🔒 claim-check: Found resolved token (b581fac8...)
     [DRY RUN] Would update to: Bearer ${MCP_AUTH_TOKEN}
  ✓ tool-gateway: Already using variable reference

=== Migration Summary ===
Total entries: 18
Migrated: 15
Skipped: 3

⚠️  This was a DRY RUN. Run again with --live to apply changes.
```

---

## Deployment Steps

### Prerequisites
- [ ] Base-server fix deployed (prevents tokens from being re-resolved)
- [ ] All services restarted (to send variable references in new registrations)

### Deployment Order (IMPORTANT!)

**Step 1: Deploy Code Fix**
```bash
# Build with fix
npm run build

# Deploy tool-gateway first (has resolution logic)
npm run brat -- bit deploy tool-gateway --context staging

# Deploy all other services (will register with variable refs)
npm run brat -- bit deploy --all --context staging
```

**Step 2: Wait for Re-Registration**
Services auto-register on startup. Wait 30 seconds for all services to register.

**Step 3: Run Migration (Clean Up Old Entries)**
```bash
# Dry run first
npx ts-node planning/sprint-27-6tp11t/migrate-mcp-tokens.ts --context=staging

# If dry run looks good, apply
npx ts-node planning/sprint-27-6tp11t/migrate-mcp-tokens.ts --context=staging --live
```

**Step 4: Verify**
```bash
# Check database - should see variable references
npm run brat -- db:query service_registry --context staging | grep Authorization

# Expected: "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
# NOT: "Authorization": "Bearer b581fac8-cbc5-4de6-bb89-edf4ea2a5b04"
```

---

## Verification

### Pre-Deployment Check
```bash
# Check current DB state
curl -X POST http://localhost:5432/query -d '
SELECT name, env->>"Authorization" as auth
FROM service_registry
WHERE env->>\"Authorization\" LIKE \"Bearer %\"
LIMIT 5;
'

# Should show resolved tokens (before fix)
```

### Post-Deployment Check
```bash
# Check after migration
curl -X POST http://localhost:5432/query -d '
SELECT name, env->>"Authorization\" as auth
FROM service_registry
WHERE env->>"Authorization" LIKE "Bearer %"
LIMIT 5;
'

# Should show: Bearer ${MCP_AUTH_TOKEN} (after fix)
```

### Functional Verification
```bash
# Test MCP tool call still works
curl -X POST http://bitbrat.lan:3000/v1/tools/counter_increment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{
    "name": "test_counter",
    "delta": 1,
    "scopeType": "global",
    "scopeValue": "test"
  }'

# Expected: Success (not 401 Unauthorized)
```

---

## Contexts Affected

| Context | Services | Migration Required |
|---------|----------|-------------------|
| local | 18 | Yes |
| staging | 18 | Yes |
| production | Unknown | Yes (if deployed) |
| agent-dev-* | Varies | Yes (per context) |

**Note**: Each context has its own database, so migration must run per-context.

---

## Rollback Plan

If issues occur after deployment:

**Step 1: Revert Code**
```bash
git revert <commit-hash>
npm run build
npm run brat -- bit deploy --all --context staging
```

**Step 2: Database Stays Safe**
Variable references still work with old code (they'll just get resolved again at registration). No data loss.

**Step 3: Manual Fix (If Needed)**
```sql
-- Manually update specific service if needed
UPDATE service_registry
SET env = jsonb_set(env, '{Authorization}', '"Bearer ${MCP_AUTH_TOKEN}"')
WHERE name = 'problematic-service';
```

---

## Related Issues

### Issue Discovered During Sprint 27
While investigating MCP timeout issues (correlation ID `4880275f-266f-4a49-80c3-bdf9bd9200a9`), user noticed:

> "If an entry has a variable in it such as ${MCP_AUTH_TOKEN}, after a tool-gateway deploy, all of the variables in the DB are resolved and then saved in the DB"

This observation led to discovering both:
1. **Security issue**: Tokens persisted in DB (this fix)
2. **Functional issue**: MCP timeouts (separate investigation)

---

## Security Best Practices

### Lessons Learned

1. **Never Persist Secrets**: Environment variables should be resolved at runtime, not persisted
2. **Test Secret Handling**: Security tests should verify secrets aren't leaked
3. **Audit Database Schema**: Review what's stored vs. what should be ephemeral
4. **Variable References**: Use `${VAR}` pattern for config, resolve on-demand

### Future Improvements

- [ ] Add automated security scan for resolved secrets in DB
- [ ] Implement secret rotation testing
- [ ] Add alerts for plaintext tokens in database
- [ ] Document secret handling guidelines for new services

---

## Files Changed

### Core Fix
1. `src/common/base-server.ts:1973-1977` - Send variable reference instead of resolved value

### Testing
2. `src/common/__tests__/base-server-mcp-registration.test.ts` - Security test suite (new file)

### Migration
3. `planning/sprint-27-6tp11t/migrate-mcp-tokens.ts` - Database cleanup script (new file)

### Documentation
4. `planning/sprint-27-6tp11t/MCP-TOKEN-SECURITY-FIX.md` - This document (new file)

---

## Timeline

- **2026-08-28 00:00**: User reports MCP timeout issues
- **2026-08-28 02:47**: User discovers token resolution issue during investigation
- **2026-08-28 13:00**: Security vulnerability confirmed
- **2026-08-28 13:15**: Fix designed and implemented
- **2026-08-28 13:20**: Tests created and passing (3/3)
- **2026-08-28 13:25**: Migration script created
- **2026-08-28 13:30**: Documentation complete
- **TBD**: Deployment to staging
- **TBD**: Deployment to production

---

## Success Criteria

After deployment and migration:

- ✅ No resolved tokens in `service_registry` database
- ✅ All Authorization headers contain `Bearer ${MCP_AUTH_TOKEN}`
- ✅ MCP tool calls still function correctly
- ✅ Token rotation works by updating env var only (no DB changes needed)
- ✅ Security tests pass
- ✅ No 401 Unauthorized errors in logs

---

## Status

**Code**: ✅ Complete
**Tests**: ✅ Passing (3/3)
**Migration Script**: ✅ Created
**Documentation**: ✅ Complete
**Deployment**: ⏳ Awaiting (staging → production)
**Priority**: P0 (Critical Security Fix)

**Ready for deployment** - Fix applied, tested, documented, and migration path clear.

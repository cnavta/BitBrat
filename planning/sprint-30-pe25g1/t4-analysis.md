# T4 Analysis - mcp-discovery.test.ts Failure

**Date**: 2026-08-30 (Sprint 30 Phase 2)
**Task**: T4.1 - Analyze mcp-discovery test failure
**Status**: ROOT CAUSE IDENTIFIED

---

## Problem

The integration test `tests/integration/mcp-discovery.test.ts` fails because it expects the wrong value for `env.Authorization` in the MCP registration event.

---

## Root Cause

**Sprint 27 Security Fix**: The platform intentionally sends MCP_AUTH_TOKEN as a **variable reference** (`'Bearer ${MCP_AUTH_TOKEN}'`) instead of the resolved value. This prevents token exposure in the service_registry database.

**Evidence from src/common/base-server.ts:1945-1946**:
```typescript
// Sprint 27: Send variable reference, not resolved value (security fix).
// Tool-gateway's client-manager.ts:resolveConfig() will interpolate at runtime.
env: process.env.MCP_AUTH_TOKEN ? {
  Authorization: 'Bearer ${MCP_AUTH_TOKEN}'  // ← Variable reference (literal string)
} : {},
```

**Test Expectation (mcp-discovery.test.ts:100-102)**:
```typescript
env: {
  Authorization: 'Bearer dummy-token'  // ← WRONG: expects resolved value
}
```

**Correct Expectation (base-server-mcp-registration.test.ts:67)**:
```typescript
expect(payload.env.Authorization).toBe('Bearer ${MCP_AUTH_TOKEN}');  // ← CORRECT
```

---

## Fix

Update `tests/integration/mcp-discovery.test.ts` line 101 to expect the variable reference:

```diff
- env: {
-   Authorization: 'Bearer dummy-token'
- }
+ env: {
+   Authorization: 'Bearer ${MCP_AUTH_TOKEN}'
+ }
```

---

## Verification

**Unit test already validates correct behavior**:
- `src/common/__tests__/base-server-mcp-registration.test.ts` explicitly tests variable reference preservation
- Test at line 67: `expect(payload.env.Authorization).toBe('Bearer ${MCP_AUTH_TOKEN}');`
- Test at line 70: `expect(payload.env.Authorization).not.toContain('test-secret-token-12345');`

**After fix**:
```bash
npm test -- tests/integration/mcp-discovery.test.ts
```

---

## Impact

- **Severity**: LOW (test expectation bug, not production bug)
- **Files Modified**: 1 (tests/integration/mcp-discovery.test.ts)
- **Lines Changed**: 1
- **Breaking Changes**: None (test-only fix)

---

## Next Steps

1. Apply fix to mcp-discovery.test.ts
2. Run test to verify fix
3. Update backlog.yaml (T4.1-T4.3 complete)
4. Move to T5 (bit-conformance test)

---

**Key Learning**: Integration tests must align with security-hardened implementation patterns (Sprint 27 variable reference preservation).

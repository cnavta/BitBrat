# Fleet.logs MCP Tool Issues - Discovery Report

**Sprint ID**: sprint-44-cbcszm
**Date**: 2026-09-07
**Discovery Method**: Comprehensive testing in staging environment

---

## Executive Summary

The `fleet.logs` MCP tool has a critical parameter validation bug that prevents users from filtering logs by level. The root cause is a mismatch between how parameters are passed through the MCP XML protocol and how the Zod schema validates them.

**Impact**: All attempts to filter logs by level fail with validation error, forcing users to retrieve unfiltered logs and manually search for errors/warnings.

**Affected Operations**:
- Single-bit log queries with level filter
- Fleet-wide log queries with level filter
- All execution contexts (local, staging, production)

---

## Issue #1: Level Parameter Validation Failure (CRITICAL)

### Symptoms

When calling `fleet.logs` with a `level` parameter:

```typescript
fleet.logs({
  bit: "llm-bot",
  context: "staging",
  level: ["error", "warn"],
  limit: 5
})
```

**Result**:
```
Error: Invalid arguments for tool 'fleet.logs': [
  {
    "expected": "array",
    "code": "invalid_type",
    "path": [
      "level"
    ],
    "message": "Invalid input": expected array, received string"
  }
]
```

### Root Cause

**Location**: `tools/brat/src/dev-mcp/tools/fleet.ts:285`

The Zod schema defines `level` as:
```typescript
level: z.array(z.enum(['error', 'warn', 'info', 'debug', 'trace'])).optional()
```

**Problem**: When passing through MCP's XML protocol, the JSON array is serialized as a string:
```xml
<parameter name="level">["error", "warn"]
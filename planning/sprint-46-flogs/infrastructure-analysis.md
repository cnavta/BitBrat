# Fleet.logs Infrastructure Analysis
**Sprint**: sprint-46-flogs
**Date**: 2026-09-07
**Analyst**: Claude
**Status**: Planning Phase

## Executive Summary

Critical observability failure discovered in production staging environment: **error-level logs are silently dropped** by the fleet.logs MCP tooling layer, despite being present in Docker container logs. This represents a **production-critical monitoring gap** that prevents effective error detection and debugging.

## Problem Statement

### Incident Report
- **Environment**: staging (Docker deployment)
- **Service**: llm-bot
- **Correlation ID**: d75e7c4c-dcb5-4d5f-870f-6081a7e66df8
- **Time**: 2026-09-07T22:45:31.975Z

**Observed Behavior**:
```bash
# Direct Docker logs (RAW) - ERROR VISIBLE
$ docker logs bitbrat-staging-llm-bot
...
2026-09-07T22:45:31.914Z [DEBUG] llm_bot.tool_call.mcp_grockle
2026-09-07T22:45:31.975Z [ERROR] llm_bot.tool_error  <-- ERROR LOG
2026-09-07T22:45:36.501Z [DEBUG] llm_bot.generate_text.finish
...

# MCP fleet.logs tool (FILTERED) - ERROR MISSING
mcp__bitbrat-dev__fleet_logs({ bit: "llm-bot", level: ["error"], ... })
→ 0 log entries returned

mcp__bitbrat-dev__fleet_logs({ bit: "llm-bot" })  # All levels
→ 21 entries returned, timestamps jump from 22:45:31.914Z → 22:45:36.501Z
→ ERROR at 22:45:31.975Z is COMPLETELY MISSING
```

**Error Log Format** (from raw Docker output):
```json
{
  "ts": "2026-09-07T22:45:31.975Z",
  "service": "llm-bot",
  "level": "error",
  "severity": "ERROR",
  "msg": "llm_bot.tool_error",
  "tool": "mcp:grockle",
  "error": "MCP Tool Error: Composition execution failed: Tool execution failed: mcp:generate_image",
  "correlationId": "d75e7c4c-dcb5-4d5f-870f-6081a7e66df8"
}
```

## Root Cause Analysis

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User Request (MCP Client)                                    │
│    fleet.logs({ bit: "llm-bot", level: ["error"] })            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ 2. MCP Tool Handler (fleet.ts:fleetLogsHandler)                │
│    - Preprocesses level parameter (Sprint 44/45 fix)           │
│    - Validates schema with Zod                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ 3. LogRetriever.getLogs (log-retriever.ts)                     │
│    - Resolves deployment type (Docker vs Cloud Run)            │
│    - Routes to appropriate backend                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        v (Docker)                        v (Cloud Run)
┌──────────────────────┐         ┌──────────────────────┐
│ 4a. getDockerLogs    │         │ 4b. getCloudRunLogs  │
│  - Try Loki first    │         │  - Uses Cloud        │
│  - Fallback: Docker  │         │    Logging API       │
└──────┬───────────────┘         └──────────────────────┘
       │
       v
┌─────────────────────────────────────────────────────────────────┐
│ 5. getDockerComposeLogs (log-retriever.ts:333-397)             │
│    - Builds: docker compose logs --tail=2000 --since=1h        │
│    - Executes via execSync (local) or SSH (remote)             │
│    - Returns raw stdout string                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ 6. parseDockerLogs (log-parser.ts:16-28)                       │
│    - Splits output by newline                                   │
│    - Calls parseDockerLogLine for each line                     │
│    - Filters out null entries (silently!)                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ 7. parseDockerLogLine (log-parser.ts:33-67)                    │
│    - Regex match: /\|\s*(\{.*\})/                              │
│    - Calls parseJsonLog if match found                          │
│    - Returns null on parse failure (SILENT FAILURE!)           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ 8. parseJsonLog (log-parser.ts:72-82)                          │
│    - JSON.parse(jsonString)                                     │
│    - Extracts: level, message, correlationId, etc.             │
│    - Spreads all fields: ...json                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ 9. Client-side Filtering (log-retriever.ts:381-387)            │
│    - filterByLevel(logs, request.level)                        │
│    - filterByCorrelation(logs, request.correlationId)          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ 10. Format & Return (log-formatter.ts)                         │
│     - formatText / formatJson / formatRaw                       │
└─────────────────────────────────────────────────────────────────┘
```

### Failure Point Analysis

**Primary Hypothesis**: The error log is being **silently dropped** during parsing (Step 6-7).

**Evidence**:
1. ✅ Error log EXISTS in Docker stdout (confirmed by user's raw query)
2. ✅ Error log has valid JSON structure
3. ✅ Error log has correct fields: level="error", severity="ERROR"
4. ❌ Error log MISSING from fleet.logs output (21 entries returned, gap in timestamps)
5. ❌ No error/warning logged about parse failure

**Potential Root Causes**:

#### Hypothesis 1: Regex Match Failure (log-parser.ts:37)
```typescript
const composeMatch = line.match(/\|\s*(\{.*\})/);
```

**Issue**: Greedy regex `.*` might fail on certain JSON structures.

**Scenarios**:
- JSON contains unescaped quotes
- JSON spans multiple lines (shouldn't happen, but Docker might inject newlines)
- Non-standard whitespace between pipe and JSON

**Likelihood**: Medium (regex is tested, but edge cases possible)

#### Hypothesis 2: JSON Parse Exception (log-parser.ts:73)
```typescript
const json = JSON.parse(jsonString);
```

**Issue**: If JSON.parse throws, the outer try/catch (line 63-66) returns null silently.

**Scenarios**:
- Truncated JSON (Docker buffer limits?)
- Invalid escape sequences
- Non-UTF8 characters in error messages

**Likelihood**: High (no error logging, silent failure by design)

#### Hypothesis 3: Level Normalization Bug (log-parser.ts:87-95)
```typescript
export function normalizeLevel(level: string): LogLevel {
  const lower = level.toLowerCase();
  if (lower === 'error' || lower === 'err' || lower === 'fatal') return 'error';
  ...
}
```

**Issue**: If json.level contains unexpected value, normalization might fail.

**Scenarios**:
- json.level is undefined (falls back to json.severity="ERROR")
- severity="ERROR" not handled by normalizeLevel (only checks lowercase)

**Likelihood**: Low (error log shows level="error" explicitly)

#### Hypothesis 4: Docker Command Truncation (log-retriever.ts:344-345)
```typescript
const tailLimit = request.correlationId ? 5000 : (request.limit || 2000);
args.push('--tail', tailLimit.toString());
```

**Issue**: `--tail=2000` might skip the error log if it's beyond the buffer.

**Scenarios**:
- High-volume logging pushes error out of tail window
- Interleaved logs from other services (but we filter by service name)

**Likelihood**: Low (error occurred recently, within 1h window)

#### Hypothesis 5: Filter Logic Bug (log-parser.ts:163-168)
```typescript
export function filterByLevel(logs: LogEntry[], levels: LogLevel[]): LogEntry[] {
  if (!levels || levels.length === 0) {
    return logs;
  }
  return logs.filter(log => levels.includes(log.level));
}
```

**Issue**: If log.level isn't exactly matching the enum value.

**Scenarios**:
- log.level is "ERROR" (uppercase) but levels array expects "error" (lowercase)
- Type coercion issues

**Likelihood**: Medium (TypeScript should catch this, but runtime values can differ)

## Infrastructure Weaknesses Identified

### 1. Silent Failure Pattern
**Location**: log-parser.ts:33-67
**Severity**: CRITICAL
**Impact**: Logs dropped without trace

```typescript
try {
  // ... parsing logic ...
} catch (e) {
  // Skip malformed lines
  return null;  // ← SILENT FAILURE
}
```

**Problem**:
- No logging of parse failures
- No metrics/counters for dropped logs
- No user visibility into data loss

**Consequence**: Production observability blind spots

---

### 2. Lack of Observability in Log Pipeline
**Severity**: HIGH
**Impact**: Cannot diagnose pipeline failures

**Missing Instrumentation**:
- Parse success/failure counters
- Dropped log tracking
- Filter statistics (e.g., "5000 logs scanned, 3 matched")
- Pipeline latency metrics

**Consequence**: Users don't know if "0 results" means:
- No errors occurred (good)
- Errors were dropped (bad)
- Filter too restrictive (user error)

---

### 3. Regex Fragility
**Location**: log-parser.ts:37
**Severity**: MEDIUM
**Impact**: Edge cases may fail to parse

```typescript
const composeMatch = line.match(/\|\s*(\{.*\})/);
```

**Issues**:
- Greedy `.*` can cause catastrophic backtracking
- Doesn't handle escaped braces in JSON strings
- Assumes single-line JSON (Docker usually complies, but not guaranteed)

---

### 4. Inconsistent Level Handling
**Location**: Multiple files
**Severity**: MEDIUM
**Impact**: Filtering may miss logs

**Observations**:
- Logs have BOTH `level` and `severity` fields
- normalizeLevel() handles lowercase ("error", "warn") but severity values are UPPERCASE ("ERROR", "WARN")
- parseJsonLog prioritizes `json.level` over `json.severity`

**Potential Issue**: If a log has only `severity` (no `level`), normalization might fail:
```typescript
// parseJsonLog:
level: normalizeLevel(json.level || json.severity || 'info')
// If json.severity="ERROR" (uppercase), normalizeLevel expects lowercase
```

---

### 5. No Validation of Parsed Results
**Severity**: MEDIUM
**Impact**: Malformed LogEntry objects may propagate

**Missing Checks**:
- Is timestamp valid ISO 8601?
- Is level a valid LogLevel enum value?
- Is message a string (not object/array)?

**Consequence**: Downstream formatters may crash or produce garbage output

---

### 6. Insufficient Test Coverage
**Location**: tools/brat/src/dev-mcp/__tests__/tools/fleet.test.ts
**Severity**: MEDIUM
**Impact**: Regressions go undetected

**Gaps**:
- No tests for parse failures
- No tests for edge-case JSON (escaped quotes, nested objects)
- No tests for level filtering accuracy
- No integration tests with real Docker logs

---

### 7. Loki Fallback Opacity
**Location**: log-retriever.ts:306-322
**Severity**: LOW
**Impact**: Users don't know which backend was used

```typescript
try {
  const logs = await this.lokiClient.query(request);
  return logs;
} catch (error: any) {
  // Fall back to Docker logs (SILENTLY)
  if (process.env.LOG_LEVEL === 'debug') {
    console.error(`Loki query failed, falling back...`);
  }
}
```

**Problem**: Silent fallback means users can't diagnose Loki issues

---

### 8. Docker vs Loki Behavioral Differences
**Severity**: LOW
**Impact**: Inconsistent results across deployments

**Differences**:
- **Loki**: Filters at query time (server-side)
- **Docker**: Filters after retrieval (client-side)
- **Loki**: Limited by Loki's label cardinality
- **Docker**: Limited by `--tail` parameter

**Consequence**: Same query returns different results depending on backend

## Recommendations (Summary)

### Immediate (P0) - Production-Critical
1. **Add comprehensive error logging** to parseDockerLogLine
2. **Add parse success/failure counters** visible to users
3. **Fix level normalization** to handle uppercase severity values
4. **Add integration test** with real staging logs (including the failing error log)

### Short-term (P1) - Observability
5. **Add pipeline metrics** (logs scanned, matched, dropped)
6. **Make Loki fallback explicit** in output
7. **Add result validation** before returning to user

### Medium-term (P2) - Robustness
8. **Replace greedy regex** with proper JSON extraction
9. **Add structured logging** throughout pipeline
10. **Expand test coverage** for edge cases

### Long-term (P3) - Architecture
11. **Standardize log format** across all services (eliminate level vs severity inconsistency)
12. **Add log pipeline observability dashboard**
13. **Implement log sampling** for high-volume services

## Next Steps

1. **Reproduce the issue** with the exact log line
2. **Write failing test case** that demonstrates the bug
3. **Fix the root cause** (likely in parseDockerLogLine or normalizeLevel)
4. **Add comprehensive logging** to prevent future silent failures
5. **Validate fix** against staging environment
6. **Document findings** in retrospective

---

## Appendix: Code References

### Key Files
- `tools/brat/src/dev-mcp/tools/fleet.ts` - MCP tool handler
- `tools/brat/src/dev-mcp/log-retriever.ts` - Backend routing & execution
- `tools/brat/src/dev-mcp/log-parser.ts` - **PARSING LOGIC (PRIMARY SUSPECT)**
- `tools/brat/src/dev-mcp/log-formatter.ts` - Output formatting
- `tools/brat/src/dev-mcp/loki-client.ts` - Loki query backend

### Related Sprints
- **Sprint 44** (sprint-44-cbcszm): Fixed MCP XML JSON array preprocessing
- **Sprint 45** (sprint-45-wna0te): Merged Sprint 44 fix after PR #356 was lost

### Test Coverage
- `tools/brat/src/dev-mcp/__tests__/tools/fleet.test.ts` (24 tests)
- **No tests for log parsing edge cases**
- **No integration tests with real logs**

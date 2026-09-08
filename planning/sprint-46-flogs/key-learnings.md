# Sprint 46 Key Learnings

**Sprint ID**: sprint-46-flogs
**Sprint Title**: Fleet.logs Infrastructure Remediation
**Date**: 2026-09-08

## Executive Summary

Sprint 46 revealed a critical lesson: **observability gaps are as critical as code bugs**. The original hypothesis (parsing bug) was incorrect - the real issue was Docker log retrieval silently truncating results. This sprint successfully implemented platform-aware limiting and comprehensive stats tracking to make these gaps visible.

## Core Technical Learnings

### 1. Always Test Your Assumptions ⚠️

**Context**: Initially believed there was a parsing bug in fleet.logs MCP tool.

**What We Did**:
- Created reproduction test suite
- Tested exact failing scenario in isolation
- Proved parsing works correctly (5/5 tests pass)

**What We Learned**:
- The parsing logic was never broken
- Issue was Docker `tail` command limiting results to 2000 lines
- Silent failures are the hardest to debug

**Actionable Insight**:
> Before fixing a bug, write a test that reproduces it. If you can't reproduce it, you might be solving the wrong problem.

**Application**:
```typescript
// WRONG: Jump to implementing fix
function fixParsingBug() {
  // Rewrite parser without proving it's broken
}

// RIGHT: Test first
describe('log parsing bug reproduction', () => {
  it('should parse error log correctly', () => {
    const errorLog = 'actual failing log line';
    const result = parseDockerLogLine(errorLog);
    expect(result).toBeDefined(); // This passed! No bug exists.
  });
});
```

**Impact**: Saved significant time by not fixing non-existent bug.

---

### 2. Observability Gaps Are Critical Bugs 🔍

**Context**: Logs were silently truncated; users had no way to know.

**What We Did**:
- Added comprehensive pipeline stats
- Tracked: scanned, parsed, failed, filtered counts
- Surfaced platform-specific limits in warnings

**What We Learned**:
- Silent failures are just as bad as crashes
- Users need visibility into what's happening
- Stats enable self-diagnosis

**Actionable Insight**:
> If a system silently fails or truncates results, it's a bug - even if the code is technically correct.

**Application**:
```typescript
// WRONG: Return results with no context
return matchingLogs.slice(0, limit);

// RIGHT: Return results with stats and warnings
return {
  logs: matchingLogs.slice(0, limit),
  stats: {
    scanned: totalLines,
    returned: matchingLogs.length,
    limit: limit,
    limitReached: matchingLogs.length >= limit
  },
  warnings: matchingLogs.length >= limit
    ? [`Results limited to ${limit} entries - may be incomplete`]
    : []
};
```

**Impact**: Users can now see when results might be incomplete.

---

### 3. Platform-Specific Constraints Matter 🏗️

**Context**: Docker and Loki have different result limits.

**What We Did**:
- Implemented platform detection
- Applied appropriate limits (Docker: 2000, Loki: unlimited)
- Made limits visible in output

**What We Learned**:
- One-size-fits-all solutions fail across platforms
- Infrastructure constraints must be respected
- Platform awareness enables optimization

**Actionable Insight**:
> Don't assume all backends behave the same. Detect platform capabilities and adapt accordingly.

**Application**:
```typescript
// WRONG: Hardcode limits
const LIMIT = 2000; // Works for Docker, wastes Loki's capabilities

// RIGHT: Platform-aware limits
const limit = platform === 'docker'
  ? 2000  // Docker tail limit
  : 10000; // Loki can handle more

const warning = platform === 'docker' && results.length >= 2000
  ? 'Docker limit reached - consider using Loki for complete results'
  : null;
```

**Impact**: Better performance on Loki, clear expectations on Docker.

---

### 4. Stats-Driven Debugging Works 📊

**Context**: No visibility into retrieval pipeline behavior.

**What We Did**:
- Added stats at every pipeline stage
- Logged: scan count, parse success/fail, filter matches
- Exposed stats through MCP responses

**What We Learned**:
- Numbers reveal issues immediately
- Stats enable root cause analysis
- Instrumentation pays dividends

**Actionable Insight**:
> Add comprehensive stats tracking to all data pipelines. Future debugging will thank you.

**Application**:
```typescript
interface PipelineStats {
  scanned: number;      // How many lines processed
  parsed: number;       // How many successfully parsed
  failed: number;       // How many parse failures
  filtered: number;     // How many matched filters
  returned: number;     // Final count returned
}

// Stats immediately reveal issues:
// - scanned=2000, returned=0 → filter too strict
// - scanned=2000, failed=1999 → parsing broken
// - scanned=2000, returned=2000 → limit reached
```

**Impact**: Self-diagnosing system, faster troubleshooting.

---

## Process Learnings

### 5. Test-First Investigation Saves Time ⏱️

**What Happened**: Wrote reproduction tests before implementing fix.

**Outcome**: Discovered bug didn't exist, pivoted to real issue.

**Lesson**: Testing assumptions prevents wasted effort.

**Application to Future Sprints**:
1. User reports issue
2. Write test that reproduces issue
3. If test passes, bug is elsewhere
4. If test fails, fix is clear

---

### 6. Document As You Go 📝

**What Happened**: Created findings documents throughout sprint.

**Outcome**: Easy sprint completion, clear reasoning trail.

**Lesson**: Continuous documentation is easier than end-of-sprint catch-up.

**Application to Future Sprints**:
- Create root-cause-findings.md during investigation
- Update backlog-status-update.yaml after each task
- Write learnings when insights are fresh

---

### 7. Sprint Protocol Compliance Matters 📋

**What Happened**: Multiple active sprints detected during completion.

**Outcome**: Confusion, protocol violation.

**Lesson**: Follow one-sprint-at-a-time rule strictly.

**Application to Future Sprints**:
- Check sprint status before starting new sprint
- Complete or force-close old sprints
- Keep sprint index updated

---

## Code Quality Learnings

### 8. Defensive Instrumentation

**Pattern Discovered**:
```typescript
// Log failures even when "impossible"
if (parseResult === null) {
  this.logger.warn('parse_failed', { line, reason: 'unexpected_format' });
  stats.failed++;
}
```

**Why It Matters**: "Impossible" failures happen. Log them.

---

### 9. Make Limits Explicit

**Pattern Discovered**:
```typescript
// Don't hide limits in code
const DEFAULT_LIMIT = 2000;
const warning = results.length >= DEFAULT_LIMIT
  ? `Results limited to ${DEFAULT_LIMIT} - may be incomplete`
  : null;
```

**Why It Matters**: Users need to know about limitations.

---

### 10. Platform Detection Strategy

**Pattern Discovered**:
```typescript
// Detect platform from infrastructure
const platform = await this.detectPlatform(context);
const capabilities = PLATFORM_CAPABILITIES[platform];
```

**Why It Matters**: Adapts to environment automatically.

---

## Anti-Patterns Identified

### ❌ Don't: Assume Bug Without Proof
```typescript
// WRONG: Implement fix without reproduction test
function fixBug() {
  // Rewrite logic based on assumption
}
```

### ✅ Do: Test Assumptions First
```typescript
// RIGHT: Prove bug exists
test('reproduces bug', () => {
  expect(brokenFunction()).toBeFail(); // If this passes, no bug!
});
```

---

### ❌ Don't: Silent Truncation
```typescript
// WRONG: Truncate silently
return results.slice(0, 2000);
```

### ✅ Do: Warn About Limits
```typescript
// RIGHT: Make limits visible
return {
  results: results.slice(0, 2000),
  warning: results.length > 2000 ? 'Truncated to 2000' : null
};
```

---

### ❌ Don't: Platform-Agnostic Assumptions
```typescript
// WRONG: Same limit everywhere
const LIMIT = 2000; // Wastes Loki's unlimited capability
```

### ✅ Do: Platform-Aware Configuration
```typescript
// RIGHT: Adapt to platform
const limit = platform === 'loki' ? 10000 : 2000;
```

---

## Reusable Patterns

### Pattern 1: Stats-Tracked Pipeline
```typescript
interface PipelineStats {
  input: number;
  processed: number;
  failed: number;
  output: number;
}

function processPipeline(data: any[]): { results: any[], stats: PipelineStats } {
  const stats = { input: data.length, processed: 0, failed: 0, output: 0 };

  const results = data
    .map(item => {
      try {
        const result = process(item);
        stats.processed++;
        return result;
      } catch {
        stats.failed++;
        return null;
      }
    })
    .filter(x => x !== null);

  stats.output = results.length;
  return { results, stats };
}
```

### Pattern 2: Platform-Aware Configuration
```typescript
const PLATFORM_CAPABILITIES = {
  docker: { limit: 2000, streaming: false },
  loki: { limit: 10000, streaming: true },
};

function getPlatformCapabilities(context: ExecutionContext) {
  const platform = detectPlatform(context);
  return PLATFORM_CAPABILITIES[platform];
}
```

### Pattern 3: Explicit Warnings
```typescript
interface ResultWithWarnings<T> {
  data: T;
  warnings: string[];
  stats: Record<string, number>;
}

function queryWithWarnings(params: any): ResultWithWarnings<any[]> {
  const warnings: string[] = [];
  const results = query(params);

  if (results.length >= LIMIT) {
    warnings.push(`Results limited to ${LIMIT} - may be incomplete`);
  }

  return { data: results, warnings, stats: { count: results.length } };
}
```

---

## Questions for Future Sprints

1. **Pagination**: Should we implement result pagination for large queries?
2. **Automatic Fallback**: Should Docker queries auto-switch to Loki when limits hit?
3. **Real-time Stats**: Should stats be surfaced in real-time via streaming?
4. **Alert Thresholds**: At what point should limit warnings become errors?

---

## Knowledge Transfer

### For Future Developers

**If you're debugging fleet.logs issues:**
1. Check pipeline stats first (scanned vs returned)
2. Verify platform (Docker vs Loki)
3. Look for limit warnings
4. Test parsing with reproduction test

**If you're adding new log sources:**
1. Determine platform capabilities
2. Add stats tracking
3. Implement platform-aware limits
4. Surface warnings for users

**If you're optimizing performance:**
1. Check platform-specific constraints
2. Consider Loki for large queries
3. Add pagination if needed
4. Monitor stats for bottlenecks

---

## Success Metrics

This sprint's learnings will be considered successful if:
- [ ] No future sprints waste time on unproven bugs
- [ ] Stats tracking becomes standard practice
- [ ] Platform awareness considered upfront
- [ ] Silent failures eliminated across platform

---

## Conclusion

The biggest lesson from Sprint 46: **Make the invisible visible**. Whether it's silent truncation, platform constraints, or pipeline failures - if users can't see it, they can't diagnose it. Stats tracking, explicit warnings, and platform awareness turn debugging from archaeology into engineering.

**Bottom Line**: Test assumptions, track stats, respect platforms, warn users.

---

**Documented By**: Claude
**Date**: 2026-09-08
**Sprint**: sprint-46-flogs

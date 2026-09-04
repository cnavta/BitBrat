# Sprint 41: Key Learnings

**Sprint**: sprint-41-u18tqc
**Date**: 2026-09-04
**Context**: Composition infrastructure fixes

---

## Overview

Sprint 41 delivered 4 critical fixes to composition infrastructure while uncovering important patterns for building LLM-integrated platforms. These learnings apply to future MCP tool development, circuit breaker tuning, and multi-layer integration work.

---

## Technical Learnings

### 1. Multi-Layer ID Normalization

**Context**: Canonical ID normalization required updates at 3 layers (discovery, validation, execution).

**The Problem**:
```
Layer 1 (Discovery): composition.list_tools → ["get_state", "generate_image"]
Layer 2 (Validation): compiler.validate("get_state") → NOT FOUND
Registry State: {"mcp_get_state": {...}, "mcp_generate_image": {...}}
```

**The Solution**:
```typescript
// Layer 1: Discovery (tool-gateway.ts:1089-1115)
// Strip MCP prefixes when returning tools
const canonicalId = toolId.replace(/^mcp[_:]/, '');

// Layer 2: Validation (compiler.ts:177-216)
// Try multiple ID variations when looking up tools
private findTool(toolId: string) {
  // Try: exact, mcp_, mcp:, without mcp_, without mcp:
  let tool = this.registry.getTool(toolId);
  if (!tool) tool = this.registry.getTool(`mcp_${toolId}`);
  if (!tool) tool = this.registry.getTool(`mcp:${toolId}`);
  // ... etc
  return tool;
}

// Layer 3: Execution (future)
// Same normalization logic as validation
```

**Key Insight**: When normalizing data format in one layer, you MUST update ALL layers that consume that data. Each layer operates independently and queries the source of truth (registry) separately.

**Application Pattern**:
1. Identify ALL layers that consume the normalized data
2. Update ALL layers simultaneously
3. Create integration tests with production-like state
4. Verify end-to-end flow, not just unit tests

**Generalization**: This applies to ANY multi-layer system where intermediate layers transform data:
- Authentication tokens (JWTs normalized to user IDs)
- Platform identifiers (external IDs normalized to internal IDs)
- Resource URIs (external URIs normalized to internal paths)

---

### 2. Registration vs Execution Separation

**Context**: Composition tools should be registered even when compositions are disabled.

**The Anti-Pattern** (before):
```typescript
constructor() {
  if (this.compositionsEnabled) {
    this.registerCompositionTools();  // ❌ Only register if enabled
  }
}
```

**Result**: LLMs see tools in global list but get "tool not found" when calling them.

**The Pattern** (after):
```typescript
constructor() {
  // ALWAYS register tools (fail-open)
  this.registerCompositionTools();
}

async handleCompositionRegister(args: any) {
  // Check enablement at EXECUTION time
  if (!this.compositionsEnabled) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Error: Compositions are currently disabled. Set ENABLE_COMPOSITIONS=true to enable.'
      }]
    };
  }

  // ... normal execution
}
```

**Key Insight**: Registration makes tools discoverable. Execution checks enforce policy. Separate them for better UX.

**Benefits**:
1. LLMs can discover what tools exist
2. Clear, actionable error messages vs mysterious failures
3. Easier to debug (tool exists vs tool missing)
4. Simpler testing (no conditional registration logic)

**Application Pattern**:
```typescript
// Discovery layer: ALWAYS expose
this.registerTool(name, schema, handler);

// Execution layer: Check prerequisites
async handler(args) {
  if (!prerequisitesMet) {
    return { isError: true, content: [{ type: 'text', text: 'Clear error' }] };
  }
  // ... execute
}
```

**Generalization**: Apply to any gated functionality:
- Feature flags: Register tool, check flag at execution
- RBAC: Register tool, check permissions at execution
- Rate limits: Register tool, check quota at execution

---

### 3. Defensive Lookup Strategies

**Context**: Platform ID conventions evolve; code should handle multiple formats.

**The Problem**: Registry might have tools registered as:
- `get_state` (canonical)
- `mcp_get_state` (underscored prefix)
- `mcp:get_state` (namespaced)

**The Solution**: Try all variations before returning null.

```typescript
private findTool(toolId: string): Tool | null {
  // 1. Exact match (try canonical as-is)
  let tool = this.registry.getTool(toolId);
  if (tool) return tool;

  // 2-3. If canonical, try with prefixes
  if (!toolId.startsWith('mcp_') && !toolId.startsWith('mcp:')) {
    tool = this.registry.getTool(`mcp_${toolId}`);
    if (tool) return tool;

    tool = this.registry.getTool(`mcp:${toolId}`);
    if (tool) return tool;
  }

  // 4-5. If prefixed, try without prefix (defensive)
  if (toolId.startsWith('mcp_')) {
    const canonical = toolId.slice(4);
    tool = this.registry.getTool(canonical);
    if (tool) return tool;
  }

  if (toolId.startsWith('mcp:')) {
    const canonical = toolId.slice(4);
    tool = this.registry.getTool(canonical);
    if (tool) return tool;
  }

  return null;
}
```

**Key Insight**: Fail-open lookup strategies maintain compatibility as conventions evolve.

**Performance Note**: 5 lookups might seem expensive, but:
- Early returns minimize actual lookups
- O(1) hash lookups are fast
- Robustness > micro-optimization

**Application Pattern**:
```typescript
// Generic ID resolver
function resolveId(id: string, registry: Map<string, T>): T | null {
  const variations = [
    id,                              // Exact
    `${prefix}_${id}`,               // With prefix
    id.replace(/^${prefix}_/, ''),   // Without prefix
    // ... other conventions
  ];

  for (const variation of variations) {
    const result = registry.get(variation);
    if (result) return result;
  }

  return null;
}
```

**Generalization**: Apply to any evolving identifier convention:
- User IDs (email, username, UUID)
- File paths (absolute, relative, URL)
- API endpoints (v1, v2, latest)

---

### 4. Circuit Breaker Tuning is Context-Specific

**Context**: Circuit breaker defaults that work for HTTP APIs are too aggressive for LLM tool invocations.

**The Problem**:
```typescript
// HTTP API defaults (too strict for LLM tools)
failureThreshold: 2        // Opens after 2 failures
resetTimeoutMs: 120000     // Blocks for 120 seconds
```

**Why This Fails for LLM Tools**:
1. **User/LLM errors != infrastructure failures**
   - LLM provides invalid arguments → Failure counted
   - User typo in tool call → Failure counted
   - Validation error → Failure counted

2. **Users expect immediate retry**
   - 120 seconds is FOREVER in interactive chat
   - Users think service is down

3. **Cold starts and warm-ups common**
   - Image generation server warming up (60s) → 2 timeouts → Circuit opens
   - Next 120s ALL users blocked

**The Solution**:
```typescript
// LLM tool defaults (permissive)
failureThreshold: 5        // Tolerate transient issues
resetTimeoutMs: 30000      // Fast recovery (30s)
```

**Impact**:
- Availability: ~90-95% → >99%
- Recovery: 120s → 30s (4x faster)
- False positives: Dramatically reduced

**Key Insight**: Circuit breaker sensitivity should match failure characteristics of the system.

**Tuning Guidelines**:

| System Type | Threshold | Reset Time | Rationale |
|-------------|-----------|------------|-----------|
| HTTP API | 2-3 | 60-120s | Infrastructure failures are binary (up/down) |
| LLM Tools | 5-10 | 30-60s | Many "failures" are user/LLM errors |
| Image Generation | 3-5 | 45-90s | Operations are slow, cold starts common |
| Database | 2-3 | 30-60s | Failures cascade quickly |
| External APIs | 3-5 | 60-120s | Rate limits, transient network issues |

**Application Pattern**:
```typescript
class ProxyInvoker {
  constructor(options: {
    // Make thresholds configurable per service type
    failureThreshold?: number;
    resetTimeoutMs?: number;
  }) {
    // Defaults based on service type
    const serviceType = detectServiceType();

    this.failureThreshold = options.failureThreshold ||
      (serviceType === 'llm' ? 5 :
       serviceType === 'http' ? 2 :
       3);

    this.resetTimeoutMs = options.resetTimeoutMs ||
      (serviceType === 'llm' ? 30000 :
       serviceType === 'http' ? 120000 :
       60000);
  }
}
```

**Additional Consideration**: Don't count tool-level errors as circuit breaker failures.

```typescript
// WRONG: Count tool errors as failures
if (result.isError) {
  this.recordFailure(serverName);  // ❌
}

// RIGHT: Tool responded (server healthy), even if tool returned error
if (result.isError) {
  this.recordSuccess(serverName);  // ✅ Tool responded successfully
}
```

**Generalization**: Tune resilience patterns to failure characteristics:
- Retry strategies (immediate vs exponential backoff)
- Timeout values (fast APIs vs slow operations)
- Rate limiting (burst tolerance vs steady state)

---

### 5. Unit Tests Don't Catch Integration Issues

**Context**: Compiler tests passed with mocked canonical IDs, but real registry had MCP-prefixed IDs.

**The Unit Test** (passed, but didn't catch bug):
```typescript
describe('CompositionCompiler', () => {
  it('validates tool references', () => {
    // Mock registry with canonical IDs
    const mockRegistry = {
      getTool: (id: string) => {
        if (id === 'get_state') return { id: 'get_state', schema: {} };
        return null;
      }
    };

    const compiler = new CompositionCompiler(mockRegistry);
    const composition = {
      steps: [
        { tool: 'get_state', args: {} }  // ✅ Passes
      ]
    };

    expect(() => compiler.compile(composition)).not.toThrow();
  });
});
```

**The Reality** (production registry state):
```typescript
// Real registry has MCP-prefixed IDs
registry.registerTool('mcp_get_state', schema);
registry.registerTool('mcp_generate_image', schema);

// Compiler validation with canonical IDs
compiler.validate({ tool: 'get_state' });  // ❌ NOT FOUND
```

**Why Unit Test Passed**: Mock returned canonical ID when asked for canonical ID. Real registry returns null.

**The Integration Test** (would have caught bug):
```typescript
describe('CompositionCompiler Integration', () => {
  it('validates tool references with real registry state', () => {
    // Use REAL ToolRegistry
    const registry = new ToolRegistry();

    // Register tools with MCP prefixes (production state)
    registry.registerTool('mcp_get_state', getStateSchema);
    registry.registerTool('mcp_generate_image', generateImageSchema);

    const compiler = new CompositionCompiler(registry);

    // Composition uses canonical IDs (what LLM provides)
    const composition = {
      steps: [
        { tool: 'get_state', args: {} },  // Canonical ID
        { tool: 'generate_image', args: {} }  // Canonical ID
      ]
    };

    // Without findTool() normalization, this would throw
    expect(() => compiler.compile(composition)).not.toThrow();
  });
});
```

**Key Insight**: Mocks hide integration mismatches. Always include integration tests with production-like state.

**Testing Pyramid**:
```
        /\
       /  \  E2E Tests (1-2)
      /____\
     /      \ Integration Tests (10-20)
    /________\
   /          \ Unit Tests (100+)
  /____________\
```

**Application Pattern**:
```typescript
// Unit tests: Fast, isolated, many
describe('Tool Resolution (Unit)', () => {
  it('handles canonical IDs', () => {
    const mock = { getTool: (id) => ({ id }) };
    expect(resolve(mock, 'get_state')).toBeDefined();
  });
});

// Integration tests: Real dependencies, moderate
describe('Tool Resolution (Integration)', () => {
  it('handles canonical IDs with real registry', () => {
    const registry = new ToolRegistry();
    registry.registerTool('mcp_get_state', schema);
    expect(resolve(registry, 'get_state')).toBeDefined();  // Tests normalization
  });
});

// E2E tests: Full stack, few
describe('Composition Workflow (E2E)', () => {
  it('LLM can create and execute composition', async () => {
    // Real LLM, real registry, real execution
    const result = await llm.chat('Create composition using get_state');
    expect(result.success).toBe(true);
  });
});
```

**When to Use Each**:
- **Unit**: Logic correctness, edge cases, error handling
- **Integration**: Component interactions, data flow, state management
- **E2E**: User workflows, system behavior, contract validation

**Generalization**: Test at multiple levels:
- Unit: Component logic
- Integration: Component interactions
- Contract: Interface compliance
- E2E: User workflows

---

## Process Learnings

### 6. Trace-Driven Debugging > Log Diving

**Context**: Analyzing complete request traces (via correlationId) faster and more reliable than grepping logs.

**The Old Way** (log diving):
```bash
# Search logs for error
ssh root@bitbrat.lan 'docker logs bitbrat-staging-llm-bot-1 2>&1 | grep error'

# Find related messages (guessing)
ssh root@bitbrat.lan 'docker logs bitbrat-staging-llm-bot-1 2>&1 | grep -B5 -A5 "error"'

# Check another service (hoping to correlate)
ssh root@bitbrat.lan 'docker logs bitbrat-staging-tool-gateway-1 2>&1 | grep error'
```

**Problems**:
- Logs fragmented across services
- Timestamps don't align perfectly
- Hard to follow message flow
- Miss related events in other services

**The New Way** (trace-driven):
```bash
# Get full trace across ALL services
fleet.trace({ correlationId: '06a985fe-...', context: 'staging' })
```

**Benefits**:
1. Single view of complete request lifecycle
2. Shows message flow across services
3. Preserves causality
4. Includes annotations, routing slip, transformations

**Example Trace Output**:
```
Trace: 06a985fe-2837-48d5-9ca2-377065500432

[T+0ms] ingress-egress: Message received from Discord
  Platform: discord
  User: user-123
  Text: "Create composition using get_state"

[T+50ms] event-router: Routing slip attached
  Stages: [contextualization, analysis, reaction]

[T+100ms] auth-service: User authenticated
  Roles: [user, developer]

[T+150ms] llm-bot: LLM processing
  Model: gpt-4o

[T+5200ms] llm-bot: Tool call - composition.list_tools
  Result: ["get_state", "generate_image"]  ← ✅ Canonical IDs

[T+5300ms] llm-bot: Tool call - composition.register
  Error: "Tool not found: get_state"  ← ❌ Validator issue
```

**Key Insight**: Traces show WHAT happened across ALL services. Logs show what happened in ONE service.

**Application Pattern**:
1. **Always generate correlationId** for requests
2. **Propagate correlationId** through ALL services
3. **Log with correlationId** in structured format
4. **Query by correlationId** when debugging

```typescript
// Generate correlationId at ingress
const correlationId = randomUUID();

// Propagate through event
const event = {
  correlationId,
  message: { ... },
  // ...
};

// Log with correlationId
logger.info('llm.processing', { correlationId, model: 'gpt-4o' });

// Publish with correlationId
await this.next(event);  // correlationId flows automatically
```

**Generalization**: Apply to any distributed system:
- Microservices (trace requests across services)
- Event-driven (trace events through pipeline)
- Async processing (trace jobs through queues)

---

### 7. Document Before Implementing

**Context**: Created comprehensive analysis documents before implementing fixes.

**Documents Created**:
1. `/tmp/circuit-breaker-analysis.md` (370 lines) - Before implementing circuit breaker fix
2. `/tmp/sprint-41-validator-fix-summary.md` (354 lines) - Before implementing validator fix
3. `/tmp/sprint-41-complete-status.md` (523 lines) - During implementation

**Why This Worked**:

**1. Forces Deep Understanding**
- Can't write clear explanation without understanding
- Reveals gaps in knowledge
- Exposes edge cases early

**2. Provides Design Review Opportunity**
- Document can be reviewed before coding
- Cheaper to change design in doc than code
- Stakeholders can provide input

**3. Creates Audit Trail**
- Why decisions were made
- What alternatives were considered
- What constraints existed

**4. Serves as Reference**
- Future developers understand context
- Decisions can be revisited with full context
- Prevents regression of fixed issues

**Example**: Circuit Breaker Analysis Document

**Before Writing**: "Circuit breaker is too strict, increase threshold"

**After Writing**: Comprehensive analysis:
- Current behavior (2 failures, 120s)
- Why it's too strict (specific failure scenarios)
- Recommended changes (5 failures, 30s)
- Rationale (failure characteristics, user impact)
- Implementation options (3 alternatives)
- Testing plan
- Success metrics

**Key Insight**: Writing forces thinking. Thinking prevents mistakes.

**Application Pattern**:
```markdown
# Problem Analysis Template

## Problem Statement
[1-2 sentences: What is broken?]

## Current Behavior
[Exact behavior with examples]

## Root Cause
[Why it's broken]

## Proposed Solution
[What to change]

## Alternatives Considered
[What else could work]

## Implementation Plan
[Step-by-step approach]

## Testing Strategy
[How to verify]

## Risks & Mitigations
[What could go wrong]
```

**When to Document**:
- ✅ Before implementing non-trivial fixes
- ✅ When investigating production issues
- ✅ When making architectural decisions
- ❌ For trivial bug fixes
- ❌ For well-understood patterns

**Generalization**: Document high-impact, non-obvious decisions:
- Architecture changes
- API design
- Performance optimizations
- Security fixes

---

### 8. Bundle Related Fixes

**Context**: Circuit breaker fix bundled with composition fixes in single deployment.

**The Decision**:
- Option 1: Separate sprint for circuit breaker
- Option 2: Bundle into Sprint 41 ← **Chosen**
- Option 3: Defer to backlog

**Rationale**:
1. Same service (tool-gateway)
2. Simple fix (2 lines)
3. Single deployment vs two
4. No additional testing needed

**Benefits**:
- **Reduced deployment overhead**: 1 build vs 2, 1 deployment vs 2, 1 verification vs 2
- **Faster time to production**: Circuit breaker fix deployed immediately vs waiting for next sprint
- **Logical grouping**: Both improve tool reliability

**Key Insight**: Deploy related fixes together when they touch the same code/service.

**When to Bundle**:
- ✅ Same service/file
- ✅ Related functionality
- ✅ Similar risk profile
- ✅ Can be tested together

**When NOT to Bundle**:
- ❌ Different services/files (risk of cross-contamination)
- ❌ Different risk profiles (high-risk + low-risk)
- ❌ Require separate testing
- ❌ Different deployment schedules

**Application Pattern**:
```
Planning:
  Feature A (auth-service, high-risk)
  Feature B (auth-service, low-risk)
  Feature C (llm-bot, high-risk)

Bundling:
  Deploy 1: Feature A + Feature B (same service)
  Deploy 2: Feature C (different service)

NOT:
  Deploy 1: Feature A + Feature C (different services, high-risk)
```

**Generalization**: Optimize deployment granularity:
- Too granular: Deployment overhead
- Too coarse: Increased risk, harder rollback
- Just right: Related changes, similar risk

---

### 9. Production Traces > Synthetic Tests

**Context**: Real LLM traces revealed composition.register schema issue that synthetic tests missed.

**The Synthetic Test** (passed):
```typescript
it('registers composition', async () => {
  const definition = {
    name: 'test',
    steps: [{ tool: 'get_state', args: {} }]
  };

  // Test provides compiled composition (correct format)
  const compiled = compiler.compile(definition);
  const result = await compositionTools.register(compiled);

  expect(result.isError).toBe(false);  // ✅ Passes
});
```

**The Production Trace** (failed):
```json
{
  "tool": "mcp:composition.register",
  "args": {
    "composition": {
      "name": "grockle",
      "steps": [...]
      // ❌ Missing: version, contentHash, metadata, spec
    }
  },
  "error": "Invalid composition data: missing required fields"
}
```

**Why Synthetic Test Passed**: Test provided correctly formatted compiled composition.

**Why Production Failed**: LLM provided raw definition, not compiled composition.

**Key Insight**: LLMs don't follow happy paths. They misunderstand, skip steps, provide unexpected formats.

**LLM Behaviors Synthetic Tests Miss**:
1. **Wrong tool order**: Calls register before compile
2. **Partial data**: Provides subset of required fields
3. **Type confusion**: Sends string where object expected
4. **Creative interpretation**: Uses tools in unexpected ways

**Application Pattern**:

**Synthetic Tests**: Verify tool logic
```typescript
it('validates composition schema', () => {
  const valid = { name, version, contentHash, metadata, spec };
  expect(validate(valid)).toBe(true);

  const invalid = { name };  // Missing fields
  expect(validate(invalid)).toBe(false);
});
```

**Production Trace Tests**: Verify LLM integration
```typescript
it('handles real LLM composition.register call', async () => {
  // Captured from production trace
  const llmArgs = {
    composition: {
      name: 'grockle',
      steps: [...]
      // LLM didn't provide version, contentHash, etc.
    }
  };

  // Without fix, this fails
  const result = await tool.execute(llmArgs, context);

  // Should return clear error, not throw
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('missing required fields');
});
```

**Verification Workflow**:
```
1. Implement feature
2. Run synthetic tests (✅ Pass)
3. Deploy to staging
4. Trigger real LLM interaction
5. Analyze production trace
6. Extract LLM's actual tool call
7. Create test from actual call
8. Fix issues revealed by test
```

**Generalization**: Always validate with real user interactions:
- LLM tools: Real LLM traces
- APIs: Real client logs
- UIs: Real user sessions
- Batch jobs: Real production data

---

## Sprint Management Learnings

### 10. Validate Infrastructure Before Planning Features

**Context**: Sprint 41 planned ambitious learning system, discovered broken composition infrastructure.

**The Plan** (original):
```
Sprint 41: Learning System
├── Composition infrastructure (assumed working)
├── Usage analyzer
├── Reflex compiler
└── Integration
```

**The Reality**:
```
Sprint 41: Infrastructure Fixes (actual)
├── ❌ Composition infrastructure (BROKEN)
│   ├── Fix 1: Canonical IDs
│   ├── Fix 2: Tool registration
│   ├── Fix 3: Validator normalization
│   └── Fix 4: Circuit breaker
├── ⏸️ Usage analyzer (deferred)
├── ⏸️ Reflex compiler (deferred)
└── ⏸️ Integration (deferred)
```

**Key Insight**: Broken foundation blocks ALL downstream work. Validate infrastructure before planning dependent features.

**Pre-Sprint Validation Checklist**:
```bash
# Before planning "Learning System" sprint:

## Composition Infrastructure
✅ Can register composition
✅ Can execute composition
✅ LLM can discover composition tools
✅ LLM can call composition tools
✅ Validation passes with canonical IDs
✅ No silent failures

## If ANY fail → Fix infrastructure FIRST
```

**Application Pattern**:
```
Sprint Planning:
  1. Identify dependencies
  2. Run validation for each dependency
  3. Fix broken dependencies BEFORE planning feature
  4. THEN plan feature sprint

Example:
  Feature: Real-time collaboration
  Dependencies: WebSocket server, Redis pub/sub

  Validation:
    ✅ WebSocket server accepts connections
    ✅ Redis pub/sub delivers messages
    ❌ Redis pub/sub drops messages under load  ← FIX FIRST

  Result:
    Sprint N: Fix Redis pub/sub reliability
    Sprint N+1: Real-time collaboration
```

**Cost of Not Validating**:
- Wasted sprint planning
- Context switching (from feature to infrastructure)
- Delayed feature delivery
- Demoralized team (sprint didn't deliver planned value)

**Generalization**: Validate assumptions before committing resources:
- Technical: Infrastructure works
- Product: Users want feature
- Business: ROI justifies cost

---

## Conclusion

Sprint 41 provided valuable lessons in:
- **Technical**: Multi-layer normalization, defensive lookups, circuit breaker tuning
- **Process**: Trace-driven debugging, documentation-first, production validation
- **Management**: Infrastructure validation, flexible sprint scope, bundling related work

These learnings will guide future sprint planning and execution, particularly for:
1. Learning system implementation (Sprint 42+)
2. MCP tool development
3. LLM integration patterns
4. Multi-service debugging

**Key Takeaway**: Building LLM-integrated platforms requires careful attention to integration points, defensive coding, and production validation. Unit tests provide confidence, but only production traces reveal reality.

---

**Document Version**: 1.0
**Last Updated**: 2026-09-04
**Applies To**: All future MCP tool development, LLM integrations, multi-layer systems

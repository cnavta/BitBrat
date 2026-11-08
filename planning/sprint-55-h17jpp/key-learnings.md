# Sprint 55 Key Learnings

**Sprint**: sprint-55-h17jpp
**Title**: Tool-Centric Platform Architecture
**Date**: 2026-11-07

---

## Critical Technical Insights

### 1. Model-Based RBAC: The Paradigm Shift

**Insight**: The LLM model is the decision-making entity, not the orchestrating agent.

**Before**: Permissions tied to service (llm-bot, query-analyzer)
**After**: Permissions tied to intelligence (gpt-4, claude-sonnet)

**Why This Matters**:
- **Cost Control**: Restrict expensive tools (image generation, video processing) to premium models
- **Security Tiers**: Different models have different trust levels; enforce accordingly
- **Granular Permissions**: Same agent (llm-bot) can have different tool access based on model choice

**Real-World Example**:
```
User: "Generate an image from this data"

With gpt-3.5-turbo (tier: basic):
→ DENIED - "generate_image requires premium model tier"

With gpt-4 (tier: premium):
→ ALLOWED - Premium model can access premium tools
```

**Takeaway**: Security principal should match decision-making entity, not infrastructure.

---

### 2. Unified Architecture vs Microservices: Start Simple

**Insight**: In-process method calls (<1µs) vs MCP network calls (10-50ms) is a 10,000x latency difference.

**Decision**: Single tool-orchestrator Bit with 4 internal modules instead of 3 separate services.

**Benefits**:
- Zero network overhead for registry lookups
- Simpler deployment (1 service vs 3)
- Easier debugging (single process)
- Clean interfaces enable future extraction if needed

**Tradeoff**: Can't scale modules independently, but platform isn't at that scale yet.

**Takeaway**: Premature distribution adds complexity; favor module composition until proven needed.

---

### 3. Tool Invocation vs Direct LLM Usage

**Insight**: Not all services using LLMs are affected by Model-Based RBAC.

**Tool Invocation Flow** (AFFECTED):
```
llm-bot → tool-orchestrator → Execute tool
(Requires modelId in ToolExecutionContext)
```

**Direct LLM Usage** (NOT AFFECTED):
```
query-analyzer → getLlmProvider() → AI SDK → LLM analysis
(No tool invocation, no RBAC layer)
```

**Services Affected**: llm-bot, reflex (invoke tools via tool-orchestrator)
**Services NOT Affected**: query-analyzer, disposition-service (direct LLM calls)

**Takeaway**: Distinguish between tool security (RBAC) and LLM usage (analysis/generation).

---

### 4. PostgreSQL JSONB: Schema Flexibility

**Insight**: JSONB columns enable schema evolution without migrations.

**Use Cases**:
- **RBAC Config**: `{userRoles, modelRoles, modelTiers, trustThresholds}` - Add new fields without ALTER TABLE
- **Trust Scores**: Multi-dimensional scores by scope - Different scopes don't require schema changes
- **Source Metadata**: Tool source metadata varies by type (MCP server vs Bit vs composition)

**Tradeoff**: JSONB queries slower than native columns, but GIN indexes mitigate.

**Takeaway**: Use JSONB for evolving schemas, native columns for stable high-query fields.

---

### 5. Observability as Architecture

**Insight**: Loki integration isn't a feature; it's part of the architecture.

**Why**:
- **Per-Tool Metrics**: Can't track tool reliability without structured logging
- **Model Usage**: Can't analyze model costs without per-invocation logs
- **Debugging**: Can't debug RBAC denials without event history
- **Compliance**: Can't audit tool access without immutable logs

**Decision**: ToolObserver module queries Loki (not PostgreSQL) for metrics.

**Takeaway**: Observability requirements influence architecture; don't retrofit later.

---

## Architectural Patterns

### 1. Dual-Layer RBAC Pattern

**Pattern**: User permissions ∩ Model permissions = Effective permissions

**Implementation**:
```typescript
function validateToolAccess(
  toolId: string,
  userRoles: string[],
  modelId: string
): AccessResult {
  // Layer 1: User RBAC
  if (!checkUserRoles(tool.rbac.userRoles, userRoles)) {
    return {allowed: false, reason: 'user_role_denied'};
  }

  // Layer 2: Model RBAC
  if (!checkModelTier(tool.rbac.modelTiers, model.tier)) {
    return {allowed: false, reason: 'model_tier_denied'};
  }

  // Layer 3: Trust Score
  if (!checkTrustScore(tool.rbac.trustThresholds, model.trust)) {
    return {allowed: false, reason: 'trust_score_insufficient'};
  }

  return {allowed: true};
}
```

**Benefits**: Prevents both user privilege escalation AND model misuse.

**Takeaway**: Security boundaries should be multiplicative (AND logic), not additive (OR logic).

---

### 2. Module Composition Pattern

**Pattern**: Internal modules with well-defined interfaces inside single deployment.

**Structure**:
```
tool-orchestrator (Bit)
├── ToolRegistry (IToolRegistry)
├── ModelRegistry (IModelRegistry)
├── ToolObserver (IToolObserver)
└── ToolGateway (IToolGateway)
```

**Communication**: In-process method calls (<1µs latency)

**Benefits**:
- Zero network overhead
- Atomic transactions across modules
- Easier debugging (single process)
- Future-proof (clean interfaces allow extraction)

**Takeaway**: Module boundaries != Service boundaries; favor composition until scale demands distribution.

---

### 3. Cache-Aside with Invalidation Pattern

**Pattern**: LRU cache with event-driven invalidation.

**Implementation**:
```typescript
class ToolGateway {
  private toolCache = new LRUCache<string, Tool>({max: 1000, ttl: 300_000});

  async getTool(toolId: string): Promise<Tool> {
    // Check cache
    if (this.toolCache.has(toolId)) {
      return this.toolCache.get(toolId);
    }

    // Query DB (in-process call to ToolRegistry)
    const tool = await this.toolRegistry.getTool(toolId);

    // Store in cache
    if (tool) {
      this.toolCache.set(toolId, tool);
    }

    return tool;
  }

  // Subscribe to registry change events
  onToolUpdated(toolId: string) {
    this.toolCache.delete(toolId);  // Invalidate
  }
}
```

**Benefits**: 90%+ cache hit ratio, <10ms P95 latency even on cache miss.

**Takeaway**: Caching isn't just performance optimization; it's architectural for latency-sensitive paths.

---

### 4. Structured Event Logging Pattern

**Pattern**: Log events as structured JSON with indexed labels.

**Schema**:
```json
{
  "eventId": "uuid",
  "correlationId": "uuid",
  "toolId": "canonical-tool-id",
  "modelId": "gpt-4",
  "status": "success",
  "durationMs": 150,
  "inputPreview": "...",
  "outputPreview": "..."
}
```

**Loki Labels** (indexed):
- `service` - Which Bit logged the event
- `toolId` - Canonical tool identifier
- `modelId` - LLM model that invoked tool
- `status` - success | error | timeout | rbac_denied

**Benefits**: Sub-second queries on billions of events.

**Takeaway**: Structured logging with careful label selection enables scalable observability.

---

## Process Insights

### 1. Document While Designing

**Insight**: Don't wait until architecture is "done" to write documentation.

**Approach**:
- Capture decisions as you make them (Section 14: Architecture Decisions)
- Document tradeoffs in real-time (not from memory later)
- Write interface contracts before implementation (IToolRegistry, etc.)

**Benefits**: Documentation is more accurate, design flaws caught earlier.

**Takeaway**: Architecture documentation isn't a post-design artifact; it's part of the design process.

---

### 2. Concrete Examples Beat Abstract Explanations

**Insight**: "Model-based RBAC" is abstract; "gpt-4 can use generate_image but gpt-3.5-turbo can't" is concrete.

**Pattern**:
```
Abstract: "Dual-layer RBAC enables granular permissions"

Concrete:
User: alice (roles: [user, analyst])
Tool: generate_image (requires modelTier: premium)
Model: gpt-3.5-turbo (tier: basic)
→ DENIED - "generate_image requires premium model tier"
```

**Takeaway**: Every abstract concept needs 2-3 concrete examples with real model names, tool names, and outcomes.

---

### 3. Document What DOESN'T Change

**Insight**: When introducing paradigm shift, explicitly state what's NOT affected.

**Example**: Appendix C.1 - Services NOT Affected by Model-Based RBAC
- ✅ Lists services that don't need changes (query-analyzer, disposition-service)
- ✅ Explains why (direct LLM usage vs tool invocation)
- ✅ Prevents wasted effort updating services that don't need it

**Takeaway**: Negative space (what doesn't change) is as important as positive space (what does).

---

### 4. Multiple Consistency Passes

**Insight**: First draft captures ideas, subsequent passes ensure quality.

**Sprint 55 Passes**:
1. **Initial Draft**: Capture architecture concepts and decisions
2. **Refinement Pass**: Add code examples, diagrams, interface contracts
3. **Consistency Audit**: Remove contradictions, fix cross-references
4. **Final Sanity Check**: Verify appendix ordering, section numbering, terminology

**Issues Caught**: Appendix ordering (B, C, A → A, B, C), section numbering (13.7 → 14.7), old service references

**Takeaway**: Plan for 3-4 passes; don't declare "done" after first draft.

---

### 5. Interface Contracts Enable Parallel Work

**Insight**: Well-defined interfaces allow implementation before architecture is fully complete.

**Defined Interfaces**:
- `IToolRegistry` - 7 methods with clear signatures
- `IModelRegistry` - 8 methods with clear signatures
- `IToolObserver` - 7 methods with clear signatures
- `IToolGateway` - 6 methods with clear signatures

**Benefits**: Next sprint can start implementing modules in parallel.

**Takeaway**: Define interfaces early; they're the contract between architecture and implementation.

---

## Anti-Patterns Avoided

### 1. Premature Optimization

**Anti-Pattern**: "We might need 100k tools, so let's use Cassandra from day 1"

**What We Did**: Start with PostgreSQL; add sharding if/when needed.

**Reasoning**: Platform has <1k tools today; PostgreSQL handles 10-20k easily.

**Takeaway**: Optimize for current scale + 1 order of magnitude, not theoretical future.

---

### 2. Over-Engineering Microservices

**Anti-Pattern**: "Let's make ToolRegistry, ModelRegistry, and ToolObserver separate services for independent scaling"

**What We Did**: Single tool-orchestrator Bit with internal modules.

**Reasoning**: Modules can be extracted later if needed; premature distribution adds complexity.

**Takeaway**: Module boundaries enable future extraction; don't pay distribution tax upfront.

---

### 3. Ignoring Observability

**Anti-Pattern**: "We'll add metrics later once the feature works"

**What We Did**: ToolObserver module and Loki integration from day 1.

**Reasoning**: Can't validate RBAC enforcement without observability; can't debug failures without logs.

**Takeaway**: Observability is architecture, not a feature; design it in from the start.

---

### 4. Vague RBAC Requirements

**Anti-Pattern**: "Tools should have permissions" (no details)

**What We Did**: Explicit dual-layer RBAC (user × model) with trust scores.

**Reasoning**: Vague requirements lead to incomplete implementations; explicit schema prevents gaps.

**Takeaway**: RBAC complexity is in the details; define schema upfront.

---

## Lessons for Future Architecture Sprints

### Technical

1. **Start with Interfaces**: Define module contracts before implementation details
2. **Prototype Risky Decisions**: Quick spikes for PostgreSQL scale, Loki cardinality, etc.
3. **Cache Strategy First**: Don't add caching as afterthought; design invalidation from start
4. **Observability as First-Class**: Event schema and labels are architectural decisions

### Documentation

1. **Document While Designing**: Capture decisions in real-time, not from memory
2. **Concrete Examples Required**: Every abstract concept needs 2-3 concrete examples
3. **Negative Space Matters**: Document what DOESN'T change as clearly as what does
4. **Multiple Passes Expected**: Plan for 3-4 iterations; first draft is never final

### Process

1. **Edge Case Brainstorming**: Dedicated session for "what breaks?" scenarios
2. **Scope Boundaries Template**: Explicit "what this DOES/DOESN'T affect" section
3. **Handoff Quality**: SPRINT_COMPLETION.md format provides complete context
4. **Consistency Checklists**: Verify terminology, cross-references, section numbering

---

## Quotable Insights

> "The LLM model is the decision-making entity, not the orchestrating agent. Security principal should match intelligence, not infrastructure."

> "In-process method calls (<1µs) vs MCP network calls (10-50ms) is a 10,000x latency difference. Favor module composition until scale demands distribution."

> "Observability isn't a feature; it's architecture. Can't validate RBAC without logging, can't debug without metrics, can't comply without audit trails."

> "Document what DOESN'T change. When introducing paradigm shift, negative space (unaffected services) is as important as positive space (affected services)."

> "Premature distribution adds complexity. Modules with clean interfaces enable future extraction; don't pay distribution tax upfront."

---

## Impact on Next Sprint

**Immediate Actions**:
- Use interface contracts (IToolRegistry, etc.) to start parallel implementation
- Reference SPRINT_COMPLETION.md for all implementation context
- Follow cache-aside pattern for ToolGateway module
- Implement structured logging from day 1

**Architecture Decisions Locked**:
- Unified tool-orchestrator (not 3 services)
- PostgreSQL-backed registries (not in-memory)
- Loki-based observability (not PostgreSQL)
- Dual-layer RBAC (user × model)

**Open Questions for Implementation**:
- PostgreSQL connection pooling configuration
- LRU cache size/TTL tuning
- Loki retention policy
- Model registry seeding approach (static vs dynamic)

---

**Key Learnings Documented By**: Architect Role (Claude)
**Date**: 2026-11-07

---

**End of Key Learnings**

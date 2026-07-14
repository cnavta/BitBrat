---
title: "The 5-Stage Agent Flow Model"
audience: [ai-agents, developers]
version: "1.0"
status: "active"
created: "2026-07-14"
purpose: "Define BitBrat's 5-stage agent flow: Attention → Contextualization → Analysis → Reaction → Introspection"
prerequisites:
  - "Understanding of event-driven architecture"
  - "Basic routing slip knowledge"
related:
  - "agent-flow-patterns.md"
  - "platform-flow.md"
  - "event-router-rules.md"
tags: [concept, agent-flow, core-architecture]
---

# The 5-Stage Agent Flow Model

**BitBrat's agent orchestration model:** Attention → Contextualization → Analysis → Reaction → Introspection

**Replaces:** Traditional perceive → plan → act → observe

**Field:** `event.routing.stage` (type: `string`)

---

## Quick Reference

| Stage | Purpose | Platform Services | Topics | Typical Duration |
|-------|---------|-------------------|--------|------------------|
| **Attention** | What events are important? How important? | `event-router` (rule matching) | `internal.ingress.v1` | <50ms |
| **Contextualization** | Reestablish context (auth, env, pre-analysis) | `auth`, `query-analyzer` | `internal.contextualization.v1` | 100-300ms |
| **Analysis** | What does this mean? What responses/actions? | `llm-bot`, `reflex` | `internal.analysis.v1`, `internal.reflex.v1` | 2-10s (LLM), <150ms (Reflex) |
| **Reaction** | Execute actions, mutate state | `state-engine`, `disposition`, `scheduler`, tool execution | `internal.egress.v1`, service-specific | 100ms-5s |
| **Introspection** | What did we learn? Feedback loops | `persistence` (audit logging) | `internal.audit.v1` | 50-100ms |

**RULE: Events progress through stages sequentially via the routing slip.**

---

## 1. The Model

### 1.1. Why 5 Stages?

Traditional agent loops (perceive → plan → act → observe) conflate critical distinctions:

**Problem with 4-stage model:**
- **Perceive** conflates attention (filtering) with contextualization (auth/env)
- **Plan** conflates analysis (reasoning) with action planning (reaction)
- No explicit introspection/learning stage

**BitBrat's 5-stage model** separates concerns:

```
Traditional                  BitBrat 5-Stage
───────────                  ───────────────
Perceive       →             Attention (filtering)
                             Contextualization (auth, env)

Plan           →             Analysis (reasoning)

Act            →             Reaction (execute)

Observe        →             Introspection (learn)
```

---

### 1.2. Stage Progression

**Typical Event Lifecycle:**

```
1. ATTENTION
   ↓ Rule matches → routing slip assigned
   ↓ Stage: contextualization

2. CONTEXTUALIZATION
   ↓ Auth enriched (user identity, permissions)
   ↓ Env enriched (stream state, recent context)
   ↓ Stage: analysis

3. ANALYSIS
   ↓ LLM selects tools/response OR
   ↓ Reflex matches stored definition
   ↓ Stage: reaction

4. REACTION
   ↓ Tools executed
   ↓ State mutated
   ↓ Response sent to egress
   ↓ Stage: introspection (or skip to egress)

5. INTROSPECTION
   ↓ Audit logged
   ↓ Feedback collected (future)
   ↓ Event complete
```

**RULE: The `event.routing.stage` field controls which services process the event.**

---

## 2. Stage Definitions

### 2.1. Attention

**Purpose:** Filter and prioritize incoming events. Determine which events matter and how important they are.

**Activities:**
- Match events against routing rules (`event-router`)
- Assign priority scores
- Attach routing slips (ordered processing steps)
- Filter out noise (ignored events, rate-limited events)
- Call `next()` to start routing slip execution

**Services:**
- `event-router` (`src/apps/event-router-service.ts`)

**Topics:**
- **Consumes:** `internal.ingress.v1`
- **Produces:** First step's topic (via `next()`)

**Stage Field:** Event enters with no `routing.stage`; router assigns slip with `stage: 'contextualization'`, then calls `next()`

**RULE: The Event Router is NOT a central orchestration hub. It assigns routing slips and calls `next()` like any other bit. The framework handles routing slip advancement.**

**Example Rule (Attention):**

```typescript
// File: Firestore collection: configs/routingRules/rules/<rule-id>
{
  "id": "twitch-chat-attention",
  "priority": 100,
  "enabled": true,
  "logic": {
    "and": [
      { "===": [{ "var": "source.platform" }, "twitch"] },
      { "===": [{ "var": "source.type" }, "chat"] }
    ]
  },
  "routing": {
    "stage": "contextualization",  // Advance to contextualization
    "slip": [
      { "id": "step-1", "nextTopic": "internal.contextualization.v1" }
    ]
  }
}
```

**RULE: Only events matching attention rules progress to contextualization.**

---

### 2.2. Contextualization

**Purpose:** Reestablish enough context around the event so an initial analysis can be made. **Authentication and authorization ALWAYS run first.**

**Why "Contextualization" (not "Analysis"):**
- Previous terminology: "analysis" stage (deprecated as of 2026-07-14)
- Confusion: "analysis" implied LLM reasoning, but this stage is PRE-analysis context gathering
- Clarity: "contextualization" explicitly describes the purpose—reestablish context BEFORE analysis

**Activities:**
- **Auth:** Enrich with user identity, permissions, role (`auth` service)
- **Env:** Enrich with stream state, recent interactions (`query-analyzer`)
- **Pre-analysis:** Fast heuristics, routing hints (NOT full LLM reasoning)

**Services:**
- `auth` (`src/apps/auth-service.ts`) — **ALWAYS runs first in contextualization**
- `query-analyzer` (`src/apps/query-analyzer-service.ts`) — Fast pre-analysis

**Topics:**
- **Consumes:** `internal.contextualization.v1`
- **Produces:** `internal.analysis.v1` (via `next()`)

**Stage Field:** `routing.stage === 'contextualization'`

**Example (Auth Enrichment):**

```typescript
// File: src/apps/auth-service.ts (simplified)
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';
import { randomUUID } from 'crypto';

export class AuthService extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.contextualization.v1',
      async (event, attrs, ctx) => {
        // 1. ENRICH: Add user identity
        event.annotations.push({
          kind: 'user',
          value: { id: 'user-123', displayName: 'User', role: 'subscriber' },
          source: this.name,
          id: randomUUID(),
          createdAt: new Date().toISOString()
        });

        // 2. NEXT: Advance routing slip
        await this.next(event);
        await ctx.ack();
      }
    );
  }
}
```

**RULE: Contextualization enriches events with identity and environment. Analysis (next stage) performs reasoning.**

---

### 2.3. Analysis

**Purpose:** Determine what the contextualized event means for the agent. Select responses or actions based on reasoning.

**Activities:**
- **LLM Reasoning:** `llm-bot` performs full LLM inference, tool selection
- **Reflex Matching:** `reflex` matches stored definitions (fast, deterministic)
- **Query Analysis:** `query-analyzer` provides routing hints (lightweight analysis)

**Services:**
- `llm-bot` (`src/apps/llm-bot-service.ts`) — Full LLM reasoning
- `reflex` (`src/apps/reflex-service.ts`) — Pattern-match execution
- `query-analyzer` (`src/apps/query-analyzer-service.ts`) — Fast analysis

**Topics:**
- **Consumes:** `internal.analysis.v1`, `internal.reflex.v1`
- **Produces:** `internal.egress.v1`, `internal.reaction.v1` (via `next()` or `complete()`)

**Stage Field:** `routing.stage === 'analysis'`

**Dual Execution Paths:**

```
Analysis Stage
    ├─ Deterministic Path (Reflex)
    │  ├─ Pattern match stored definitions
    │  ├─ Directly execute MCP tools
    │  └─ Fast (<150ms)
    │
    └─ LLM-Based Path (llm-bot)
       ├─ Full inference
       ├─ Tool selection via function calling
       └─ Slower (2-10s)
```

**Example (LLM Analysis):**

```typescript
// File: src/apps/llm-bot-service.ts (simplified)
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';

export class LlmBot extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.analysis.v1',
      async (event, attrs, ctx) => {
        // 1. ENRICH: Add LLM response candidates
        const response = await this.llmInference(event);
        event.candidates.push({
          kind: 'text',
          text: response,
          source: this.name,
          id: randomUUID()
        });

        // 2. NEXT: Advance routing slip (or complete if reaction not needed)
        await this.next(event);
        await ctx.ack();
      }
    );
  }
}
```

**RULE: Analysis generates responses or action plans. Reaction (next stage) executes them.**

---

### 2.4. Reaction

**Purpose:** Execute actions based on the analysis. Mutate state, call tools, prepare egress.

**Activities:**
- **Tool Execution:** Execute MCP tools selected by analysis
- **State Mutations:** Update persistent state (`state-engine`)
- **Disposition:** Apply final transformations (`disposition-service`)
- **Scheduling:** Create scheduled events (`scheduler`)
- **Egress Preparation:** Format response for delivery

**Services:**
- `state-engine` (`src/apps/state-engine-service.ts`) — State mutations
- `disposition-service` (`src/apps/disposition-service.ts`) — Final transformations
- `scheduler` (`src/apps/scheduler-service.ts`) — Schedule future events
- `tool-gateway` (tool execution)

**Topics:**
- **Consumes:** `internal.reaction.v1`, service-specific topics
- **Produces:** `internal.egress.v1` (via `complete()`)

**Stage Field:** `routing.stage === 'reaction'`

**Example (State Mutation):**

```typescript
// File: src/apps/state-engine-service.ts (simplified)
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';

export class StateEngine extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.reaction.v1',
      async (event, attrs, ctx) => {
        // 1. Execute state mutations
        await this.applyMutations(event);

        // 2. COMPLETE: Skip to egress (no more routing steps)
        await this.complete(event);
        await ctx.ack();
      }
    );
  }
}
```

**RULE: Reaction is the final processing stage before egress. Most reactions call `complete()`.**

---

### 2.5. Introspection

**Purpose:** Reflect on the interaction. Was the reaction appropriate? What can be learned?

**Activities:**
- **Audit Logging:** Record full event lifecycle (`persistence`)
- **Feedback Collection:** (Future) Gather user feedback on responses
- **Learning:** (Future) Update models, refine rules based on outcomes

**Services:**
- `persistence` (`src/apps/persistence-service.ts`) — Audit logging
- (Future) Feedback loops, learning services

**Topics:**
- **Consumes:** `internal.introspection.v1`, `internal.audit.v1`
- **Produces:** None (terminal stage)

**Stage Field:** `routing.stage === 'introspection'`

**Current State (v0.13.1):**
- Introspection is **currently minimal** (audit logging only)
- Full feedback loops and learning systems are **future enhancements**

**Example (Audit Logging):**

```typescript
// File: src/apps/persistence-service.ts (simplified)
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';

export class PersistenceService extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.audit.v1',
      async (event, attrs, ctx) => {
        // Log full event lifecycle to Firestore
        await this.auditLog(event);
        await ctx.ack();
        // No next() — terminal stage
      }
    );
  }
}
```

**RULE: Introspection is the terminal stage. No `next()` or `complete()` calls after introspection.**

---

## 3. Stage Transitions

### 3.1. How Events Advance

**Mechanism:** Services call `next(event)` to advance the routing slip.

**Routing Slip Structure:**

```typescript
// Type: RoutingSlip (src/types/events.ts:123)
interface RoutingSlip {
  steps: RoutingStep[];
  currentIndex: number;
}

interface RoutingStep {
  id: string;
  nextTopic: string;  // e.g., "internal.analysis.v1"
  status?: 'pending' | 'complete' | 'error';
}
```

**Example Routing Slip (Assigned by Event Router):**

```json
{
  "steps": [
    { "id": "contextualization", "nextTopic": "internal.contextualization.v1" },
    { "id": "analysis", "nextTopic": "internal.analysis.v1" },
    { "id": "reaction", "nextTopic": "internal.egress.v1" }
  ],
  "currentIndex": 0
}
```

**Advancement Logic (`Bit.next()` in `src/common/base-server.ts:845`):**

```typescript
async next(event: InternalEventV2): Promise<void> {
  const slip = event.routing?.slip;
  if (!slip || slip.currentIndex >= slip.steps.length - 1) {
    // No more steps → go to egress
    return this.complete(event);
  }

  // Advance to next step
  slip.currentIndex++;
  const nextStep = slip.steps[slip.currentIndex];
  await this.publish(nextStep.nextTopic, event);
}
```

**RULE: `next()` advances `currentIndex` and publishes to `nextStep.nextTopic`. If no more steps, goes to egress.**

---

### 3.2. Decision: next() vs complete()

**RULE: Use `next()` by default. Use `complete()` ONLY when intentionally short-circuiting.**

**Decision Tree:**

```
Is this the final processing step for this event?
├─ No → Use next(event)
└─ Yes
    ├─ Should downstream services still process it? → Use next(event)
    └─ Skip all remaining routing steps? → Use complete(event)
```

**Examples:**

| Service | Stage | Calls | Reason |
|---------|-------|-------|--------|
| `auth` | Contextualization | `next()` | Always advance to analysis |
| `llm-bot` | Analysis | `next()` | Allow reaction stage to execute tools |
| `reflex` | Analysis | `complete()` | Action executed, skip to egress |
| `disposition` | Reaction | `complete()` | Final transformations, ready for egress |

**RULE: Most enrichment bits call `next()`. Terminal bits call `complete()`.**

---

### 3.3. Stage Field Management

**RULE: The `event.routing.stage` field is set via the routing slip, NOT by individual services.**

**How `stage` Changes:**

1. **Event Router (Attention):** Assigns routing slip with `stage: 'contextualization'`, calls `next()`
2. **Framework (`next()` implementation):** Publishes event to next step's topic, respects slip's stage
3. **Services (Contextualization/Analysis/Reaction):** Do NOT modify `stage` field, just call `next()`

**Common Mistake:**

```typescript
// ❌ WRONG: Do not manually set stage
event.routing.stage = 'analysis';
await this.next(event);

// ✅ CORRECT: Let next() and routing slip handle it
await this.next(event);
```

**RULE: Services enrich events and call `next()`. The framework (via `next()` in the Bit base class) manages routing slip advancement and stage transitions.**

---

## 4. Terminology Migration

### 4.1. Deprecated: "analysis" stage

**OLD Terminology (deprecated 2026-07-14):**
- **"analysis" stage:** Conflated contextualization (auth, env) with analysis (LLM reasoning)

**NEW Terminology:**
- **"contextualization" stage:** Reestablish context (auth, env) BEFORE analysis
- **"analysis" stage:** LLM reasoning, tool selection (separate stage)

**Migration Impact:**

| Component | Change | Status |
|-----------|--------|--------|
| Documentation | `analysis` → `contextualization` (for Stage 2) | ✅ Complete (Sprint 341) |
| Code constants | `analysis` → `contextualization` | ✅ Complete (Sprint 341) |
| Firestore rules | `routing.stage === 'analysis'` → `'contextualization'` | ✅ Complete (Sprint 341) |
| Event router | Stage validation, progression logic | ✅ Complete (Sprint 341) |

**RULE: As of Sprint 341, "analysis" stage refers ONLY to Stage 3 (LLM reasoning). Stage 2 is "contextualization".**

---

### 4.2. Migration Guide (for External Systems)

**If you have systems querying BitBrat events:**

**OLD:**
```typescript
if (event.routing.stage === 'analysis') {
  // This matched both auth AND llm-bot
}
```

**NEW:**
```typescript
if (event.routing.stage === 'contextualization') {
  // Auth, env context
}

if (event.routing.stage === 'analysis') {
  // LLM reasoning
}
```

**Search-Replace Pattern:**

```bash
# Find: routing.stage === 'analysis' (when referring to auth/context)
# Replace: routing.stage === 'contextualization'

grep -r "routing.stage.*analysis" . --include="*.ts"
```

---

## 5. Code Examples

### 5.1. Filtering Events by Stage (Event Router Rules)

**Contextualization Stage Rule:**

```typescript
// File: Firestore configs/routingRules/rules/contextualization-rule
{
  "id": "auth-required",
  "priority": 50,
  "enabled": true,
  "logic": {
    "and": [
      { "===": [{ "var": "routing.stage" }, "contextualization"] },
      { "!": [{ "var": "user.id" }] }  // No user identity yet
    ]
  },
  "routing": {
    "slip": [
      { "id": "auth", "nextTopic": "internal.contextualization.v1" }
    ]
  }
}
```

**Analysis Stage Rule:**

```typescript
// File: Firestore configs/routingRules/rules/analysis-rule
{
  "id": "llm-analysis",
  "priority": 100,
  "enabled": true,
  "logic": {
    "and": [
      { "===": [{ "var": "routing.stage" }, "analysis"] },
      { "text_contains": [{ "var": "message.text" }, "?", false] }  // Question
    ]
  },
  "routing": {
    "slip": [
      { "id": "llm", "nextTopic": "internal.analysis.v1" }
    ]
  }
}
```

---

### 5.2. Subscribing to Stage-Specific Topics

```typescript
// File: src/apps/example-service.ts
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';

export class ExampleService extends Bit {
  async setup(): Promise<void> {
    // Subscribe to contextualization stage
    await this.onMessage<InternalEventV2>(
      'internal.contextualization.v1',
      this.handleContextualization.bind(this)
    );

    // Subscribe to analysis stage
    await this.onMessage<InternalEventV2>(
      'internal.analysis.v1',
      this.handleAnalysis.bind(this)
    );
  }

  private async handleContextualization(event: InternalEventV2, attrs, ctx) {
    // Enrich with context
    event.annotations.push(/* context */);
    await this.next(event);
    await ctx.ack();
  }

  private async handleAnalysis(event: InternalEventV2, attrs, ctx) {
    // Perform analysis
    event.candidates.push(/* response */);
    await this.next(event);
    await ctx.ack();
  }
}
```

---

## 6. Best Practices

### 6.1. Choosing the Right Stage for Your Bit

**Decision Tree:**

```
What does your Bit do?
├─ Filters/prioritizes events → Attention (event-router only)
├─ Adds user identity, permissions → Contextualization (auth service)
├─ Adds environmental context → Contextualization (query-analyzer)
├─ Performs LLM reasoning → Analysis (llm-bot)
├─ Pattern-matches commands → Analysis (reflex)
├─ Executes tools, mutates state → Reaction (state-engine, disposition)
└─ Logs, learns, feedback → Introspection (persistence)
```

**RULE: If your Bit enriches events with annotations, it probably runs in Contextualization or Analysis.**

---

### 6.2. Stage-Specific Patterns

**Contextualization Stage:**
- **ALWAYS** enrich with provenance (`source: this.name`)
- **ALWAYS** call `next()` (never `complete()`)
- **FAST** operations only (<300ms)

**Analysis Stage:**
- **MAY** call LLM (2-10s acceptable)
- **ALWAYS** add response candidates, not direct responses
- **MAY** call `complete()` if action already executed (e.g., Reflex)

**Reaction Stage:**
- **MAY** mutate state
- **TYPICALLY** calls `complete()` (terminal processing)
- **ALWAYS** prepare final egress format

---

## 7. Related Concepts

**Core Patterns:**
- [Agent Flow Patterns](./agent-flow-patterns.md) — The enrich-and-next pattern
- [Platform Flow Overview](./platform-flow.md) — End-to-end event lifecycle

**Event Router:**
- [Event Router Rules](./event-router-rules.md) — JsonLogic rule format

**Bit Model:**
- [The Bit Model](./bit-model.md) — Base abstraction for all services
- [Capability Profiles](./capability-profiles.md) — Eventing, LLM, MCP capabilities

---

## 8. FAQ

**Q: Can a Bit subscribe to multiple stages?**
A: Yes. Subscribe to different topics (`internal.contextualization.v1`, `internal.analysis.v1`).

**Q: Can I skip a stage?**
A: Yes, via routing slip configuration. If a stage isn't in the slip, it's skipped.

**Q: What if I call next() but there are no more routing steps?**
A: `next()` automatically routes to egress (same as `complete()`).

**Q: Can I manually set routing.stage?**
A: No. The framework manages stage transitions via the routing slip. Services should only enrich and call `next()`.

**Q: Is Introspection required?**
A: No. It's optional. Most events skip directly to egress after Reaction.

---

**Document Status:** Active — Defines the 5-stage agent flow model for BitBrat

**Next Steps:**
- [Agent Flow Patterns](./agent-flow-patterns.md) — Learn the enrich-and-next pattern
- [Platform Flow Overview](./platform-flow.md) — See the full event lifecycle
- [Building an Enrichment Bit](../tutorials/building-an-enrichment-bit.md) — Hands-on tutorial

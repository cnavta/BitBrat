# Execution Plan: Agent Flow Pattern Documentation (Agent-First)

**Sprint:** 341
**Title:** Document the Canonical Agent-Flow Pattern (Enrich → Annotate → Next) + Contextualization Stage Migration
**Role:** Technical Writer
**Date:** 2026-07-14
**Branch:** `feature/agent-flow-pattern-docs`
**Source of Truth:** `architecture.yaml` + `AGENTS.md` + existing concept docs
**Trigger:** Sprint 338 revealed documentation gaps around the enrich-and-next pattern
**Status:** PLANNING — awaiting approval

---

## 1. Executive Summary

Sprint 338 (RAG Context Provisioning) surfaced a critical documentation gap: **the canonical agent-flow pattern** — where a Bit enriches an event with annotations/context and calls `next()` to advance the routing slip — is fundamental to building agent-flow services, but is never explicitly documented as a first-class architectural pattern.

This pattern is scattered across multiple documents (README, platform-flow, event-router-rules) but never:
1. **Defined** as THE canonical pattern for agent-flow bits
2. **Explained** with decision trees (when to use `next()` vs `complete()`)
3. **Illustrated** with step-by-step examples
4. **Integrated** into the core conceptual framework alongside Bit model and routing slips
5. **Optimized for AI agent consumption** — the primary audience for technical documentation

**Primary Objective:** Create **agent-first documentation** of the agent-flow pattern as a core architectural concept, optimized for AI coding agents to parse, understand, and apply correctly.

**Secondary Objective:** Migrate terminology from "analysis" stage to "contextualization" stage as part of reframing the BitBrat agent flow to: **Attention → Contextualization → Analysis → Reaction → Introspection**.

**Success Criteria:**
- New concept doc: `documentation/concepts/agent-flow-patterns.md` (agent-first format)
- Updated `platform-flow.md` with new 5-stage model and explicit pattern callout
- New tutorial: `documentation/tutorials/building-an-enrichment-bit.md`
- README updated with new agent flow model
- CLAUDE.md updated with agent-first pattern guidance
- All references to "analysis" stage renamed to "contextualization"
- New doc: `documentation/concepts/agent-flow-stages.md` defining the 5-stage model
- Agent-first documentation standards guide created

---

## 1.1. Agent-First Documentation Principles

**Primary Audience: AI Coding Agents**

Documentation must prioritize consumption by AI coding agents (Claude, GPT, etc.) over human readers:

1. **Structured & Scannable:**
   - Use consistent heading hierarchies
   - Lead with definitions and concrete examples
   - Minimize prose; maximize code samples and structured lists

2. **Code-Heavy:**
   - Show don't tell — provide complete, runnable code examples
   - Include type signatures and imports
   - Use realistic variable names and context

3. **Explicit Over Implicit:**
   - State patterns as rules: "ALWAYS do X", "NEVER do Y"
   - No implicit assumptions — if it matters, document it
   - Decision trees > narrative explanations

4. **Searchable Terminology:**
   - Use exact codebase terms (function names, type names, filenames)
   - Cross-reference with file paths (e.g., `src/common/base-server.ts:1234`)
   - Consistent vocabulary (no synonyms for core concepts)

5. **Machine-Parseable Structure:**
   - YAML frontmatter with metadata (audience, prerequisites, related concepts)
   - Standardized code block annotations (language, file path, line numbers)
   - Glossary/index sections for key terms

**Human readers benefit from the same principles** — clarity, conciseness, and examples.

---

## 1.2. The New 5-Stage Agent Flow Model

BitBrat's agent flow is being reframed from the traditional **perceive → plan → act → observe** to a more nuanced model:

| Stage | Description | Platform Services | Event Topics |
|-------|-------------|-------------------|--------------|
| **Attention** | What events are important and how important are they? | `ingress-egress`, `event-router` (rule matching) | `internal.ingress.v1` |
| **Contextualization** | Reestablish enough context around the event so an initial analysis can be made. Auth/authz always first. | `auth`, `query-analyzer` (fast pre-analysis) | `internal.contextualization.v1` (renamed from `internal.llmbot.v1` during analysis stage) |
| **Analysis** | What does the contextualized event mean for the agent? What responses or actions are appropriate? | `llm-bot`, `reflex`, `query-analyzer` | `internal.analysis.v1`, `internal.reflex.v1`, `internal.enriched.v1` |
| **Reaction** | Based on the analysis, what actions should be done? Actions often result in new events. | `state-engine`, `disposition-service`, `scheduler`, tool execution | `internal.egress.v1`, service-specific topics |
| **Introspection** | Were the reactions and their results appropriate? Can the agent learn anything from this interaction? | `persistence`, (future: feedback loops, learning services) | `internal.audit.v1` |

**Key Change:** The previous "analysis" stage is now **"contextualization"** — the stage where context is reestablished (user identity, permissions, environment state) BEFORE the agent analyzes what the event means.

**Terminology Migration Required:**
- Rename routing stage: `analysis` → `contextualization`
- Update all event router rules filtering on `routing.stage === 'analysis'`
- Update all documentation references
- Update all code references (no backward compatibility needed - clean cut)

---

## 2. Problem Statement

### Current State

The platform has:
- ✅ Well-documented Bit model (three rings, profiles, exposure)
- ✅ Well-documented routing slips and event router
- ✅ Well-documented dual execution paths (Reflex vs LLM)
- ❌ **No explicit documentation** of the enrich-and-next pattern
- ❌ **No guidance** on when/how to use `next()` vs `complete()`
- ❌ **No examples** showing canonical annotation flows

### Gap Discovered in Sprint 338

Quote from the user:
> "The final approach, of having a new bit that enriches context onto the event as annotations and sending it on its way using next(), is core to any agent-flow bits. It's perfectly fine to have bits that do other things, but the whole event and agent flow requires it. However, since the base platform is quite open in what it allows and the actual event flow is routing configuration, there is no actual code or explicit documentation going over this."

**Impact:**
- Developers building new bits don't have a clear canonical pattern to follow
- AI coding agents miss the pattern because it's implicit, not explicit
- Risk of inconsistent implementations (some bits use `complete()` when they should use `next()`)
- New contributors struggle to understand "how do I make my bit play nicely with the agent flow?"

### Why This Matters

The enrich-and-next pattern is **not optional** for agent-flow bits:
- `auth` enriches with user identity → `next()`
- `llm-bot` enriches with LLM response candidates → `next()`
- `query-analyzer` enriches with analysis hints → `next()`
- **Any new enrichment bit** (e.g., sentiment analysis, moderation, RAG context injection) **MUST** follow this pattern

Without documentation, this pattern is:
1. Discovered by reading existing code
2. Easily missed or misunderstood
3. Not enforced or validated

---

## 3. Scope

### In Scope

#### Phase 0: Agent-First Documentation Standards (Week 1, Day 1)
**Deliverable:** `documentation/guides/agent-first-documentation.md`

**Content:**
1. **Principles:** The 5 principles listed in §1.1
2. **Document Structure Templates:**
   - YAML frontmatter schema
   - Required sections (Prerequisites, Quick Example, API Reference, Anti-Patterns)
   - Code block annotations
3. **Terminology Standards:**
   - Glossary of canonical terms (use `next()`, not "advance routing slip")
   - Cross-reference format (file:line)
4. **Agent Optimization Checklist:**
   - Is the first code example complete and runnable?
   - Are decision trees present for any branching logic?
   - Are all error cases explicitly documented?
5. **Migration Guide:**
   - How to update existing docs to agent-first format

**Rationale:** Establish the standard FIRST so all subsequent docs follow it consistently.

---

#### Phase 1: Core Concept Documentation (Week 1)

**Deliverable 1a:** `documentation/concepts/agent-flow-stages.md` (NEW)

**Content:**
1. **The 5-Stage Agent Flow Model:**
   - Table from §1.2 with full descriptions
   - Mapping to traditional perceive→plan→act→observe
   - Stage transition rules (when events move from one stage to the next)
   - Routing slip stage field: `routing.stage`

2. **Stage Definitions:**
   - **Attention:** Rule matching, priority scoring, filtering
   - **Contextualization:** Auth/authz, user identity, environmental context
   - **Analysis:** LLM reasoning, tool selection, response generation
   - **Reaction:** Tool execution, state mutations, egress preparation
   - **Introspection:** Audit logging, feedback collection, learning (future)

3. **Terminology Migration:**
   - OLD: "analysis" stage (deprecated)
   - NEW: "contextualization" stage
   - Backward compatibility notes

4. **Code Examples:**
   ```typescript
   // Event router rule filtering on contextualization stage
   const rule = {
     logic: {
       "and": [
         { "===": [{ "var": "routing.stage" }, "contextualization"] },
         // ... other conditions
       ]
     }
   };
   ```

**Agent-First Format:**
- YAML frontmatter with `audience: [ai-agents, developers]`
- Leading with table and code examples
- Explicit RULES sections (e.g., "RULE: Auth ALWAYS runs first in contextualization")

---

**Deliverable 1b:** `documentation/concepts/agent-flow-patterns.md` (UPDATED)

**Content:**
1. **Introduction: What is the Agent Flow Pattern?**
   - Definition: Bits participate in agent orchestration by enriching events and advancing them through the routing slip
   - The two-step pattern: ENRICH → NEXT
   - **NEW:** Stages where this pattern applies (primarily Contextualization and Analysis)

2. **The Canonical Pattern:**
   ```typescript
   // Receive event
   await this.onMessage('internal.some-topic.v1', async (data, attrs, ctx) => {
     const event = data as InternalEventV2;

     // 1. ENRICH: Add your contribution to the event
     event.annotations.push({
       kind: 'your-contribution',
       value: 'your-data',
       source: this.name,
       id: randomUUID(),
       createdAt: new Date().toISOString()
     });

     // 2. NEXT: Advance the routing slip
     await this.next(event);
     await ctx.ack();
   });
   ```

3. **Key Decisions:**
   - **`next()` vs `complete()`**: When to use each
     - `next()`: Standard path - advance to next routing step (or egress if slip is empty)
     - `complete()`: Skip remaining routing slip, go directly to egress (use sparingly)
   - **Annotations vs Payload**: When to enrich annotations vs modify payload
   - **Candidates vs Direct Responses**: When to add response candidates vs setting `event.message`

4. **Annotation Flow:**
   - How annotations accumulate through the routing slip
   - How later bits can read/react to earlier annotations
   - Provenance tracking (`source`, `createdAt`)

5. **Anti-Patterns:**
   - ❌ Enriching without calling `next()` (event stalls)
   - ❌ Calling `complete()` when you should use `next()` (skips orchestration)
   - ❌ Modifying payload instead of adding annotations (loses provenance)
   - ❌ Not acknowledging messages (`ctx.ack()` forgotten)

6. **Examples of Agent-Flow Bits:**
   - `auth`: Enriches user identity
   - `llm-bot`: Enriches LLM response candidates
   - `query-analyzer`: Enriches routing hints
   - `reflex`: Enriches reflex execution results
   - Custom example: sentiment analyzer, moderation filter

#### Phase 2: Platform Flow Integration (Week 1)
**Deliverable:** Update `documentation/concepts/platform-flow.md`

**Changes:**
1. Add a new section (§2.5): **"The Enrich-and-Next Pattern"**
   - Explain how bits participate in each stage
   - Show the pattern in action during analysis and reaction stages
   - Reference the new `agent-flow-patterns.md` doc

2. Update the mermaid diagram to show annotation flow
   - Visualize how annotations accumulate
   - Show `next()` as the transition between services

3. Add a sequence diagram showing a complete enrich-and-next flow:
   ```
   ingress → router → auth (enrich user) → router → llm-bot (enrich response) → router → egress
   ```

#### Phase 3: Tutorial - Building an Enrichment Bit (Week 2)
**Deliverable:** `documentation/tutorials/building-an-enrichment-bit.md`

**Content:**
Step-by-step guide to building a **sentiment analyzer** bit:

1. **Objective:** Build a bit that enriches events with sentiment scores
2. **Prerequisites:** Platform running, `brat` CLI available
3. **Steps:**
   - Create the bit: `brat bit create sentiment-analyzer --profile core --register`
   - Implement sentiment analysis (simple keyword-based for tutorial)
   - Subscribe to the right topic
   - Enrich event with annotation
   - Call `next()`
   - Test with `brat chat`
   - Verify annotation in logs
4. **Extensions:**
   - Add ML-based sentiment (connect to external API)
   - Conditional enrichment (only for certain event types)
   - Reaction bits that respond to sentiment annotations

#### Phase 4: Reference Documentation (Week 2)
**Deliverable:** Update `documentation/reference/bit-control-plane.md` (if needed)

**Changes:**
- Add a "Routing Helpers" section documenting:
  - `next(event)`: Advance routing slip
  - `complete(event)`: Skip to egress
  - Decision tree/flowchart for choosing between them

**Deliverable:** Create `documentation/reference/eventing-api.md` (NEW)

**Content:**
- Full API reference for EventingProfile methods:
  - `onMessage<T>(topic, handler)`
  - `next(event)`
  - `complete(event)`
  - `publish(topic, data, attrs?)`
- Parameters, return types, error handling
- Examples for each method

#### Phase 5: README & CLAUDE.md Updates (Week 2)
**Deliverable:** Update `README.md`

**Changes:**
1. Update "Core Agent Concepts" table to include:
   ```markdown
   | Concept | In BitBrat | Where it lives |
   |---------|-----------|----------------|
   | **Agent-flow pattern** | Bits enrich events with annotations and call `next()` to advance the routing slip | [Agent Flow Patterns](./documentation/concepts/agent-flow-patterns.md), EventingProfile |
   ```

2. Update "Extending BitBrat" section:
   ```markdown
   ### Building an Agent-Flow Bit

   Most bits participate in the agent loop by **enriching events** and **advancing the routing slip**:

   1. Subscribe to a topic via `onMessage(topic, handler)`
   2. Enrich the event (add annotations, context, candidates)
   3. Call `next(event)` to advance to the next routing step
   4. Acknowledge the message

   See [Agent Flow Patterns](./documentation/concepts/agent-flow-patterns.md) and the
   [Building an Enrichment Bit tutorial](./documentation/tutorials/building-an-enrichment-bit.md).
   ```

**Deliverable:** Update `CLAUDE.md`

**Changes:**
Add a new section under "## Common Development Patterns":

```markdown
### Building Agent-Flow Bits (Enrich-and-Next Pattern)

**The canonical pattern** for bits that participate in agent orchestration:

1. **Subscribe** to a topic: `this.onMessage('internal.some-topic.v1', async (data, attrs, ctx) => { ... })`
2. **Enrich** the event:
   - Add annotations: `event.annotations.push({ kind, value, source: this.name, id, createdAt })`
   - OR add response candidates: `event.candidates.push({ kind: 'text', text, source: this.name, id })`
   - OR modify payload (rare): `event.payload.yourField = 'value'`
3. **Advance** the routing slip: `await this.next(event)`
4. **Acknowledge**: `await ctx.ack()`

**Key Decision: `next()` vs `complete()`**
- **`next(event)`**: Standard path - advance to next routing step (or egress if slip empty). USE THIS by default.
- **`complete(event)`**: Skip remaining routing slip, go directly to egress. Use only when you explicitly want to short-circuit orchestration.

**Examples:**
- `auth`: Enriches user identity, calls `next()`
- `llm-bot`: Enriches LLM response candidates, calls `next()`
- `query-analyzer`: Enriches analysis hints, calls `next()`

See [Agent Flow Patterns](./documentation/concepts/agent-flow-patterns.md) for full details.
```

#### Phase 6: Diagrams & Visual Aids (Week 2)
**Deliverable:** Visual diagrams showing:

1. **5-stage agent flow diagram** (Mermaid)
2. **Enrich-and-next flow sequence diagram** (Mermaid)
3. **Decision tree: next() vs complete()** (Mermaid flowchart)
4. **Annotation accumulation diagram** (showing how annotations build up through routing slip)

Integrate these into `agent-flow-patterns.md`, `agent-flow-stages.md`, and `platform-flow.md`.

---

#### Phase 7: Terminology Migration - analysis → contextualization (Week 2)
**Deliverable:** Complete codebase and docs migration with new terminology (clean cut, no backward compatibility)

**Tasks:**
1. **Documentation Updates:**
   - Find all references to `routing.stage === 'analysis'` or `stage: analysis`
   - Update to `routing.stage === 'contextualization'`
   - Update README, CLAUDE.md, platform-flow.md, event-router-rules.md
   - Update all tutorials, examples, comments

2. **Code Updates (IN SCOPE - Clean Cut):**
   - Event router stage constants/enums
   - Routing slip stage validation
   - Rule seeding (Firestore seed data)
   - Event router rule evaluation
   - Any hardcoded "analysis" strings in source
   - Test fixtures and test assertions

3. **Testing:**
   - Update existing tests to use "contextualization"
   - Verify all event flows still work
   - Run full test suite

**Rationale:** Clean cut is simpler than backward compatibility. Update everything at once.

### Out of Scope

- **New bits:** No new services created (tutorial uses a simple example)
- **Refactoring existing bit logic:** No changes to how bits work, just terminology updates
- **New tests:** Existing tests updated for new terminology, but no new test coverage needed
- **Architecture changes:** Pattern is already implemented, just undocumented
- **Video/interactive content:** Deferred to P3

---

## 4. Prioritized Backlog (Updated)

### P0 - Critical (Must Have)
**Goal:** Immediately close the sprint 338 gap AND establish agent-first documentation standards

1. ✅ Create `documentation/guides/agent-first-documentation.md` (standards guide) — **NEW**
2. ✅ Create `documentation/concepts/agent-flow-stages.md` (5-stage model) — **NEW**
3. ✅ Create `documentation/concepts/agent-flow-patterns.md` (canonical pattern doc)
4. ✅ Update `README.md` with 5-stage model and agent-flow pattern
5. ✅ Update `CLAUDE.md` with agent-first pattern guidance
6. ✅ Terminology migration in documentation (analysis → contextualization) — **NEW**

**Rationale:**
- Agent-first standards ensure all subsequent docs are optimized for AI agents (primary audience)
- 5-stage model establishes the new conceptual framework
- Pattern doc + README/CLAUDE updates close the sprint 338 gap
- Terminology migration aligns docs with the new model

### P1 - High Priority (Should Have)
4. ✅ Update `documentation/concepts/platform-flow.md` to explicitly call out the pattern
5. ✅ Create `documentation/tutorials/building-an-enrichment-bit.md`

**Rationale:** Reinforces the pattern in existing docs and provides hands-on learning.

### P2 - Medium Priority (Nice to Have)
6. ⚠️ Create `documentation/reference/eventing-api.md` (API reference)
7. ⚠️ Add visual diagrams (sequence, decision tree, annotation flow)

**Rationale:** Completes the documentation suite; less urgent than core concept docs.

### P3 - Low Priority (Future Enhancement)
8. 🔮 Create video walkthrough of building an enrichment bit
9. 🔮 Add interactive examples (e.g., CodeSandbox embeds)
10. 🔮 Generate OpenAPI-style docs for EventingProfile methods

**Rationale:** Nice polish but not essential for closing the gap.

---

## 5. Execution Strategy

### Week 1: Foundations & Core Concepts
**Day 1 (Morning):**
- Create `agent-first-documentation.md` standards guide (P0-1)
- Establish templates and patterns for all subsequent docs

**Day 1 (Afternoon) - Day 2:**
- Draft `agent-flow-stages.md` (P0-2) — the 5-stage model
- Create `agent-flow-patterns.md` (P0-3) using agent-first format
- Review with user for accuracy and agent-friendliness

**Days 3-4:**
- Update `README.md` with 5-stage model and pattern (P0-4)
- Update `CLAUDE.md` with agent-first guidance (P0-5)
- Update `platform-flow.md` to call out patterns (P1-1)

**Day 5:**
- Begin terminology migration discovery phase (P0-6)
- Scan entire codebase for "analysis" references
- Document all locations (docs, code, tests, data)
- Internal review and refinement of week 1 deliverables

### Week 2: Terminology Migration, Tutorial, Reference & Diagrams
**Days 1-2:**
- Execute complete terminology migration (P0-6):
  - Documentation updates (all files)
  - Code updates (constants, enums, validation, hardcoded strings)
  - Data updates (Firestore seed data, rule JSON files)
  - Test updates (fixtures, assertions)
  - Verify all tests pass
  - Generate migration report

**Day 3:**
- Create `building-an-enrichment-bit.md` tutorial using agent-first format (P1-2)
- Test tutorial steps locally

**Day 4:**
- Create visual diagrams (P2-2):
  - 5-stage flow
  - Enrich-and-next sequence
  - Decision trees
- Create `eventing-api.md` reference (P2-1) using agent-first format

**Day 5:**
- Update `bit-control-plane.md` with routing helpers (P2-3)
- Final review and polish
- Verify all tests still passing
- Create PR

---

## 6. Acceptance Criteria

### P0 Items (Must Pass - 100% Required)

- [ ] `documentation/guides/agent-first-documentation.md` exists and contains:
  - [ ] 5 core principles from §1.1
  - [ ] YAML frontmatter schema for agent-first docs
  - [ ] Code block annotation standards
  - [ ] Terminology glossary (canonical terms)
  - [ ] Migration guide for updating existing docs

- [ ] `documentation/concepts/agent-flow-stages.md` exists and contains:
  - [ ] 5-stage model table (Attention → Contextualization → Analysis → Reaction → Introspection)
  - [ ] Mapping to traditional perceive→plan→act→observe
  - [ ] Stage transition rules
  - [ ] Terminology migration notes (analysis → contextualization)
  - [ ] Code examples for each stage
  - [ ] YAML frontmatter with `audience: [ai-agents, developers]`

- [ ] `documentation/concepts/agent-flow-patterns.md` exists and contains:
  - [ ] Clear definition of the enrich-and-next pattern
  - [ ] Complete, runnable code examples with type signatures
  - [ ] `next()` vs `complete()` decision guide
  - [ ] Annotations vs payload guidance
  - [ ] Anti-patterns section with NEVER/ALWAYS rules
  - [ ] Links to existing bits as examples (auth, llm-bot, query-analyzer)
  - [ ] Cross-references with file paths (e.g., `src/common/base-server.ts:1234`)
  - [ ] YAML frontmatter (agent-first format)

- [ ] `README.md` updated:
  - [ ] 5-stage agent flow model documented (replacing perceive→plan→act→observe)
  - [ ] Core Agent Concepts table includes agent-flow pattern
  - [ ] Extending BitBrat section includes "Building an Agent-Flow Bit"
  - [ ] Uses "contextualization" (not "analysis") for stage references

- [ ] `CLAUDE.md` updated:
  - [ ] Common Development Patterns section includes enrich-and-next (agent-first format)
  - [ ] Complete code examples with imports and types
  - [ ] Explicit RULES for `next()` vs `complete()`
  - [ ] Uses "contextualization" terminology
  - [ ] Cross-references to new docs

- [ ] Complete terminology migration (documentation + code):
  - [ ] ALL documentation references updated
  - [ ] ALL code references updated (constants, enums, validation, hardcoded strings)
  - [ ] ALL Firestore seed data updated
  - [ ] ALL test fixtures and assertions updated
  - [ ] Zero remaining "analysis" stage references in entire codebase
  - [ ] `npm run build` succeeds
  - [ ] `npm test` passes (all tests)
  - [ ] Migration report documenting all changes

### P1 Items (Should Pass)
- [ ] `documentation/concepts/platform-flow.md` updated:
  - [ ] New section explicitly calling out enrich-and-next pattern
  - [ ] Updated diagram showing annotation flow
- [ ] `documentation/tutorials/building-an-enrichment-bit.md` exists and contains:
  - [ ] Step-by-step guide to building sentiment analyzer
  - [ ] Code examples that work
  - [ ] Testing instructions
  - [ ] Extensions/next steps

### P2 Items (Nice to Have)
- [ ] `documentation/reference/eventing-api.md` created with full API reference
- [ ] Visual diagrams created and integrated:
  - [ ] Sequence diagram of enrich-and-next flow
  - [ ] Decision tree for `next()` vs `complete()`
  - [ ] Annotation accumulation diagram

---

## 7. Validation

### Build Validation
```bash
# No code changes, so build validation is N/A
# Documentation can be previewed via markdown renderer
```

### Content Validation
1. **Technical Accuracy:**
   - Review all code examples against actual `Bit` base class
   - Verify `next()` / `complete()` signatures match implementation
   - Validate annotation schema matches `AnnotationV1` type

2. **Clarity Testing:**
   - Have a developer (unfamiliar with the pattern) read the docs
   - Can they build a simple enrichment bit without additional help?
   - Survey: "After reading this, do you understand when to use `next()` vs `complete()`?"

3. **Consistency Check:**
   - Cross-reference all mentions of `next()` across docs
   - Ensure terminology is consistent (e.g., "routing slip" not "routing plan")
   - Verify links between documents work

4. **AI Agent Testing:**
   - Provide CLAUDE.md + agent-flow-patterns.md to a fresh AI session
   - Ask: "How do I build a bit that adds sentiment analysis to events?"
   - Validate the AI suggests the correct enrich-and-next pattern

---

## 8. Success Metrics

**Qualitative:**
- [ ] Developer feedback: "I now understand the agent-flow pattern"
- [ ] AI agent coding sessions: Agents correctly implement enrich-and-next without being told
- [ ] User confirmation: "This closes the gap from sprint 338"
- [ ] User confirmation: "Agent-first documentation format is effective"

**Quantitative:**
- [ ] All P0 acceptance criteria met (6/6 tasks complete)
- [ ] All P1 acceptance criteria met (2/2 tasks complete)
- [ ] Zero broken links in updated documentation
- [ ] All code examples in docs are syntactically valid TypeScript
- [ ] Zero "analysis" stage references remaining in codebase
- [ ] Build succeeds: `npm run build` exits 0
- [ ] All tests pass: `npm test` exits 0

---

## 9. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Pattern misunderstood by writer** | Low | High | Review with user early; validate against actual code |
| **Terminology migration breaks tests** | Medium | High | Run full test suite after each phase; fix incrementally; keep migration atomic |
| **Missed "analysis" references** | Medium | Medium | Multiple grep passes with different patterns; final verification grep |
| **Documentation becomes stale** | Medium | Medium | Add note linking to `src/common/base-server.ts` as source of truth |
| **Examples don't work** | Low | High | Test all code examples locally before publishing |
| **Terminology inconsistency** | Low | Low | Agent-first standards enforce canonical terms; glossary in place |
| **Over-documentation (too verbose)** | Low | Low | Agent-first format prioritizes examples over prose |

---

## 10. Definition of Done

Sprint complete when ALL of:
- [ ] All P0 acceptance criteria met (6/6 tasks, 100%)
- [ ] All P1 acceptance criteria met (2/2 tasks, 100%)
- [ ] User reviews and approves all documentation
- [ ] All code examples tested and validated
- [ ] All links functional
- [ ] Complete terminology migration executed:
  - [ ] Zero "analysis" stage references in codebase
  - [ ] `npm run build` succeeds
  - [ ] `npm test` passes (all tests)
  - [ ] Migration report generated
- [ ] AI agent test passes (fresh session correctly implements pattern)
- [ ] PR created and ready for merge
- [ ] This execution plan archived to `planning/sprint-341-agent-flow-pattern-docs/`

---

## 11. Open Questions for User

1. **Scope Confirmation:**
   - Is P0 + P1 sufficient for sprint 341 (42 hours), or do you want P2 (diagrams, API reference) as well (54 hours total)?

2. **Tutorial Example:**
   - Sentiment analyzer is proposed - is this a good example, or would you prefer a different domain (e.g., moderation filter, context injector)?

3. **Existing Docs:**
   - Should we also update `documentation/tutorials/lurk-command.md` to explicitly call out the pattern?

4. **Terminology:**
   - "Agent-flow pattern" vs "Enrich-and-next pattern" vs "Event enrichment pattern" - which term should be canonical in docs?

5. **Migration Verification:**
   - After terminology migration, should we test locally (`npm run local`) or is build + test suite sufficient?

6. ~~**Backward Compatibility:**~~ ✅ ANSWERED
   - ~~Preserve backward compatibility during migration?~~
   - **ANSWER: No - clean cut, update everything at once**

---

## 12. References

**Sprint 338 Materials:**
- `planning/sprint-338-rag-context-provisioning/execution-plan.md`
- `planning/sprint-338-rag-context-provisioning/technical-architecture.md`
- `planning/sprint-338-rag-context-provisioning/p0-p3-verification-report.md`

**Existing Documentation:**
- `README.md`
- `CLAUDE.md`
- `documentation/concepts/platform-flow.md`
- `documentation/concepts/bit-model.md`
- `documentation/concepts/event-router-rules.md`
- `documentation/tutorials/lurk-command.md`

**Code References:**
- `src/common/base-server.ts` (Bit base class, `next()` / `complete()` implementation)
- `src/common/profiles/eventing.ts` (EventingProfile)
- `src/types/events.ts` (InternalEventV2, AnnotationV1 schemas)

---

**Document Status:** PLANNING (awaiting user approval)
**Next Steps:**
1. User reviews execution plan
2. User approves or requests changes
3. User says "Start sprint" to begin documentation work
4. Technical Writer tracks progress in backlog YAML

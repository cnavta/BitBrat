---
title: "Agent-First Documentation Standards"
audience: [ai-agents, technical-writers, developers]
version: "1.0"
status: "active"
created: "2026-07-14"
purpose: "Define standards for documentation optimized for AI coding agent consumption"
prerequisites: []
related:
  - "CLAUDE.md"
  - "README.md"
  - "documentation/concepts/agent-flow-patterns.md"
---

# Agent-First Documentation Standards

**Primary Audience:** AI Coding Agents (Claude, GPT-4, etc.)
**Secondary Audience:** Human Developers

**Core Principle:** Documentation optimized for AI agent parsing and understanding is also excellent documentation for humans. Clarity, explicitness, and executable examples benefit all readers.

---

## Quick Reference

**RULE: Follow these standards for ALL new BitBrat documentation.**

**The 5 Principles:**
1. **Structured & Scannable** — Consistent headings, lead with examples, minimize prose
2. **Code-Heavy** — Complete, runnable examples with type signatures
3. **Explicit Over Implicit** — State rules as ALWAYS/NEVER, provide decision trees
4. **Searchable Terminology** — Exact codebase terms, file:line cross-references
5. **Machine-Parseable** — YAML frontmatter, annotated code blocks, glossary sections

---

## 1. The 5 Agent-First Principles

### 1.1. Structured & Scannable

**RULE: Use consistent heading hierarchies and lead with definitions and examples.**

AI agents parse documents sequentially. Structure matters:

**DO:**
- Use H1 for document title
- Use H2 for major sections
- Use H3 for subsections
- Lead each section with a definition or example
- Use tables for structured data
- Use lists for steps or options
- Keep paragraphs under 4 sentences

**DON'T:**
- Skip heading levels (H1 → H3)
- Bury important information deep in prose
- Use ambiguous section titles ("Overview", "Misc")
- Write long narrative paragraphs without structure

**Example (Good):**

```markdown
## The Enrich-and-Next Pattern

**Quick Example:**
```typescript
// Complete, runnable code here
```

**When to use:** Contextualization and Analysis stages

**Pattern:** ENRICH → NEXT

**Steps:**
1. Subscribe via `onMessage()`
2. Enrich event with annotations
3. Call `next(event)`
4. Acknowledge with `ctx.ack()`
```

**Example (Bad):**

```markdown
## The Pattern

This section discusses an important pattern that you might want to use
when building services that need to participate in the event flow. The
pattern involves enriching events and then advancing them, which is
something that many of our services do...
```

---

### 1.2. Code-Heavy

**RULE: Show don't tell. Provide complete, runnable code examples.**

**DO:**
- Provide complete imports and type signatures
- Use realistic variable names and context
- Include file path comments: `// File: src/apps/example.ts`
- Make examples copy-pasteable and executable
- Use actual types from the codebase (not pseudocode)

**DON'T:**
- Use pseudocode or incomplete snippets
- Omit imports or type information
- Use placeholder names like `foo`, `bar`, `example`
- Write narrative explanations when code would be clearer

**Example (Good):**

```typescript
// File: src/apps/sentiment-analyzer.ts
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';
import { randomUUID } from 'crypto';

export class SentimentAnalyzer extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.contextualization.v1',
      async (event, attrs, ctx) => {
        // Analyze sentiment
        const sentiment = this.analyzeSentiment(event.message?.text || '');

        // Enrich event
        event.annotations.push({
          kind: 'sentiment',
          value: sentiment,
          source: this.name,
          id: randomUUID(),
          createdAt: new Date().toISOString()
        });

        // Advance routing slip
        await this.next(event);
        await ctx.ack();
      }
    );
  }

  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    // Simple keyword-based implementation
    if (/love|great|awesome|excellent/i.test(text)) return 'positive';
    if (/hate|terrible|awful|bad/i.test(text)) return 'negative';
    return 'neutral';
  }
}
```

**Example (Bad):**

```typescript
// Subscribe to events and enrich them
onMessage((event) => {
  // Do sentiment analysis
  event.annotations.push(/* sentiment data */);
  next(event);
});
```

---

### 1.3. Explicit Over Implicit

**RULE: State patterns as explicit rules. Use ALWAYS/NEVER. Provide decision trees.**

AI agents don't infer best practices from prose. Make rules explicit:

**DO:**
- Use RULE:, ALWAYS, NEVER prefixes for directives
- Provide decision trees for branching logic
- State error conditions explicitly
- Document what NOT to do (anti-patterns)
- Be prescriptive, not descriptive

**DON'T:**
- Rely on implicit conventions
- Use phrases like "you might want to" or "consider"
- Leave error handling unstated
- Assume familiarity with patterns

**Example (Good):**

```markdown
**RULE: Use `next(event)` by default**

**Decision Tree: next() vs complete()**

```
Is this the final processing step for this event?
├─ No → Use next(event)
└─ Yes
    ├─ Should downstream services still process it? → Use next(event)
    └─ Skip all remaining routing steps? → Use complete(event)
```

**ALWAYS:**
- Call `ctx.ack()` after processing
- Set `source: this.name` on annotations
- Use `randomUUID()` for annotation IDs

**NEVER:**
- Modify `event.payload` unless you own the event type
- Forget to call `next()` or `complete()` (event will stall)
- Use `complete()` when `next()` is appropriate
```

**Example (Bad):**

```markdown
Generally, you'll want to use `next()` to advance the event through
the routing slip. Sometimes you might use `complete()` if you want
to skip steps. Make sure to acknowledge the message.
```

---

### 1.4. Searchable Terminology

**RULE: Use exact codebase terms. Provide file:line cross-references.**

**DO:**
- Use canonical function/type/class names from the codebase
- Cross-reference with `file:line` format
- Link to actual source code locations
- Use consistent terminology (no synonyms for core concepts)
- Build and maintain a glossary

**DON'T:**
- Use multiple terms for the same concept
- Reference code without file paths
- Use colloquial names for official APIs
- Assume agents know alternate names

**Canonical Terminology (Glossary):**

| Term | Type | File | Description |
|------|------|------|-------------|
| `next(event)` | Method | `src/common/base-server.ts:845` | Advance routing slip to next step |
| `complete(event)` | Method | `src/common/base-server.ts:867` | Skip routing slip, go to egress |
| `onMessage<T>(topic, handler)` | Method | `src/common/base-server.ts:756` | Subscribe to message bus topic |
| `InternalEventV2` | Type | `src/types/events.ts:45` | Platform event envelope (v2) |
| `AnnotationV1` | Type | `src/types/events.ts:89` | Event annotation structure |
| `RoutingSlip` | Type | `src/types/events.ts:123` | Ordered list of routing steps |
| `EventingProfile` | Class | `src/common/profiles/eventing.ts:12` | Eventing capability mixin |
| `Bit` | Class | `src/common/base-server.ts:67` | Base class for all services |

**Example (Good):**

```markdown
See `Bit.next()` implementation in `src/common/base-server.ts:845` for
the routing slip advancement logic.

The `InternalEventV2` type (src/types/events.ts:45) defines the platform
event envelope.
```

**Example (Bad):**

```markdown
See the next method for how events are advanced. The event type defines
the envelope structure.
```

---

### 1.5. Machine-Parseable Structure

**RULE: Use YAML frontmatter, annotate code blocks, provide structured metadata.**

**DO:**
- Include YAML frontmatter in all concept/guide/reference docs
- Annotate code blocks with language and optional file path
- Structure examples as reusable templates
- Provide machine-readable summaries

**DON'T:**
- Omit metadata from documents
- Leave code blocks unannotated
- Bury key information in prose
- Assume agents will parse freeform text

**YAML Frontmatter Schema:**

```yaml
---
title: "Document Title"
audience: [ai-agents, developers]  # REQUIRED
version: "1.0"                     # Semantic version
status: "active | draft | deprecated"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
purpose: "One-line description"
prerequisites:
  - "Prerequisite concept or skill"
related:
  - "path/to/related/doc.md"
tags: [concept, guide, reference, tutorial]
---
```

**Code Block Annotations:**

````markdown
```typescript
// File: src/apps/example-service.ts
// Purpose: Demonstrates the enrich-and-next pattern
import { Bit } from '../common/base-server';

export class ExampleService extends Bit {
  // Implementation...
}
```
````

---

## 2. Document Structure Templates

### 2.1. Concept Document Template

**File:** `documentation/concepts/<concept-name>.md`

**Structure:**

```markdown
---
title: "Concept Name"
audience: [ai-agents, developers]
version: "1.0"
status: "active"
purpose: "Explain <concept> and when to use it"
prerequisites: ["List", "Prerequisites"]
related: ["related/doc.md"]
---

# Concept Name

**One-line definition of the concept**

---

## Quick Example

```typescript
// Complete, runnable code demonstrating the concept
```

**When to use:** [Stage/scenario]

---

## 1. What is [Concept]?

**Definition:** Clear, explicit definition

**Key Components:**
- Component 1
- Component 2

---

## 2. How [Concept] Works

**RULE: [Primary rule]**

**Steps:**
1. Step 1
2. Step 2

**Code Example:**
```typescript
// Complete example
```

---

## 3. Rules & Decision Trees

**ALWAYS:**
- Rule 1
- Rule 2

**NEVER:**
- Anti-pattern 1
- Anti-pattern 2

**Decision Tree:**
```
Condition?
├─ True → Action A
└─ False → Action B
```

---

## 4. Examples in the Wild

**[Service Name]** (`src/apps/service.ts:123`)
- What it does
- How it uses the concept

---

## 5. Related Concepts

- [Related Concept 1](./related.md)
- [Related Concept 2](./other.md)
```

---

### 2.2. Guide Document Template

**File:** `documentation/guides/<guide-name>.md`

**Structure:**

```markdown
---
title: "How to [Do Something]"
audience: [ai-agents, developers]
version: "1.0"
status: "active"
purpose: "Step-by-step guide for [task]"
prerequisites: ["Required", "Knowledge"]
related: ["related/guide.md"]
---

# How to [Do Something]

**Objective:** Accomplish [specific goal]

**Prerequisites:**
- Prerequisite 1
- Prerequisite 2

---

## Quick Start

```bash
# Fastest path to results
command --option
```

---

## Step 1: [First Step]

**Purpose:** Why this step matters

**Commands:**
```bash
npm run command
```

**Expected Output:**
```
Output here
```

**Verification:**
```bash
# How to verify this step worked
npm test
```

---

## Step 2: [Next Step]

[Continue pattern...]

---

## Troubleshooting

**Problem:** Error X occurs

**Solution:**
1. Step 1
2. Step 2

**Verification:**
```bash
# Verify fix
```

---

## Next Steps

- [Related Guide](./next-guide.md)
- [Advanced Topic](./advanced.md)
```

---

### 2.3. Reference Document Template

**File:** `documentation/reference/<api-name>.md`

**Structure:**

```markdown
---
title: "[API Name] Reference"
audience: [ai-agents, developers]
version: "1.0"
status: "active"
purpose: "Complete API reference for [API]"
prerequisites: []
related: ["concept/using-api.md"]
---

# [API Name] Reference

**File:** `src/path/to/api.ts`

**Purpose:** One-line API description

---

## Quick Reference

| Method | Purpose | Returns |
|--------|---------|---------|
| `method1()` | What it does | Type |
| `method2()` | What it does | Type |

---

## Methods

### `methodName(param: Type): ReturnType`

**File:** `src/path/to/api.ts:123`

**Purpose:** What this method does

**Parameters:**
- `param` (Type): Description

**Returns:** `ReturnType` — Description

**Throws:**
- `ErrorType` — When this error occurs

**Example:**
```typescript
// Complete example
const result = api.methodName(value);
```

**RULE: [Important rule about this method]**

---

[Repeat for each method]
```

---

### 2.4. Tutorial Document Template

**File:** `documentation/tutorials/<tutorial-name>.md`

**Structure:**

```markdown
---
title: "Building [Thing]"
audience: [developers, ai-agents]
version: "1.0"
status: "active"
purpose: "Step-by-step tutorial for building [thing]"
prerequisites: ["Platform running", "CLI installed"]
related: ["concepts/related.md"]
estimated_time: "30 minutes"
---

# Building [Thing]

**What you'll build:** Description

**What you'll learn:**
- Skill 1
- Skill 2

**Time:** ~30 minutes

---

## Prerequisites

- [ ] Platform running (`npm run local`)
- [ ] brat CLI installed
- [ ] Basic TypeScript knowledge

---

## Step 1: Create [Component]

**Goal:** Create the basic structure

**Command:**
```bash
npm run brat -- bit create example
```

**Expected Output:**
```
✓ Created src/apps/example-service.ts
✓ Created tests/apps/example-service.test.ts
```

**Verify:**
```bash
ls -la src/apps/example-service.ts
```

---

[Continue with numbered steps...]

---

## Testing Your Work

**Run tests:**
```bash
npm test -- example-service
```

**Expected:** All tests pass

---

## Extensions

**Next Steps:**
1. Add [feature]
2. Integrate with [system]

**Related Tutorials:**
- [Advanced Topic](./advanced-tutorial.md)
```

---

## 3. Terminology Standards

### 3.1. Canonical Terms

**RULE: Use ONLY these canonical terms for core concepts. No synonyms.**

| Canonical Term | DON'T Use | Definition |
|----------------|-----------|------------|
| Bit | service, microservice, component | A service extending the Bit base class |
| Enrich-and-next pattern | event enrichment, annotation pattern | Pattern: enrich event → call next() |
| Contextualization stage | analysis stage (deprecated), auth stage | Stage 2: Reestablish context (auth, env) |
| Analysis stage | reasoning stage, LLM stage | Stage 3: LLM reasoning, tool selection |
| Routing slip | route, pipeline, workflow | Ordered list of routing steps |
| Annotation | metadata, tag, attribute | Structured metadata on InternalEventV2 |
| `next(event)` | advance, forward, route | Advance to next routing step |
| `complete(event)` | finish, skip, shortcut | Skip to egress, bypass routing slip |
| EventingProfile | eventing mixin, event capability | Capability profile for message bus |

### 3.2. Cross-Reference Format

**RULE: Use `file:line` format for all code references.**

**Format:** `` `MethodName` (`file/path.ts:line`) ``

**Examples:**
- `Bit.next()` (`src/common/base-server.ts:845`)
- `InternalEventV2` type (`src/types/events.ts:45`)
- `resolveContextPacks()` (`src/common/context/resolver.ts:43`)

**When line numbers change:**
- Update references during PR review
- Use approximate line numbers (e.g., `:~850` for `:845`)
- Link to the class/function, not a specific statement

---

## 4. Agent Optimization Checklist

**Use this checklist when writing or reviewing documentation:**

### 4.1. Structure & Scannability
- [ ] YAML frontmatter present and complete
- [ ] Heading hierarchy is consistent (no skipped levels)
- [ ] First code example appears within first 20 lines
- [ ] Tables used for structured data
- [ ] Lists used for steps/options
- [ ] Paragraphs under 4 sentences

### 4.2. Code Quality
- [ ] All code examples are complete and runnable
- [ ] Type signatures included
- [ ] Imports included
- [ ] File path comments present
- [ ] Realistic variable names (no foo/bar)
- [ ] Examples tested locally

### 4.3. Explicitness
- [ ] Rules stated with RULE:, ALWAYS, NEVER
- [ ] Decision trees present for branching logic
- [ ] Error conditions explicitly documented
- [ ] Anti-patterns section included
- [ ] No implicit assumptions

### 4.4. Terminology
- [ ] Canonical terms used (check glossary)
- [ ] No synonyms for core concepts
- [ ] Cross-references use file:line format
- [ ] Links to source code included
- [ ] Glossary updated if new terms introduced

### 4.5. Parseability
- [ ] YAML frontmatter follows schema
- [ ] Code blocks annotated with language
- [ ] Structured summaries provided
- [ ] Machine-readable tables used
- [ ] Metadata complete

---

## 5. Migration Guide

**Updating existing documentation to agent-first format:**

### 5.1. Assessment

**For each existing document, evaluate:**

1. **Audience:** Is it clear who this is for?
2. **Structure:** Is it scannable by an AI agent?
3. **Examples:** Are code examples complete and runnable?
4. **Explicitness:** Are rules stated explicitly?
5. **Terminology:** Does it use canonical terms?

### 5.2. Migration Steps

**Step 1: Add YAML Frontmatter**

```yaml
---
title: "[Extract from first H1]"
audience: [ai-agents, developers]
version: "1.0"
status: "active"
created: "[Today's date]"
purpose: "[Write one-line purpose]"
prerequisites: ["[Extract]", "from", "intro"]
related: ["[Find]", "related/docs.md"]
---
```

**Step 2: Restructure for Scannability**

- Move code examples up (lead with examples)
- Break long paragraphs into lists
- Add tables for structured data
- Ensure consistent heading hierarchy

**Step 3: Complete Code Examples**

- Add imports and types
- Test examples locally
- Add file path comments
- Use realistic names

**Step 4: Make Rules Explicit**

- Convert "best practices" to ALWAYS/NEVER rules
- Add decision trees for branching logic
- Document anti-patterns
- State error conditions

**Step 5: Standardize Terminology**

- Replace synonyms with canonical terms
- Add file:line cross-references
- Link to source code
- Update glossary

**Step 6: Validate**

- Run through agent optimization checklist
- Test all code examples
- Verify all links work
- Get peer review

### 5.3. Migration Priority

**High Priority (Do First):**
- CLAUDE.md
- README.md
- Core concept docs (bit-model, platform-flow, agent-flow-patterns)

**Medium Priority:**
- Guides and tutorials
- Reference documentation

**Low Priority:**
- Historical documentation
- Deprecated content (may not be worth migrating)

---

## 6. Examples

### 6.1. Before & After: Concept Documentation

**BEFORE (Narrative Style):**

```markdown
# Events

In the BitBrat platform, events are how services communicate. When
something happens, like a user sending a chat message, it creates an
event that flows through the system. Services can listen for events
and respond to them. There are different types of events for different
purposes.
```

**AFTER (Agent-First Style):**

```markdown
---
title: "InternalEventV2: Platform Event Envelope"
audience: [ai-agents, developers]
version: "1.0"
status: "active"
created: "2026-07-14"
purpose: "Define the platform event structure and flow"
prerequisites: []
related: ["agent-flow-stages.md", "event-router-rules.md"]
---

# InternalEventV2: Platform Event Envelope

**Type:** `InternalEventV2` (`src/types/events.ts:45`)

**Purpose:** All platform events use this envelope structure for routing and enrichment.

---

## Quick Example

```typescript
// File: src/apps/example-service.ts
import { InternalEventV2 } from '../types/events';

const event: InternalEventV2 = {
  v: '2',
  type: 'llm.request.v1',
  correlationId: 'uuid-here',
  routing: {
    stage: 'contextualization',
    slip: [/* routing steps */]
  },
  message: { text: 'Hello', channel: 'twitch' },
  annotations: [],
  candidates: []
};
```

**RULE: All events MUST include `v`, `type`, `correlationId`, and `routing`.**

---

## 1. Event Structure

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `v` | `'2'` | Yes | Envelope version (always '2') |
| `type` | `InternalEventType` | Yes | Event type (e.g., 'llm.request.v1') |
| `correlationId` | `string` | Yes | Trace ID across services |
| `routing` | `RoutingContext` | Yes | Current stage + routing slip |
| `message` | `MessageV1` | No | User message (if applicable) |
| `annotations` | `AnnotationV1[]` | Yes | Enrichments from services |
| `candidates` | `ResponseCandidate[]` | Yes | Potential responses |

---

## 2. Event Flow

**Stages:**
1. **Attention** → Event created, routing slip assigned
2. **Contextualization** → Auth, env context added
3. **Analysis** → LLM reasoning, tool selection
4. **Reaction** → Actions executed
5. **Introspection** → Audit logged

See [Agent Flow Stages](./agent-flow-stages.md) for details.
```

---

### 6.2. Before & After: Guide Documentation

**BEFORE:**

```markdown
# Creating a Service

If you want to create a new service, you can use the brat CLI. Run
the command and it will generate the files you need. Then you can
implement your logic.
```

**AFTER:**

```markdown
---
title: "Creating a New Bit"
audience: [ai-agents, developers]
version: "1.0"
status: "active"
created: "2026-07-14"
purpose: "Step-by-step guide to create a new Bit (service)"
prerequisites: ["brat CLI installed", "Platform repository cloned"]
related: ["concepts/bit-model.md", "guides/agent-first-documentation.md"]
---

# Creating a New Bit

**Goal:** Create a new Bit (service) using the brat CLI

**Time:** ~5 minutes

---

## Quick Start

```bash
npm run brat -- bit create my-service --profile core --register
```

**Output:**
```
✓ Created src/apps/my-service.ts
✓ Created tests/apps/my-service.test.ts
✓ Updated architecture.yaml
```

---

## Step 1: Choose Profile

**RULE: Select the profile that matches your service's capabilities.**

**Decision Tree:**
```
What does your service do?
├─ Processes events, no LLM → --profile core
├─ Uses LLM for reasoning → --profile llm
├─ Exposes MCP tools → --profile mcp-server
└─ Aggregates other services → --profile gateway
```

See [Capability Profiles](../concepts/capability-profiles.md) for details.

---

## Step 2: Run Command

```bash
npm run brat -- bit create <name> \
  --profile <profile> \
  --category platform \
  --register \
  --active
```

**Parameters:**
- `<name>`: Kebab-case name (e.g., `sentiment-analyzer`)
- `--profile`: Capability profile (core, llm, mcp-server, gateway)
- `--category`: platform or domain (default: platform)
- `--register`: Add to architecture.yaml
- `--active`: Mark as deployable

**Example:**
```bash
npm run brat -- bit create sentiment-analyzer \
  --profile core \
  --register \
  --active
```

---

## Step 3: Verify Files Created

```bash
ls -la src/apps/sentiment-analyzer.ts
ls -la tests/apps/sentiment-analyzer.test.ts
```

**Expected:** Both files exist

---

## Step 4: Implement Service Logic

**Edit:** `src/apps/sentiment-analyzer.ts`

**Pattern:** Follow the [enrich-and-next pattern](../concepts/agent-flow-patterns.md)

```typescript
// File: src/apps/sentiment-analyzer.ts
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';

export class SentimentAnalyzer extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.contextualization.v1',
      async (event, attrs, ctx) => {
        // Your logic here
        await this.next(event);
        await ctx.ack();
      }
    );
  }
}
```

---

## Step 5: Test Locally

```bash
npm test -- sentiment-analyzer
```

**Expected:** All tests pass

---

## Next Steps

- [Building an Enrichment Bit](../tutorials/building-an-enrichment-bit.md)
- [Deploying to Cloud Run](./deploying-services.md)
```

---

## 7. Validation

**How to validate agent-first compliance:**

### 7.1. Automated Checks

**YAML Frontmatter Validator:**
```bash
# Check all docs have frontmatter
grep -L "^---$" documentation/**/*.md

# Check frontmatter has required fields
grep -A10 "^---$" doc.md | grep "audience:"
```

**Code Example Validator:**
```bash
# Extract code blocks and test them
# (Custom script needed)
```

### 7.2. Manual Review

**Checklist:**
1. Read the doc as if you're an AI agent (no prior context)
2. Can you execute every code example without modifications?
3. Are all decisions explicit (no "usually" or "typically")?
4. Is terminology consistent?
5. Are cross-references complete?

### 7.3. AI Agent Test

**Best validation: Test with a fresh AI agent session.**

**Process:**
1. Open fresh AI session (no context)
2. Provide ONLY the documentation being tested
3. Ask: "Implement [concept/pattern] from this documentation"
4. Verify: Does the agent implement it correctly without additional prompting?

**Success Criteria:**
- Agent uses correct APIs
- Agent follows stated rules
- Agent doesn't ask clarifying questions that are answered in the doc
- Implementation matches examples

---

## 8. Maintenance

### 8.1. Keeping Documentation Current

**RULE: Update documentation when code changes.**

**Process:**
1. Code change merged
2. Search for affected docs: `grep -r "MethodName" documentation/`
3. Update references, examples, line numbers
4. Re-validate (run checklist)
5. Include doc updates in same PR as code change

### 8.2. Version Management

**When to bump version:**
- Major version (2.0): Breaking changes to documented APIs
- Minor version (1.1): New sections or significant additions
- Patch version (1.0.1): Fixes, clarifications, typos

**Update:**
- YAML frontmatter `version` field
- YAML frontmatter `updated` field
- Add changelog entry (if doc has one)

---

## 9. FAQ

**Q: Do ALL documents need YAML frontmatter?**
A: Concept, guide, reference, and tutorial docs: YES. README, CHANGELOG, LICENSE: NO.

**Q: What if the code example is too long?**
A: Link to a complete example file in `documentation/examples/` rather than truncating.

**Q: Can I use synonyms if they're more readable?**
A: No. Readability for humans is a side effect of agent optimization. Canonical terms are non-negotiable.

**Q: How do I handle deprecated APIs?**
A: Add `status: deprecated` to frontmatter, add deprecation warning at top, link to replacement.

**Q: Should I migrate old docs?**
A: Prioritize high-traffic docs (README, CLAUDE.md, core concepts). Low-traffic docs can migrate opportunistically.

---

## 10. Resources

**Templates:**
- Concept: See §2.1
- Guide: See §2.2
- Reference: See §2.3
- Tutorial: See §2.4

**Examples:**
- Good: This document (agent-first-documentation.md)
- Good: documentation/concepts/agent-flow-patterns.md (once created)

**Tools:**
- Markdown linter: markdownlint-cli
- Code extractor: (custom script in tools/doc-validator/)
- Link checker: markdown-link-check

---

**Document Status:** Active — This is the standard for all new BitBrat documentation

**Next Steps:**
- Use these standards for all new documentation
- Migrate high-priority existing docs
- Update as patterns evolve

# BitBrat Personality Generation Context Guide

This document provides context for LLMs tasked with generating personality documents for the BitBrat platform. It explains how personalities are assembled, processed, and injected into prompts.

## Overview

BitBrat uses a structured **Prompt Assembly System** that composes prompts from multiple sources:

1. **System Prompt**: Immutable platform rules (safety, architecture constraints)
2. **Identity**: Personality/persona (what you're generating)
3. **Requesting User**: User context (roles, permissions, notes)
4. **Conversation State**: Short-term memory (recent exchanges)
5. **Contexts**: Named data contexts (adventure state, world state, context packs)
6. **Constraints**: Runtime guardrails (behavioral, format, policy)
7. **Task**: What the LLM should do (instructions)
8. **Input**: User's actual query

**Your role**: Generate content for the **Identity** section (Section 2).

## How Personalities Are Stored

Personalities are stored as documents in PostgreSQL (or Firestore for legacy deployments) with this structure:

```typescript
{
  name: string;          // Unique identifier (e.g., "helpful-assistant", "narrator")
  text: string;          // The personality prompt text (what you generate)
  status: string;        // "active" | "inactive" | "archived"
  version?: number;      // Version number (incremented on updates)
  tags?: string[];       // Categories (e.g., ["helpful", "concise"])
  platform?: string;     // Optional: Override LLM provider (e.g., "openai", "anthropic")
  model?: string;        // Optional: Override model (e.g., "gpt-4o", "claude-sonnet-4")
  createdAt?: string;    // ISO timestamp
  updatedAt?: string;    // ISO timestamp
}
```

**Key fields for personality generation:**

- **name**: Keep it descriptive but concise (`kebab-case`)
- **text**: The actual personality prompt (see composition guidelines below)
- **tags**: Help with discovery and filtering
- **platform/model**: Optional overrides for specialized personalities (e.g., a narrator personality might work best with a specific model)

## Personality Resolution Flow

When an event arrives, BitBrat:

1. **Searches annotations** for `kind: "personality"` annotations
2. **Resolves personalities** by name or inline text:
   - **Inline**: `payload.text` contains the personality directly
   - **Named**: `payload.name` or `value` references a stored personality document
3. **Applies limits**:
   - Max annotations: 3 (default, configurable)
   - Max chars per personality: 4000 (default, configurable)
   - Personalities are **sorted by score** (lower = higher priority) and **truncated** if limits exceeded
4. **Extracts constraints** from personality text:
   - Lines starting with "Do not", "Never", "Always", "Must", "Should", "Format", "Output" are extracted as runtime constraints
5. **Composes into Identity section** of PromptSpec

## PromptSpec Structure

The `PromptSpec` object that gets assembled:

```typescript
{
  systemPrompt?: {
    summary?: string;        // 1-2 line description
    rules: string[];         // Immutable platform rules
    sources?: string[];      // Source documents (e.g., "AGENTS.md")
  },

  identity?: {               // ← YOUR PERSONALITY GOES HERE
    personaId?: string;
    name?: string;
    summary?: string;        // 1-3 sentences
    traits?: string[];       // e.g., ["precise", "helpful", "concise"]
    tone?: string;           // e.g., "professional", "friendly"
    styleGuidelines?: string[];  // e.g., ["use bullet lists", "be concise"]
  },

  requestingUser?: {
    userId?: string;
    handle?: string;         // e.g., "@user"
    displayName?: string;
    roles?: string[];        // e.g., ["admin", "moderator"]
    notes?: string;          // Disposition guidance, user description
    subheader?: string;      // Optional context
  },

  conversationState?: {
    summary?: string;        // Preferred: concise state summary
    transcript?: Array<{     // Optional: recent messages
      role: "user" | "assistant" | "tool";
      content: string;
      at?: string;
    }>;
    retention?: {
      maxMessages?: number;  // Default: 8
      maxChars?: number;     // Default: 8000
    };
    renderMode?: "summary" | "transcript" | "both";
  },

  contexts?: Array<{
    name: string;            // e.g., "World State", "Adventure Context"
    content: string | object;
    priority?: 1 | 2 | 3 | 4 | 5;  // 1 = highest
    subheader?: string;
  }>,

  constraints?: Array<{
    text: string;            // Single rule/guardrail
    priority?: 1 | 2 | 3 | 4 | 5;
    source?: "system" | "policy" | "runtime";
    tags?: string[];
  }>,

  task: Array<{              // Required: at least one
    instruction: string;     // Imperative statement
    priority?: 1 | 2 | 3 | 4 | 5;
    required?: boolean;      // Default: true
  }>,

  input: {                   // Required
    userQuery: string;       // Raw user question
    context?: string;        // Optional snippet
  }
}
```

## Rendered Output Format

The assembled prompt is rendered as **markdown** with sections in canonical order:

```markdown
## [System Prompt]
- Follow architecture.yaml precedence
- Never leak secrets

## [Assistant Identity]
- Name: BitBrat
- You are a helpful, precise, and concise assistant for the BitBrat platform.
- Traits: precise, helpful, concise
- Tone: professional
- Style: Use bullet lists; Be concise

## [Requesting User]
- Handle: @alice
- Roles: [admin, architect]
- Notes: Prefers technical depth over simplicity

## [Conversation State / History]
~~~text
U: What's the status of the deployment?
A: The deployment is in progress. Stage 2/5 complete.
~~~

## [Contexts]
### World State
~~~text
{ "location": "Enchanted Forest", "time": "dusk" }
~~~

## [Constraints]
- (2) Do not use emojis unless explicitly requested
- (3) Format code blocks with syntax highlighting

## [Task]
- (3) Answer the user's question with technical precision

## [Input]
How do I deploy a new service?
```

## Personality Composition Guidelines

### What to Include

1. **Core Identity** (1-3 sentences)
   - Who/what is the assistant?
   - What is their primary purpose?
   - What distinguishes them from a generic assistant?

2. **Behavioral Traits** (bullet list)
   - Precision level (concise, detailed, verbose)
   - Helpfulness style (proactive, reactive, hands-off)
   - Expertise domain (technical, creative, general)

3. **Tone & Voice**
   - Professional, friendly, casual, formal
   - Emoji usage (discouraged by default)
   - Technical jargon level

4. **Style Guidelines**
   - Formatting preferences (bullets, tables, code blocks)
   - Response length (brief, moderate, comprehensive)
   - Code example style (minimal, annotated, tutorial-style)

5. **Constraints** (extracted automatically)
   - Start lines with: "Do not", "Never", "Always", "Must", "Should", "Format", "Output"
   - These become runtime constraints (Priority 3 by default)
   - Example: "Never use emojis unless explicitly requested"
   - Example: "Always provide file paths with line numbers when referencing code"

### What NOT to Include

1. **User-specific information**: User context is injected separately in `requestingUser`
2. **Conversation history**: Short-term memory is managed automatically in `conversationState`
3. **Dynamic state**: World state, adventure context, etc. are injected as `contexts`
4. **Task instructions**: The specific task is injected separately in `task`
5. **Input/query**: The user's actual query is in `input`

### Composition Patterns

**Minimal Personality** (100-300 chars):
```
You are BitBrat, a helpful assistant for the BitBrat event-driven platform.
Be concise, precise, and technical. Use bullet lists.
Never use emojis unless requested.
```

**Moderate Personality** (300-1000 chars):
```
You are BitBrat, an expert assistant for the BitBrat event-driven LLM orchestration platform.

Core Traits:
- Precision: Provide exact file paths, line numbers, and technical terms
- Helpfulness: Proactive but not intrusive
- Expertise: Deep knowledge of microservices, event-driven architecture, and LLM orchestration

Tone & Voice:
- Professional and technical
- Clear and concise
- No unnecessary pleasantries or filler

Style Guidelines:
- Use bullet lists for enumerations
- Use tables for structured comparisons
- Use code blocks with syntax highlighting
- Reference code with file:line format (e.g., src/apps/llm-bot-service.ts:123)

Constraints:
Never use emojis unless explicitly requested
Always cite sources when referencing documentation
Format all code with appropriate language tags
Output JSON with proper indentation when requested
```

**Rich Personality** (1000-4000 chars):
```
You are BitBrat, the official AI assistant for the BitBrat event-driven LLM orchestration platform. You embody the platform's philosophy: precision, modularity, and relentless pursuit of clarity.

Identity & Purpose:
You exist to help developers, architects, and operators build, deploy, and maintain event-driven LLM systems using BitBrat's microservices architecture. Your knowledge spans the entire platform—from the Bit abstraction and MCP control plane to message routing, persistence backends, and cloud deployments.

Core Principles:
- Precision over brevity: Exact file paths, line numbers, command syntax
- Architecture-first thinking: Always consider the Bit model, event flow, and system boundaries
- Documentation-driven: Reference CLAUDE.md, architecture.yaml, and guides
- Platform-agnostic defaults: PostgreSQL, NATS, Docker (cloud platforms as examples, not defaults)

Expertise Domains:
1. Event-Driven Architecture: Routing slips, enrichment patterns, at-least-once delivery
2. Microservices: Bit model, profiles (core/gateway/llm/mcp-server), MCP control plane
3. Persistence: PostgreSQL (default), Firestore (legacy, deprecated)
4. Message Bus: NATS (default), Pub/Sub, SQS/SNS
5. Deployment: Docker Compose, Cloud Run, ECS, ACI (platform-agnostic)
6. LLM Integration: Multi-provider (OpenAI, Anthropic, Ollama, vLLM)
7. Tools & CLI: brat fleet, brat deploy, brat context

Behavioral Traits:
- Proactive: Surface related concepts without overwhelming
- Context-aware: Adapt depth based on user roles (admin, developer, operator)
- Error-intolerant: Catch ambiguity, verify assumptions, ask clarifying questions
- Teaching-oriented: Explain "why" alongside "how"

Tone & Voice:
- Professional, technical, and direct
- No marketing language or hyperbole
- No emojis (unless user explicitly requests)
- No unnecessary apologies or hedging

Style Guidelines:
- Use bullet lists for processes and enumerations
- Use tables for structured data (features, comparisons, configurations)
- Use code blocks with syntax highlighting (bash, typescript, yaml)
- Use exact references: file:line (e.g., src/common/base-server.ts:67)
- Use fenced blocks for multi-line examples
- Use inline code for commands, variables, file names

Output Formatting:
- Headers: Descriptive, not generic ("PostgreSQL Backup" not "Backup Options")
- Code examples: Near definitions, not buried at the end
- Cross-references: Exact file paths and section names
- Error messages: Exact text, not paraphrased

Constraints (Runtime Guardrails):
Never use emojis unless explicitly requested by the user
Always provide file paths with line numbers when referencing code (e.g., src/apps/llm-bot-service.ts:123)
Always cite documentation sources (CLAUDE.md, architecture.yaml, guides)
Format all code blocks with appropriate language tags (bash, typescript, yaml, json)
Output JSON with 2-space indentation when structured data is requested
Do not use marketing language or superlatives ("amazing", "powerful", "revolutionary")
Do not apologize excessively; acknowledge errors once and provide solutions
Must verify user intent when requests are ambiguous (use AskUserQuestion if needed)
Should surface related concepts proactively (e.g., "You might also consider...")
Should adapt technical depth based on user roles (admin vs. developer)
```

## Behavioral Integration

Personalities interact with **Behavioral Profiles** which are derived from annotations:

### Behavior Profile Structure

```typescript
{
  intent: 'question' | 'joke' | 'praise' | 'critique' | 'command' | 'meta' | 'spam';
  tone: {
    valence: number;      // -1 (negative) to +1 (positive)
    arousal: number;      // 0 (calm) to 1 (excited)
    bucket: 'hostile' | 'negative' | 'neutral' | 'positive' | 'excited';
  };
  risk: {
    level: 'none' | 'low' | 'med' | 'high';
    type: 'none' | 'harassment' | 'spam' | 'privacy' | 'self_harm' | 'sexual' | 'illegal';
  };
  policy: {
    shouldRespond: boolean;
    shouldUseTools: boolean;
    shouldDeescalate: boolean;
    shouldRefuse: boolean;
  };
  responseMode: 'answer' | 'light_humor' | 'gratitude' | 'deescalate' | 'brief_comply' | 'meta_explain' | 'refuse' | 'ignore';
  gate: 'PROCEED' | 'SAFE_REFUSAL' | 'NO_RESPONSE' | 'ESCALATE';
}
```

**Key Interactions:**

- **High-risk traffic** (`risk.level: 'high'`): Tools disabled, response may be refused
- **Meta intent** (`intent: 'meta'`): Only internal status tools allowed
- **Hostile tone** (`tone.bucket: 'hostile'`): De-escalation guidance injected
- **Spam intent** (`intent: 'spam'`): No response generated

**Behavioral constraints** are injected as Priority 2 constraints:

```typescript
[
  { text: "Respond with empathy and de-escalate if the user seems frustrated", priority: 2, source: "runtime", tags: ["behavior"] },
  { text: "Be brief and factual; avoid tools for this request", priority: 2, source: "runtime", tags: ["behavior"] }
]
```

**Your personality should complement, not conflict with, behavioral guidance.** Avoid overly rigid constraints that would clash with dynamic behavioral adjustments.

## Truncation & Budget Management

Personalities are subject to character limits:

1. **Per-personality cap**: 4000 chars (default, configurable via `PERSONALITY_MAX_CHARS`)
2. **Section cap**: `config.sectionCaps.identity` (optional)
3. **Total cap**: `config.maxTotalChars` (optional)

**Truncation order** (when total budget exceeded):

1. Input.context removed first
2. ConversationState.transcript trimmed (oldest first)
3. Contexts dropped (lowest priority first)
4. Tasks dropped (lowest priority first)
5. **Identity preserved** (never truncated for total budget, only per-section cap)
6. Input.userQuery truncated (last resort)

**Constraint extraction** does NOT count toward Identity section length; constraints are moved to the Constraints section.

## Platform/Model Overrides

Personalities can specify `platform` and `model` fields to override the default LLM provider:

```typescript
{
  name: "creative-narrator",
  text: "You are a creative storyteller...",
  platform: "anthropic",
  model: "claude-sonnet-4"
}
```

**Use cases:**

- **Narrator personalities**: May work better with models that excel at creative writing
- **Technical assistants**: May benefit from models with stronger code reasoning
- **Cost optimization**: Route simple queries to smaller models

**Guidelines:**

- Only specify overrides when necessary (default is `LLM_PROVIDER` and `LLM_MODEL` from config)
- Test with the default provider first
- Document why the override is needed (in `tags` or external docs)

## Example Personality Documents

### Example 1: Default Assistant

```json
{
  "name": "default-assistant",
  "text": "You are BitBrat, a helpful assistant for the BitBrat platform. Be concise, precise, and technical. Use bullet lists. Never use emojis unless requested.",
  "status": "active",
  "version": 1,
  "tags": ["default", "concise", "technical"]
}
```

### Example 2: Narrator (Adventure Mode)

```json
{
  "name": "narrator",
  "text": "You are the Narrator, a mystical storyteller guiding adventurers through interactive tales.\n\nCore Identity:\nYou weave narratives that respond to player choices, maintaining consistency with the world state and available choices. Your descriptions are vivid but concise.\n\nStyle Guidelines:\n- Use present tense for immediacy\n- Use second person (\"You see...\", \"You hear...\")\n- Balance description with player agency\n- Use dialogue sparingly but impactfully\n\nConstraints:\nNever reveal future plot points or unchosen paths\nAlways respect the current scene's mood and setting\nFormat choices as numbered lists when presenting options\nOutput narrative blocks in 2-4 sentences unless dramatic moments warrant more",
  "status": "active",
  "version": 2,
  "tags": ["narrative", "adventure", "creative"],
  "platform": "anthropic",
  "model": "claude-sonnet-4"
}
```

### Example 3: Technical Architect

```json
{
  "name": "technical-architect",
  "text": "You are BitBrat Senior Architect, a domain expert in event-driven microservices, LLM orchestration, and distributed systems.\n\nExpertise:\n- Event-driven architecture (routing slips, enrichment patterns, at-least-once delivery)\n- Microservices (Bit model, MCP control plane, profiles)\n- Persistence (PostgreSQL default, Firestore deprecated)\n- Message bus (NATS default, cloud alternatives)\n- Deployment (Docker Compose, Cloud Run, ECS, platform-agnostic)\n- LLM providers (OpenAI, Anthropic, Ollama, vLLM)\n\nBehavior:\n- Architecture-first thinking: Always consider system boundaries, event flow, idempotency\n- Reference documentation: Cite CLAUDE.md, architecture.yaml, guides with exact section names\n- Platform-agnostic defaults: PostgreSQL, NATS, Docker (cloud platforms as examples)\n- Proactive guidance: Surface related concepts, warn about pitfalls\n\nTone & Voice:\n- Professional, technical, direct\n- No marketing language\n- Teaching-oriented: Explain \"why\" alongside \"how\"\n\nStyle:\n- Use tables for comparisons (e.g., message bus options)\n- Use bullet lists for processes\n- Use code:line references (e.g., src/common/base-server.ts:67)\n- Use fenced blocks for examples\n\nConstraints:\nNever recommend Firestore for new deployments (use PostgreSQL)\nAlways provide file paths with line numbers when referencing code\nAlways cite documentation sources when making architectural claims\nFormat all code blocks with language tags\nMust surface trade-offs when multiple valid approaches exist\nShould recommend platform-agnostic defaults before cloud-specific solutions",
  "status": "active",
  "version": 3,
  "tags": ["technical", "architecture", "expert", "teaching"]
}
```

### Example 4: Concise Responder

```json
{
  "name": "concise-responder",
  "text": "You are BitBrat Concise Mode. Brevity is paramount.\n\nConstraints:\nNever exceed 3 sentences unless listing items\nAlways use bullet lists for enumerations\nFormat code inline with backticks for single-line examples\nOutput multi-line code in fenced blocks with no explanatory text inside the fence\nDo not apologize or add pleasantries\nMust provide exact answers; no hedging or uncertainty language",
  "status": "active",
  "version": 1,
  "tags": ["concise", "brief", "minimal"]
}
```

## Integration with User Context

Personalities are composed with **User Context** annotations:

### User Context Structure

```typescript
{
  kind: "annotation",
  source: "llm-bot.user-context",
  label: "user-context-v1",
  payload: {
    username: string;
    roles: string[];
    description?: string;
    rolePrompts?: string[];  // Role-specific instructions
  }
}
```

**Rendering into RequestingUser:**

```markdown
## [Requesting User]
- Handle: @alice
- Roles: [admin, architect]
- Notes:
  Username: alice
  Roles: admin, architect
  Description: Senior architect, prefers technical depth
```

**Role-based prompts** (from `rolePrompts`) are injected as **Task annotations** (Priority 2), NOT into Identity:

```markdown
## [Task]
- (2) You are speaking with an admin. Provide deeper technical details and surface system internals.
- (3) Answer the user's question with precision
```

**Your personality should NOT duplicate role-based instructions.** The system handles role context separately.

## Integration with Disposition Context

**Disposition** is a stateful emotional/behavioral snapshot of a user, tracked over time:

```typescript
{
  userKey: string;
  disposition: 'neutral' | 'friendly' | 'frustrated' | 'hostile' | 'playful';
  confidence: number;
  context?: string;
  ttl?: number;
}
```

**Disposition guidance** is injected as a **prompt annotation** (`kind: "prompt"`, `source: "llm-bot.disposition"`):

```typescript
{
  kind: "prompt",
  source: "llm-bot.disposition",
  value: "The user seems frustrated. Acknowledge their concern and offer clear, actionable help."
}
```

This guidance is rendered into `RequestingUser.notes`:

```markdown
## [Requesting User]
- Handle: @bob
- Notes:
  The user seems frustrated. Acknowledge their concern and offer clear, actionable help.
```

**Your personality should allow for dynamic tone adjustments based on disposition.** Avoid overly rigid tone constraints that would conflict with de-escalation guidance.

## Testing & Validation

When generating a personality, consider:

1. **Constraint extraction**: Are your "Never", "Always", "Must" statements clear and actionable?
2. **Character budget**: Is the text under 4000 chars? Can it be trimmed without losing clarity?
3. **Behavioral compatibility**: Does it allow for dynamic tone/tool adjustments based on behavior profile?
4. **Role compatibility**: Does it complement (not duplicate) role-based guidance?
5. **Disposition compatibility**: Does it allow for empathetic responses when users are frustrated?
6. **Platform override necessity**: Is the `platform`/`model` override justified?

**Validation checklist:**

- [ ] Text is 100-4000 characters
- [ ] Constraints use standard prefixes ("Never", "Always", "Must", "Should", "Format", "Output")
- [ ] No user-specific details (roles, names, preferences)
- [ ] No task instructions (those come from annotations)
- [ ] No conversation history (managed automatically)
- [ ] Tone is adaptable (not rigid)
- [ ] Style guidelines are clear and actionable
- [ ] Tags are descriptive and aid discovery
- [ ] Platform/model override is justified (if present)

## Common Pitfalls

1. **Overly long personalities**: Keep under 1000 chars for general use; 1000-4000 for specialized
2. **Conflicting constraints**: "Always be brief" + "Always explain in detail" = contradiction
3. **Role duplication**: Don't say "If user is admin, provide deeper details" (handled by user context)
4. **Task duplication**: Don't say "Answer the user's question" (that's injected as Task)
5. **Rigid tone**: Allow behavioral profile to adjust tone dynamically
6. **Missing constraint prefixes**: "Don't use emojis" won't be extracted; use "Never use emojis"
7. **Unjustified overrides**: Don't set `platform`/`model` without a clear reason

## Summary

**Key Points for LLM Personality Generators:**

1. Generate the **text** field (100-4000 chars)
2. Focus on **identity, traits, tone, style, constraints**
3. Use **constraint prefixes** for runtime extraction ("Never", "Always", etc.)
4. Avoid duplicating **user context, tasks, input, conversation history**
5. Keep tone **adaptable** for behavioral adjustments
6. Use **platform/model overrides sparingly** and justify them
7. Test for **character budget, clarity, compatibility**

Your generated personality will be composed into a structured prompt alongside system rules, user context, behavioral guidance, and dynamic state. Design for clarity, composability, and adaptability.

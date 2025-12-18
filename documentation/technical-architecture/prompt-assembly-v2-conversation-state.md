# Prompt Assembly Framework – v2

## Abstract
This document updates the prompt assembly framework to add a new, first-class canonical section: Conversation State / History. The new order is:

System Prompt → Assistant Identity → Requesting User (stable traits) → Conversation State / History → Constraints → Task → Input

This spec defines the section semantics, rendering rules, updated TypeScript types, provider mappings (OpenAI and Google), token budgeting, security posture, integration notes, and a migration guide from v1 (6 sections) to v2 (7 sections).

## Goals and Non‑Goals
- Goals
  - Introduce Conversation State / History as an explicit section in the canonical prompt structure.
  - Preserve provider portability (OpenAI, Google) while maintaining order semantics.
  - Provide updated, minimal TypeScript types and assembly rules.
- Non‑Goals
  - Implement code changes in this sprint; this is a documentation/architecture update only.

## Canonical Structure (v2)
Sections MUST appear in the following order. Sections are OPTIONAL except where noted. If omitted, the assembler MUST still render explicit section boundaries with an empty body unless configured otherwise.

1) System Prompt — optional but preferred
- Purpose: Immutable laws of the system and safety/tone defaults. Highest‑priority guardrails.

2) Assistant Identity (aka “Identity”) — optional but preferred
- Purpose: Persona/role/tone/operating stance of the assistant.
- Note: The section label is updated to “Assistant Identity” for clarity. Type/interface name remains Identity for backward compatibility.

3) Requesting User — optional
- Purpose: Stable, non‑sensitive traits of the human/agent requester (role, tier, locale). No secrets.

4) Conversation State / History — optional but recommended when available
- Purpose: Short‑term, session‑scoped state and salient history that informs the current exchange.
- Guidance: Prefer a compact state summary with optional, fenced, trimmed transcript excerpts when needed for disambiguation.

5) Constraints — optional
- Purpose: Non‑negotiable rules/guardrails; formatting constraints; architectural alignment.
- Model guidance: Treat as hard constraints that qualify all later sections.

6) Task — required
- Purpose: Prioritized Prompt Annotations (PPA): ordered instructions, acceptance criteria, and output formatting.

7) Input — required
- Purpose: The immediate user query and attachments.

### Standard Section Labels and Markup
Use dual signaling for clarity:
- Markdown headings (H2 by default)
- Explicit bracketed labels

Section headers (H2):
```
## [System Prompt]
## [Assistant Identity]
## [Requesting User]
## [Conversation State / History]
## [Constraints]
## [Task]
## [Input]
```

Within each section, prefer bullets and short, declarative sentences. Wrap long free‑form inputs and transcripts in fenced blocks to preserve formatting.

## Rendering Rules (v2)
- Always render sections in canonical order, even if some are empty (unless configured to hide empty sections).
- Sort Constraints and Task annotations by ascending priority (1 = highest).
- When no System Prompt or Assistant Identity is provided, render headers with “None provided.” unless configured to hide empties.
- Escape or fence user‑provided text in Input and any transcript excerpts to avoid tag collisions.
- Conversation State / History rendering guidance:
  - Default render mode: summary bullets first, optional fenced transcript after (~~~text) if needed.
  - Prefer summarization over raw transcript to conserve tokens.
  - Clearly mark any truncation (e.g., “(truncated to last 8 exchanges)”).

## TypeScript Thin Layer – Updates for v2
Conceptual interfaces to live under src/common/prompt-assembly/.

```ts
export interface ConversationStateItem {
  role: "user" | "assistant" | "tool";
  content: string;          // one logical message (already sanitized)
  at?: string;              // ISO timestamp (optional)
}

export interface ConversationState {
  summary?: string;         // concise state summary (preferred)
  transcript?: ConversationStateItem[]; // trimmed recent items (optional)
  retention?: {             // assembler hints (optional)
    maxMessages?: number;   // e.g., 8
    maxChars?: number;      // e.g., 4000
  };
  renderMode?: "summary" | "transcript" | "both"; // default: "summary"
}

export interface SystemPrompt {
  summary?: string;
  rules: string[];
  sources?: string[];
}

export interface Identity {
  personaId?: string;
  name?: string;
  summary?: string;
  traits?: string[];
  tone?: string;
  styleGuidelines?: string[];
}

export interface RequestingUser {
  userId?: string;
  handle?: string;
  displayName?: string;
  roles?: string[];
  locale?: string;
  timezone?: string;
  tier?: string;
}

export type Priority = 1 | 2 | 3 | 4 | 5;

export interface Constraint {
  id?: string;
  priority?: Priority;  // default 3
  text: string;
  tags?: string[];
  source?: "system" | "policy" | "runtime";
}

export interface FormatSpec {
  type: "markdown" | "json" | "xml" | "text";
  jsonSchema?: object;
  example?: string;
}

export interface TaskAnnotation {
  id?: string;
  priority?: Priority;  // default 3
  instruction: string;
  required?: boolean;   // default true
  outputFormat?: FormatSpec;
}

export interface InputPayload {
  userQuery: string;
  attachments?: Array<{ name: string; mime: string; uri?: string; bytesBase64?: string }>; // optional
  context?: string;     // optional free-form context (non-history)
}

export interface PromptSpec {
  systemPrompt?: SystemPrompt;
  identity?: Identity;                // a.k.a. Assistant Identity
  requestingUser?: RequestingUser;
  conversationState?: ConversationState; // NEW in v2
  constraints?: Constraint[];
  task: TaskAnnotation[];             // at least one
  input: InputPayload;                // required
}

export interface AssemblerConfig {
  headingLevel?: 1 | 2 | 3;           // default 2
  showEmptySections?: boolean;        // default true
  provider?: "openai" | "google";  // rendering target
}

export interface AssembledPrompt {
  text: string; // concatenated sections in canonical order
  sections: {
    systemPrompt: string;
    identity: string;             // label renders as [Assistant Identity]
    requestingUser: string;
    conversationState: string;    // NEW in v2
    constraints: string;
    task: string;
    input: string;
  };
}
```

### Assembly Algorithm (summary)
1. Normalize inputs; default priorities to 3.
2. Sort Constraints and Task by ascending priority.
3. Render each section using shared heading template and bracketed labels.
4. For Conversation State / History:
   - Prefer rendering `summary` bullets; if `transcript` present and `renderMode` includes it, render a fenced `~~~text` excerpt with clear truncation notes.
5. Fence Input (~~~text) when multi‑line.
6. Join sections with double newlines.

## Provider Adapters (v2)
The assembler continues to produce a provider‑neutral canonical text and then maps to provider payloads, preserving the logical order as closely as each provider allows.

- OpenAI (Chat/Responses)
  - messages[0] role=system: [System Prompt] + [Assistant Identity]
  - messages[1] role=user: [Requesting User] + [Conversation State / History] + [Constraints] + [Task] + [Input]
  - Notes:
    - Constraints move out of system to preserve the canonical order relative to Conversation State / History.
    - To maintain priority, the System Prompt should include a meta‑rule instructing the model to treat the [Constraints] section (in user content) as non‑negotiable.

- Google (Gemini / Vertex AI)
  - systemInstruction: [System Prompt] + [Assistant Identity]
  - contents (user role): [Requesting User] + [Conversation State / History] + [Constraints] + [Task] + [Input]

This mapping maintains the canonical order across sections without duplication while leveraging each provider’s system‑message features.

## Formatting Conventions
- Headings: H2 (##) with bracketed section names.
- Bullets: “-” bullets; one rule or instruction per line.
- Fencing: Wrap long Input and transcript excerpts in ~~~text fences. Never fence headings.
- Language: Default English; pass through user locale when available.
- Output format: Prefer JSON or Markdown based on TaskAnnotation.outputFormat.

## Token Budgeting and Truncation
- Include a simple guard supporting per‑section caps and a total hard cap.
- Preservation order when trimming (highest to lowest):
  1) System Prompt (never drop)
  2) Assistant Identity (preserve when provided)
  3) Constraints (never drop; may compress wording but not meaning)
  4) Conversation State / History (prefer summarization; trim transcript first)
  5) Higher‑priority Tasks
  6) Lower‑priority Tasks
  7) Input.context (non‑history) and finally non‑essential attachment text
- Clearly log truncation and summarization decisions in assembly meta (counts, chars, priorities affected).

## Security and Privacy
- Do not include secrets in any section. Apply redaction to conversation state and transcripts when necessary.
- Conversation State / History must avoid PII beyond what’s necessary. Prefer abstracted summaries over raw transcripts.
- System Prompt encodes immutable rules and safety posture; it must not include secrets.

## Example — v2 Canonical Text
```
## [System Prompt]
- (1) Precedence: architecture.yaml > AGENTS.md > everything else.
- (2) Safety: Do not reveal secrets or internal tokens. Refuse policy violations.
- (3) Defaults: Professional tone; concise; use Markdown.

## [Assistant Identity]
- Role: Staff Engineer
- Tone: Professional, precise
- Style: Bullet lists; short, actionable guidance

## [Requesting User]
- Handle: @christophernavta
- Roles: [Architect]
- Locale: en-US; TZ: America/New_York

## [Conversation State / History]
- Summary: Discussed prompt assembly v1; user wants a v2 layer for conversation state.
- Scope: Documentation first; no code changes this sprint.
~~~text
(last 4 exchanges, truncated)
U: Can we add a conversation state layer?
A: Yes; propose as a new section between Requesting User and Constraints.
U: Update provider mappings accordingly.
A: Will do; moving Constraints into user content after Conversation State.
~~~

## [Constraints]
- (1) Follow architecture.yaml. Justify deviations.
- (2) Keep responses under 500 tokens unless asked otherwise.
- (3) Prefer Markdown; include TypeScript blocks for types.

## [Task]
- (1) Draft the Technical Architecture for v2 with the new section.
- (2) Update types, rendering rules, and provider mappings.
- (3) Provide one end‑to‑end example.

## [Input]
~~~text
We are standardizing our prompt pipeline to include Conversation State / History as a dedicated section. Produce a doc we can adopt immediately.
~~~
```

## Integration Guidance
- Primary integration targets: src/common/prompt-assembly/, tools/prompt-assembly CLI, and llm-bot processor.
- Build PromptSpec with: System Prompt → Assistant Identity → Requesting User → Conversation State / History → Constraints → Task → Input.
- Provider payloads via adapters (revised mapping above).
- Observability: log assembly meta and truncation notes; never log full transcripts or secrets.

## Migration Guide: v1 (6) → v2 (7) Sections
- Previous order: System Prompt → Identity → Requesting User → Constraints → Task → Input
- New order: System Prompt → Assistant Identity → Requesting User → Conversation State / History → Constraints → Task → Input
- Actions for teams:
  - Promote short‑term memory from Input.context into [Conversation State / History].
  - Adjust provider adapters to place [Constraints] after [Conversation State / History] in the user content.
  - Update types to include `conversationState` on PromptSpec and AssembledPrompt.
  - Revisit truncation: summarize transcripts first; never drop Constraints.
  - Validate using CLI rendering and adapter fixtures.

## Roadmap
- v2 (this sprint): Documentation and plan only.
- v2.1 (next): Implement types, assembly, and provider adapters with tests.
- v2.2: Token estimation and structured output validators.

## References
- architecture.yaml (precedence)
- AGENTS.md Sprint Protocol v2.4
- OpenAI API (Chat/Responses)
- Google Generative AI (Gemini) API

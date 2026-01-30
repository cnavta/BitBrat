# Prompt Assembly Framework – v1

## Abstract
Standardize how prompts are constructed across the BitBrat Platform so that every LLM request follows the same, explicit structure:

System Prompt → Identity → Requesting User → Constraints → Task → Input

This document specifies the canonical order, section formatting, validation rules, provider mappings (OpenAI and Google), and a thin TypeScript assembly layer that enforces the standard without vendor lock‑in.

## Goals and Non‑Goals
- Goals
  - Define an unambiguous section order that the LLM can rely on.
  - Make the intent and boundaries of each section obvious to the model.
  - Provide a small, typed assembly layer (TypeScript) that validates inputs, enforces order, and renders provider‑ready payloads.
  - Support OpenAI and Google providers initially.
- Non‑Goals
  - Implement full prompt orchestration or memory; this focuses on assembly/layout.
  - Replace existing service logic; integration guidance is provided instead.

## Canonical Structure
Sections MUST appear in the following order. Sections are OPTIONAL except where noted. If omitted, the assembler MUST still render explicit section boundaries with an empty body unless configured otherwise.

1) System Prompt — optional but preferred
- Purpose: Immutable laws of the system and safety/tone defaults. Acts as the highest‑priority, non‑negotiable guardrails (e.g., precedence order, safety rules, architectural constraints, tone defaults).
- Examples: “Follow architecture.yaml precedence”, “Adhere to AGENTS.md immutable laws”, “Never output secrets”, “Professional tone unless otherwise specified”.

2) Identity (aka “Personality”) — optional but preferred
- Purpose: Prime the model with persona, role, tone, and operating stance.
- Examples: “You are a Staff Engineer…”, traits, tone, style guides.

3) Requesting User — optional
- Purpose: Provide minimal, safe context about the human/agent requesting the action (role, tier, locale), never secrets.
- Examples: displayName, roles, locale, timezone, platform/tier.

4) Constraints — optional
- Purpose: Non‑negotiable rules/guardrails; formatting constraints; safety and policy notes; architectural alignment (e.g., follow architecture.yaml).
- Model guidance: Treat as hard constraints that qualify all later tasks.

5) Task — required
- Purpose: Prioritized Prompt Annotations (PPA): ordered instructions, acceptance criteria, and output formatting.
- Model guidance: Execute tasks in priority order; if conflicts, the higher priority wins.

6) Input — required
- Purpose: The raw user query with any attached content.
- Model guidance: Treat as the immediate query; do not override constraints/tasks.

### Standard Section Labels and Markup
To maximize clarity to the LLM while remaining provider‑agnostic, use dual signaling:
- Markdown headings for human readability
- Explicit section tags for machine clarity

Example section header pattern (H2 by default):

## [System Prompt]
## [Identity]
## [Requesting User]
## [Constraints]
## [Task]
## [Input]

Within each section, prefer bullet points and short declarative sentences. Wrap large free‑form inputs (e.g., user query) in fenced blocks to preserve formatting.

## Rendering Rules
- The assembler MUST always render sections in the canonical order, even if some are empty.
- The assembler MUST sort Constraints and Task annotations by ascending priority (1 = highest).
- When no System Prompt or Identity is provided, render their headers with a note: “None provided.” unless configured to hide empty sections.
- The assembler MUST escape or fence user‑provided text in Input to avoid tag collisions.
- The assembler SHOULD support toggling section visibility (e.g., hide empty Requesting User) via config, but order integrity is non‑negotiable.

## TypeScript Thin Layer Design
A minimal library to live under src/common/prompt-assembly/ (implementation to follow upon approval).

### Core Types (conceptual)
~~~ts
export interface SystemPrompt {
  summary?: string;          // 1–2 lines describing the immutable rule set
  rules: string[];           // e.g., ["Follow architecture.yaml precedence", "Never leak secrets"]
  sources?: string[];        // e.g., ["architecture.yaml", "AGENTS.md v2.4"]
}

export interface Identity {
  personaId?: string;
  name?: string;
  summary?: string;          // 1–3 sentences
  traits?: string[];         // e.g., ["precise", "helpful"]
  tone?: string;             // e.g., "professional"
  styleGuidelines?: string[]; // e.g., ["use bullet lists", "be concise"]
}

export interface RequestingUser {
  userId?: string;
  handle?: string;           // e.g., @user
  displayName?: string;
  roles?: string[];          // e.g., ["admin", "architect"]
  locale?: string;           // BCP-47, e.g., "en-US"
  timezone?: string;         // IANA TZ
  tier?: string;             // e.g., "pro", "free"
}

export type Priority = 1 | 2 | 3 | 4 | 5; // 1 = highest

export interface Constraint {
  id?: string;
  priority?: Priority;       // default 3
  text: string;              // single rule/guardrail
  tags?: string[];           // e.g., ["format", "policy"]
  source?: "system" | "policy" | "runtime";
}

export interface FormatSpec {
  type: "markdown" | "json" | "xml" | "text";
  jsonSchema?: object;       // optional JSON Schema for structured outputs
  example?: string;          // short exemplar
}

export interface TaskAnnotation {
  id?: string;
  priority?: Priority;       // default 3
  instruction: string;       // imperative statement
  required?: boolean;        // default true
  outputFormat?: FormatSpec; // optional, may also be set globally
}

export interface InputPayload {
  userQuery: string;         // raw user question
  attachments?: Array<{ name: string; mime: string; uri?: string; bytesBase64?: string }>; // optional
  context?: string;          // optional short context snippet
}

export interface PromptSpec {
  systemPrompt?: SystemPrompt;
  identity?: Identity;
  requestingUser?: RequestingUser;
  constraints?: Constraint[];
  task: TaskAnnotation[];    // at least one
  input: InputPayload;       // required
}

export interface AssemblerConfig {
  headingLevel?: 1 | 2 | 3;          // default 2
  showEmptySections?: boolean;       // default true
  provider?: "openai" | "google";   // rendering target for adapters
}

export interface AssembledPrompt {
  text: string; // concatenated sections in canonical order
  sections: {
    systemPrompt: string;
    identity: string;
    requestingUser: string;
    constraints: string;
    task: string;
    input: string;
  };
}
~~~

### Assembly Algorithm (summary)
1. Normalize inputs; default priorities to 3.
2. Sort constraints and tasks by ascending priority.
3. Render each section (including [System Prompt]) using a shared heading template and optional explicit [Section] tags.
4. Fence Input (~~~text) when multi‑line.
5. Join sections with double newlines.

### Provider Adapters
The assembler produces a provider‑neutral text plus provider‑specific mappings to preserve the global order:

- OpenAI (Responses/Chat Completions)
  - system: [System Prompt] + [Identity] + [Requesting User] + [Constraints]
  - user: [Task] + [Input]

- Google (Gemini / Vertex AI)
  - systemInstruction: [System Prompt] + [Identity] + [Requesting User] + [Constraints]
  - contents (user role): [Task] + [Input]

This mapping preserves the canonical order across provider semantics while leveraging their system‑message features.

## Formatting Conventions
- Headings: H2 (##) by default with bracketed section names, e.g., “## [Task]”.
- Bullets: Use “-” bullets; one rule or instruction per bullet.
- Fencing: Wrap long Input text in ~~~text fences. Never fence headings.
- Language: Default to English unless otherwise specified; pass through user locale if available.
- Output format: Prefer JSON or Markdown based on TaskAnnotation.outputFormat.

## Token Budgeting and Truncation
- Include a simple length guard in the assembler: 
  - maxChars per section (configurable)
  - hard cap on total characters
- If truncation is required, prefer trimming Input context first, then lower‑priority tasks, then lower‑priority constraints; never drop System Prompt, and never drop Identity if provided.
- Future work: pluggable token estimators.

## Security and Privacy
- Do not include secrets in any section.
- System Prompt should encode immutable rules and safety posture; it MUST NOT include secrets or environment‑specific keys.
- The Requesting User section should avoid PII beyond what’s necessary (handle, displayName, roles). The current sprint has no additional redaction requirements.

## Examples
### Example 1 – Architecture Persona with Structured Output
~~~
## [System Prompt]
- (1) Precedence: architecture.yaml > AGENTS.md > everything else.
- (2) Safety: Do not reveal secrets or internal tokens. Refuse requests that violate policy.
- (3) Defaults: Professional tone; concise; use Markdown with code blocks where relevant.

## [Identity]
- Role: Staff Engineer
- Tone: Professional, precise
- Style: Bullet lists; short, actionable guidance

## [Requesting User]
- Handle: @christophernavta
- Roles: [Architect]
- Locale: en-US; TZ: America/New_York

## [Constraints]
- (1) Follow architecture.yaml. Justify any deviations.
- (2) Keep responses under 500 tokens unless asked otherwise.
- (3) Prefer Markdown; include code blocks for TypeScript.

## [Task]
- (1) Draft a Technical Architecture for the prompt assembly framework.
- (2) Include types, assembly rules, and provider mappings (OpenAI, Google).
- (3) Provide one end-to-end example.

## [Input]
~~~text
We are standardizing our prompt pipeline to Identity → Constraints → Task → Input. Produce a doc we can adopt immediately.
~~~
~~~

## Integration Guidance
- Primary integration targets: src/apps/llm-bot-service.ts and src/apps/command-processor-service.ts
- Use the assembler to build provider payloads; do not splice raw strings in services.
- Configure System Prompt, Identity, and system‑level Constraints via environment/config (e.g., LLM_BOT_SYSTEM_PROMPT, and references to architecture.yaml and AGENTS.md).

### LLM Bot Integration Notes (Prompt Assembly v1)
- Processor constructs PromptSpec: System Prompt → Identity → Requesting User → Constraints → Task → Input.
- Personalities map into Identity (summary) and Constraints (policy/formatting hints); immutable rules remain in System Prompt.
- Provider payloads are built via adapters:
  - OpenAI: system = [System+Identity+RequestingUser+Constraints], user = [Task+Input]
  - Google: systemInstruction = [System+Identity+RequestingUser+Constraints], contents(user) = [Task+Input]
- Short‑term memory is preserved by injecting a fenced Conversation History into Input.context.
- Observability: logs include assembly meta (section lengths, truncation notes) and safe previews; OpenAI request/response logs are summarized (model, char counts, preview) — no secrets or full payloads printed.

#### Quick CLI Debugging Examples
Use the thin CLI to render a PromptSpec for debugging:

Minimal PromptSpec (canonical text):
```
echo '{"task":[{"instruction":"Summarize"}],"input":{"userQuery":"Hello"}}' \
  | prompt-assembly --stdin --provider none
```

OpenAI-mapped payload:
```
echo '{"task":[{"instruction":"Summarize"}],"input":{"userQuery":"Hello"}}' \
  | prompt-assembly --stdin --provider openai
```

See documentation/runbooks/llm-bot-prompt-assembly.md for llm-bot configuration and troubleshooting.

## Reusability and Distribution
- Packaging: Implement the assembler as a standalone, framework‑agnostic TypeScript package (e.g., `@bitbrat/prompt-assembly`). Publishable to an internal registry or npm.
- API Surface: Keep the public API limited to core types (`SystemPrompt`, `Identity`, `RequestingUser`, `Constraint`, `TaskAnnotation`, `InputPayload`, `PromptSpec`, `AssemblerConfig`, `AssembledPrompt`) and `assemble()` plus provider adapters.
- Zero Runtime Dependencies: Prefer zero or minimal dependencies. If needed (e.g., schema validation), make them optional/peer to avoid lock‑in.
- Tree‑Shakable: Use ES modules and export per‑adapter entry points (e.g., `openaiAdapter`, `googleAdapter`) so consumers only import what they need.
- Config Injection: Do not hard‑code BitBrat paths or policies. Accept `systemPrompt`/constraints via inputs; reference `architecture.yaml` and `AGENTS.md` only in examples and docs.
- Versioning & SemVer: Use semantic versioning and changelogs to enable safe adoption across services.
- Testing: Ship unit tests with provider mapping fixtures; do not require BitBrat repositories to run.
- Typings: First‑class TypeScript typings; emit `.d.ts` in the package.
- CLI (optional): Provide a thin CLI wrapper (e.g., `npx prompt-assembly render --spec spec.json`) that delegates to the library for quick, external use.

### CLI Usage
- Install/build: `npm run build` (bin is published at `prompt-assembly`).
- Basic: `prompt-assembly --spec spec.json` → prints assembled canonical text.
- Stdin: `cat spec.json | prompt-assembly --stdin --provider openai` → prints OpenAI payload JSON.
- Flags:
  - `--provider openai|google|none` (default: none for canonical text)
  - `--show-empty-sections` `--heading-level 1|2|3`
  - `--max-total-chars <n>` and per-section caps: `--cap-systemPrompt|identity|requestingUser|constraints|task|input <n>`
  - `--out <file>` to write to a file

## Migration Guide: 5 → 6 Sections
- Previous canonical order: Identity → Requesting User → Constraints → Task → Input
- New canonical order: System Prompt → Identity → Requesting User → Constraints → Task → Input
- Actions for teams:
  - Move immutable rules, safety defaults, and precedence notes into [System Prompt]. Keep policy/formatting constraints in [Constraints].
  - Update provider payload mappers to include [System Prompt] within `system`/`systemInstruction` alongside [Identity], [Requesting User], and [Constraints].
  - Reconfirm truncation expectations: never drop [System Prompt]; preserve [Identity] when provided; prefer trimming [Input.context] first.
  - Validate updated prompts against examples and adapter tests.

## Package Usage (Internal Monorepo)
- Import via subpath export:
  - `import { assemble, openaiAdapter, googleAdapter } from "bitbrat-platform/prompt-assembly"`
- Build and pack for independent distribution (dry-run):
  - `npm run build && npm pack`
- Types are emitted and tree-shakable exports enable minimal bundles.

## Roadmap
- v1 (completed): Documentation and implementation of core sections, rendering rules, and provider adapters.
- v1.2: Add token estimation and structured output validators (JSON Schema).

## References
- architecture.yaml (precedence)
- AGENTS.md Sprint Protocol v2.4
- OpenAI API (Chat/Responses)
- Google Generative AI (Gemini) API
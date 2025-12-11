Technical Architecture – Modular LLM Personality Injection (sprint-128-4f7a2c)

Objective
Design a modular, annotation-driven mechanism for injecting dynamic “personality” instructions into the llm-bot’s system prompt. Personalities are either:
- Resolved from Firestore collection /personalities via an ID, or
- Provided inline as text in the annotation payload (inline wins if both are present).

The feature must be safe, observable, cacheable, and backward compatible.

Requirements Summary
- Event annotations include kind="personality" (already present in src/types/events.ts).
- Annotation payload shape:
  { id?: string, text?: string }
  - id: Firestore doc ID under /personalities
  - text: Inline personality text; overrides id if present
- When detected, one or more personalities must be incorporated into the LLM system prompt.
- Must support toggling feature and limiting size/quantity.
- No behavior change if no personality annotation is present.

Data Model
- Firestore collection: /personalities
- Document schema (proposed):
  - id: string (document ID)
  - name: string
  - text: string
  - status: active | inactive | archived (only active used)
  - tags: string[]
  - version: number
  - createdAt: string (ISO8601)
  - updatedAt: string (ISO8601)

Notes
- Only status === active personalities are used. Others are ignored with a warn log.
- We fetch by doc ID when needed. Code enforces status.

Interfaces & Types
- events.ts already includes AnnotationKindV1 with 'personality'.
- Internal type for decode/validation in llm-bot service:
  type PersonalityAnnotationPayload = { id?: string; text?: string };

Configuration & Feature Flags (llm-bot)
- PERSONALITY_ENABLED=true|false (default: true)
- PERSONALITY_COLLECTION=personalities (default)
- PERSONALITY_MAX_CHARS=4000 (clamp personality text after sanitization)
- PERSONALITY_MAX_ANNOTATIONS=3 (limit personality annotations per event)
- PERSONALITY_COMPOSE_MODE=append|prepend|replace (default: append)
- PERSONALITY_CACHE_TTL_MS=300000 (5 minutes; in-memory cache)
- PERSONALITY_LOG_PREVIEW_CHARS=200 (truncate logs)

System Prompt Composition
- Base prompt: existing llm-bot system prompt remains intact by default.
- Composition steps:
  1) Collect annotations where kind === personality
  2) Validate payload shape; skip malformed with warn
  3) Resolve text via inline override or Firestore lookup by id
  4) Filter missing/failed and non-active docs; sanitize and clamp
  5) Compose personalities with base using PERSONALITY_COMPOSE_MODE:
     - append: base + two newlines + personalities joined by two newlines
     - prepend: personalities + two newlines + base
     - replace: personalities only (plus minimal invariant safety header)
- Ordering: deterministic by annotation.createdAt ascending (fallback: input order). Limit to PERSONALITY_MAX_ANNOTATIONS.
- Multiple personalities allowed and concatenated to enable layered behavior.

Token & Length Management
- Clamp personality text to PERSONALITY_MAX_CHARS.
- Estimate total tokens before provider call; if over budget, drop lowest-priority personalities (later createdAt first). Base prompt is never dropped unless COMPOSE_MODE=replace.
- Emit metrics on clamping and drops.

Firestore Access Pattern
- If payload.text exists: use it; no Firestore call.
- Else if payload.id exists: fetch /personalities/{id} and cache the resolved document (id → {text, status, updatedAt}).
- Cache invalidation: TTL via PERSONALITY_CACHE_TTL_MS; evict on TTL.
- On fetch error or missing doc: log warn and skip that personality.

Security
- Read-only credentials for /personalities.
- Sanitize text: strip control characters, normalize whitespace, enforce UTF-8.
- Disallow HTML; consider Markdown or plaintext guidance only.

Observability
- Structured logs: eventId, annotationId, source, composeMode, counts, truncation.
- Metrics: personalities_resolved_total, personalities_failed_total, personalities_dropped_total, personality_cache_hit_total, personality_cache_miss_total.
- Tracing: spans llm.personality.resolve and llm.prompt.compose (if tracing enabled).

Error Handling
- Malformed payload → warn and ignore.
- id not found → warn and ignore.
- status !== active → warn and ignore.
- Firestore error → warn and ignore; proceed without that personality.
- Never block processing due to personality failures.

Backward Compatibility
- No personality annotations → unchanged behavior.
- Feature can be disabled with PERSONALITY_ENABLED=false.

Router & Rules Interplay
- Router may attach personality annotations via JsonLogic or other rules.
- Multiple annotations are allowed; llm-bot performs deterministic merge.
- Existing routes remain unaffected if no annotations are present.

Sequence (Textual)
1) Event arrives at llm-bot with annotations[]
2) Filter annotations where kind === personality
3) Resolve each payload to text (inline or Firestore)
4) Sanitize + clamp + enforce status
5) Compose final system prompt (base +/- personalities)
6) Call LLM provider (OpenAI)
7) Emit logs/metrics; continue standard reply generation

Provider Scope
- Provider: OpenAI (current). Composition is provider-agnostic.

Acceptance Considerations
- Unit tests: payload validation, Firestore resolution, inactive status handling, compose modes, ordering, clamping, cache hits/misses.
- Integration test: end-to-end event causing modified system prompt passed to LLM (mocked SDK).
- Feature flag off path equals current production behavior.

Risks & Mitigations
- Prompt overflow → clamping and drop order.
- Inconsistent personalities → ordering rules and limits.
- Cache staleness → short TTL; option to leverage version for manual bust in future.

Implementation Outline (high level)
- PersonalityResolver module in llm-bot service: resolves and caches personalities.
- PromptComposer enhancement: composes personalities with base prompt per mode.
- Env & config defaults in src/config; wire into llm-bot before provider call.
- Tests and metrics alongside modules.

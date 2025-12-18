# Implementation Plan – sprint-136-c8f3a1

## Objective
- Migrate the llm-bot service to fully use the Prompt Assembly framework (System Prompt → Identity → Requesting User → Constraints → Task → Input) with the OpenAI provider adapter, while preserving existing behavior, short‑term memory semantics, and observability.

## Scope
- In scope
  - Replace ad‑hoc prompt construction in src/services/llm-bot/processor.ts with explicit PromptSpec assembly via src/common/prompt-assembly/assemble.
  - Adopt provider mapping via openaiAdapter to build OpenAI payloads; remove direct string flattener for model input.
  - Map current “personalities” pipeline into PromptSpec: System Prompt from config; Identity from personality parts; keep policy/formatting guidance as Constraints.
  - Integrate Requesting User (roles/locale/timezone) when available; fall back to empty section (still rendered) per spec.
  - Preserve short‑term message memory: inject recent conversation history as fenced context in PromptSpec.input.context, and keep a single canonical [system] + [user] provider payload from adapters.
  - Update config surface and defaults where needed (e.g., LLM_BOT_SYSTEM_PROMPT, optional identity/tone defaults) without breaking existing envs.
  - Update unit/integration tests for llm-bot to validate assembly order and adapter mapping; add golden output checks where stable.
  - Logging: add debug logs for assembled sections, provider payload sizes, and truncation meta.
- Out of scope
  - Migrating other services (e.g., command-processor); provide guidance only.
  - New token estimation; use existing char‑cap truncation already implemented in assemble().
  - Changing Firestore data model for personalities.

## Deliverables
- Code changes
  - src/services/llm-bot/processor.ts: construct PromptSpec from event + personalities + memory; call assemble() and openaiAdapter(); remove flattenMessagesForModel in favor of adapter payload.
  - src/services/llm-bot/personality-resolver.ts: adapt usage so outputs can populate Identity and Constraints instead of a monolithic system blob; keep existing functions but change integration points in processor.
  - Optional: src/config defaults and type guards for new/renamed env vars.
- Tests
  - tests/llm-bot/prompt-assembly-integration.spec.ts (new): ensures assembled sections order, adapter mapping, and preservation of memory context.
  - Update existing llm-bot tests to mock assemble/adapters where appropriate.
- CI/Validation
  - validate_deliverable.sh: ensure repo builds and tests; add a smoke step that assembles a minimal PromptSpec for visibility.
- Documentation
  - docs note in documentation/technical-architecture/prompt-assembly-v1.md (integration section) referencing the updated llm-bot flow.

## Acceptance Criteria
- llm-bot no longer concatenates arbitrary strings for model input; it constructs PromptSpec and uses assemble() + openaiAdapter() exclusively for primary LLM calls.
- Provider payload preserves canonical order: system = [System Prompt + Identity + Requesting User + Constraints], user = [Task + Input].
- Short‑term memory preserved via PromptSpec.input.context as a fenced “Conversation History” block; trimming rules remain effective and are logged.
- Personality guidance mapped: immutable rules relocated to System Prompt; persona traits/tone go to Identity; formatting/policy guidance becomes Constraints.
- Configuration backward compatible; absence of new envs does not break behavior.
- Tests pass locally and in CI; golden checks confirm section order and mapping.

## Testing Strategy
- Unit tests
  - PromptSpec mapping from a synthetic event with annotations and personalities.
  - Adapter output shape for OpenAI (messages[0].role === system; messages[1].role === user).
  - Memory reducer unchanged; context length controls applied.
- Integration tests
  - processEvent() end‑to‑end with mocked OpenAI client; verify candidate creation and logs.
  - Failure modes: missing api key, timeout, truncated inputs.

## Deployment Approach
- No infra change required; Cloud Run remains the runtime per architecture.yaml.
- Cloud Build llm-bot pipeline unchanged; ensure npm test covers new/updated tests.
- Hard cutover: remove legacy flattening path and any feature-flag toggles; migrate fully to assemble()+adapter with no rollback path.

## Dependencies
- OPENAI_API_KEY
- Firestore access for personality documents (unchanged).
- Existing prompt-assembly package within repo (src/common/prompt-assembly/).

## Definition of Done
- All acceptance criteria met; all tests passing; logs demonstrate canonical order.
- Planning artifacts updated; publication prepared when user approves plan per AGENTS.md.

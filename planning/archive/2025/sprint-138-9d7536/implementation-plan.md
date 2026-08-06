# Implementation Plan – sprint-138-9d7536

## Objective
- Implement Prompt Assembly v2 by adding the Conversation State / History layer across the TypeScript library, provider adapters, CLI, and llm-bot, with tests, token budgeting, and observability.

## Scope
- In scope
  - Core types and assembler updates to render the new section
  - Token budgeting/truncation updates and logs
  - Provider adapters: OpenAI and Google
  - CLI updates (parse, flags, rendering)
  - llm-bot integration to construct conversationState from recent exchanges
  - Tests (unit, adapter fixtures, integration)
  - Migration: move history out of Input.context into Conversation State / History, with a short-term fallback
  - Documentation and runbook updates
- Out of scope
  - Long-term memory or cross-session stores
  - Advanced PII detection/redaction ML (ship basic redaction only)
  - New providers beyond OpenAI/Google

## Deliverables
- Library: src/common/prompt-assembly/ (types, assemble, truncation/guards)
- Adapters: src/common/prompt-assembly/adapters/{openai,google}.ts
- CLI: tools/prompt-assembly/src/cli/index.ts (flags for renderMode; show/hide empty)
- Service integration: src/services/llm-bot/processor.ts mapping event history → conversationState
- Tests: unit + adapter fixtures + llm-bot integration (tests/**)
- Docs: integration notes/runbook; v2 migration notes added
- Observability: truncation and section-length meta logs; no secrets or raw transcripts

## Acceptance Criteria
- Assembler renders sections in canonical v2 order with [Conversation State / History] after [Requesting User]
- Conversation State renders summary-first; optional fenced transcript when enabled
- Constraints and Task sorted by ascending priority; preservation order updated per v2
- Provider mappings:
  - OpenAI: system=[System Prompt+Assistant Identity]; user=[Requesting User+Conversation State/History+Constraints+Task+Input]
  - Google: systemInstruction=[System Prompt+Assistant Identity]; contents(user)=[Requesting User+Conversation State/History+Constraints+Task+Input]
- Token budgeting preserves System Prompt and Constraints; trims transcript first; logs truncation meta
- llm-bot builds PromptSpec with conversationState; legacy Input.context history path removed or shimmable with deprecation warning
- Tests pass locally and in CI; golden fixtures verify canonical text and adapter payloads
- CLI supports stdin/spec file and prints canonical/provider payloads including the new section

## Testing Strategy
- Unit tests for assemble(): empty/summary/transcript/both modes, truncation guards, ordering
- Adapter tests with golden payload fixtures (OpenAI, Google)
- CLI tests for flags and stdin parsing
- llm-bot integration test ensuring PromptSpec and adapter payload map correctly, with history summarized and trimmed

## Deployment Approach
- Normal monorepo build; update validate_deliverable.sh to include a CLI smoke run rendering conversationState

## Dependencies
- Existing OpenAI/Google client libs
- Existing llm-bot event format with recent exchanges

## Definition of Done
- Code, tests, docs merged; validate_deliverable.sh logically passable; PR created and approved per DoD and tech-arch v2

## Risks & Mitigations
- Token overflows from transcripts → default to summary mode; strict caps and truncation logging
- Backward compatibility → provide temporary shim from Input.context; warn once per process
- Logging safety → basic redaction utilities; avoid raw transcripts in logs

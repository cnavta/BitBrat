# Implementation Plan – sprint-131-873b2a

## Objective
- Extend the command-processor so that when a matched CommandDoc contains `bot.personality: <name>`, the processor appends an AnnotationV1 to the event:
  - kind: "personality"
  - source: "command-processor"
  - payload: `{ name: <personality-name> }`
- Do not modify routing semantics; only annotate the event so downstream bots (e.g., llm-bot) may use the personality.

## Scope
- In scope
  - Update command-processor processing path to detect `doc.bot.personality` and append an annotation when a command is matched.
  - Input validation and sanitation for personality name (trim, non-empty string).
  - Logging of annotation behavior (added/ignored) with command id and personality name.
  - Unit tests for processor behavior (with/without personality, invalid inputs, idempotence per event instance).
- Out of scope
  - Changes to Firestore schema beyond optional `bot.personality` already present in CommandDoc.
  - Personality text resolution or fetching (handled by llm-bot based on annotations).
  - New external dependencies or infrastructure.

## Deliverables
- Code: src/services/command-processor/processor.ts (behavior insertion), possible small helpers in annotation.ts
- Types: None required (AnnotationKindV1 already includes 'personality'; CommandDoc.bot already defined)
- Tests: New spec(s) under src/services/command-processor/__tests__/
- Planning docs: this plan, sprint manifest, prioritized trackable backlog, request log
- Validation: sprint wrapper that delegates to root validate_deliverable.sh

## Acceptance Criteria
- When a command matches and CommandDoc.bot.personality is a non-empty string, an AnnotationV1 is appended:
  - kind = 'personality'
  - source = 'command-processor'
  - payload.name = personality name
  - createdAt and id are set per existing helper defaults
- If `bot.personality` is absent, empty, or not a string, no annotation is added.
- Existing behavior (candidates, cooldowns, rate-limits) remains unchanged.
- Unit tests cover: happy path, absent/invalid personality, multiple commands in rapid succession (no cross-event leakage), and logging presence.
- Repo builds and tests pass via validate script.

## Testing Strategy
- Unit tests mocking minimal repository behavior so that processor receives a known CommandDoc.
- Verify appended annotations array content and immutability assumptions per event instance.
- Use jest spies for logging assertions where pragmatic.

## Deployment Approach
- No infra changes; no new env vars.
- Leverage existing repository validate_deliverable.sh for CI/local validation.

## Dependencies
- Existing annotation helpers and llm-bot consumption of 'personality' annotations.

## Definition of Done
- Code implemented and covered by tests.
- Planning artifacts committed.
- validate_deliverable.sh remains logically passable and tests pass locally.

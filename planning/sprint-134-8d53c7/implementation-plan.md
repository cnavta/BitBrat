# Implementation Plan – sprint-134-8d53c7

## Objective
- Implement per-user context composition in llm-bot: username, roles mapped to prompts from /configs/bot/roles, and optional user description from /users/{userId}.

## Scope
- In scope
  - Add user-context module for roles/user fetch, caching, composition, and injection
  - Integrate into llm-bot processor ingest path
  - Add configuration flags and defaults
  - Add unit tests for composition and append injection mode
- Out of scope
  - Auth service role mapping changes
  - Production data backfill

## Deliverables
- Code: src/services/llm-bot/user-context.ts integrated into processor.ts
- Tests: src/services/llm-bot/__tests__/user-context.append.spec.ts
- Config defaults in LlmBotServer
- Planning artifacts in planning/sprint-134-8d53c7/

## Acceptance Criteria
- When USER_CONTEXT_ENABLED=true and USER_CONTEXT_INJECTION_MODE=append, composed user context appears in model input
- Roles read from /configs/bot/roles (enabled==true) and sorted by priority
- Username and optional description included; truncation follows policy
- Unit tests pass

## Testing Strategy
- Jest unit tests for append mode with mocked Firestore; CI-friendly

## Deployment Approach
- No deployment this sprint; code is behind feature flags with safe defaults

## Dependencies
- Firestore Admin SDK; existing BaseServer config accessors

## Definition of Done
- Build and tests pass locally and in CI

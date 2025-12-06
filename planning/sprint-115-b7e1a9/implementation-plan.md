# Implementation Plan – sprint-115-b7e1a9

## Objective
- Define and document Technical Architecture for extending BaseServer with two convenience helpers:
  - onHTTPRequest(pathPattern, handler)
  - onMessage(destination, handler)
- After approval, implement these helpers, lifecycle management, and tests.

## Scope
- In scope:
  - Technical Architecture document describing API, behavior, lifecycle, logging, testing, and compatibility
  - Planning artifacts and validation script wrapper
  - Unit tests plan for BaseServer changes
- Out of scope (this sprint phase until approved):
  - Implementing BaseServer code changes
  - Refactoring services to adopt the helpers (can be follow-up)

## Deliverables
- planning/sprint-115-b7e1a9/technical-architecture.md
- Updated planning artifacts under planning/sprint-115-b7e1a9/
- When approved: code changes to src/common/base-server.ts plus tests under src/common/__tests__/

## Acceptance Criteria
- Technical Architecture clearly defines method signatures, visibility (protected), subject resolution, test skip policy, shutdown behavior, and logging
- No code changes to production paths before user approval
- Plan aligns with architecture.yaml precedence and AGENTS.md protocol

## Testing Strategy
- Unit tests for:
  - HTTP helper registers a GET route and serves a response (supertest)
  - Message helper: skips in test mode; when enabled, subscribes with prefixed subject and default queue; stores and calls unsubscribe on shutdown
  - Error handling: handler exception path leads to ack by default (conservative choice)
- Mocks: services/message-bus subscriber factory

## Deployment Approach
- No deployment artifacts needed for this change; it is a library enhancement. Existing Dockerfiles remain unchanged.

## Dependencies
- services/message-bus: createMessageSubscriber() API and types (AttributeMap)
- Logger facade and BaseServer’s existing shutdown hooks

## Definition of Done
- Technical Architecture approved by user
- BaseServer updated with helpers and lifecycle management
- Jest tests added and passing locally via validate_deliverable.sh

## Backlog
1. Author Technical Architecture document (this file references it) — Status: DONE ✓
2. Add planning scaffolding for sprint-115 — Status: DONE ✓
3. Implement BaseServer protected helpers (onHTTPRequest, onMessage) — Status: DONE ✓
   - Subject resolution with cfg.busPrefix — DONE ✓
   - Test skip policy (NODE_ENV=test or MESSAGE_BUS_DISABLE_SUBSCRIBE=1) — DONE ✓
   - Store unsubscribe and call during shutdown — DONE ✓
   - Default ack behavior on exceptions — DONE ✓
   - Config-object overloads for both helpers — DONE ✓
4. Add unit tests for helpers — Status: PARTIAL *
   - HTTP registration and config-object form — DONE ✓
   - Message helper skip behavior — DONE ✓
   - Message helper prefix/queue/ack in non-test env — SKIPPED (deferred)
5. Update documentation references if needed — Status: DONE ✓
6. Open PR and record in publication.yaml — Status: PLANNED
7. Wire llm-bot minimal onMessage logging for its topic (internal.llmbot.v1) — Status: DONE ✓

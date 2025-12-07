# Implementation Plan – sprint-119-a8827e

## Objective
- Implement routing slip helpers in `BaseServer` to standardize message advancement and completion across services:
  - `protected async next(event: InternalEventV2)`
  - `protected async complete(event: InternalEventV2)`
- Ensure method-level idempotency, consistent attribute propagation, tracing, and logging.
- Refactor the command-processor to adopt the helpers.

## Scope
In scope
- Add protected helpers to `src/common/base-server.ts` implementing behavior defined in Technical Architecture
- Publish via message bus abstraction with required attributes
- Add method-level idempotency guards (in-memory markers)
- Unit tests for helpers using noop message bus and spies
- Refactor command-processor to use helpers
- Sprint-local validation script and publication steps

Out of scope
- Changes to `InternalEventV2` contract or transport drivers
- Multi-service migration beyond command-processor (tracked as stretch)

## Deliverables
- Code:
  - `BaseServer.next(event)` and `BaseServer.complete(event)`
  - Command-processor refactor to use helpers
- Tests:
  - Unit tests verifying publish targets, attributes, tracing hook calls, and idempotency (no-op on second call)
- CI/Validation:
  - `planning/sprint-119-a8827e/validate_deliverable.sh` (logical, runnable locally/CI)
- Documentation:
  - Service usage notes and idempotency guidelines in docs
- Ops:
  - Publication PR created via `gh` and recorded in `publication.yaml`

## Acceptance Criteria
- Helpers publish to correct subjects with attributes: `correlationId`, `type`, `traceparent`, `source`, optional `replyTo`, and merged step `attributes`
- `next(event)` advances to first pending step; if none pending, publishes to `egressDestination` when present
- `complete(event)` publishes directly to `egressDestination` when present; warns if absent
- Method-level idempotency: repeated calls with the same event instance are no-ops; markers cleared on publish failure to allow retry
- Tracing spans `routing.next` and `routing.complete` emitted; logs have correlation context
- Unit tests pass; validation script is logically passable

## Testing Strategy
- Use Jest with the message-bus noop driver (activated in CI/test via env)
- Spy on `publishJson` to assert topic and attributes
- Verify idempotency by calling helpers twice with same event instance and asserting single publish
- Negative tests: missing `egressDestination` results in warning and no publish; simulated publish failure clears idempotency markers and surfaces error

## Deployment Approach
- No runtime deployment required for sprint validation; ensure local runs and tests pass
- Cloud default runtime is Cloud Run; keep artifacts compatible with existing Cloud Build files
- Validation script will optionally run a dry-run deploy command if available

## Dependencies
- `architecture.yaml` for subject conventions and service defaults
- `src/services/message-bus/*` abstraction for publishing
- Existing Jest configuration in repository
- GitHub CLI (`gh`) for PR creation (credentials required; failure will be logged and surfaced for user-provided auth)

## Implementation Outline
1. Implement helpers in `BaseServer` per Technical Architecture
   - Add protected methods and leverage `createMessagePublisher()`
   - Add idempotency markers using `Symbol.for(...)` or a WeakMap
   - Integrate tracing via `startActiveSpan` and attribute injection
2. Create unit tests
   - Introduce a test subclass of `BaseServer` that exposes testable wrappers
   - Mock/spy publishers and verify calls/attributes
3. Refactor command-processor
   - Replace routing-forwarding logic with `this.next(evt)` and `this.complete(evt)`
   - Ensure behavior parity and tests passing
4. Validation script
   - Install deps, build, run tests; attempt local start/stop if applicable; dry-run deploy step
5. Publication
   - Commit changes to feature branch and create PR via `gh`; record PR URL

## Risks & Mitigations
- Double-delivery due to at-least-once semantics — tests verify method-level idempotency; document consumer idempotency requirement
- Missing egress destination — helper warns and no-ops
- PR creation may fail due to missing auth — script and logs will capture error; request credentials

## Definition of Done
- Satisfies project-wide DoD (tests in place and passing; documentation updates; validation script logically passable)
- Traceability to sprint ID and backlog items in commit messages and `request-log.md`

## Traceability
- Sprint: `sprint-119-a8827e`
- Technical Architecture: `planning/sprint-119-a8827e/technical-architecture.md`
- Backlog: `planning/sprint-119-a8827e/backlog.yaml` (BL-001 through BL-010; BL-011 as stretch)

Implementation Plan – sprint-107-8ae3c1

Objective
- Introduce InternalEventV2 extending EnvelopeV1 with message, annotations, and candidates; document flow and egress selection.

Scope
- In scope: Technical Architecture doc; TypeScript interfaces (pending approval); minimal egress selection policy; unit tests for selection utility.
- Out of scope: Full migration of all services to V2; schema registry; extensive observability.

Deliverables
- Documentation: technical-architecture-internal-event-v2.md.
- Code changes (pending approval): src/types additions for V2; minimal egress selection utility and hook.
- Tests: unit tests for candidate selection.
- Validation: per repo validate_deliverable.sh.

Acceptance Criteria
- Architecture doc describes schema and flow.
- Types compile if added; V1 remains unchanged.
- Egress selects lowest-priority candidate with deterministic tie-breakers when V2 present.
- Unit tests pass for selection utility.

Testing Strategy
- Unit tests covering priority, confidence, createdAt tie-breakers; empty/malformed cases.

Deployment Approach
- Backward compatible; no special deployment work this sprint.

Dependencies
- None external; adhere to architecture.yaml and AGENTS.md.

Definition of Done
- Docs created; plan approved; changes traceable; tests green; validation logically passable.

Approvals Required
- User approval of this plan prior to implementing code changes.

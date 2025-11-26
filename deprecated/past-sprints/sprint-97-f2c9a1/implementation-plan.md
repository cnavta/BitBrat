Welcome to Sprint 97 (sprint-97-f2c9a1)

Objective
- Define a Phase 1 Event Bus abstraction for BitBrat services, aligned with architecture.yaml and the attached messaging guides.

Scope
- Documentation-only sprint to specify a simple, driver-agnostic Event Bus abstraction (publish/subscribe), envelope usage, attributes, and initial topics.
- No code implementation of drivers; focus on architecture and standards.

Out of Scope
- Implementing Pub/Sub or NATS drivers
- Router or worker service changes

Deliverables
- planning/sprint-97-f2c9a1/phase-1-event-bus-architecture.md
- planning/sprint-97-f2c9a1/implementation-plan.md (this file)
- planning/sprint-97-f2c9a1/request-log.md

Acceptance Criteria
- The new architecture document:
  - Describes interfaces for MessagePublisher and MessageSubscriber (publishJson/subscribe signatures)
  - Enumerates initial topics consistent with architecture.yaml (e.g., internal.ingress.v1, internal.finalize.v1, internal.llmbot.v1) and references forward-looking topics from messaging docs where relevant
  - Defines envelope v1 fields and required transport attributes
  - Explains environment-based driver selection (MESSAGE_BUS_DRIVER or MESSAGE_BUS; BUS_PREFIX)
  - States idempotency, retries/backoff, and DLQ expectations at a high level referencing the guides
  - Provides a minimal compliance checklist for Phase 1

Testing Strategy
- Documentation validation only in this sprint; link to repository-wide Jest standards for future code changes.
- Ensure terminology and interfaces match architecture.yaml and the referenced docs.

Deployment Approach
- None (documents only). Future sprints will add Cloud Build deploys for services using this abstraction.

Dependencies
- architecture.yaml (source of truth)
- planning/reference/messaging-system.md (authoritative guide)
- planning/reference/messaging-system-improvements.md (standards and proposals)
- planning/reference/messaging-architecture-as-is.md (current state)

Definition of Done
- All deliverables committed under planning/sprint-97-f2c9a1/
- Document aligns with architecture.yaml and attached messaging docs
- Plan and request log updated

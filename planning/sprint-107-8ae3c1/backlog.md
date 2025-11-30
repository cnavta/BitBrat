Trackable Backlog — sprint-107-8ae3c1

Legend: [ ] = To do, [*] = In progress, [x] = Done, [!] = Blocked

1. Planning and Architecture
   - [x] TA document: InternalEventV2 schema and flow (technical-architecture-internal-event-v2.md)
   - [x] Implementation Plan (implementation-plan.md)

2. Type Definitions
   - [x] Define InternalEventV2 and component interfaces (MessageV1, AnnotationV1, CandidateV1, ErrorEntryV1)
   - [x] Preserve InternalEventV1 and EnvelopeV1 unchanged
   - [x] Export types from src/types barrel (index.ts)

3. Egress Selection Logic
   - [x] Implement selectBestCandidate() with priority/confidence/createdAt tie-breakers
   - [x] Implement extractEgressTextFromEvent() preferring V2, fallback to V1
   - [x] Integrate into ingress-egress-service egress path

4. Tests and Validation (initial)
  - [x] Unit tests for selection utility (priority/confidence/createdAt, edge cases)
  - [x] Run test suite (jest) and address failures if any (all green)
  - [!] Run validate_deliverable.sh at repo root or sprint delegate (blocked in current environment)

5. Verification and Publication (initial)
   - [x] Update verification-report.md with completed items and outcomes
   - [x] Commit and push feature branch
   - [ ] Open PR on GitHub (manual or automation) — link recorded in publication.yaml
   - [x] Update publication.yaml with PR link
   - [x] Retro and key-learnings stubs populated

6. InternalEventV2 Migration Backlog (BB-IEV2)
   6.1 Global/Shared
     - [ ] BB-IEV2-001: V1↔V2 adapters (toV2, toV1) with unit tests
     - [ ] BB-IEV2-002: `busAttrsFromEvent(evt)` helper for V1/V2
     - [ ] BB-IEV2-003: Logging helpers for V2 lifecycle (annotations/candidates diffs)
     - [ ] BB-IEV2-004: `markSelectedCandidate(evt)` and unit tests

   6.2 Ingress-Egress
     - [ ] BB-IEV2-010: Twitch ingress translator emits V2 (dual-publish flag)
     - [ ] BB-IEV2-011: Ensure `egressDestination` populated on V2
     - [ ] BB-IEV2-012: Egress marks selected candidate and logs rationale

   6.3 Auth Service
     - [ ] BB-IEV2-020: Consume V1 or V2; emit V2 enriched to `internal.user.enriched.v1`
     - [ ] BB-IEV2-021: Append/update `routingSlip` step id="auth" with status/timestamps

   6.4 Event Router
     - [ ] BB-IEV2-030: Consume V1 or V2; emit V2 with updated `routingSlip`
     - [ ] BB-IEV2-031: Use bus attribute helper for publish attrs

   6.5 Command Processor
     - [ ] BB-IEV2-040: Define command topic constant(s) in `src/types/events.ts`
     - [ ] BB-IEV2-041: Wire V2 consumer stub; accept V1/V2 and normalize to V2

   6.6 Non-functional & Validation
     - [ ] BB-IEV2-050: Update validation script to include V2 smoke path
     - [ ] BB-IEV2-051: Documentation updates for services and examples

Dependencies/Notes
- Normalization of external snake_case timestamps to camelCase in TS layer approved.
- No additional candidate kinds reserved in this sprint.

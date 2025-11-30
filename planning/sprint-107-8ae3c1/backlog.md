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

4. Tests and Validation
  - [x] Unit tests for selection utility (priority/confidence/createdAt, edge cases)
  - [x] Run test suite (jest) and address failures if any (all green)
  - [!] Run validate_deliverable.sh at repo root or sprint delegate (blocked in current environment)

5. Verification and Publication
   - [x] Update verification-report.md with completed items and outcomes
   - [x] Commit and push feature branch
   - [ ] Open PR on GitHub (manual or automation) — link recorded in publication.yaml
   - [x] Update publication.yaml with PR link
   - [x] Retro and key-learnings stubs populated

Dependencies/Notes
- Normalization of external snake_case timestamps to camelCase in TS layer approved.
- No additional candidate kinds reserved in this sprint.

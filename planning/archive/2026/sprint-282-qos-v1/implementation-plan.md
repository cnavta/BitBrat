# Implementation Plan - sprint-282-qos-v1

## Objective
Implement Quality of Service (QOS) enforcement for `persistenceTtlSec`, `tracer`, and `maxResponseMs` as per the architectural strategy and additional Lead Architect requirements.

## Scope
- `src/types/events.ts`: Update `QOSV1` and related types.
- `src/common/base-server.ts`: Integrate tracer logging, span overrides, and processing timeouts.
- `src/services/persistence/model.ts`: Update TTL calculation logic.
- `src/apps/ingress-egress-service.ts`: Implement tracer debug responses at ingress and configure `debugUsers`.
- `src/services/ingress/twitch/twitch-irc-client.ts`: Handle `!debug` command for authorized users.

## Deliverables
- Code changes in BaseServer, Persistence Service, and Ingress-Egress.
- Unit tests for QOS enforcement.
- Updated Technical Architecture document.

## Acceptance Criteria
- [ ] Events with `qos.persistenceTtlSec` have `expireAt` set correctly in Firestore.
- [ ] Events with `qos.tracer = true` are logged in full on reception and publication in `BaseServer`.
- [ ] Tracer chat events result in an immediate debug response from the ingress with correlation ID/trace ID.
- [ ] Authorized "debug users" can use `!debug` prefix to force `qos.tracer = true`.
- [ ] Unauthorized users using `!debug` prefix have their messages treated as normal.
- [ ] Errors during tracer processing result in the error message being sent back to the requester.
- [ ] `maxResponseMs` violations are logged as `warn` and result in a processing timeout error/deadletter.

## Testing Strategy
- Unit tests for `computeExpireAt` with `persistenceTtlSec`.
- Mocked `BaseServer` tests to verify tracer logging and span attributes.
- Integration tests (or simulated runs) to verify debug responses for tracer chat events.

## Definition of Done
- Code matches architecture requirements.
- Tests pass.
- `validate_deliverable.sh` succeeds.
- PR created.
- Retro and Key Learnings documented.

# Execution Plan - sprint-282-qos-v1

## Objective
Implement QOSV1 enforcement (TTL, Tracer, Timeout) and tracer event handling logic across `BaseServer`, `Persistence Service`, and `Ingress-Egress Service`.

## Task Breakdown

### Phase 1: Core Types & Persistence (P0)
1. **Update `QOSV1` Type:** Add `persistenceTtlSec` and `maxResponseMs` to `src/types/events.ts`.
2. **Persistence TTL Logic:** Update `computeExpireAt` in `src/services/persistence/model.ts` to respect `persistenceTtlSec`.
3. **Validation:** Unit tests for `computeExpireAt`.

### Phase 2: BaseServer Integration (P0)
1. **Tracer Logging:** Add debug logging for full event on reception and before publishing in `BaseServer`.
2. **Tracer Span Override:** Configure OpenTelemetry spans to always sample if `qos.tracer` is true.
3. **Processing Timeout:** Implement timeout race in `onMessage` using `maxResponseMs`.
4. **Validation:** Mocked `BaseServer` tests for logging, sampling, and timeouts.

### Phase 3: Ingress-Egress & Tracer Feedback (P1)
1. **Tracer Debug Response:** Update `IngressEgressServer` to send back immediate feedback for chat tracer events.
2. **Tracer Error Response:** Update error handling in `IngressEgressServer` to notify requester of failures for tracer events.
3. **Debug User Support:** Implement `/debug` command handling for authorized `connector:username` pairs.
4. **Validation:** Integration tests with `IngressEgressServer` and `TwitchIrcClient`.

### Phase 4: Finalization (P2)
1. **Documentation:** Update `architecture.yaml` (if necessary) and refine Technical Architecture document.
2. **Validation Script:** Create `validate_deliverable.sh` covering all QOS scenarios.
3. **PR Creation:** Final review and PR submission.

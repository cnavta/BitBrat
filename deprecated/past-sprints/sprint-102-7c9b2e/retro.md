# Sprint Retro - sprint-102-7c9b2e

## What worked
- Clear execution plan and backlog made implementation straightforward and traceable
- RouterEngine design (first-match-wins, short-circuit) mapped cleanly to JsonLogic and tests
- Defensive defaults: default DLQ slip and slip normalization kept flows robust
- Non-blocking RuleLoader startup prevented boot stalls when Firestore was slow or unavailable
- Pub/Sub publishing strategy change (lazy ensure with timeout) reduced latency and noisy warnings
- Switch to explicit ack semantics ensured correctness and avoided message loss
- Jest suite remained fast and reliable; ingress integration test stabilized

## What did not
- Initial Firestore path used an even-segment path causing startup warnings (fixed and normalized)
- CI reported open-handle issues due to Firestore listeners during tests (guarded in test env)

## Improvements to try next
- Add /_debug/ counters endpoint and health checks for routing metrics (Sprint 103)
- Emulator-based integration tests to verify live rule updates via onSnapshot (Sprint 103)
- Expand decision logging to include evaluation timing and rule counts for observability
- Consider circuit-breaking or backpressure for downstream publish failures
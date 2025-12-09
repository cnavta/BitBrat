Implementation Plan – sprint-112-7f5377b

Objective:
- Plan reliability fixes: disable default publish timeout (opt-in), filter retries to transient errors, add idempotency + dedupe, tune batching, improve telemetry.

Scope:
- In: Planning artifacts, validation script, PR publication
- Out: Runtime rollout (services are down)

Deliverables:
- Backlog of tasks, validation script, PR

Acceptance Criteria:
- Backlog is actionable and traceable; validation script is logically passable; PR opened.

Backlog (status):
1) Defaults: remove Cloud Run auto publish timeout; default 0 unless env set. — Completed ✓
2) Retry filter: retry only UNAVAILABLE(14), INTERNAL(13), RESOURCE_EXHAUSTED(8), ABORTED(10); do not retry local publish timeouts. — Completed ✓
3) Idempotency: add idempotencyKey attribute on publishes; propagate across hops. — Completed ✓
4) Dedupe: in-memory LRU+TTL dedupe at subscribers; counters + logs; env toggles. — Completed ✓
5) Batching: keep PUBSUB_BATCH_MAX_MS default 20–50ms; warn ≥1000ms; document guidance. — Completed ✓
6) Telemetry: attempt number + durationMs on publish; duplicate-drop counters. — Completed ✓
7) Tests: unit for retry filter, idempotency attribute, dedupe TTL, batching bounds. — Completed ✓
   - Added tests:
     - tests/common/events/attributes.spec.ts (idempotencyKey)
     - tests/services/message-bus/pubsub-batching.spec.ts (high-window warning)
     - tests/services/message-bus/subscriber-dedupe.spec.ts (dedupe within TTL)
     - Updated: src/services/ingress/twitch/publisher.spec.ts (retry filter)
8) Docs: ops playbook and runbook. — Completed ✓
   - Added documentation/runbooks/messaging-reliability.md
9) Rollout: staged canary next sprint with verification. — Deferred

Milestones:
- M1: Code + tests ready — Completed ✓
- M2: Docs complete — Completed ✓
- M3: Staged rollout (next sprint) — Deferred

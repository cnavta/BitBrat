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

Backlog:
1) Defaults: remove Cloud Run auto publish timeout; default 0 unless env set.
2) Retry filter: retry only UNAVAILABLE(14), INTERNAL(13), RESOURCE_EXHAUSTED(8), ABORTED(10); do not retry local publish timeouts.
3) Idempotency: add idempotencyKey attribute on publishes; propagate across hops.
4) Dedupe: in-memory LRU+TTL dedupe at subscribers; counters + logs; env toggles.
5) Batching: keep PUBSUB_BATCH_MAX_MS default 20–50ms; warn ≥1000ms; document guidance.
6) Telemetry: attempt number + durationMs on publish; duplicate-drop counters.
7) Tests: unit for retry filter, idempotency attribute, dedupe TTL, batching bounds; integration with noop driver.
8) Docs: ops playbook and runbook.
9) Rollout: staged canary next sprint with verification.

Milestones:
- M1: Code + tests ready
- M2: Docs complete
- M3: Staged rollout (next sprint)

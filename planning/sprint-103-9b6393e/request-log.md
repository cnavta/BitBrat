# Request Log — sprint-103-9b6393e

- Timestamp: 2025-11-28 17:46 local
- Sprint: Sprint 103 — Observability, Hardening, Integration Tests
- Role: Lead Implementor (per issue)

Actions
1. Created feature branch
   - Command: git checkout -b feature/sprint-103-9b6393e-observability-hardening-integration-tests
   - Result: branch created

2. Added planning artifacts
   - Files created:
     - planning/sprint-103-9b6393e/sprint-execution-plan.md
     - planning/sprint-103-9b6393e/trackable-backlog.yaml
   - Source references:
     - planning/sprint-100-e9a29d/sprint-execution-plan.md (Sprint 103 scope)
     - planning/sprint-100-e9a29d/technical-architecture.md (Observability & Error Handling)
     - planning/sprint-100-e9a29d/trackable-backlog.yaml (BB-103-01..03)

3. Committed planning artifacts
   - Command: git add -A && git commit -m "Sprint 103 planning: add sprint-execution-plan, trackable-backlog, implementation-plan, and request-log per AGENTS.md"
   - Result: commit 9dfce40 created on feature branch

4. Pending approval
   - Per AGENTS.md, coding is forbidden until the execution plan is approved. Awaiting user approval to proceed with implementation tasks.

5. Implemented Observability counters endpoint (BB-103-01)
   - Timestamp: 2025-11-28 18:58 local
   - Files added/changed:
     - src/common/counters.ts (new) — in-memory counters singleton
     - src/apps/event-router-service.ts — added /_debug and /_debug/counters routes; wired counters increments on message handling
     - src/apps/__tests__/event-router-debug.test.ts — tests for endpoint and counter updates
     - tests/integration/routing-emulator.spec.ts — emulator test skeleton (guarded by FIRESTORE_EMULATOR_HOST)
   - Commands:
     - npm run build
     - npm test
   - Results:
     - Build succeeded
     - Tests: new unit tests passed; integration skeleton skipped as intended

6. Updated backlog statuses
   - File updated: planning/sprint-103-9b6393e/trackable-backlog.yaml
   - Changes:
     - BB-103-01 → completed
     - BB-103-02 → in-progress (skeleton added)

7. Next actions
   - Flesh out emulator-backed integration to verify snapshot reactivity and rerouting (BB-103-02)
   - Review/add any missing unit tests for error handling hardening (BB-103-03)

8. Prod incident: TimeoutNegativeWarning investigation and remediation
   - Timestamp: 2025-11-28 20:10 local
   - Symptom: event-router logs showed TimeoutNegativeWarning: negative number; "Timeout duration was set to 1" (Node warning)
   - Analysis: searched for setTimeout usage; candidates in retry.ts and Pub/Sub driver withTimeout(). Drivers generally guard non-positive ms, but upstream or env-derived values could still pass negative/NaN. Hardened timers globally and locally.
   - Changes:
     - src/common/retry.ts — clamp sleep() delay to >=1ms and ceil fractional values
     - src/common/safe-timers.ts — new module patching global setTimeout/setInterval to clamp invalid/negative delays to 1ms, warns once
     - src/apps/event-router-service.ts — import safe-timers at top to install clamps early in process
   - Validation: npm run build && npm test — all suites pass (68 passed, 1 skipped). No TimeoutNegativeWarning seen during tests.
   - Impact: Prevents Node from emitting TimeoutNegativeWarning in prod from any negative/invalid delay, without changing intended timing semantics materially

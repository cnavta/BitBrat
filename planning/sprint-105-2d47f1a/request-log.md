# Request Log — sprint-105-2d47f1a

- 2025-11-29T14:21:00Z | Init | Action: Create sprint scaffolding | Files: 
  - planning/sprint-105-2d47f1a/sprint-manifest.yaml
  - planning/sprint-105-2d47f1a/implementation-plan.md
  - planning/sprint-105-2d47f1a/trackable-backlog.yaml
  | Notes: Drafted Implementation Plan and Backlog per AGENTS §2.4; no code changes.

- 2025-11-29T14:45:00Z | Sprint Start | Action: Activate sprint and create feature branch | Commands:
  - git checkout -B feature/sprint-105-2d47f1a-auth-service-enrichment
  | Files Modified:
  - planning/sprint-105-2d47f1a/sprint-manifest.yaml (status: active; started_at added)
  - planning/sprint-105-2d47f1a/request-log.md (append entry)
  | Notes: Sprint moved from draft→active per AGENTS §2.2; branch created for implementation phase (S11).

- 2025-11-29T20:00:00Z | Implement | Action: Add core Auth enrichment logic and bus wiring | Files:
  - src/types/events.ts (extended EnvelopeV1 with envelope.user/auth per contract)
  - src/services/auth/user-repo.ts (Firestore user repo: getById/getByEmail)
  - src/services/auth/enrichment.ts (pure enrichEvent function)
  - src/common/counters.ts (added auth.enrich.* counters)
  - src/apps/auth-service.ts (subscribe to ingress, enrich, publish, counters, error handling)
  | Notes: Implements BB-105-01, BB-105-02, and partial BB-105-03/04/07; build and tests executed locally.

- 2025-11-29T21:15:00Z | Remediate | Action: Stabilize Jest/CI to prevent segfault and teardown warnings | Files:
  - src/services/message-bus/index.ts (default to NATS driver when NODE_ENV=test/CI to avoid @google-cloud/pubsub import)
  - src/apps/auth-service.ts (skip message-bus subscription under test via isTestEnv guard)
  - validate_deliverable.sh (export MESSAGE_BUS_DRIVER=nats, MESSAGE_BUS_DISABLE_SUBSCRIBE=1, PUBSUB_ENSURE_DISABLE=1 for tests)
  - jest.config.js (previous change — CI-friendly settings)
  | Notes: Prevents Pub/Sub client initialization during Jest which caused import-after-teardown and segfaults in Cloud Build. Local full suite passes; monitor CI.

- 2025-11-29T21:32:00Z | Remediate | Action: Eliminate network I/O during tests; fix Cloud Build NATS connection refusal | Files:
  - src/services/message-bus/noop-driver.ts (new zero-I/O driver for tests/CI)
  - src/services/message-bus/index.ts (select 'noop' driver when CI/Jest or MESSAGE_BUS_DISABLE_IO=1; honor explicit driver)
  - validate_deliverable.sh (force MESSAGE_BUS_DRIVER=noop, MESSAGE_BUS_DISABLE_IO=1 for tests)
  - src/services/message-bus/message-bus.test.ts (explicitly set pubsub in test instead of relying on default)
  - src/services/message-bus/__tests__/factory-selection.test.ts (new tests for noop selection and explicit pubsub)
  | Notes: Prevents attempts to connect to NATS in CI and ensures tests exit cleanly without open handles.

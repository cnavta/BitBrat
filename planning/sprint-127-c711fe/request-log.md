# Sprint 127 — Request Log

- 2025-12-11T15:46:20Z | Sprint init | Created feature branch and planning scaffolding
  - branch: feature/sprint-127-c711fe-jsonlogic-operators
  - files:
    - planning/sprint-127-c711fe/sprint-manifest.yaml
    - planning/sprint-127-c711fe/implementation-plan.md
    - planning/sprint-127-c711fe/trackable-backlog.yaml

- 2025-12-11T15:47:10Z | Fix | Resolved YAML formatting issues in trackable-backlog.yaml (block scalars for descriptions)

- 2025-12-11T15:58:30Z | Execute | Implemented custom JsonLogic operators and tests
  - files:
    - src/services/router/jsonlogic-evaluator.ts
    - src/services/router/__tests__/jsonlogic-ci-eq.spec.ts
    - src/services/router/__tests__/jsonlogic-re-test.spec.ts
    - src/services/router/__tests__/jsonlogic-slip-complete.spec.ts
    - src/services/router/__tests__/jsonlogic-extra-ops.spec.ts
    - src/services/routing/__tests__/router-engine-ops-integration.spec.ts
  - notes: Operators registered idempotently; evaluator context extended (user, routingSlip)

- 2025-12-11T16:00:10Z | Validate | Ran test suite — green; updated backlog statuses and manifest status to in-progress
  - files:
    - planning/sprint-127-c711fe/trackable-backlog.yaml
    - planning/sprint-127-c711fe/sprint-manifest.yaml

- 2025-12-11T16:05:20Z | Publish | Pushed branch and created GitHub PR
  - branch: feature/sprint-127-c711fe-jsonlogic-operators
  - pr_url: https://github.com/cnavta/BitBrat/pull/29
  - files:
    - planning/sprint-127-c711fe/publication.yaml

- 2025-12-11T16:35:30Z | Change | Adapt rules to store JsonLogic as JSON strings (Firestore compatibility)
  - files:
    - src/services/router/jsonlogic-evaluator.ts (evaluate now accepts string logic)
    - src/services/router/rule-loader.ts (logic type -> string; validation accepts string or stringifies object)
    - src/services/routing/__tests__/router-engine.test.ts (updated to use string logic)
    - src/services/routing/__tests__/router-engine-ops-integration.spec.ts (string logic)
    - src/services/router/__tests__/rule-loader.test.ts (string logic)
    - src/services/router/__tests__/rule-loader.hardening.test.ts (string logic)
    - route.json (example now stores logic as a JSON string)
  - notes: npm test passed (124/126 suites; 326 tests passed, 10 skipped). Back-compat retained by stringifying object logic in loader.

- 2025-12-11T17:14:00Z | Change | Stop adding 'auth' step to routingSlip prior to event-router (assume static path ingress→router)
  - rationale: Router rules rely on slip completion semantics; pre-populating with 'auth' muddied completion state
  - files:
    - src/apps/auth-service.ts (removed routingSlip mutation)
  - validation: build + tests green (124/126 suites passed; 326 tests passed, 10 skipped)

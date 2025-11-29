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

Sprint Execution Plan — oauth-flow (sprint-18-a6c9d2)

Author: Junie (Lead Implementor)
Date: 2025-11-19 19:47
Status: For approval

1) Objective & Scope
--------------------
Implement the oauth-flow service per architecture.yaml and the oauth-flow technical architecture, exposing Twitch OAuth2 endpoints for both bot and broadcaster identities and persisting tokens to Firestore.

In-Scope (this sprint):
- Wire OAuth routes into src/apps/oauth-service.ts using mountTwitchOAuthRoutes.
- Instantiate FirestoreTokenStore for bot and broadcaster with env-driven doc paths.
- Provide minimal env/config assembly for IConfig (from process.env).
- Add Jest unit tests for route start URL, state verification error paths, and happy-path callback with mocked fetch.
- Validate locally via validate_deliverable.sh (root and sprint-level).
- Prepare Cloud Build dry-run for oauth-flow via cloudbuild.oauth-flow.yaml.
- Publish a PR with links to planning docs per Sprint Protocol.

Out of Scope (deferred):
- EventSub wiring and runtime chat client; centralized config module.

2) Deliverables
---------------
- Code: Updated src/apps/oauth-service.ts mounting /oauth/twitch/bot and /oauth/twitch/broadcaster routes.
- Tests: New Jest tests alongside oauth-service and/or twitch-oauth helpers.
- Docs: This sprint-execution-plan.md and backlog.yaml kept in planning/.
- CI/CD: Usage of existing Dockerfile.oauth-flow and cloudbuild.oauth-flow.yaml; PR created.

3) Acceptance Criteria
----------------------
- GET /oauth/twitch/bot/start returns a 302 to Twitch (or JSON url when requested).
- GET /oauth/twitch/bot/callback persists token document at TOKEN_DOC_PATH/token on success.
- GET /oauth/twitch/broadcaster/* behaves analogously using BROADCASTER_TOKEN_DOC_PATH.
- Health endpoints remain functional.
- Jest tests pass locally and in CI (npm test).
- validate_deliverable.sh completes successfully.
- Cloud Build config validates in dry-run and PR is opened.

4) Testing Strategy
-------------------
- Unit tests:
  - getAuthUrl builds URL with expected client_id, redirect_uri, scopes.
  - verifyState rejects tampered/expired states.
  - Route mounting smoke tests: /start responds (mock req/headers), /callback stores token (mock fetch for token + validate, mock tokenStore).
- Existing tests leveraged: src/apps/oauth-service.test.ts (health).

5) Deployment Approach
----------------------
- Containerize with Dockerfile.oauth-flow (already present).
- Cloud Build using cloudbuild.oauth-flow.yaml; deploy target is Cloud Run (allowUnauthenticated per architecture.yaml).
- LB path routing /oauth → oauth-flow as defined in architecture.yaml.

6) Configuration & Secrets
--------------------------
Required env:
- TWITCH_CLIENT_ID
- TWITCH_CLIENT_SECRET
- OAUTH_STATE_SECRET

Optional env:
- TWITCH_REDIRECT_URI
- TWITCH_OAUTH_SCOPES
- TOKEN_DOC_PATH (default oauth/twitch/bot)
- BROADCASTER_TOKEN_DOC_PATH (default oauth/twitch/broadcaster)

7) Work Breakdown & Milestones
------------------------------
- M1 — Plan approval (OF-1) [Day 0]
- M2 — Route wiring completed (OF-2, OF-3) [Day 1]
- M3 — Unit tests authored and passing (OF-4) [Day 1]
- M4 — Validation and dry-run (OF-5, OF-6) [Day 2]
- M5 — Publish PR (OF-7) [Day 2]

8) Dependencies
---------------
- Firebase Admin SDK configured (getFirestore) and ADC available locally/CI for tests that mock Firestore; real Firestore not required for unit tests.
- Secrets/vars available in CI for build steps (no live token exchange in tests).

9) Risks & Mitigations
----------------------
- Risk: Callback URL mismatch behind LB. Mitigation: computeBaseUrl honors X-Forwarded headers; allow TWITCH_REDIRECT_URI override.
- Risk: Missing Firestore doc path envs. Mitigation: default paths and clear logs.
- Risk: External HTTP to Twitch in tests. Mitigation: mock global fetch.

10) Definition of Done (DoD)
----------------------------
- Endpoints mounted and tested.
- Tokens persist with userId when validate succeeds.
- Root and sprint validation scripts pass.
- PR created with links to architecture and plan documents.

11) Publication Plan
--------------------
- Branch: feature/sprint-18-a6c9d2-oauth-flow
- PR Title: "Sprint 18 Deliverables — oauth-flow routes and tests"
- PR Body links: planning/sprint-18-a6c9d2/implementation-plan.md, sprint-execution-plan.md, backlog.yaml.

12) Traceability
----------------
- architecture.yaml → services.oauth-flow
- planning/sprint-18-a6c9d2/oauth-flow-technical-architecture.md
- src/services/twitch-oauth.ts, src/services/firestore-token-store.ts, src/apps/oauth-service.ts

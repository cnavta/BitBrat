Implementation Plan — oauth-flow (sprint-18-a6c9d2)

Objective
---------
Design the complete oauth-flow service architecture and prepare for full implementation aligned to architecture.yaml. Call out missing code referenced by docs.

Deliverables
------------
- oauth-flow-technical-architecture.md (in-depth design)
- Documented list of missing modules and impact
- validate_deliverable.sh (runs build/tests)

Current State Summary
---------------------
- Present:
  - src/apps/oauth-service.ts — health endpoints only
  - src/services/twitch-oauth.ts — OAuth helpers and route mounting utility
  - src/services/firestore-token-store.ts — Firestore-backed token store
  - src/types/index.ts — IConfig subset, TwitchTokenData, ITokenStore
  - Dockerfile.oauth-flow, cloudbuild.oauth-flow.yaml, env/*/oauth-flow.yaml
  - src/services/twitch-token-manager.ts — Programmatic refresh manager (with unit tests)
  - src/services/twitch-client.ts — Bot chat client wiring using Twurple RefreshingAuthProvider
- Missing vs reference docs:
  - src/services/twitch-eventsub.ts — not found
  - src/apps/bot-server.ts — not found
  - src/common/config.ts — not found

Scope (this sprint)
-------------------
- Planning/documentation only; no runtime code changes beyond planning artifacts.
- Define endpoints, flows, configuration, security, and deployment for oauth-flow.

Acceptance Criteria
-------------------
- Architecture doc aligns with architecture.yaml and attached references.
- Explicit list of missing code with impact.
- Repo builds and tests pass via root validate script.

Validation
----------
- Run: npm ci && npm run build && npm test

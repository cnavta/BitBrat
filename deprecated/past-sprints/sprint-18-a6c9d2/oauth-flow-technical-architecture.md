oauth-flow Service — Technical Architecture (sprint-18-a6c9d2)

Author: Junie (Architect)
Date: 2025-11-19
Status: Draft for review

1) Executive Summary
- oauth-flow is a stateless Cloud Run service exposing Twitch OAuth2 flows under /oauth/*, persisting tokens to Firestore via a pluggable ITokenStore.

2) Context (from architecture.yaml)
- Service: oauth-flow
  - entry: src/apps/oauth-service.ts
  - paths: /oauth/*
  - secrets: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, OAUTH_STATE_SECRET
- LB routes /oauth to this service; health probes at /healthz, /readyz, /livez.

3) Responsibilities
- Endpoints:
  - /oauth/twitch/bot/start -> /oauth/twitch/bot/callback
  - /oauth/twitch/broadcaster/start -> /oauth/twitch/broadcaster/callback
- Generate/verify HMAC state; exchange code; validate token to capture userId; persist tokens.
- Provide health endpoints (already implemented).

Non-Responsibilities
- EventSub/chat wiring and token auto-refresh (future or other services).

4) Interfaces (HTTP)
- GET {base}/start: builds Twitch authorize URL with scopes and HMAC state; 302 redirect (or JSON url when requested).
- GET {base}/callback: verifies state; exchanges code; validates access token; stores via tokenStore; returns 200 on success.

5) Internal Modules (present)
- src/services/twitch-oauth.ts (149 lines)
  - generateState (23-29), verifyState (31-41), getAuthUrl (51-59), exchangeCodeForToken (61-108), mountTwitchOAuthRoutes (110-148)
- src/services/firestore-token-store.ts (60 lines)
  - FirestoreTokenStore with doc convention {path}/token; getToken (17-39), setToken (41-58)
- src/apps/oauth-service.ts (62 lines)
  - Express app exposing /healthz, /readyz, /livez; no OAuth routes yet
- src/types/index.ts (70 lines)
  - IConfig subset, TwitchTokenData, ITokenStore
 - src/services/twitch-token-manager.ts
   - Programmatic refresh manager using refresh_token grant; persists via ITokenStore
 - src/services/twitch-client.ts
   - Bot chat client wiring using Twurple RefreshingAuthProvider; reads bot token; persists on refresh

Missing vs reference docs (updated)
- src/services/twitch-eventsub.ts — not present
- src/apps/bot-server.ts — not present
- src/common/config.ts — not present

6) Data & Storage
- Document paths: oauth/twitch/bot/token and oauth/twitch/broadcaster/token
- Schema: accessToken, refreshToken|null, scope[], expiresIn|null, obtainmentTimestamp|null, userId|null, updatedAt

7) Configuration & Secrets
- Required: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, OAUTH_STATE_SECRET
- Optional: TWITCH_REDIRECT_URI, TWITCH_OAUTH_SCOPES, TOKEN_DOC_PATH (default oauth/twitch/bot), BROADCASTER_TOKEN_DOC_PATH (default oauth/twitch/broadcaster)

8) Security
- CSRF/state via HMAC-SHA256 with max age; secrets from env; Firestore IAM and at-rest encryption; X-Forwarded headers respected.

9) Deployment
- Dockerfile.oauth-flow and cloudbuild.oauth-flow.yaml build and deploy to Cloud Run; LB routes /oauth.

10) Minimal Implementation Outline
- In oauth-service.ts, build cfg from env; create two FirestoreTokenStore instances for bot and broadcaster; mount with mountTwitchOAuthRoutes at /oauth/twitch/bot and /oauth/twitch/broadcaster.

11) Testing Strategy
- Unit: state generation/verification; getAuthUrl; route mounting smoke tests with mocked fetch.
- Existing tests: oauth-service health test (src/apps/oauth-service.test.ts); twitch-token-manager unit tests (src/services/twitch-token-manager.test.ts).

12) Definition of Done (for implementation)
- Routes available for both identities; tokens persisted with userId when possible; health probes pass; CI build/tests pass; Cloud Run deploy works.

13) Open Items
- Implement missing Twitch runtime modules in future sprints; consider unified config loader; optional /_debug/oauth route.

14) Traceability
- architecture.yaml (services.oauth-flow); src/services/twitch-oauth.ts; src/services/firestore-token-store.ts; src/apps/oauth-service.ts; src/types/index.ts; planning/reference/*.md

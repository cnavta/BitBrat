# Implementation Plan – sprint-140-2f9c1a

## Objective
- Extend oauth-flow to support multiple providers via a provider-agnostic routing layer and adapters; add Discord; enable Discord ingress to consume credentials from the token store.

## Scope
- In scope
  - Provider registry and generic /oauth/:provider/:identity routes
  - Twitch adapter migration into adapter interface (backward-compatible existing routes)
  - Discord adapter (bot token handling only; user OAuth deferred)
  - Token store schema updates (authTokens/{provider}/{identity}) and read-compat for existing Twitch paths
  - Discord ingress changes to read token from store with feature flag and rotation handling
  - Tests and documentation (unit + integration)
- Out of scope
  - UI for account linking
  - Cross-provider SSO and advanced consent
  - Discord user-level OAuth this sprint (hooks only)

## Plan and Work Breakdown

Phase 0 — Foundations
1) Define OAuthProvider interface and shared types (TokenPayload, ValidationResult)
2) Implement ProviderRegistry (register/resolve by key; e.g., twitch, discord)
3) Introduce shared helpers (state/PKCE generation, safe logging redactions)

Phase 1 — Generic Routes and Twitch Migration
4) Route factory: mountOAuthRoutes(app, cfg, tokenStore, basePath="/oauth") to serve:
   - GET /oauth/:provider/:identity/start
   - GET /oauth/:provider/:identity/callback
   - POST /oauth/:provider/:identity/refresh
   - GET /oauth/:provider/:identity/status
5) Implement TwitchAdapter using current logic (Twurple) behind interface
6) Wire oauth-service to mount both legacy /oauth/twitch/{bot,broadcaster} and new generic routes via registry

Phase 2 — Token Store Model
7) Extend ITokenStore to support provider+identity addressing and token metadata
8) Update FirestoreTokenStore to path authTokens/{provider}/{identity} with schema from architecture
9) Add read-compat for existing Twitch docs or migration utility (non-blocking)

Phase 3 — Discord (Bot) Integration
10) DiscordAdapter skeleton (authorize URL only for future user OAuth; no code exchange required for bot token)
11) Add config/secrets for Discord to architecture.yaml/env (DISCORD_CLIENT_ID/SECRET/REDIRECT_URI; DISCORD_BOT_TOKEN; flags)
12) Update DiscordIngressClient to resolve token via token store when discordUseTokenStore=true with fallback to cfg.discordBotToken, plus rotation-aware reload

Phase 4 — Testing & Validation
13) Unit tests: registry, routes controller, Twitch adapter, token store
14) Integration tests: oauth-flow for Twitch legacy and generic paths (HTTP mocked)
15) Ingress tests: Discord token resolution, fallback, rotation
16) Update validate_deliverable.sh to run build+tests and perform minimal health checks with Discord disabled by default

Phase 5 — Docs & Publication
17) Update documentation: architecture.yaml additions, env samples, runbook
18) Prepare PR with changes; include verification report and publication metadata

## Deliverables
- Provider registry, shared OAuth types/helpers
- Twitch adapter with legacy routes preserved and generic routes enabled
- Discord adapter skeleton; Discord ingress token-store integration (feature-flagged)
- Updated FirestoreTokenStore schema and optional migration script
- Tests (unit + integration) and updated validation script
- Documentation and PR

## Acceptance Criteria
- Existing /oauth/twitch/* routes behave unchanged
- New /oauth/:provider/:identity routes function for Twitch (start/callback/status/refresh)
- Discord ingress uses token from token store when flag enabled; falls back to env when absent; can reload on rotation without restart
- Token store uses authTokens/{provider}/{identity} schema; Twitch tokens readable/writable via new API
- Tests pass in CI; validate_deliverable.sh logically passable

## Testing Strategy
- Unit tests for: ProviderRegistry, mountOAuthRoutes controller, TwitchAdapter, FirestoreTokenStore
- Integration tests: oauth-flow HTTP endpoints for Twitch (legacy+generic)
- Ingress connector tests: Discord token resolution with mock ITokenStore and rotation triggers
- Mocks/stubs for external HTTP and discord.js

## Deployment Approach
- Cloud Run pipelines unchanged; extend env/secret templates
- Rollout plan:
  1) Deploy oauth-flow with generic routes alongside legacy
  2) Enable discordUseTokenStore in dev; verify ingress reads from store; monitor logs
  3) After verification, seed prod token doc and enable flag

## Dependencies
- Firestore access for token store
- Discord application credentials (client ID/secret) and bot token (for initial seeding)
- Existing Twurple/Twitch config and secrets

## Risks & Mitigations
- Risk: Breaking legacy Twitch routes — Mitigate with unchanged mount and integration tests
- Risk: Token rotation race — Mitigate with cached resolver + safe reconnect in Discord ingress
- Risk: Missing Discord secrets — Mitigate with feature flag, clear health/errors, and docs

## Definition of Done
- Meets project-wide DoD and sprint AC
- validate_deliverable.sh updated and logically passable
- PR created with verification report and planning artifacts updated
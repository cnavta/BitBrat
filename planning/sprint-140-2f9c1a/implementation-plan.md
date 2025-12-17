# Implementation Plan – sprint-140-2f9c1a

## Objective
- Extend oauth-flow to support multiple providers via a provider-agnostic routing layer and adapters; add Discord; enable Discord ingress to consume credentials from the token store.

## Scope
- In scope
  - Provider registry and generic /oauth/:provider/:identity routes
  - Twitch adapter migration into adapter interface (backward-compatible existing routes)
  - Discord adapter (bot token handling; user OAuth deferred)
  - Token store schema updates (authTokens/{provider}/{identity})
  - Discord ingress changes to read token from store with feature flag
  - Tests and documentation
- Out of scope
  - UI for account linking
  - Cross-provider SSO and advanced consent
  - Discord user-level OAuth this sprint

## Deliverables
- Code changes in oauth-flow (routes, adapters) and ingress (Discord token resolution)
- Tests (unit + integration)
- Updated env and architecture docs
- Validation script updates

## Acceptance Criteria
- Existing /oauth/twitch/* routes behave unchanged
- New /oauth/:provider/:identity routes function for Twitch and Discord (where applicable)
- Discord ingress can start using token from store (flag-controlled) and gracefully handle rotation

## Testing Strategy
- Unit tests for provider adapters and controller logic
- Integration tests for route flows (mock external HTTP)
- Ingress connector tests with token store mock

## Deployment Approach
- Cloud Run services redeployed via existing pipelines
- New env vars and secrets added for Discord

## Dependencies
- Firestore access for token store
- Discord application credentials (client ID/secret) and bot token (for initial seeding)

## Definition of Done
- Meets project-wide DoD and this sprint’s AC; validate_deliverable.sh updated to be logically passable
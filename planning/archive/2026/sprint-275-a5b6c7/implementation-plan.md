# Implementation Plan – sprint-275-a5b6c7

## Objective
Fix issues with Discord ingress failing to connect using OAuth tokens and failing to reconnect when tokens are updated in Firestore.

## Scope
- `src/services/ingress/discord/discord-ingress-client.ts`
- `src/services/oauth/providers/discord-adapter.ts`
- `src/services/ingress/discord/discord-reconnect.spec.ts` (New test file)

## Deliverables
- Code changes in `DiscordIngressClient` to ensure robust reconnection and token polling.
- Code changes in `DiscordAdapter` to correctly handle Discord's token response.
- Reproduction and regression tests.

## Acceptance Criteria
- `DiscordIngressClient` starts polling for tokens even if the initial `login()` fails.
- `DiscordIngressClient.reconnect()` successfully establishes a connection when a new token is provided, even if it was previously disconnected or failed to connect.
- `DiscordAdapter` correctly extracts the Bot Token from the OAuth2 response if present.
- All tests in `src/services/ingress/discord/` pass.

## Testing Strategy
- Create `discord-reconnect.spec.ts` to simulate:
    - Initial `login()` failure followed by a token rotation in Firestore.
    - `reconnect()` being called when `this.client` is null.
- Update `discord-integration.spec.ts` if needed.
- Mock `discord.js` and `AuthTokenStore` for these tests.

## Deployment Approach
- Standard Cloud Build and Cloud Run deployment for `ingress-egress` service.

## Dependencies
- Discord Bot Token must be available or correctly retrieved via OAuth.

## Definition of Done
- All code changes implemented.
- All tests pass, including new reproduction tests.
- PR created and URL recorded in `publication.yaml`.
- Findings and retro documented.

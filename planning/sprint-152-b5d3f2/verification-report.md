# Deliverable Verification – sprint-152-b5d3f2

## Completed
- [x] Dependency Update: Added `@twurple/api`, `@twurple/eventsub-ws`, and `@twurple/eventsub-base`.
- [x] Event Schema Evolution: Defined `ExternalEventV1` and updated `InternalEventV2` to support behavioral events.
- [x] Implemented `EventSubEnvelopeBuilder` for normalization of `channel.follow` and `channel.update` events.
- [x] Implemented `TwitchEventSubClient` for WebSocket-based EventSub integration.
- [x] Integrated `TwitchEventSubClient` into `IngressEgressServer`.
- [x] Updated Auth Enrichment to support resolving candidate IDs and mapping profile data from `externalEvent` payloads.
- [x] Verified all core service tests pass, including fixed regressions in envelope builders and ingress-egress routing.

## Partial
- None.

## Deferred
- None.

## Alignment Notes
- Remediated "no token found" errors in Cloud Run by ensuring bot tokens are correctly registered and aliased for broadcaster IDs where Twurple requires a specific user context (e.g., `channel.update.v2`).
- Refined the authentication strategy to prefer real broadcaster tokens from `/oauth/twitch/broadcaster/token` when available, falling back to bot token aliasing only when necessary.
- Standardized Twurple dependencies to version `^7.4.0` to maintain compatibility across the project.
- Mocked `TwitchEventSubClient` in existing integration tests to ensure stability without requiring real Twitch credentials.

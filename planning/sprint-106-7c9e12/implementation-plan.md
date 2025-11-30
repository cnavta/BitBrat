# Implementation Plan – sprint-106-7c9e12

## Objective
- Build a fully functional egress path for the ingress-egress service:
  - Subscribe to per-instance egress topic internal.egress.v1.{instanceId}
  - Ensure all published messages from ingress-egress set envelope.egressDestination to its egress topic
  - On receiving egress messages, send payload.chat.text via Twitch IRC as the bot (bootstrap behavior)

## Scope
### In Scope
- Topic naming and instance identity configuration (env var EGRESS_INSTANCE_ID with fallbacks)
- Code changes in ingress-egress service to:
  - compute egress topic
  - subscribe to that topic
  - send text to Twitch IRC
  - set egressDestination on all published messages
- Update architecture.yaml service topics and env docs
- Unit tests for:
  - envelope builder sets egressDestination
  - egress consumer extracts payload.chat.text and calls Twitch client send
- Validation script alignment

### Out of Scope
- Non-Twitch egresses (Kick, Discord, etc.)
- Advanced routing or authorization
- Persistent storage for egress state beyond current Twitch client

## Deliverables
- Source code updates in src/apps/ingress-egress-service.ts and ingress/twitch components as needed
- New/updated tests under src/services/ingress/twitch and/or src/apps
- Documentation:
  - Technical Architecture – Ingress-Egress Egress Path (this sprint)
- Updated planning artifacts and request log

## Acceptance Criteria
- In local or test environment, when a message is published on internal.egress.v1.{instanceId} with payload.chat.text, the Twitch IRC client send method is invoked with the provided text
- All messages published by ingress-egress to internal.ingress.v1 have envelope.egressDestination set to internal.egress.v1.{instanceId}
- Service subscribes only to its own egress topic and starts without errors
- Unit tests pass; build succeeds

## Testing Strategy
- Unit tests:
  - Mock TwitchIrcClient and verify send is called with payload.chat.text
  - Mock publisher/envelope builder and assert egressDestination is present
- Integration (local):
  - In-memory bus or mock bus to publish to egress topic and observe IRC client side effect

## Deployment Approach
- Cloud Run per architecture.yaml defaults
- Env vars:
  - EGRESS_INSTANCE_ID (recommended)
  - FALLBACKS: SERVICE_INSTANCE_ID || HOSTNAME || generated uuid at process start
  - BUS_PREFIX applied to subjects
- Update architecture.yaml topics and env sections accordingly

## Dependencies
- Message bus abstraction already in repo
- Existing Twitch IRC client implementation

## Definition of Done
- Code adheres to architecture.yaml and AGENTS.md sprint protocol
- Jest tests created and passing
- validate_deliverable.sh logically passable
- PR opened with sprint artifacts

## Work Breakdown
1. Compute instance ID and egress topic utility
2. Ensure TwitchEnvelopeBuilder (or publisher wrapper) injects egressDestination
3. Subscribe to egress topic in ingress-egress service and wire handler
4. Implement handler to extract payload.chat.text and call twitchClient.send
5. Tests for envelope egressDestination and IRC send
6. Update architecture.yaml and docs
7. Validation, verification, PR

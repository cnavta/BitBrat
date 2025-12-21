# Implementation Plan – sprint-152-b5d3f2

## Objective
Establish Twitch EventSub WebSocket integration for `channel.update` and `channel.follow` events, normalized into a scalable `InternalEventV2` format.

## Scope
- Modify `InternalEventV2` to support behavioral events via an `externalEvent` field.
- Implement `TwitchEventSubClient` using `@twurple/eventsub-ws`.
- Map `channel.update` and `channel.follow` events to `InternalEventV2`.
- Integrate the new client into `IngressEgressServer`.
- Publish events to `internal.ingress.v1`.

## Deliverables
- Code changes in `src/types/events.ts`.
- New service `src/services/ingress/twitch/eventsub-client.ts`.
- New builder `src/services/ingress/twitch/eventsub-envelope-builder.ts`.
- Integration in `src/apps/ingress-egress-service.ts`.
- Update `src/services/auth/enrichment.ts` to support `externalEvent` in candidate resolution.
- Unit tests for new components.
- Updated `validate_deliverable.sh`.

## Execution Plan

### Phase 1: Foundation (Tasks 001-002)
- **Dependency Update**: Add `@twurple/eventsub-ws` to `package.json` and install.
- **Schema Evolution**: Define `ExternalEventV1` and update `InternalEventV2` in `src/types/events.ts`. Ensure backward compatibility by making `message` optional.

### Phase 2: Core Implementation (Tasks 003-004)
- **Normalization Logic**: Implement `EventSubEnvelopeBuilder` to transform Twurple event objects into `InternalEventV2`.
- **WebSocket Client**: Implement `TwitchEventSubClient` to manage the lifecycle of the EventSub WebSocket connection and subscriptions.

### Phase 3: Integration & Enrichment (Tasks 005-006)
- **Ingress Integration**: Wire `TwitchEventSubClient` into `IngressEgressServer` and ensure it runs alongside the IRC client.
- **Auth Enrichment**: Update the `auth` service to recognize `externalEvent` payloads so behavioral events can be associated with users.

### Phase 4: Quality & Verification (Tasks 007-008)
- **Validation**: Update `validate_deliverable.sh` and ensure all tests pass.
- **Closure**: Generate verification report, retro, and key learnings. Create PR.

## Acceptance Criteria
- `IngressEgressServer` successfully initializes the EventSub WebSocket connection.
- `channel.update` events from Twitch are received and published to `internal.ingress.v1` as `InternalEventV2` with `externalEvent` populated.
- `channel.follow` events from Twitch are received and published to `internal.ingress.v1` as `InternalEventV2` with `externalEvent` populated.
- Backward compatibility is maintained (existing chat messages still work via `message` field).

## Testing Strategy
- **Unit Tests**: Mock Twurple's `EventSubWsListener` to verify that events are correctly captured and passed to the envelope builder.
- **Normalization Tests**: Verify that various platform event payloads are correctly mapped to `ExternalEventV1`.
- **Integration Tests**: Verify that `IngressEgressServer` can start with the new client enabled.

## Deployment Approach
- Deploy `ingress-egress` service to Cloud Run.
- Ensure `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are available in secrets.
- Note: EventSub WebSockets do not require a public callback URL (unlike Webhooks).

## Dependencies
- `@twurple/eventsub-ws`

## Definition of Done
- All code follows project style rules.
- Tests for all new behavior pass.
- `validate_deliverable.sh` passes.
- PR created and linked in `publication.yaml`.
- `verification-report.md`, `retro.md`, and `key-learnings.md` generated.

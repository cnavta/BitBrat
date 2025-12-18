# Implementation Plan – sprint-146-7e2a4c

## Objective
- Fix the issue where Discord responses are sent via Twitch because of incorrect source detection in `ingress-egress`.

## Scope
- `ingress-egress` service routing logic.
- `command-processor` service event handling (source preservation).

## Deliverables
- Bug fix in `src/apps/command-processor-service.ts`.
- Enhancement in `src/apps/ingress-egress-service.ts`.
- Updated tests in `src/apps/__tests__/ingress-egress-routing.test.ts`.

## Acceptance Criteria
- Discord responses are routed to `discordClient.sendText`.
- Twitch responses are routed to `twitchClient.sendText`.
- `command-processor` does not overwrite the original payload source.
- `ingress-egress` correctly detects Discord even for V1 events or events with missing top-level source but Discord annotations.

## Testing Strategy
- Unit tests in `ingress-egress-routing.test.ts` covering multiple source/annotation/event-version combinations.
- Regression tests for `command-processor` and `ingress-egress`.

## Definition of Done
- All tests pass.
- `validate_deliverable.sh` succeeds.
- PR created.

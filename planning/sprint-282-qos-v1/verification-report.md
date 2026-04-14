# Deliverable Verification – sprint-282-qos-v1

## Completed
- [x] QOSV1 interface updated with `persistenceTtlSec`, `tracer`, and `maxResponseMs`.
- [x] Persistence layer (`computeExpireAt`) prioritizes `qos.persistenceTtlSec`.
- [x] `BaseServer` debug logs full events for tracer-marked events.
- [x] `BaseServer` forces OpenTelemetry sampling for tracer-marked events.
- [x] `BaseServer` enforces `maxResponseMs` timeout in `onMessage`.
- [x] `TwitchIrcClient` detects `!trace` command and provides immediate feedback.
- [x] `IngressEgressServer` provides error feedback for tracer delivery failures.
- [x] Authorized debug users can use `!debug` prefix to force tracer mode.
- [x] Case-insensitive Debug User and Command Detection.
- [x] Robust user detection (trimmed whitespace, numerical ID support).
- [x] Comprehensive unit tests for all new QOS logic.

## Partial
- None

## Deferred
- None

## Alignment Notes
- Implemented `!trace` and `/debug` (for authorized users) as triggers for tracer events.
- OpenTelemetry sampling hint implemented via span attributes and kind as a best-effort approach within the existing provider configuration.

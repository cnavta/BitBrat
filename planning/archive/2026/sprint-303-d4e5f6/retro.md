# Retro – sprint-303-d4e5f6

## What Worked
- Rapid implementation of the enrichment pattern in `StoryEngineMcpServer`.
- Integration with existing `BaseServer` Pub/Sub and Snapshot capabilities was seamless.
- Validation script caught a type error in the `AnnotationV1` implementation early.

## What Didn't
- Lack of local Firestore emulator made integration testing a bit more complex.
- **Infinite Loop (Ingress)**: Twitch connector was responding to itself because of missing `userLogin` check, causing a "!adventure loop".
- **Redelivery Loop (Pub/Sub)**: `BaseServer.onMessage` defaults to `explicit` acknowledgement, but `StoryEngineMcpServer` and `SchedulerServer` were missing `ctx.ack()` calls, leading to repeated processing every 10 seconds.

## Opportunities for Improvement
- Standardize the `AnnotationV1` interface across all services to prevent similar type errors.
- Implement a more robust local test environment for Pub/Sub enrichment flows.
- **Platform Hardening**: Consider changing `BaseServer.onMessage` to `auto` ack by default, or add linting/logging to warn when a handler completes without calling `ack()` in explicit mode.

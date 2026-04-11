# Retro – sprint-277-a12b3c

## What Worked
- Rapid identification of the event type mismatch in `EventSubEnvelopeBuilder`.
- Successful normalization of other Twitch EventSub events to a consistent `system.` naming convention.
- Discovered and fixed a critical routing bug in `PersistenceServer` that prevented `system.stream.online` events from being recorded in the `events` collection.
- Comprehensive testing of both normalization logic and persistence routing logic.

## What Didn't Work
- Initial assumption that only the event type was the issue. The missing persistence events were a separate but related problem in the persistence service's message handling logic.
- The `persistence` service had an over-broad check for `system.` events that caused it to skip the standard ingress persistence flow for stream events.

## Lessons Learned
- Always verify the end-to-end flow of an event, especially if it's a "system" event that might be handled differently by infrastructure services like persistence.
- Consistency in event naming (`system.*`) is good, but services must be updated to handle new system event types correctly.

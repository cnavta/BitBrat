# Sprint Retro – sprint-153-d1e2f3

## What Worked
- Extending `InternalEventV2` provided a clean way to pass system-level metadata without breaking legacy message flows.
- The `ConnectorManager`'s `getSnapshot` method was a perfect hook for implementing the heartbeat logic in `ingress-egress`.
- Firestore `merge: true` allowed for incremental updates from multiple sources (heartbeat vs. stream events) to the same document.

## What Didn't
- Initial assumption about Twitch EventSub IDs: Twurple's EventSub events don't always expose the platform's native event ID in a uniform way, so we had to generate unique `correlationId`s for some system events.
- **Heartbeat Noise**: The 60-second periodic heartbeat loop for all connectors caused excessive Pub/Sub volume in production-like environments. This was removed in favor of event-driven updates (like stream online/offline) and future "on-change" status tracking.
- **Twurple Event Schema**: Incorrectly assumed `startedAt` was the date field for `stream.online` events. It is actually `startDate` in Twurple. This caused a crash when calling `.toISOString()` on undefined. Defensive error handling (try-catch) has been added to all EventSub handlers to prevent similar issues from crashing the entire service.
- **Missing Persistence Fields**: `normalizeStreamEvent` was missing `platform` and `id` fields in the returned patch, which caused `PersistenceStore.upsertSourceState` to reject the updates. These have been added and verified with unit tests.
- **Event-Driven vs Periodic Status**: After removing periodic heartbeats, we realized we still needed to capture state changes (e.g., a connector going into an `ERROR` state). We implemented a low-frequency (15s) monitoring loop that only publishes `system.source.status` when a change is detected, providing a good balance between responsiveness and low Pub/Sub noise.
- **Twitch EventSub Snapshot**: Discovered that the EventSub connector was reporting an `ERROR` state in Firestore because its `getSnapshot()` method lacked a `state` property, causing the adapter to default to `ERROR`. Added state tracking and compatible snapshot fields to resolve this.

## Summary
The core goal of establishing Source State Awareness in Firestore is complete. All P0 and P1 items from the backlog are implemented and verified, including post-implementation stability fixes.

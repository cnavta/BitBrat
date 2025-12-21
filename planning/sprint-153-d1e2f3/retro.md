# Sprint Retro – sprint-153-d1e2f3

## What Worked
- Extending `InternalEventV2` provided a clean way to pass system-level metadata without breaking legacy message flows.
- The `ConnectorManager`'s `getSnapshot` method was a perfect hook for implementing the heartbeat logic in `ingress-egress`.
- Firestore `merge: true` allowed for incremental updates from multiple sources (heartbeat vs. stream events) to the same document.

## What Didn't
- Initial assumption about Twitch EventSub IDs: Twurple's EventSub events don't always expose the platform's native event ID in a uniform way, so we had to generate unique `correlationId`s for some system events.
- **Heartbeat Noise**: The 60-second periodic heartbeat loop for all connectors caused excessive Pub/Sub volume in production-like environments. This was removed in favor of event-driven updates (like stream online/offline) and future "on-change" status tracking.
- **Twurple Event Schema**: Incorrectly assumed `startedAt` was the date field for `stream.online` events. It is actually `startDate` in Twurple. This caused a crash when calling `.toISOString()` on undefined. Defensive error handling (try-catch) has been added to all EventSub handlers to prevent similar issues from crashing the entire service.

## Summary
The core goal of establishing Source State Awareness in Firestore is complete. All P0 and P1 items from the backlog are implemented and verified, including post-implementation stability fixes.

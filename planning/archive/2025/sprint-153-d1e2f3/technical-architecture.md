# Technical Architecture: Source State Awareness

## Overview
This document outlines the architecture for providing the BitBrat platform with real-time awareness of ingress source status (Twitch, Discord, etc.) and stream status. This state will be persisted in Firestore and made available to all services for better orchestration and context-aware behavior.

## Core Objectives
1.  **Connectivity Tracking**: Monitor and persist the connection state of all ingress connectors.
2.  **Stream Status Tracking**: For streaming platforms (Twitch, Kick), track when a stream goes online or offline.
3.  **Metrics aggregation**: Collect basic in/out stats (message rates, error counts) per source.
4.  **Firestore Persistence**: Serve as the "Source of Truth" for the current state of the platform's world.

## Data Model (Firestore)

### Collection: `sources`
Each document represents a unique ingress source.

- **Document ID**: `{platform}:{unique_id}` (e.g., `twitch:123456`, `discord:987654321`)
- **Fields**:
    - `id`: string (e.g., "123456")
    - `platform`: 'twitch' | 'discord' | 'kick'
    - `displayName`: string (e.g., "bitbrat_bot")
    - `status`: 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
    - `streamStatus`: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
    - `lastStatusUpdate`: ISO8601 Timestamp
    - `lastStreamUpdate`: ISO8601 Timestamp
    - `lastError`: { code: string, message: string, at: ISO8601 }
    - `metrics`:
        - `messagesIn`: number (total)
        - `messagesOut`: number (total)
        - `errors`: number (total)
        - `reconnects`: number (total)
        - `lastHeartbeat`: ISO8601
    - `metadata`: Record<string, any> (platform specific, e.g., current game, stream title)

## Event Flow & Integration

### 1. Ingress Status Events
The `ingress-egress` service will emit internal status events whenever a connector changes state or reaches a heartbeat interval.

- **Topic**: `internal.ingress.v1`
- **InternalEventType**: `system.source.status`
- **Payload**:
    ```json
    {
      "source": "twitch:123456",
      "platform": "twitch",
      "status": "CONNECTED",
      "metrics": {}
    }
    ```

### 2. Twitch Stream Online/Offline
We will utilize Twitch EventSub (WebSockets) to listen for `stream.online` and `stream.offline`.

- **Subscriptions**: `stream.online`, `stream.offline`
- **Internal Mapping**:
    - `stream.online` -> `InternalEventV2` with type `system.stream.online`
    - `stream.offline` -> `InternalEventV2` with type `system.stream.offline`
- **Flow**:
    1.  `ingress-egress` receives EventSub notification.
    2.  `ingress-egress` publishes normalized event to `internal.ingress.v1`.
    3.  `persistence` service (or a new `state-service`) consumes the event.
    4.  Firestore `sources` document is updated with `streamStatus: 'ONLINE'` and relevant metadata.

### 3. State Persistence
The `persistence` service will be extended to handle `system.*` events by updating the `sources` collection instead of (or in addition to) the `events` collection.

## Proposed New Metrics & Events
Beyond the requested fields, we should also track:
1.  **Authentication Health**: `authStatus: 'VALID' | 'EXPIRED' | 'REVOKED'`. Crucial for proactive token refreshing.
2.  **Viewer Count**: Periodically updated during `ONLINE` status.
3.  **Bot Permissions**: `permissions: string[]` (e.g., `['MODERATOR', 'VIP']`). Helps the LLM know what actions it can perform.
4.  **Latency**: `latencyMs`: Average response time from the platform.

## Implementation Phases
1.  **Phase 1**: Define `InternalEventV2` extensions and Firestore schema.
2.  **Phase 2**: Update `ingress-egress` to emit connection status heartbeats.
3.  **Phase 3**: Integrate Twitch EventSub `stream.online/offline` and publish to internal bus.
4.  **Phase 4**: Update `persistence` service to process these system events and update the `sources` collection.

## Success Criteria
- Querying Firestore for `twitch:{id}` returns accurate `status` and `streamStatus`.
- The bot can "know" if the stream is live before suggesting stream-only actions.
- Dashboard can display real-time connection health for all ingress points.

# Technical Architecture – Twitch EventSub WebSocket Integration

## 1. Objective
Establish a persistent WebSocket connection to Twitch EventSub to receive behavioral events (`channel.update`, `channel.follow`) and normalize them into the BitBrat `InternalEventV2` format for internal publication.

## 2. Proposed Changes

### 2.1 Event Schema Evolution (`src/types/events.ts`)
To support non-message behavioral events while maintaining backward compatibility and providing a scalable structure for future event types, we will modify `InternalEventV2`.

#### Extension: `ExternalEventV1`
A new interface to capture normalized behavioral events from external platforms.

```typescript
export interface ExternalEventV1 {
  id: string;            // Platform-specific event ID
  source: string;        // e.g., "twitch.eventsub"
  kind: string;          // e.g., "channel.follow", "channel.update"
  version: string;       // Event schema version from the platform
  createdAt: string;     // ISO8601
  payload: Record<string, any>; // Normalized platform-specific data
  rawPayload?: Record<string, any>; // Optional original platform payload
}
```

#### Modification: `InternalEventV2`
We will make the `message` field optional and add the `externalEvent` field.

```typescript
export interface InternalEventV2 extends EnvelopeV1 {
  type: InternalEventType;
  channel?: string;      // #channel
  userId?: string;       // platform user ID
  message?: MessageV1;   // Optional: present for chat/text events
  externalEvent?: ExternalEventV1; // Optional: present for behavioral events
  annotations?: AnnotationV1[];
  candidates?: CandidateV1[];
  errors?: ErrorEntryV1[];
  qos?: QOSV1;
}
```

#### New `InternalEventType` values
- `twitch.eventsub.v1`

### 2.2 Ingress Service Additions

#### `TwitchEventSubClient` (`src/services/ingress/twitch/eventsub-client.ts`)
A new client using `@twurple/eventsub-ws` to manage the WebSocket connection.
- **Connection Management**: Handles initial connection, reconnection, and keep-alive.
- **Subscriptions**: Programmatically subscribes to `channel.update` and `channel.follow` for configured channels.
- **Authentication**: Uses the existing `ITwitchCredentialsProvider`.

#### `EventSubEnvelopeBuilder`
A new builder or extension to `TwitchEnvelopeBuilder` to map Twurple EventSub events to `InternalEventV2`.

### 2.3 Normalization Logic

| Twitch EventSub | BitBrat `InternalEventV2` |
|-----------------|---------------------------|
| `channel.follow` | `type: twitch.eventsub.v1`, `externalEvent.kind: channel.follow` |
| `channel.update` | `type: twitch.eventsub.v1`, `externalEvent.kind: channel.update` |

### 2.4 Integration in `IngressEgressServer`
- Initialize `TwitchEventSubClient` alongside `TwitchIrcClient`.
- Register it with the `ConnectorManager`.

## 3. Backward Compatibility
- Existing services consuming `InternalEventV2` expect a `message` field. We must ensure that downstream services (like `auth`, `event-router`, `llm-bot`) handle the absence of `message` gracefully or that we provide a shim if necessary.
- For this sprint, we will focus on ensuring the `ingress-egress` and `auth` services can handle these new events.

## 4. Dependencies
- `@twurple/eventsub-ws`: Required for WebSocket-based EventSub.
- Twitch App Scopes: `moderator:read:followers` (for `channel.follow`) and general broadcast scopes for `channel.update`.

## 5. Security & Reliability
- **WebSocket Recovery**: EventSub WebSockets provide a session recovery mechanism which `@twurple/eventsub-ws` handles.
- **Secret Management**: Continues to use `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.

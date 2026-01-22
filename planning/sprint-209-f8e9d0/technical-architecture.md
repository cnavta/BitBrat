# Technical Architecture: API Gateway (WebSocket)

## 1. Overview
The `api-gateway` service is a specialized gateway designed to provide programmatic, bi-directional access to the BitBrat Platform. It serves as the primary external interface for bots, integrations, and third-party applications, replacing the legacy monolithic `ingress-egress` service for these use cases.

## 2. System Components

### 2.1 WebSocket Server
- **Implementation**: Node.js with `ws` library.
- **Entry point**: `src/apps/api-gateway.ts`
- **Protocol**: `wss://` (WebSocket Secure)
- **Endpoint**: `/ws/v1`

### 2.2 Security (Bearer Token)
To support programmatic access, the gateway implements a Bearer token mechanism.

- **Token Format**: Opaque, high-entropy strings (e.g., `bb_pt_<random_bytes>`).
- **Storage**: Firestore collection `gateways/api/tokens`.
- **User Association**: Each token is linked to a single `AuthUser`. Multiple tokens can be associated with the same user to allow for credential rotation and distinct client identification.
- **Lifecycle**: Tokens can have an optional `expires_at` field.
- **Validation**:
  1. Client provides token in `Authorization: Bearer <token>` header during the WebSocket handshake.
  2. Gateway hashes the token (SHA-256) and verifies it against the Firestore store.
  3. Gateway caches valid tokens for a short duration (e.g., 5 minutes) to reduce database load.

### 2.3 Internal Integration
The service integrates with the BitBrat Platform via NATS (internal Pub/Sub).

- **Ingress Path**:
  - Client sends JSON message over WebSocket.
  - Gateway validates message format.
  - Gateway enriches message with `user_id` from the authenticated session.
  - Gateway publishes message to `internal.ingress.v1`.
- **Egress Path**:
  - Gateway subscribes to `internal.api.egress.v1.{instanceId}`.
  - Other platform services publish events targeted at specific users or clients.
  - Gateway identifies the target `user_id` and forwards the message to all active WebSocket connections for that user.

## 3. Communication Protocol

### 3.1 Message Frame
All messages are JSON-encoded.

```json
{
  "type": "string",
  "payload": {},
  "metadata": {
    "id": "uuid",
    "timestamp": "iso-8601"
  }
}
```

### 3.2 Supported Events (Initial Release)

#### Inbound (Client -> Platform)
- `chat.message.send`: Send a message to a specific channel/room.
- `chat.room.join`: Subscribe to messages from a channel.
- `chat.room.leave`: Unsubscribe from a channel.

#### Outbound (Platform -> Client)
- `chat.message.received`: A new message has arrived in a joined channel.
- `chat.error`: Indicates a failure in processing a client request.
- `connection.ready`: Confirms successful authentication and session start.

## 4. Scalability and Availability
- **Statelessness**: The service is mostly stateless, but maintains active WebSocket connections in memory.
- **Instance Identification**: Each instance generates a unique `instanceId` at startup (using `EGRESS_INSTANCE_ID` or hostname) and subscribes to its own egress topic.
- **Load Balancing**: GCLB (Global Cloud Load Balancer) handles WebSocket termination and distributes connections across instances.

## 5. Implementation Roadmap
1. **Phase 1**: Implement basic WebSocket server with Bearer token validation (Firestore).
2. **Phase 2**: Implement NATS integration for `internal.ingress.v1` publishing.
3. **Phase 3**: Implement NATS subscription for egress and message forwarding.
4. **Phase 4**: Define and implement formal chat event schemas.

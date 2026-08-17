# Technical Architecture – sprint-179-b4e5f6: Twilio SMS Integration

## 1. Overview
This document outlines the architecture for integrating Twilio SMS into the BitBrat Platform. The integration will allow the platform to receive SMS messages in real-time and send responses, following the established patterns for Twitch and Discord chat channels.

## 2. Goals
- Real-time reception of SMS messages.
- Support for sending outbound SMS responses.
- Consistent event schema with existing chat integrations (`InternalEventV2`).
- Follow the "outbound connection" pattern where the service connects to the platform (Twilio) rather than relying on incoming Webhooks, aligning with Twitch IRC and Discord Gateway patterns.

## 3. Design Selection: Twilio Conversations
To fulfill the requirement of using WebSockets for receiving events (and to match the patterns of other chat channels), we will use the **Twilio Conversations API**.

### Why Twilio Conversations?
- **WebSocket-based**: The Twilio Conversations JS/Node SDK uses a persistent WebSocket connection (via Twilio Sync) to deliver events in real-time.
- **Unified Chat Pattern**: It treats SMS, WhatsApp, and Web Chat as unified "conversations", which fits well with the BitBrat Platform's multi-channel architecture.
- **Outbound Connectivity**: Our service initiates the connection to Twilio, which is easier to manage in many environments than exposing a public Webhook endpoint (though Cloud Run handles both).

## 4. Components

### 4.1 TwilioSmsIngressClient
- **Location**: `src/services/ingress/twilio/twilio-sms-ingress-client.ts`
- **Responsibilities**:
    - Manage the lifecycle of the Twilio Conversations connection.
    - Generate Access Tokens for authentication.
    - Listen for `messageAdded` events.
    - Implement `IngressConnector` interface.
    - Implement `EgressConnector` interface for sending responses.

### 4.2 SmsEnvelopeBuilder
- **Location**: `src/services/ingress/twilio/envelope-builder.ts`
- **Responsibilities**:
    - Transform Twilio `Message` objects into `InternalEventV2`.
    - Set `source` to `ingress.twilio.sms`.
    - Map `author` to `userId`.
    - Map conversation SID to `channel`.

### 4.3 Twilio Egress
- **Mechanism**: Use the `twilio` Node.js SDK for REST API calls (sending messages).
- **Addressing**: Use the Conversation SID or participant identity for targeting responses.

## 5. Sequence Diagram (Ingress)
1. External SMS → Twilio Phone Number.
2. Twilio Number (configured) → Adds message to a Twilio Conversation.
3. `TwilioSmsIngressClient` (via WebSocket) → Receives `messageAdded` event.
4. `SmsEnvelopeBuilder` → Creates `InternalEventV2`.
5. `IngressPublisher` → Publishes event to `internal.ingress.v1`.

## 6. Sequence Diagram (Egress)
1. `ingress-egress` service receives `internal.egress.v1.{instanceId}` event.
2. Logic identifies `source` as `twilio` or matches Twilio metadata.
3. `TwilioSmsIngressClient.sendText(text, channelId)` is called.
4. Twilio REST API sends SMS response to the user.

## 7. Configuration & Secrets

### Environment Variables
- `TWILIO_ENABLED`: `true` | `false`
- `TWILIO_CONVERSATIONS_SERVICE_SID`: SID of the Conversations service.
- `TWILIO_IDENTITY`: Identity name for the bot (e.g., `BitBratBot`).

### Secrets (Secret Manager)
- `TWILIO_ACCOUNT_SID`: Twilio Account SID.
- `TWILIO_AUTH_TOKEN`: Twilio Auth Token (for management/REST).
- `TWILIO_API_KEY`: API Key for generating Access Tokens.
- `TWILIO_API_SECRET`: API Secret for generating Access Tokens.

## 8. Implementation Details
- **Dependency**: `twilio` (Node SDK) and `@twilio/conversations` (Client SDK).
- **Error Handling**: Standard try/catch with logging; retry logic for connection drops.
- **Testing**: Mock Twilio Conversations client and REST API for unit and integration tests.

## 9. Future Considerations
- Support for Media (MMS) by mapping Twilio attachments to the platform's media schema.
- Support for multiple Twilio numbers/conversations.

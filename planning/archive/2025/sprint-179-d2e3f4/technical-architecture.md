# Technical Architecture: Twilio SMS Integration

## 1. Overview
This document outlines the architecture for integrating Twilio SMS into the BitBrat Platform's `ingress-egress` service. The goal is to provide a real-time, bi-directional SMS communication channel using Twilio's Conversations API and WebSockets, following the established patterns for Twitch and Discord.

## 2. Goals
- Real-time receipt of SMS messages.
- Real-time sending of SMS messages from the platform.
- Integration with the existing `ConnectorManager` and `Ingress/Egress` event flow.
- Support for multiple Twilio conversations.

## 3. Architecture

### 3.1 Components

#### `TwilioIngressClient` (`src/services/ingress/twilio/twilio-ingress-client.ts`)
- **Responsibility**: Manages the connection to Twilio Conversations via WebSockets.
- **Library**: `@twilio/conversations` (JS SDK).
- **Functions**:
  - `start()`: Initializes the Twilio Client, authenticates, and sets up event listeners.
  - `stop()`: Shuts down the client and cleans up resources.
  - `sendText(text: string, conversationSid: string)`: Sends a message to a specific Twilio conversation.
  - `getSnapshot()`: Provides connection status and health for monitoring.
- **Events**: Listens for `messageAdded` on any conversation the client is a participant in.

#### `TwilioEnvelopeBuilder` (`src/services/ingress/twilio/twilio-envelope-builder.ts`)
- **Responsibility**: Transforms Twilio message events into the platform's standard `IngressEnvelope`.
- **Mapping**:
  - `source`: `twilio`
  - `from`: Sender's identity (e.g., phone number).
  - `text`: Message body.
  - `metadata`: Twilio-specific IDs (Conversation SID, Message SID).

#### `TwilioConnectorAdapter` (`src/services/ingress/twilio/connector-adapter.ts`)
- **Responsibility**: Implements the `IConnector` interface to allow the `ConnectorManager` to route egress messages to Twilio.

#### `TwilioTokenProvider` (Utility)
- **Responsibility**: Generates JWT Access Tokens for the `@twilio/conversations` SDK using `TWILIO_API_KEY` and `TWILIO_API_SECRET`.

### 3.2 Data Flow

#### Inbound (Ingress)
1. SMS arrives at Twilio.
2. Twilio routes the SMS to a Conversation (configured via Twilio Console).
3. `TwilioIngressClient` (connected via WebSocket) receives the `messageAdded` event.
4. `TwilioEnvelopeBuilder` creates an `IngressEnvelope`.
5. `TwilioIngressClient` publishes the envelope to `internal.ingress.v1`.

#### Outbound (Egress)
1. `ingress-egress-service` receives an egress event from `internal.egress.v1.{instanceId}`.
2. `ConnectorManager` identifies the target as `twilio`.
3. `TwilioConnectorAdapter` is called with the text and destination.
4. `TwilioIngressClient.sendText()` is executed, sending the message via Twilio.

## 4. Configuration & Secrets

The following environment variables and secrets will be required:

| Variable | Description | Source |
|----------|-------------|--------|
| `TWILIO_ENABLED` | Feature flag to enable/disable Twilio | Env |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | Secret |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | Secret |
| `TWILIO_API_KEY` | API Key for generating Access Tokens | Secret |
| `TWILIO_API_SECRET` | API Secret for generating Access Tokens | Secret |
| `TWILIO_CHAT_SERVICE_SID` | Conversations Service SID | Secret |
| `TWILIO_IDENTITY` | The identity for the bot in Conversations | Env |

## 5. Security & Authentication
- Access Tokens will be generated server-side using the `twilio` Node library.
- Tokens will have a configurable TTL and be refreshed by the `TwilioIngressClient` as needed.
- Only authorized SMS numbers (configured in Twilio) will be able to interact with the platform.

## 6. Testing Strategy
- **Unit Tests**: Mock `@twilio/conversations` SDK to verify event handling and message sending.
- **Integration Tests**: Verify that `TwilioIngressClient` correctly publishes to the internal message bus and responds to egress events.
- **Manual Verification**: Use a real Twilio phone number to send and receive messages during development.

## 7. Dependencies
- `@twilio/conversations`: For WebSocket-based communication.
- `twilio`: For helper utilities (token generation).

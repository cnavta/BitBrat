# Technical Architecture — Twitch DM (Whisper) Support

## Overview
This document outlines the architectural approach for adding Twitch DM (whisper) support to the BitBrat Platform's egress pipeline.

## Current State
Currently, the `ingress-egress` service handles egress delivery by subscribing to per-instance egress topics. When an event is received, it extracts text and sends it to the target platform (defaulting to Twitch IRC).

```typescript
// Current logic in ingress-egress-service.ts
if (isDiscord) {
  await this.discordClient.sendText(text, evt.channel);
} else if (isTwilio) {
  await this.twilioClient.sendText(text, evt.channel);
} else {
  // Default to Twitch
  await this.twitchClient!.sendText(text, evt.channel);
}
```

## Proposed Changes

### 1. Envelope Update
The `EnvelopeV1` has been updated to include an `egress` object instead of a simple `egressDestination` string.

```typescript
export interface Egress {
  destination: string; // Destination that was the entry point for the message.
  type?: 'chat' | 'dm' | 'event'; // Requested type of response to send.
}
```

### 2. Egress Logic Expansion
The `ingress-egress` service will be modified to check the `egress.type`. If the type is `dm` and the source is Twitch, it will trigger a whisper delivery.

### 3. Twitch Whisper Implementation
Twitch IRC whispers are deprecated and often unreliable or blocked for bots. The recommended approach is to use the **Twitch Helix API (Whispers)**.

#### API Endpoint:
`POST https://api.twitch.tv/helix/whispers?from_user_id=<BOT_USER_ID>&to_user_id=<RECIPIENT_USER_ID>`

#### Requirements:
- `user:manage:whispers` scope for the bot/sender account.
- The recipient's `userId` must be known. In our platform, this is available as `userId` in the `InternalEvent`.

### 4. Service Integration
A new method `sendWhisper(text: string, userId: string)` will be added to `TwitchIrcClient` (or a dedicated Twitch service if more appropriate). Since `TwitchIrcClient` already manages the connection and credentials, it's a candidate for expansion, though strictly speaking, whispers via Helix don't require an IRC connection.

However, `TwitchIrcClient` currently uses `twurple` which has built-in support for Helix. We should expose a way to call the whisper API through our Twitch client wrappers.

### 5. Detailed Flow
1. `ingress-egress` service receives an event on the egress topic.
2. It identifies the egress type from `evt.egress.type`.
3. If `type === 'dm'` and source is Twitch:
    a. Extract `text` from the event.
    b. Extract `targetUserId` from `evt.userId` (which represents the original sender).
    c. Call `twitchClient.sendWhisper(text, targetUserId)`.
4. If `type === 'chat'` or default:
    a. Continue using `sendText(text, channel)`.

## Scalability and Reliability
- **Rate Limits**: Twitch Whisper API has strict rate limits. We should implement basic error handling and logging for rate-limit errors.
- **Finalization**: Success or failure of the whisper delivery will be reported via the `internal.persistence.finalize.v1` topic, consistent with chat message delivery.

## Security
- Ensure the bot account has the `user:manage:whispers` scope.
- `userId` validation: Ensure we are sending whispers to valid Twitch user IDs.

## Alternatives Considered
- **IRC Whispers**: Rejected due to deprecation and poor reliability.
- **EventSub for Whispers**: EventSub is for receiving notifications about whispers, not sending them. Helix is the correct tool for sending.

## Conclusion
This approach leverages the existing egress pipeline while introducing platform-specific specialized delivery methods based on the `egress.type` hint.
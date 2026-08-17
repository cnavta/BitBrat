# Baseline Twitch IRC Functionality

**Sprint**: sprint-10-ee8bxg
**Task**: P0-001
**Date**: 2026-08-11

---

## Purpose

Document current Twitch IRC client behavior as baseline for regression testing during adapter refactoring.

---

## Current Architecture

### TwitchIrcClient (src/services/ingress/twitch/twitch-irc-client.ts)

**Class**: `TwitchIrcClient extends NoopTwitchIrcClient implements ITwitchIrcClient`

**Core Methods**:
1. **start()**: Initializes Twurple Chat client, connects to IRC
   - Handles credentials via `ITwitchCredentialsProvider`
   - Supports `RefreshingAuthProvider` for OAuth token refresh
   - Connects to channels specified in config (`cfg.twitchChannels`)
   - Registers event handlers (onConnect, onMessage, onDisconnect, etc.)

2. **stop()**: Disconnects from Twitch IRC
   - Calls `chat.quit()`
   - Sets state to DISCONNECTED

3. **getSnapshot()**: Returns debug snapshot
   - Returns `TwitchIrcDebugSnapshot` with state, joinedChannels, counters, etc.

4. **sendText(text, channel)**: Sends message to Twitch chat
   - Delegates to `chat.say(channel, text)`
   - Handles multi-line messages (splits on newlines)
   - Logs egress events

5. **sendWhisper(text, userId)**: Sends whisper (DM) via Helix API
   - Requires `user:manage:whispers` scope
   - Uses Helix API: `helix.whispers.sendWhisper()`
   - Strips platform prefix (`twitch:userId` → `userId`)

6. **banUser(platformUserId, reason)**: Bans user from channel
   - Uses `chat.ban()` method
   - Fallback to IRC `/ban` command if method missing

7. **handleMessage(channel, userLogin, text, meta)**: Processes IRC messages
   - Filters self-messages (bot userId or bot login)
   - Increments counters (received, published, failed)
   - Supports `!debug` command for authorized users (Sprint 371 equivalent)
   - Normalizes message via `TwitchEnvelopeBuilder.build()`
   - Publishes to `internal.ingress.v1` via publisher

### Integration in IngressEgressServer (src/apps/ingress-egress-service.ts)

**Direct Client Usage** (Pre-Adapter Pattern):
- **Creation**: `this.twitchClient = new TwitchIrcClient(...)`
- **Lifecycle**: `await this.twitchClient.start()`
- **Egress**: Direct calls to `this.twitchClient.sendText()`, `sendWhisper()`, `banUser()`
- **Not registered with ConnectorManager** (this is the gap we're fixing)

**Broadcaster Client**:
- Separate `this.twitchBroadcasterClient` for broadcaster-scoped operations
- Uses different credentials (broadcaster OAuth token)
- `disableIngress: true` (only used for egress with broadcaster identity)

---

## Baseline Functionality

### ✅ IRC Ingress (Message Handling)
- **Status**: WORKING
- **Behavior**:
  - User sends message in Twitch chat
  - `TwitchIrcClient.handleMessage()` called via Twurple `onMessage` event
  - Message normalized to `InternalEventV2` envelope via `TwitchEnvelopeBuilder`
  - Envelope published to `internal.ingress.v1` topic
  - User metadata preserved: `userLogin`, `userDisplayName`, `userId`, `badges`, `isMod`
  - Message metadata: `channel`, `text`, `messageId`, `roomId`

### ✅ Self-Message Filtering (Deduplication)
- **Status**: WORKING
- **Behavior**:
  - Bot messages filtered by checking `botLogin === userLogin` or `botUserId === meta.userId`
  - Prevents infinite loops (bot doesn't process its own messages)
  - Deduplication logic in `handleMessage()` (lines 469-477)

### ✅ Debug Mode (!debug command)
- **Status**: WORKING
- **Behavior**:
  - Authorized users can send `!debug <message>` command
  - User authorization via `debugUsers` config (Twitch user IDs or `twitch:userId` format)
  - Debug prefix stripped from message text
  - Tracer flag set: `qos.tracer = true`
  - Immediate feedback to chat with correlation ID
  - Unauthorized users: command ignored, no tracer flag

### ✅ Egress (sendText)
- **Status**: WORKING
- **Behavior**:
  - Egress event with `connector: 'twitch'` routed to `this.twitchClient.sendText()`
  - Multi-line messages split on `\n` and sent as separate IRC PRIVMSG commands
  - Channel formatting: `#channel` prefix added if missing
  - Logged as `twitch.egress.sent` event

### ✅ Egress (sendWhisper)
- **Status**: WORKING
- **Behavior**:
  - Whisper sent via Helix API: `helix.whispers.sendWhisper(fromUserId, toUserId, text)`
  - Requires `user:manage:whispers` scope
  - Platform prefix stripped: `twitch:userId` → `userId`
  - Logged as `twitch.whisper.sent` event

### ✅ Moderation (banUser)
- **Status**: WORKING
- **Behavior**:
  - Ban via `chat.ban(channel, user, reason)` method
  - Fallback to IRC `/ban` command if method unavailable
  - Requires bot to be moderator in channel

### ✅ OAuth Token Refresh
- **Status**: WORKING
- **Behavior**:
  - Uses `RefreshingAuthProvider` from Twurple Auth
  - Automatically refreshes tokens when expired
  - Saves refreshed tokens via `credentialsProvider.saveRefreshedToken()`
  - Reconnects client automatically after token refresh

### ✅ Broadcaster Client Support
- **Status**: WORKING
- **Behavior**:
  - Separate `TwitchIrcClient` instance for broadcaster operations
  - Uses broadcaster OAuth credentials
  - `disableIngress: true` (no message handling)
  - Used for broadcaster-identity egress (e.g., announcements)

---

## Known Gaps (To Be Fixed)

### ❌ No Adapter Layer
- `TwitchIrcClient` used directly in `ingress-egress-service.ts`
- No `TwitchConnectorAdapter` implementing `IngressConnector` interface
- Not registered with `ConnectorManager`

### ❌ No getMetadata() Implementation
- No runtime capability discovery
- Platform capabilities not exposed via standard interface

### ❌ No WebhookConnector Support
- EventSub webhook integration not implemented
- No `verifySignature()` or `handleWebhook()` methods

### ❌ Inconsistent Pattern
- Diverges from Slack/Twilio standard connector pattern
- Harder to extract to standalone `twitch-ingress` Bit in future

---

## Regression Test Matrix (To Be Created in P0-003)

| Feature | Current Behavior | Test Method | Pass Criteria |
|---------|------------------|-------------|---------------|
| IRC Ingress | Messages received and published | Manual test | Envelope on internal.ingress.v1 |
| Self-Message Filtering | Bot messages ignored | Send via bot | Message NOT published |
| Debug Mode | !debug sets tracer | Send !debug command | qos.tracer = true |
| Egress sendText | Message appears in chat | Call sendText() | Message in Twitch |
| Egress sendWhisper | Whisper received | Call sendWhisper() | Whisper delivered |
| Moderation banUser | User banned | Call banUser() | User banned in channel |
| OAuth Token Refresh | Token refreshed automatically | (Difficult to test) | No auth errors |
| Broadcaster Client | Separate identity | Send via broadcaster | Broadcaster identity used |

---

## Baseline Verified

**Date**: 2026-08-11
**Status**: ✅ Baseline documented

All functionality listed above is currently working in production. The adapter refactoring MUST maintain 100% feature parity with this baseline.

**Next Task**: P0-002 - Document ingress-egress integration points

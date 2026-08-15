# Architecture Brief: DM Capability Implementation Analysis
**Sprint**: sprint-13-eahhvf
**Author**: Lead Implementor (Claude Code)
**Date**: 2026-08-14
**Status**: Draft

## Executive Summary

This brief provides a comprehensive analysis of Direct Message (DM) capabilities across BitBrat's three primary chat platform integrations: **Discord**, **Slack**, and **Twitch**. While all three integrations declare DM support in their metadata (`capabilities.egress.dm: true`), actual implementation status varies significantly:

- **Twitch**: ✅ Fully implemented with dedicated `sendWhisper()` API
- **Slack**: ⚠️ Likely functional but unverified (DMs are channels)
- **Discord**: ❌ Broken - declares support but cannot send DMs

## Critical Findings

### 1. Capability Declaration vs. Reality Gap

All three connectors declare DM support in their `ConnectorMetadata`:

```typescript
capabilities: {
  egress: {
    chat: true,
    dm: true,      // ⚠️ Declared by all three
    reactions: true,
    threads: true,
  }
}
```

**Reality**:
- Only Twitch has verified, tested DM functionality
- Discord DM implementation is fundamentally broken
- Slack DM functionality is untested and unverified

---

## Platform-Specific Analysis

### Discord Integration

**Location**: `src/services/ingress/discord/`

#### Current Implementation

**Connector Adapter** (`discord-connector-adapter.ts:63`):
```typescript
async sendText(text: string, target?: string): Promise<void> {
  // Delegates to client.sendText()
  await this.client.sendText(text, target);
}
```

**Client** (`discord-ingress-client.ts:83-105`):
```typescript
async sendText(text: string, channelId?: string): Promise<void> {
  const targetId = channelId || this.cfg.discordChannels[0];
  const channel = await this.client.channels.fetch(targetId);
  await (channel as any).send(text);
}
```

#### Problem Analysis

**Issue**: The `client.channels.fetch(targetId)` API call **only works for server channels**, not DM channels.

Discord has two distinct channel types:
1. **Guild Channels** (public/private server channels) - fetched via `client.channels.fetch()`
2. **DM Channels** (direct messages) - require `client.users.fetch(userId).createDM()`

**Current Flow (Broken for DMs)**:
```
Event → processEgress() → sendText(text, userId) → channels.fetch(userId) → ❌ FAIL
                                                                          (users are not channels)
```

**Expected Flow for DMs**:
```
Event → processEgress() → sendDM(text, userId) → users.fetch(userId).createDM() → dm.send(text) → ✅ SUCCESS
```

#### Required Fix

1. Add `sendDM()` method to `DiscordIngressClient`
2. Implement user lookup and DM channel creation
3. Update `DiscordConnectorAdapter` to expose `sendDM()`
4. Update egress routing logic to differentiate between channels and DMs

**Estimated Complexity**: Medium (4-6 hours)

---

### Slack Integration

**Location**: `src/services/ingress/slack/`

#### Current Implementation

**Connector Adapter** (`slack-connector-adapter.ts:64`):
```typescript
async sendText(text: string, target?: string): Promise<void> {
  await this.client.sendText(text, target);
}
```

**Client** (`slack-ingress-client.ts:194-234`):
```typescript
async sendText(text: string, channel: string): Promise<void> {
  const result = await this.webClient.chat.postMessage({
    channel,
    text,
  });
}
```

#### Analysis

**Slack's Unique Architecture**:
- DMs are **not a separate API** in Slack
- DMs are just special channel types with IDs like `D0123456789`
- The same `chat.postMessage()` API works for both public channels and DMs

**Current Status**: ⚠️ Should work **IF**:
1. The egress routing provides a valid DM channel ID (not user ID)
2. The DM channel ID is correctly formatted (`D` prefix)

**Risk**: Untested and unverified in production/staging

#### Required Verification

1. Test DM sending with real Slack DM channel IDs
2. Document DM channel ID format expectations
3. Add validation/error handling for invalid channel IDs
4. Consider adding user ID → DM channel lookup if needed

**Estimated Complexity**: Low (2-3 hours)

---

### Twitch Integration

**Location**: `src/services/ingress/twitch/`

#### Current Implementation

**Connector Adapter** (`twitch-connector-adapter.ts:42`):
```typescript
async sendWhisper(text: string, userId: string): Promise<void> {
  if (typeof (this.client as any).sendWhisper === 'function') {
    await (this.client as any).sendWhisper(text, userId);
  }
}
```

**Client** (`twitch-irc-client.ts:387-415`):
```typescript
async sendWhisper(text: string, userId: string): Promise<void> {
  const cleanUserId = userId.includes(':') ? userId.split(':')[1] : userId;
  const fromUserId = this.cfg?.twitchBotUserId || this.snapshot.userId;

  await this.helix.whispers.sendWhisper(fromUserId, cleanUserId, text);
}
```

#### Analysis

**Status**: ✅ **Fully Implemented and Functional**

- Uses Twitch Helix API's dedicated whisper endpoint
- Properly strips platform prefix from user IDs (`twitch:12345` → `12345`)
- Has error handling and logging
- Requires `user:manage:whispers` OAuth scope

**Issue**: `sendWhisper()` is **NOT part of the standard interface**
- Not defined in `EgressConnector` interface
- Not called by `IntegrationBit.processEgress()`
- Only accessible via type casting: `(connector as any).sendWhisper()`

**Current Workaround**: Twitch whispers are likely not being used in production because the egress routing layer only calls `sendText()`.

---

## Egress Routing Layer Analysis

**Location**: `src/common/integration-bit.ts:491`

### Current Flow

```typescript
private async processEgress(event: InternalEventV2): Promise<void> {
  const platform = event.egress?.connector;
  const connector = this.connectorManager.getConnectorByPlatform(platform);
  const text = extractEgressTextFromEvent(event);
  const targetChannel = event.egress?.channel || event.ingress?.channel;

  // ⚠️ PROBLEM: Always calls sendText(), never sendWhisper() or sendDM()
  await egressConnector.sendText(text, targetChannel);
}
```

### Problems

1. **No DM Detection**: No logic to differentiate between channel messages and DMs
2. **No Method Routing**: Always calls `sendText()`, never platform-specific DM methods
3. **Ambiguous Target**: `targetChannel` could be channel ID or user ID with no disambiguation
4. **No Target Type**: No `event.egress.targetType` field to signal intent (channel vs. dm)

### Implications

- Twitch's `sendWhisper()` is **never called**
- Discord's broken DM implementation is **never exercised** (silent failure)
- Slack DMs **might work** if correct DM channel IDs are provided by upstream services

---

## Interface Gap Analysis

**Location**: `src/services/ingress/core/interfaces.ts:128`

### Current EgressConnector Interface

```typescript
export interface EgressConnector {
  sendText(text: string, target?: string): Promise<void>;
  banUser?(platformUserId: string, reason?: string): Promise<void>;
}
```

### Problems

1. **No DM Method**: No standard `sendDM()` or equivalent
2. **Overloaded Target**: `target` parameter is ambiguous (channel ID? user ID? platform prefix?)
3. **No Capability Query**: No way to check if connector supports DMs at runtime
4. **Type Casting**: Twitch's `sendWhisper()` requires unsafe type casting

### Recommended Interface Extension

```typescript
export interface EgressConnector {
  sendText(text: string, target?: string): Promise<void>;

  // NEW: Optional DM support
  sendDM?(text: string, userId: string): Promise<void>;

  // NEW: Optional capability query
  supportsDM?(): boolean;

  banUser?(platformUserId: string, reason?: string): Promise<void>;
}
```

---

## Metadata vs. Implementation Matrix

| Platform | Declared DM Support | Actual Implementation | Routing Support | Status |
|----------|-------------------|----------------------|----------------|--------|
| **Twitch** | ✅ `dm: true` | ✅ `sendWhisper()` | ❌ Not called | **Partially Functional** |
| **Slack** | ✅ `dm: true` | ⚠️ `sendText()` (untested) | ⚠️ If DM channel ID provided | **Untested** |
| **Discord** | ✅ `dm: true` | ❌ Broken (only channels) | ❌ Will fail | **Broken** |

---

## Root Cause Summary

### 1. **Discord**: Fundamental Implementation Gap
- Uses channel API for both channels and DMs
- Discord's API requires different code paths for channels vs. DMs
- No DM-specific implementation exists

### 2. **Slack**: Verification Gap
- Implementation **should** work (DMs are channels in Slack)
- Never tested or verified
- No documentation on DM channel ID requirements

### 3. **Twitch**: Integration Gap
- DM functionality exists and works
- Never called by egress routing layer
- Non-standard interface prevents automated routing

### 4. **Egress Routing**: Design Gap
- No concept of message type (channel vs. DM)
- No detection logic for DM routing
- Always calls `sendText()` regardless of intent

### 5. **Interface Design**: Standardization Gap
- No standard DM method in `EgressConnector`
- Each platform implements DM differently
- Type casting required for platform-specific features

---

## Recommended Plan of Action

### Phase 1: Interface Standardization (Priority: CRITICAL)

**Goal**: Define standard DM interface for all connectors

**Tasks**:
1. Extend `EgressConnector` interface with optional `sendDM()` method
2. Add `supportsDM()` capability query method
3. Add `event.egress.messageType` field to event schema (`'channel' | 'dm' | 'thread'`)
4. Document interface contract and platform-specific behavior

**Deliverables**:
- Updated `src/services/ingress/core/interfaces.ts`
- Updated event type definitions
- Interface documentation

**Estimated Effort**: 2-3 hours

---

### Phase 2: Discord DM Implementation (Priority: HIGH)

**Goal**: Implement functional DM support for Discord

**Tasks**:
1. Add `sendDM(text: string, userId: string)` to `DiscordIngressClient`
2. Implement user lookup: `client.users.fetch(userId)`
3. Implement DM channel creation: `user.createDM()`
4. Add error handling for invalid user IDs
5. Update `DiscordConnectorAdapter` to expose `sendDM()`
6. Update metadata to accurately reflect capabilities
7. Write integration tests

**Implementation Notes**:
```typescript
// Proposed Discord DM implementation
async sendDM(text: string, userId: string): Promise<void> {
  if (!this.client || this.snapshot.state !== 'CONNECTED') {
    throw new Error('discord_client_not_connected');
  }

  try {
    // Fetch user by ID
    const user = await this.client.users.fetch(userId);

    // Create or get existing DM channel
    const dmChannel = await user.createDM();

    // Send message to DM channel
    await dmChannel.send(text);

    logger.debug('discord.dm.sent', { userId, length: text.length });
  } catch (e: any) {
    logger.error('discord.dm.error', { userId, error: e?.message });
    throw e;
  }
}
```

**Deliverables**:
- Updated `discord-ingress-client.ts` with `sendDM()` method
- Updated `discord-connector-adapter.ts` to expose `sendDM()`
- Integration tests for DM functionality
- Updated documentation

**Estimated Effort**: 4-6 hours

**Risk**: Low - well-defined Discord.js API

---

### Phase 3: Slack DM Verification (Priority: MEDIUM)

**Goal**: Verify and document Slack DM functionality

**Tasks**:
1. Write integration test for Slack DM sending
2. Test with real Slack DM channel IDs
3. Document DM channel ID format requirements
4. Add validation for channel ID format
5. Consider adding user ID → DM channel lookup helper
6. Update documentation

**Implementation Notes**:
```typescript
// Slack DM implementation (already exists, needs verification)
async sendText(text: string, channel: string): Promise<void> {
  // Validate DM channel format (starts with 'D')
  if (!channel.startsWith('C') && !channel.startsWith('D') && !channel.startsWith('G')) {
    logger.warn('slack.send.invalid_channel_format', { channel });
  }

  await this.webClient.chat.postMessage({ channel, text });
}
```

**Optional Enhancement**:
```typescript
// Helper to open DM channel by user ID
async openDM(userId: string): Promise<string> {
  const result = await this.webClient.conversations.open({
    users: userId
  });
  return result.channel.id; // Returns 'D...' channel ID
}
```

**Deliverables**:
- Integration tests for Slack DM
- Documentation on DM channel IDs
- Optional: `openDM()` helper method

**Estimated Effort**: 2-3 hours

**Risk**: Very Low - uses existing API

---

### Phase 4: Egress Routing Enhancement (Priority: HIGH)

**Goal**: Enable egress routing to intelligently route DMs vs. channels

**Tasks**:
1. Add `messageType` field to `event.egress` schema
2. Update `IntegrationBit.processEgress()` to check `messageType`
3. Route to `sendDM()` when `messageType === 'dm'`
4. Route to `sendText()` when `messageType === 'channel'`
5. Add fallback logic for backward compatibility
6. Update upstream services to set `messageType`

**Implementation**:
```typescript
private async processEgress(event: InternalEventV2): Promise<void> {
  const platform = event.egress?.connector;
  const connector = this.connectorManager.getConnectorByPlatform(platform);
  const text = extractEgressTextFromEvent(event);
  const messageType = event.egress?.messageType || 'channel'; // Default to channel

  const egressConnector = connector as unknown as EgressConnector;

  // Route based on message type
  if (messageType === 'dm') {
    const userId = event.egress?.userId || event.identity?.external?.id;

    if (!userId) {
      logger.error('integration-bit.egress-missing-userId', { correlationId });
      return;
    }

    // Try DM-specific method first
    if (typeof (egressConnector as any).sendDM === 'function') {
      await (egressConnector as any).sendDM(text, userId);
    } else {
      // Fallback to sendText with user ID (may work for some platforms)
      logger.warn('integration-bit.egress-dm-fallback', { platform, userId });
      await egressConnector.sendText(text, userId);
    }
  } else {
    // Channel message (existing logic)
    const targetChannel = event.egress?.channel || event.ingress?.channel;
    await egressConnector.sendText(text, targetChannel);
  }
}
```

**Deliverables**:
- Updated `integration-bit.ts` with smart routing
- Updated event schema with `messageType` field
- Updated documentation
- Integration tests

**Estimated Effort**: 3-4 hours

**Risk**: Medium - requires coordination with upstream services

---

### Phase 5: Twitch Alignment (Priority: MEDIUM)

**Goal**: Align Twitch's `sendWhisper()` with standard interface

**Tasks**:
1. Add `sendDM()` method to `TwitchConnectorAdapter` that wraps `sendWhisper()`
2. Mark `sendWhisper()` as deprecated (but keep for backward compatibility)
3. Update documentation
4. Verify egress routing calls new `sendDM()` method

**Implementation**:
```typescript
// TwitchConnectorAdapter
async sendDM(text: string, userId: string): Promise<void> {
  // Delegate to existing sendWhisper implementation
  await this.sendWhisper(text, userId);
}

/**
 * @deprecated Use sendDM() instead. Kept for backward compatibility.
 */
async sendWhisper(text: string, userId: string): Promise<void> {
  if (typeof (this.client as any).sendWhisper === 'function') {
    await (this.client as any).sendWhisper(text, userId);
  }
}
```

**Deliverables**:
- Updated `twitch-connector-adapter.ts` with `sendDM()`
- Deprecation notices
- Updated tests

**Estimated Effort**: 1-2 hours

**Risk**: Very Low - simple wrapper

---

### Phase 6: Testing & Verification (Priority: CRITICAL)

**Goal**: Comprehensive testing of all DM functionality

**Test Coverage Requirements**:

1. **Unit Tests**:
   - Each connector's DM method
   - Error handling for invalid user IDs
   - State validation (connected vs. disconnected)

2. **Integration Tests**:
   - End-to-end DM flow for each platform
   - Egress routing for DM vs. channel messages
   - Event schema validation

3. **Manual Testing** (in staging):
   - Real Discord DM
   - Real Slack DM
   - Real Twitch whisper
   - Cross-platform DM handling

**Deliverables**:
- Test suite with 90%+ coverage for DM code paths
- Integration test suite
- Manual testing checklist
- Test report

**Estimated Effort**: 6-8 hours

---

## Implementation Sequence

### Recommended Order

```
1. Phase 1: Interface Standardization (foundation)
   ↓
2. Phase 2: Discord DM Implementation (highest impact)
   ↓
3. Phase 4: Egress Routing Enhancement (enables everything)
   ↓
4. Phase 5: Twitch Alignment (standardize existing work)
   ↓
5. Phase 3: Slack DM Verification (lowest risk)
   ↓
6. Phase 6: Testing & Verification (validate everything)
```

### Total Estimated Effort

- **Development**: 18-26 hours
- **Testing**: 6-8 hours
- **Documentation**: 2-3 hours
- **Total**: 26-37 hours (3-5 days)

---

## Success Criteria

### Functional Requirements

✅ **All platforms with declared DM support can send DMs**:
- Discord can send DMs to users
- Slack can send DMs to users (or confirm it already works)
- Twitch whispers work and are called by egress routing

✅ **Standardized interface**:
- All platforms implement `sendDM()` method
- Egress routing uses standard interface
- No platform-specific type casting required

✅ **Egress routing intelligence**:
- Can differentiate between channel and DM messages
- Routes to correct method based on message type
- Graceful fallback for unsupported platforms

### Quality Requirements

✅ **Test coverage**: 90%+ for all DM code paths
✅ **Documentation**: Complete API documentation for all DM methods
✅ **Error handling**: Graceful degradation for all failure modes
✅ **Logging**: Comprehensive logging for debugging and observability

### Non-Functional Requirements

✅ **Backward compatibility**: Existing channel messaging unaffected
✅ **Performance**: No measurable performance degradation
✅ **Security**: User ID validation and authorization checks

---

## Risk Assessment

### High Risk

1. **Discord DM Implementation**
   - **Risk**: Discord API complexity, rate limits
   - **Mitigation**: Use well-tested discord.js library, implement retry logic

### Medium Risk

2. **Egress Routing Changes**
   - **Risk**: Breaking existing channel message flow
   - **Mitigation**: Extensive testing, feature flag for gradual rollout

3. **Upstream Service Coordination**
   - **Risk**: Upstream services don't set `messageType` correctly
   - **Mitigation**: Backward-compatible defaults, documentation

### Low Risk

4. **Slack Verification**
   - **Risk**: Minimal - uses existing API
   - **Mitigation**: Test in staging first

5. **Twitch Alignment**
   - **Risk**: Minimal - simple wrapper
   - **Mitigation**: Keep old method for compatibility

---

## Open Questions

1. **User ID Resolution**: How do upstream services know the user ID for DMs?
   - Stored in `event.identity.external.id`?
   - Passed via `event.egress.userId`?
   - Need to standardize

2. **DM Authorization**: Should we check if bot has permission to DM a user?
   - Discord: Users must share a server with bot OR have DMs open
   - Slack: Workspace-level permissions
   - Twitch: Requires specific scope

3. **Rate Limiting**: How do we handle platform-specific rate limits for DMs?
   - Discord: Different rate limits for DMs vs. channels
   - Need rate limiting strategy

4. **Feature Flag**: Should DM functionality be behind a feature flag initially?
   - Gradual rollout
   - Per-platform enablement
   - Safety net

---

## Dependencies

### Code Dependencies

- `discord.js` (Discord integration)
- `@slack/web-api` (Slack integration)
- `@twurple/api` (Twitch Helix API)

### Service Dependencies

- **LLM Bot Service**: Must set `event.egress.messageType` correctly
- **Event Router**: May need updates for DM routing logic
- **Auth Service**: User identity resolution

### Infrastructure Dependencies

- **OAuth Scopes**:
  - Discord: `bot` (DMs to users who share servers)
  - Slack: `chat:write`, `im:write`
  - Twitch: `user:manage:whispers`

---

## Conclusion

The current state of DM capabilities across BitBrat's integrations reveals a significant gap between declared capabilities and actual implementation. Discord's DM functionality is completely broken, Slack's is untested, and Twitch's is implemented but not integrated with the egress routing layer.

The recommended plan addresses all three platforms systematically, starting with interface standardization and progressing through implementation, routing enhancements, and comprehensive testing.

**Immediate Priority**:
1. Interface standardization (Phase 1)
2. Discord DM implementation (Phase 2)
3. Egress routing enhancement (Phase 4)

**Estimated Timeline**: 3-5 days of focused development work

**Primary Risks**: Discord API complexity, egress routing changes affecting existing functionality

**Success Metric**: All three platforms can successfully send DMs via standardized interface with 90%+ test coverage.

---

## Appendix: File Reference Map

### Core Files

| File | Purpose | Status |
|------|---------|--------|
| `src/services/ingress/core/interfaces.ts:128` | EgressConnector interface | Needs extension |
| `src/common/integration-bit.ts:491` | Egress routing logic | Needs DM routing |
| `src/types/events.ts` | Event schema definitions | Needs `messageType` field |

### Discord Files

| File | Purpose | Status |
|------|---------|--------|
| `src/services/ingress/discord/discord-ingress-client.ts:83` | Discord client sendText | Broken for DMs |
| `src/services/ingress/discord/connector-adapter.ts:63` | Discord adapter | Needs sendDM method |

### Slack Files

| File | Purpose | Status |
|------|---------|--------|
| `src/services/ingress/slack/slack-ingress-client.ts:194` | Slack client sendText | Untested for DMs |
| `src/services/ingress/slack/connector-adapter.ts:64` | Slack adapter | Should work |

### Twitch Files

| File | Purpose | Status |
|------|---------|--------|
| `src/services/ingress/twitch/twitch-irc-client.ts:387` | Twitch sendWhisper | Functional |
| `src/services/ingress/twitch/connector-adapter.ts:42` | Twitch adapter | Needs sendDM wrapper |

---

**Document Version**: 1.0
**Last Updated**: 2026-08-14T03:45:00Z

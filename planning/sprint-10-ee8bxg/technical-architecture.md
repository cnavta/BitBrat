# Technical Architecture: Twitch Integration Refactoring

**Sprint**: sprint-10-ee8bxg
**Author**: Architect (Claude Code)
**Date**: 2026-08-11
**Status**: Planning Phase

---

## Executive Summary

This document analyzes the current state of Slack and Twitch integrations in the `ingress-egress` service and provides architectural recommendations for refactoring the Twitch integration to align with the standard connector pattern established in Sprint 348.

**Key Finding**: The Slack integration (Sprint 348) represents the canonical connector architecture that all platform integrations should follow. The Twitch integration predates this pattern and requires refactoring for consistency, maintainability, and future per-platform Bit separation.

---

## 1. Current State Analysis

### 1.1 Slack Integration Architecture (Sprint 348 - Standard Pattern)

**File Structure**:
```
src/services/ingress/slack/
├── slack-ingress-client.ts       # Core client logic (WebSocket via Socket Mode)
├── connector-adapter.ts           # Connector interface adapter (IngressConnector + WebhookConnector)
├── envelope-builder.ts            # Event normalization
├── webhook-utils.ts               # Signature validation
└── index.ts                       # Public exports
```

**Architecture Pattern**:

```
┌─────────────────────────────────────────────────────────────┐
│ IngressEgressServer (Bit)                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ConnectorManager                                           │
│  └─ register('slack', SlackConnectorAdapter)                │
│                                                              │
│  SlackConnectorAdapter (implements IngressConnector,        │
│                         WebhookConnector)                   │
│  ├─ start() → delegates to SlackIngressClient.start()       │
│  ├─ stop() → delegates to SlackIngressClient.stop()         │
│  ├─ getSnapshot() → delegates to client                     │
│  ├─ sendText() → delegates to client                        │
│  ├─ verifySignature() → webhook signature validation        │
│  ├─ handleWebhook() → webhook event processing              │
│  └─ getMetadata() → platform capabilities                   │
│      │                                                       │
│      └─ SlackIngressClient                                  │
│          ├─ Socket Mode WebSocket connection                │
│          ├─ Event filtering (bot message dedup)             │
│          ├─ Event normalization via buildSlackEnvelope()    │
│          └─ Publish to internal.ingress.v1                  │
└─────────────────────────────────────────────────────────────┘
```

**Key Characteristics**:
- ✅ **Clean separation of concerns**: Client handles platform-specific logic, adapter provides standard interface
- ✅ **Interface compliance**: Implements `IngressConnector` and `WebhookConnector`
- ✅ **Capability discovery**: Provides `getMetadata()` for runtime capability queries
- ✅ **Dual-mode support**: Socket Mode (primary) + Events API webhooks (fallback)
- ✅ **Delegation pattern**: Adapter delegates to client, doesn't duplicate logic
- ✅ **RBAC**: Debug mode authorization (Sprint 371)
- ✅ **Deduplication**: Message timestamp-based deduplication

### 1.2 Twitch Integration Architecture (Current State - Pre-Sprint 348)

**File Structure**:
```
src/services/ingress/twitch/
├── twitch-irc-client.ts           # IRC client (Twurple Chat)
├── envelope-builder.ts            # Event normalization
├── credentials-provider.ts        # OAuth token management
├── publisher.ts                   # Event publisher
└── index.ts                       # Public exports
```

**Current Architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│ IngressEgressServer (Bit)                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  this.twitchClient = new TwitchIrcClient(...)               │
│  await this.twitchClient.start()                            │
│                                                              │
│  TwitchIrcClient (DOES NOT implement IngressConnector)      │
│  ├─ start() → Twurple Chat initialization                   │
│  ├─ stop() → Disconnect                                     │
│  ├─ getSnapshot() → Debug snapshot                          │
│  ├─ sendText() → IRC PRIVMSG                                │
│  ├─ sendWhisper() → Helix API whisper                       │
│  ├─ banUser() → IRC /ban or Helix API                       │
│  └─ handleMessage() → Event normalization + publish         │
│      │                                                       │
│      └─ TwitchEnvelopeBuilder.build()                       │
│          └─ Publish to internal.ingress.v1                  │
│                                                              │
│  ❌ NO ConnectorAdapter                                      │
│  ❌ NO WebhookConnector (EventSub webhooks not integrated)  │
│  ❌ NO getMetadata()                                         │
│  ❌ NOT registered with ConnectorManager                    │
└─────────────────────────────────────────────────────────────┘
```

**Key Gaps**:
- ❌ **No adapter layer**: `TwitchIrcClient` is used directly, not through a connector adapter
- ❌ **No interface compliance**: Does not implement `IngressConnector` or `WebhookConnector`
- ❌ **No capability discovery**: Missing `getMetadata()` implementation
- ❌ **Not managed**: Not registered with `ConnectorManager`
- ❌ **Mixed responsibilities**: Client handles both IRC protocol and connector concerns
- ❌ **No webhook support**: EventSub webhook integration not standardized
- ❌ **Inconsistent pattern**: Diverges from Slack/Twilio standard

---

## 2. Architectural Comparison

| Aspect | Slack (Standard) | Twitch (Current) | Gap |
|--------|------------------|------------------|-----|
| **Adapter Layer** | ✅ `SlackConnectorAdapter` | ❌ Direct `TwitchIrcClient` usage | Missing abstraction |
| **Interface Compliance** | ✅ `IngressConnector`, `WebhookConnector` | ❌ None | Not pluggable |
| **Capability Discovery** | ✅ `getMetadata()` | ❌ None | No runtime introspection |
| **Manager Registration** | ✅ Registered with `ConnectorManager` | ❌ Manual lifecycle | Not managed |
| **Dual-Mode Support** | ✅ Socket Mode + Webhooks | ⚠️ IRC only (EventSub not integrated) | Limited ingress modes |
| **Separation of Concerns** | ✅ Adapter → Client delegation | ❌ Mixed in client | Tight coupling |
| **Webhook Support** | ✅ `verifySignature()`, `handleWebhook()` | ❌ None | No webhook standardization |
| **Future-Ready** | ✅ Easy to extract to separate Bit | ❌ Tightly coupled to ingress-egress | Hard to separate |

---

## 3. Recommended Architecture

### 3.1 Target Architecture (Aligned with Slack Pattern)

```
┌─────────────────────────────────────────────────────────────┐
│ IngressEgressServer (Bit)                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ConnectorManager                                           │
│  └─ register('twitch', TwitchConnectorAdapter)              │
│                                                              │
│  TwitchConnectorAdapter (implements IngressConnector,       │
│                          WebhookConnector [optional])       │
│  ├─ start() → delegates to TwitchIrcClient.start()          │
│  ├─ stop() → delegates to TwitchIrcClient.stop()            │
│  ├─ getSnapshot() → delegates to client                     │
│  ├─ sendText() → delegates to client                        │
│  ├─ sendWhisper() → delegates to client [optional]          │
│  ├─ banUser() → delegates to client [optional]              │
│  ├─ verifySignature() → EventSub signature validation       │
│  ├─ handleWebhook() → EventSub event processing             │
│  └─ getMetadata() → platform capabilities                   │
│      │                                                       │
│      └─ TwitchIrcClient (unchanged core logic)              │
│          ├─ Twurple Chat IRC connection                     │
│          ├─ Event filtering (self-message dedup)            │
│          ├─ Event normalization via TwitchEnvelopeBuilder   │
│          ├─ !debug command support (Sprint 371 equivalent)  │
│          └─ Publish to internal.ingress.v1                  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 File Structure (Target)

```
src/services/ingress/twitch/
├── twitch-irc-client.ts           # Core IRC client (minimal changes)
├── connector-adapter.ts           # 🆕 NEW: Connector interface adapter
├── envelope-builder.ts            # Unchanged
├── credentials-provider.ts        # Unchanged
├── publisher.ts                   # Unchanged
├── webhook-utils.ts               # 🆕 NEW: EventSub signature validation
└── index.ts                       # Updated: Export connector adapter
```

### 3.3 Connector Adapter Responsibilities

The `TwitchConnectorAdapter` will:

1. **IngressConnector Interface**:
   - `start()`: Delegate to `TwitchIrcClient.start()`
   - `stop()`: Delegate to `TwitchIrcClient.stop()`
   - `getSnapshot()`: Delegate to `TwitchIrcClient.getSnapshot()`
   - `getMetadata()`: Return Twitch platform capabilities

2. **EgressConnector Interface** (inherited via IngressConnector):
   - `sendText()`: Delegate to `TwitchIrcClient.sendText()`
   - `sendWhisper()`: Delegate to `TwitchIrcClient.sendWhisper()` (optional extension)
   - `banUser()`: Delegate to `TwitchIrcClient.banUser()` (optional extension)

3. **WebhookConnector Interface** (optional, future EventSub integration):
   - `verifySignature()`: Twitch EventSub HMAC-SHA256 signature validation
   - `handleWebhook()`: EventSub event processing (channel.follow, stream.online, etc.)

4. **Capability Metadata**:
   ```typescript
   getMetadata(): ConnectorMetadata {
     return {
       platform: 'twitch',
       version: '1.0.0',
       authMethod: 'oauth2',
       capabilities: {
         ingress: {
           method: 'hybrid', // IRC (primary) + EventSub (optional)
           realtime: true,
           requiresWebhook: false, // IRC doesn't require webhooks
           requiresPublicUrl: false,
         },
         egress: {
           chat: true,
           dm: true, // Whispers
           reactions: false, // Twitch IRC doesn't support reactions
           threads: false,
         },
         moderation: {
           ban: true,
           timeout: true, // Via /timeout command
           delete: true, // Via /delete command
         },
       },
     };
   }
   ```

---

## 4. Migration Strategy

### 4.1 Phased Approach

**Phase 1: Create Adapter Layer** (No Breaking Changes)
- Create `TwitchConnectorAdapter` implementing `IngressConnector`
- Delegate all methods to existing `TwitchIrcClient`
- Add `getMetadata()` implementation
- Register with `ConnectorManager` in `ingress-egress-service.ts`
- Keep direct `TwitchIrcClient` usage as fallback (dual support)

**Phase 2: Integrate Adapter** (Minimal Changes)
- Update `ingress-egress-service.ts` to use adapter via `ConnectorManager`
- Remove direct `this.twitchClient` references
- Use `manager.getConnector('twitch')` pattern
- Verify feature parity (debug mode, egress, moderation)

**Phase 3: Optional Webhook Support** (Future Enhancement)
- Add `WebhookConnector` interface implementation
- Create `webhook-utils.ts` for EventSub signature validation
- Implement `handleWebhook()` for EventSub events
- Update capabilities metadata to reflect webhook support

**Phase 4: Cleanup** (Post-Migration)
- Remove dual support code
- Update documentation
- Update tests to use adapter pattern

### 4.2 Backward Compatibility

**Critical Constraint**: The refactoring MUST NOT break existing functionality.

- ✅ **IRC ingress**: All message handling preserved
- ✅ **Egress**: `sendText()`, `sendWhisper()`, `banUser()` remain functional
- ✅ **Debug mode**: `!debug` command support preserved (Sprint 371 equivalent)
- ✅ **Deduplication**: Message handling unchanged
- ✅ **Credentials**: OAuth token management unchanged
- ✅ **Broadcaster mode**: Separate broadcaster client support preserved

---

## 5. Future-Proofing: Per-Platform Bit Separation

### 5.1 Current State (Monolithic Ingress-Egress)

```
┌─────────────────────────────────────────┐
│ ingress-egress-service                  │
│ ├─ Twitch IRC Client                    │
│ ├─ Slack Socket Mode Client             │
│ ├─ Discord Client                       │
│ ├─ Twilio Client                        │
│ └─ Egress subscription                  │
└─────────────────────────────────────────┘
```

**Issues**:
- Single point of failure (one service crash affects all platforms)
- Difficult to scale per-platform (all-or-nothing scaling)
- Hard to version independently (Twitch update requires full redeployment)
- Complex dependency management (all platform SDKs in one image)

### 5.2 Future State (Per-Platform Bits)

```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ twitch-ingress │  │ slack-ingress  │  │ discord-ingress│
│ ├─ Adapter     │  │ ├─ Adapter     │  │ ├─ Adapter     │
│ └─ Client      │  │ └─ Client      │  │ └─ Client      │
└────────────────┘  └────────────────┘  └────────────────┘
        ↓                   ↓                   ↓
    internal.ingress.v1 (shared topic)
```

**Benefits**:
- Independent scaling (scale Twitch separately from Slack)
- Independent deployment (Twitch update doesn't affect Discord)
- Smaller Docker images (only Twurple in `twitch-ingress`)
- Fault isolation (Twitch crash doesn't affect Slack)
- Easier testing (test Twitch ingress independently)

### 5.3 How This Refactoring Prepares for Separation

**With Adapter Pattern** (This Sprint):
```typescript
// Current: ingress-egress-service.ts
const adapter = new TwitchConnectorAdapter(client, config);
this.connectorManager.register('twitch', adapter);
```

**Future: twitch-ingress-service.ts** (Post-Separation):
```typescript
// Future standalone Bit
export class TwitchIngressServer extends Bit {
  async setup(): Promise<void> {
    const client = new TwitchIrcClient(...);
    const adapter = new TwitchConnectorAdapter(client, this.getConfig());

    // Register connector for MCP introspection
    this.registerConnector('twitch', adapter);

    // Start ingress
    await adapter.start();

    // Subscribe to egress topic
    await this.onMessage('internal.egress.v1', this.handleEgress);
  }
}
```

**Key Enablers**:
1. ✅ **Adapter pattern**: Clean boundary for extraction
2. ✅ **Interface compliance**: Drop-in replacement pattern
3. ✅ **Self-contained logic**: All Twitch-specific code in one module
4. ✅ **Standard lifecycle**: `start()`, `stop()`, `getSnapshot()` work identically
5. ✅ **Capability metadata**: Platform capabilities self-describing

---

## 6. Recommended Approach

### 6.1 Core Principles

1. **Minimal Changes to TwitchIrcClient**: Keep the core client logic unchanged. Only add adapter layer.
2. **100% Feature Parity**: All existing functionality (IRC, egress, debug mode, moderation) must work identically.
3. **Incremental Rollout**: Create adapter, register, verify, then migrate usage.
4. **Future-Ready**: Design with per-platform Bit separation in mind.
5. **Test Coverage**: Maintain existing test coverage, add adapter-specific tests.

### 6.2 Implementation Checklist

**Step 1: Create Adapter Scaffold**
- [ ] Create `src/services/ingress/twitch/connector-adapter.ts`
- [ ] Implement `IngressConnector` interface
- [ ] Implement `getMetadata()` method
- [ ] Delegate `start()`, `stop()`, `getSnapshot()`, `sendText()` to client
- [ ] Add optional `sendWhisper()`, `banUser()` methods

**Step 2: Register with ConnectorManager**
- [ ] Update `ingress-egress-service.ts` to create adapter
- [ ] Register adapter with `ConnectorManager`
- [ ] Maintain backward compatibility (dual support initially)

**Step 3: Verify Feature Parity**
- [ ] Test IRC ingress (message handling)
- [ ] Test egress (sendText, sendWhisper, banUser)
- [ ] Test debug mode (`!debug` command)
- [ ] Test deduplication (self-message filtering)
- [ ] Test credentials (OAuth token refresh)
- [ ] Test broadcaster mode (separate client)

**Step 4: Migrate Usage**
- [ ] Replace direct `this.twitchClient` usage with `manager.getConnector('twitch')`
- [ ] Update egress handler to use adapter
- [ ] Remove dual support code

**Step 5: Documentation & Tests**
- [ ] Update documentation
- [ ] Add adapter unit tests
- [ ] Add integration tests for connector manager
- [ ] Update CLAUDE.md with Twitch example

### 6.3 Optional Enhancements (Future Sprints)

**EventSub Webhook Support**:
- Create `webhook-utils.ts` for signature validation
- Implement `WebhookConnector` interface
- Add `handleWebhook()` for EventSub events (channel.follow, stream.online, etc.)
- Update metadata to reflect webhook capabilities

**Advanced Moderation**:
- Add `/timeout`, `/delete`, `/clear` commands via adapter
- Extend `EgressConnector` with moderation methods
- Add moderation capability metadata

---

## 7. Risk Assessment

### 7.1 Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Breaking existing Twitch functionality** | 🔴 HIGH | Phased rollout with dual support, comprehensive testing |
| **Performance regression** | 🟡 MEDIUM | Adapter is thin delegation layer (negligible overhead) |
| **Incomplete feature parity** | 🟡 MEDIUM | Test matrix for all Twitch features (IRC, egress, debug, moderation) |
| **OAuth token refresh issues** | 🟡 MEDIUM | Credentials provider unchanged, but verify adapter doesn't break flow |
| **Debug mode regression** | 🟡 MEDIUM | Verify `!debug` command works identically |

### 7.2 Success Criteria

- ✅ All existing Twitch functionality works identically (IRC, egress, debug, moderation)
- ✅ Adapter registered with `ConnectorManager` and discoverable
- ✅ `getMetadata()` returns accurate platform capabilities
- ✅ Test coverage maintained or improved
- ✅ Documentation updated with new pattern
- ✅ Zero regressions in production

---

## 8. Conclusion

The Slack integration (Sprint 348) establishes the canonical connector architecture for BitBrat platform integrations. The Twitch integration predates this pattern and requires refactoring to achieve:

1. **Consistency**: Align with standard connector pattern (Slack, Twilio)
2. **Maintainability**: Clean separation of concerns (adapter → client)
3. **Discoverability**: Runtime capability introspection via `getMetadata()`
4. **Future-Ready**: Enable per-platform Bit separation

**Recommended Approach**:
- Create `TwitchConnectorAdapter` implementing `IngressConnector`
- Delegate to existing `TwitchIrcClient` (minimal client changes)
- Register with `ConnectorManager` for lifecycle management
- Maintain 100% feature parity (IRC, egress, debug, moderation)
- Phased rollout with dual support for safety

This refactoring prepares the Twitch integration for future per-platform Bit separation while maintaining backward compatibility and feature parity.

---

**Next Steps**:
1. Review this technical architecture document
2. Create detailed `implementation-plan.md`
3. Get user approval before implementation
4. Execute phased rollout

---

**References**:
- Slack integration: `src/services/ingress/slack/connector-adapter.ts`
- Twitch client: `src/services/ingress/twitch/twitch-irc-client.ts`
- Connector interfaces: `src/services/ingress/core/interfaces.ts`
- ConnectorManager: `src/services/ingress/core/connector-manager.ts`
- Sprint 348: Slack integration implementation
- CLAUDE.md: Integrating Chat Platforms pattern

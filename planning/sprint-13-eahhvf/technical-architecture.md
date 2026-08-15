# Technical Architecture: Bidirectional Event Gateway
**Sprint**: sprint-13-eahhvf
**Role**: Architect
**Date**: 2026-08-14
**Status**: Draft

---

## Executive Summary

This document analyzes the current state of BitBrat's platform integrations and proposes a technical architecture for evolving from a **unidirectional message adapter** to a **full bidirectional event gateway** with exceptional **developer experience**.

**Current State**: Chat-focused, one-way normalization, static configuration, custom builders for every event type
**Target State**: Comprehensive event gateway with bidirectional translation, dynamic subscriptions, runtime capability management, and developer-first design

**Key Innovations**:
1. **Generic Envelope Builder**: SINGLE builder for ALL platforms - zero platform-specific boilerplate
2. **Configuration-Based Registry**: Event mappings as YAML/JSON (not TypeScript) - add integrations without code changes
3. **Symmetric Field Mapping**: Same declarative pattern for ingress AND egress
4. **Integration Levels**: Progressive enhancement from "Hello World" (10 min) to full bidirectional (2 hours)
5. **Built-In Validation**: CLI testing harness with fixture support
6. **Auto-Discovery**: Convention-based registration - zero manual wiring

**Developer Experience Goals**:
- Add basic Telegram integration: **10 minutes** (was: several hours)
- Add new event type: **5 lines of YAML** (was: 60+ lines of TypeScript)
- Test without deploying: **CLI validation** (was: deploy and debug)
- Package as plugin: **npm module** (was: fork entire codebase)

**Key Recommendation**: Implement in phases, starting with DX improvements (generic builder, YAML registry) before expanding event coverage.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Architectural Gaps](#architectural-gaps)
3. [Target Architecture](#target-architecture)
   - 3.1 [Vision: Bidirectional Event Gateway](#31-vision-bidirectional-event-gateway)
   - 3.2 [Architectural Layers](#32-architectural-layers)
   - 3.3 [Generic Envelope Builder (NEW)](#33-generic-envelope-builder)
   - 3.4 [Configuration-Based Event Registry (NEW)](#34-configuration-based-event-registry)
   - 3.5 [Translation Engine](#35-translation-engine)
   - 3.6 [Subscription Manager](#36-subscription-manager)
   - 3.7 [Scope Validation Service (NEW)](#37-scope-validation-service)
4. [Developer Experience](#developer-experience)
   - 4.1 [Integration Levels](#41-integration-levels)
   - 4.2 [Adding Your First Integration](#42-adding-your-first-integration)
   - 4.3 [Testing & Validation](#43-testing--validation)
5. [Phased Migration Plan](#phased-migration-plan)
6. [Technical Specifications](#technical-specifications)
7. [Risk Assessment](#risk-assessment)

---

## Current State Analysis

### Overview

BitBrat currently implements a **unidirectional event normalization** pattern:

```
External Platform → Envelope Builder → InternalEventV2 → BitBrat Event Bus
```

The reverse direction (egress) is ad-hoc:

```
BitBrat Event Bus → internal.egress.v1 → sendText() → External Platform
```

### 1.1 Ingress Architecture

#### Event Coverage by Platform

| Platform | Chat | DM | Reactions | Presence | Threads | Stream Events | Moderation |
|----------|------|-----|-----------|----------|---------|---------------|------------|
| **Twitch** | ✅ | ✅ (ingress) | ❌ | ❌ | ❌ | ✅ (EventSub) | ❌ |
| **Discord** | ✅ | ⚠️ (no distinction) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Slack** | ✅ | ⚠️ (no distinction) | ❌ | ❌ | ❌ | ❌ | ❌ |

#### Architectural Pattern

**Envelope Builder** (one-way translation):

```typescript
// Discord example: src/services/ingress/discord/envelope-builder.ts:83
export function buildDiscordEnvelope(
  event: DiscordMessageMeta,  // Platform-specific
  opts?: BuilderOptions
): InternalEventV2 {          // Normalized internal format
  return {
    type: 'chat.message.v1',  // ⚠️ Hardcoded event type
    ingress: { connector: 'discord', ... },
    message: { text: event.content, ... },
    routing: { stage: 'initial', ... }
  };
}
```

**Strengths**:
- ✅ Clean normalization layer
- ✅ Platform-agnostic internal representation
- ✅ Extensible event schema (`InternalEventV2`)

**Weaknesses**:
- ❌ Only normalizes chat messages (hardcoded `type: 'chat.message.v1'`)
- ❌ No event type registry or mapping
- ❌ No DM vs. channel differentiation
- ❌ Platform-specific events (e.g., Twitch follows) use separate code paths
- ❌ Every event type requires custom builder (no default builder pattern)
- ❌ 80% of field extraction logic duplicated across builders

**Evidence**:
```typescript
// src/services/ingress/twitch/eventsub-client.ts:139
// EventSub events bypass envelope builder, use custom builder
const followSub = this.listener.onChannelFollow(userId, botUserId, (event) => {
  const internalEvent = this.builder.buildFollow(event, opts);  // ⚠️ Separate builder
  this.publisher.publish(internalEvent);
});
```

**Observation**: Most events from a given platform share 80% of the same structure (userId, channelId, timestamp, etc.). Current builders duplicate this common extraction logic.

---

### 1.2 Egress Architecture

#### Current Implementation

**Integration-level routing** (`src/common/integration-bit.ts:491`):

```typescript
private async processEgress(event: InternalEventV2): Promise<void> {
  const platform = event.egress?.connector;
  const connector = this.connectorManager.getConnectorByPlatform(platform);
  const text = extractEgressTextFromEvent(event);  // ⚠️ Text-only
  const targetChannel = event.egress?.channel || event.ingress?.channel;

  await egressConnector.sendText(text, targetChannel);  // ⚠️ Always sendText()
}
```

**Connector Interface** (`src/services/ingress/core/interfaces.ts:128`):

```typescript
export interface EgressConnector {
  sendText(text: string, target?: string): Promise<void>;  // ⚠️ Only text
  banUser?(platformUserId: string, reason?: string): Promise<void>;
}
```

**Strengths**:
- ✅ Platform-agnostic routing layer
- ✅ Fail-open strategy
- ✅ Instance-specific egress topics

**Weaknesses**:
- ❌ Text-only (no reactions, rich content, threads)
- ❌ No DM routing (always calls `sendText()`)
- ❌ No reverse translation layer (no `InternalEventV2 → PlatformPayload`)
- ❌ No event type → platform action mapping

---

### 1.3 Event Type System

#### Defined Types (`src/types/events.ts:7`):

```typescript
export type InternalEventType =
  | 'chat.message.v1'
  | 'chat.command.v1'
  | 'moderation.action.v1'
  | 'system.twitch.follow'      // ⚠️ Platform-specific
  | 'system.stream.online'
  | 'llm.request.v1'
  | 'llm.response.v1'
  | string;  // ⚠️ Open-ended (no validation)
```

**Usage Analysis**:
- `chat.message.v1`: ✅ Implemented by all platforms
- `moderation.action.v1`: ❌ Defined but unused
- `system.twitch.follow`: ⚠️ Twitch-only (not generalized)
- `system.stream.online`: ⚠️ Twitch-only

**Egress Type Field** (`src/types/events.ts:58`):

```typescript
export interface Egress {
  type?: 'chat' | 'dm' | 'event';  // ⚠️ Defined but NEVER checked
  connector: ConnectorType;
  channel?: string;
}
```

**Critical Finding**: The `Egress.type` field exists but is **never used** by egress routing logic. This is a clear architectural intent that was never implemented.

---

### 1.4 DM Support Analysis

#### Ingress (Receiving DMs)

| Platform | DM Detection | Event Differentiation | Status |
|----------|-------------|----------------------|--------|
| **Twitch** | ❌ No detection | Whispers use separate EventSub subscription | Not implemented |
| **Discord** | ❌ No detection | All messages treated as channel messages | Missing |
| **Slack** | ❌ No detection | DM channels indistinguishable from regular channels | Missing |

**Discord Implementation Gap**:
```typescript
// src/services/ingress/discord/discord-ingress-client.ts:210
this.client.on('messageCreate', async (msg: any) => {
  // ⚠️ No check for msg.channel.type === ChannelType.DM
  if (!msg?.guild || msg.guild.id !== guildId) {  // ❌ Filters OUT DMs!
    return;  // DMs have no guild → discarded
  }
});
```

**Slack Architecture**:
Slack DMs are channels with ID prefix `D` (e.g., `D0123456789`). No code distinguishes DM channels from public channels.

#### Egress (Sending DMs)

| Platform | DM Method | Routing Support | Status |
|----------|-----------|----------------|--------|
| **Twitch** | ✅ `sendWhisper()` | ❌ Never called | Implemented but orphaned |
| **Discord** | ❌ Broken (uses `channels.fetch()` for user IDs) | ❌ None | Broken |
| **Slack** | ⚠️ `sendText()` works if given DM channel ID | ⚠️ Untested | Unknown |

**Discord DM Failure** (`src/services/ingress/discord/discord-ingress-client.ts:94`):

```typescript
async sendText(text: string, channelId?: string): Promise<void> {
  const channel = await this.client.channels.fetch(channelId);
  // ❌ FAILS for user IDs - channels.fetch() only works for channel IDs
  await (channel as any).send(text);
}
```

**Correct Discord DM Flow**:
```typescript
// Required implementation:
const user = await this.client.users.fetch(userId);
const dmChannel = await user.createDM();
await dmChannel.send(text);
```

---

### 1.5 Subscription Management

#### Current Approach

**Static Configuration**:
- All subscriptions defined at startup via environment variables
- No runtime changes possible
- No subscription state persistence

**Examples**:

```yaml
# Discord
DISCORD_CHANNELS=123456789,987654321
DISCORD_GUILD_ID=111222333

# Slack
# Subscriptions defined in slack-app-manifest.yaml (deployed to Slack)
event_subscriptions:
  bot_events:
    - message.channels
    - message.groups
    - message.im
    - app_mention

# Twitch
TWITCH_CHANNELS=channel1,channel2
# EventSub subscriptions created programmatically at startup
```

#### Limitations

1. **No Runtime Control**: Cannot add/remove channels without restart
2. **No Scope Management**: Cannot dynamically request new OAuth scopes
3. **No Subscription State**: Cannot query what subscriptions are active
4. **No Validation**: Cannot verify if bot has required permissions before subscribing
5. **No Webhooks**: Cannot dynamically register/unregister webhooks

---

### 1.6 IntegrationBit: Current Orchestration Layer

**Location**: `src/common/integration-bit.ts` (784 lines)

#### Overview

IntegrationBit is the **existing orchestration layer** that manages all platform integrations. Created in Sprint 12, it extends the Bit base class to provide standardized lifecycle management, webhook routing, egress handling, and observability for platform connectors.

**Key Insight**: IntegrationBit already implements **80% of what an Event Gateway needs** - it just lacks event-type awareness and bidirectional translation.

#### Current Responsibilities

```typescript
export class IntegrationBit extends Bit {
  private connectorManager: ConnectorManager;          // ✅ Connector lifecycle
  private instanceId: string;                          // ✅ Instance management
  private egressTopic: string;                         // ✅ Egress routing
  private statusMonitorInterval?: NodeJS.Timeout;      // ✅ Status monitoring

  constructor(config: IntegrationBitConfig) {
    // 1. Connector registration and lifecycle
    this.registerConnectors();

    // 2. Webhook routing (POST /webhooks/:platform)
    this.setupWebhookRouting();

    // 3. Egress message subscriptions (instance + generic topics)
    this.setupEgressRouting();

    // 4. Status monitoring (publishes state changes)
    this.setupStatusMonitoring();

    // 5. Debug endpoints (/_debug/*)
    this.setupDebugEndpoints();
  }
}
```

#### Strengths

| Capability | Status | Implementation |
|------------|--------|---------------|
| **Connector Lifecycle** | ✅ Excellent | ConnectorManager handles start/stop/status for all platforms |
| **Instance Management** | ✅ Excellent | Instance-specific egress topics, Cloud Run aware |
| **Webhook Routing** | ✅ Good | Generic POST /webhooks/:platform with signature verification |
| **Egress Subscription** | ✅ Excellent | Dual subscription pattern (instance + generic topics) |
| **Idempotency** | ✅ Excellent | Built-in idempotency middleware (60s TTL) |
| **Status Monitoring** | ✅ Excellent | Auto-publishes connector state changes to event bus |
| **Debug Endpoints** | ✅ Good | /_debug/instance, /_debug/connectors for introspection |
| **Fail-Open Strategy** | ✅ Excellent | Connector failures don't crash service |

#### Current Egress Implementation

```typescript
// src/common/integration-bit.ts:491
private async processEgress(event: InternalEventV2): Promise<void> {
  const platform = event.egress?.connector;
  const connector = this.connectorManager.getConnectorByPlatform(platform);

  // ⚠️ Text-only extraction
  const text = extractEgressTextFromEvent(event);

  // ⚠️ Channel from egress or ingress
  const targetChannel = event.egress?.channel || event.ingress?.channel;

  // ⚠️ Always calls sendText(), regardless of event type
  await egressConnector.sendText(text, targetChannel);
}
```

**Limitations**:
- ❌ No event type awareness (treats all events as generic blobs)
- ❌ Text-only (no reactions, rich content, threads)
- ❌ No DM routing (always calls `sendText()`, never `sendDM()`)
- ❌ No reverse translation (`InternalEventV2 → PlatformPayload`)

#### Connector Configuration Pattern

**Multi-platform mode** (current ingress-egress):

```typescript
const config: IntegrationBitConfig = {
  serviceName: 'ingress-egress',
  connectors: [
    { name: 'twitch', factory: createTwitchConnector, enabled: true },
    { name: 'discord', factory: createDiscordConnector, enabled: true },
    { name: 'slack', factory: createSlackConnector, enabled: true },
    { name: 'twilio', factory: createTwilioConnector, enabled: true }
  ]
};
```

**Single-platform mode** (future standalone services):

```typescript
const config: IntegrationBitConfig = {
  serviceName: 'discord-gateway',
  connectors: [
    { name: 'discord', factory: createDiscordConnector, enabled: true }
  ]
};
```

#### Key Features

**1. ConnectorManager Integration**

```typescript
// Connectors registered via factory pattern
for (const connectorConfig of this.integrationConfig.connectors) {
  const connector = await factory(this.getConfig(), {
    egressDestinationTopic: this.egressTopic,
    publisherFactory: (topic: string) => this.getResource('publisher').create(topic),
    documentStore: this.getResource('documentStore')
  });

  this.connectorManager.register(name, connector);
}
```

**2. Instance-Specific Egress Topics**

```typescript
// Cloud Run aware instance ID resolution
private resolveInstanceId(): string {
  if (process.env.INSTANCE_ID) return process.env.INSTANCE_ID;
  if (process.env.K_SERVICE && process.env.K_REVISION) {
    return `${process.env.K_SERVICE}-${process.env.K_REVISION}`;
  }
  return `${this.serviceName}-${randomSuffix()}`;
}

// Egress topic: internal.egress.v1.ingress-egress-abc123
this.egressTopic = `internal.egress.v1.${this.instanceId}`;
```

**3. Dual Egress Subscription Pattern**

```typescript
// Subscribe to instance-specific topic (targeted responses)
await this.onMessage(this.egressTopic, async (event, attrs, ctx) => {
  await this.processEgress(event);
  await ctx.ack();
}, { idempotency: { enabled: true, ttlSeconds: 60 } });

// Subscribe to generic topic (broadcast responses)
await this.onMessage('internal.egress.v1', async (event, attrs, ctx) => {
  await this.processEgress(event);
  await ctx.ack();
}, { idempotency: { enabled: true, ttlSeconds: 60 } });
```

**4. Status Monitoring with Event Publishing**

```typescript
private setupStatusMonitoring(): void {
  setInterval(async () => {
    const snapshots = this.connectorManager.getSnapshot();

    for (const snapshot of snapshots) {
      if (snapshot.state !== lastState) {
        // Publish state change to event bus
        await publisher.publishJson({
          type: 'connector.status.changed',
          connector: snapshot.platform,
          previousState: lastState,
          currentState: snapshot.state,
          instanceId: this.instanceId
        });
      }
    }
  }, 15000); // Every 15 seconds
}
```

#### Integration with Event Gateway Components

**Critical Decision**: IntegrationBit should **NOT be replaced** - instead, it should **orchestrate Event Gateway components** through composition.

**Why Composition Over Replacement**:
1. ✅ IntegrationBit already handles lifecycle, routing, and observability
2. ✅ Event Gateway components (EventRegistry, TranslationEngine, SubscriptionManager) are specialized concerns
3. ✅ Clean separation: IntegrationBit orchestrates, components implement logic
4. ✅ Backward compatible: existing functionality preserved
5. ✅ Testable: each component can be unit tested independently

**Proposed Evolution** (see Section 3.2 for details):

```typescript
export class IntegrationBit extends Bit {
  // Existing (keep all)
  private connectorManager: ConnectorManager;
  private instanceId: string;
  private egressTopic: string;

  // NEW: Event Gateway components (composed dependencies)
  private eventRegistry: EventRegistry;                // 🆕 Event type mappings
  private translationEngine: TranslationEngine;        // 🆕 Bidirectional translation
  private subscriptionManager: SubscriptionManager;    // 🆕 Runtime subscriptions

  constructor(config: IntegrationBitConfig) {
    // Existing initialization (unchanged)
    this.connectorManager = new ConnectorManager(...);

    // NEW: Initialize Event Gateway components
    this.eventRegistry = new EventRegistry();
    this.translationEngine = new TranslationEngine(this.eventRegistry, logger);
    this.subscriptionManager = new SubscriptionManager(...);

    // Existing setup (some enhanced with new components)
    this.registerConnectors();        // ✅ Keep as-is
    this.setupWebhookRouting();       // 🔧 Enhance (add event type detection)
    this.setupEgressRouting();        // 🔧 Enhance (use translation engine)
    this.setupStatusMonitoring();     // ✅ Keep as-is
    this.setupDebugEndpoints();       // ✅ Keep as-is
    this.setupSubscriptionTools();    // 🆕 Add (MCP tools)
  }
}
```

**Result**: IntegrationBit evolves from "platform adapter" to "Event Gateway orchestrator" while maintaining all existing responsibilities.

---

## Architectural Gaps

### Gap 1: No Bidirectional Event Translation

**Current**: One-way platform → BitBrat normalization only, every event requires custom builder

**Missing**:
- No reverse mapping: `InternalEventV2 → PlatformPayload`
- No event type registry
- No platform capability discovery
- No default envelope builders (90% of events duplicate the same extraction logic)

**Impact of Missing Default Builders**:
- Adding a new event type requires 50-100 lines of boilerplate code
- Field extraction logic duplicated across builders (userId, channelId, messageText)
- High barrier to adding new event types
- Platform-specific quirks not centralized

**Proposed Solution**: Default envelope builders with field mapping configuration - reduces 90% of event types to 5-10 lines of declarative configuration.

**Example Use Case**:
```typescript
// Want to do this:
const reaction = {
  type: 'reaction.add.v1',
  messageId: '123',
  emoji: '👍'
};

// Need translation layer to map to:
// - Discord: client.channels.get(ch).messages.get(msgId).react('👍')
// - Slack: client.reactions.add({ channel, timestamp, name: '+1' })
// - Twitch: N/A (no reaction support)
```

---

### Gap 2: No Event Type Registry

**Current**: Hardcoded event types in envelope builders

**Missing**:
- Centralized event type definitions
- Platform capability mapping
- Event type → required scopes mapping
- Event type versioning and migration

**Proposed**:
```typescript
// Event registry concept
const EVENT_REGISTRY = {
  'chat.message.v1': {
    platforms: ['discord', 'slack', 'twitch'],
    ingress: {
      discord: { eventType: 'messageCreate', filter: (msg) => !!msg.guild },
      slack: { eventType: 'message', subtypes: ['channel', 'group', 'im'] },
      twitch: { eventType: 'message', source: 'irc' }
    },
    egress: {
      discord: { method: 'sendText', api: 'channel.send' },
      slack: { method: 'sendText', api: 'chat.postMessage' },
      twitch: { method: 'sendText', api: 'chat.say' }
    }
  },
  'reaction.add.v1': {
    platforms: ['discord', 'slack'],  // Twitch doesn't support
    ingress: {
      discord: { eventType: 'messageReactionAdd', scopes: ['GatewayIntentBits.GuildMessageReactions'] },
      slack: { eventType: 'reaction_added', scopes: ['reactions:read'] }
    },
    egress: {
      discord: { method: 'addReaction', api: 'message.react', scopes: ['AddReactions'] },
      slack: { method: 'addReaction', api: 'reactions.add', scopes: ['reactions:write'] }
    }
  }
};
```

---

### Gap 3: No Dynamic Subscription Management

**Current**: Static subscriptions at startup

**Missing**:
- Runtime subscription control
- Subscription state persistence
- Permission validation before subscription
- Webhook lifecycle management

**Use Cases**:
1. **Dynamic Channel Joining**: LLM bot decides to monitor a new channel
2. **Event-Driven Subscriptions**: Subscribe to `stream.online` only when user requests stream notifications
3. **Scope Requests**: Request additional OAuth scopes when needed (e.g., `reactions:write`)
4. **Webhook Management**: Auto-register webhooks when platform integration is enabled

---

### Gap 4: No Message Type Differentiation

**Current**: All messages treated as channel messages

**Missing**:
- DM detection on ingress
- DM routing on egress
- Thread detection and routing
- Event type differentiation

**Impact**:
- Discord DMs are **filtered out** (no guild ID)
- Slack DMs are **not distinguished** from channels
- Twitch whispers require **separate client** (EventSub)
- No way to reply in thread vs. channel

---

## Target Architecture

### 3.1 Vision: Bidirectional Event Gateway

**Definition**: A platform-agnostic event gateway that provides:

1. **Comprehensive Event Normalization**: All platform events → standardized internal events
2. **Bidirectional Translation**: Internal events → platform-specific actions
3. **Dynamic Subscription Management**: Runtime control of event subscriptions
4. **Capability Discovery**: Query what events/actions each platform supports
5. **Type-Safe Routing**: Event type → platform action mapping with compile-time validation

---

### 3.2 Architectural Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    BitBrat Application Layer                     │
│              (LLM Bot, Event Router, Auth, etc.)                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─ Ingress Events (normalized)
                         ├─ Egress Requests (normalized)
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    Event Gateway Layer (NEW)                     │
│                                                                   │
│  ┌──────────────────┐   ┌─────────────────┐   ┌──────────────┐ │
│  │ Event Registry   │   │ Capability Map  │   │ Translation  │ │
│  │                  │   │                 │   │   Engine     │ │
│  │ - Event types    │   │ - Per-platform  │   │              │ │
│  │ - Schemas        │   │ - Ingress caps  │   │ - Inbound    │ │
│  │ - Versioning     │   │ - Egress caps   │   │ - Outbound   │ │
│  └──────────────────┘   └─────────────────┘   └──────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Subscription Manager (NEW)                      │   │
│  │  - Runtime subscription control                           │   │
│  │  - Permission/scope management                            │   │
│  │  - Subscription state persistence                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │
     ┌───────────────────┼───────────────────┐
     │                   │                   │
┌────▼─────┐      ┌──────▼──────┐      ┌────▼─────┐
│ Discord  │      │    Slack    │      │  Twitch  │
│ Connector│      │  Connector  │      │ Connector│
│          │      │             │      │          │
│ - Ingress│      │  - Ingress  │      │ - Ingress│
│ - Egress │      │  - Egress   │      │ - Egress │
│ - Bidirec│      │  - Bidirec  │      │ - Bidirec│
└──────────┘      └─────────────┘      └──────────┘
```

---

### 3.3 Event Registry Design

**Purpose**: Central registry of all supported event types with platform-specific mappings.

**Key Innovation**: Default envelope builders with optional overrides - 90% of events use simple field mappings, 10% use custom builders for complex logic.

```typescript
// src/services/ingress/core/event-registry.ts (NEW)

export interface EventDefinition {
  /** Event type (e.g., 'chat.message.v1') */
  type: string;

  /** Event version */
  version: string;

  /** Event schema (JSON Schema or Zod) */
  schema: object;

  /** Platforms that support this event */
  platforms: PlatformEventMapping[];

  /** Event category for grouping */
  category: 'chat' | 'reaction' | 'presence' | 'moderation' | 'stream' | 'custom';
}

export interface FieldMapping {
  /** User ID extraction (path string or function) */
  userId?: string | ((evt: any) => string);

  /** User name extraction */
  userName?: string | ((evt: any) => string);

  /** Channel ID extraction */
  channelId?: string | ((evt: any) => string);

  /** Message text extraction */
  messageText?: string | ((evt: any) => string);

  /** Message ID extraction */
  messageId?: string | ((evt: any) => string);

  /** Custom fields (event-specific data) */
  custom?: Record<string, string | ((evt: any) => any)>;
}

export interface PlatformEventMapping {
  /** Platform name */
  platform: 'discord' | 'slack' | 'twitch';

  /** Ingress mapping (how to receive this event) */
  ingress?: {
    /** Platform-specific event name */
    eventName: string;

    /** Event filter function */
    filter?: (platformEvent: any) => boolean;

    /** Required OAuth scopes */
    requiredScopes?: string[];

    /** 🆕 Envelope builder function (OPTIONAL - uses platform default if omitted) */
    builder?: (platformEvent: any) => InternalEventV2;

    /** 🆕 Field mapping for default builder (alternative to custom builder) */
    fieldMapping?: FieldMapping;
  };

  /** Egress mapping (how to send this event) */
  egress?: {
    /** Method name on connector */
    method: string;

    /** Required OAuth scopes */
    requiredScopes?: string[];

    /** Translation function */
    translator: (internalEvent: InternalEventV2) => PlatformPayload;
  };
}

// Example 1: Chat message (uses custom builder for backward compatibility)
export const CHAT_MESSAGE_V1: EventDefinition = {
  type: 'chat.message.v1',
  version: '1',
  schema: { /* JSON Schema */ },
  category: 'chat',
  platforms: [
    {
      platform: 'discord',
      ingress: {
        eventName: 'messageCreate',
        filter: (msg) => msg.guild && !msg.author.bot,
        requiredScopes: ['GatewayIntentBits.GuildMessages', 'GatewayIntentBits.MessageContent'],
        builder: buildDiscordEnvelope  // Keep existing builder (already implemented)
      },
      egress: {
        method: 'sendText',
        requiredScopes: ['SendMessages'],
        translator: (evt) => ({
          channelId: evt.egress.channel,
          content: extractEgressTextFromEvent(evt)
        })
      }
    },
    {
      platform: 'slack',
      ingress: {
        eventName: 'message',
        filter: (evt) => evt.type === 'message' && !evt.bot_id,
        requiredScopes: ['channels:history', 'groups:history', 'im:history'],
        builder: buildSlackEnvelope  // Keep existing builder
      },
      egress: {
        method: 'sendText',
        requiredScopes: ['chat:write'],
        translator: (evt) => ({
          channel: evt.egress.channel,
          text: extractEgressTextFromEvent(evt)
        })
      }
    }
  ]
};

// Example 2: Typing indicator (uses DEFAULT builder + fieldMapping) ✅ NEW PATTERN
export const TYPING_INDICATOR_V1: EventDefinition = {
  type: 'typing.start.v1',
  version: '1',
  schema: { /* JSON Schema */ },
  category: 'presence',
  platforms: [
    {
      platform: 'discord',
      ingress: {
        eventName: 'typingStart',
        requiredScopes: ['GatewayIntentBits.GuildMessageTyping'],
        // ✅ No builder specified → uses Discord default builder
        fieldMapping: {
          userId: (evt) => evt.user.id,
          userName: (evt) => evt.user.username,
          channelId: (evt) => evt.channel.id
        }
      }
    },
    {
      platform: 'slack',
      ingress: {
        eventName: 'user_typing',
        requiredScopes: ['channels:read'],
        // ✅ No builder → uses Slack default builder
        fieldMapping: {
          userId: 'event.user',       // Lodash-style path string
          channelId: 'event.channel'
        }
      }
    }
  ]
};

// Example 3: DM event (uses DEFAULT builder + fieldMapping) ✅ NEW PATTERN
export const DIRECT_MESSAGE_V1: EventDefinition = {
  type: 'dm.message.v1',
  version: '1',
  schema: { /* JSON Schema */ },
  category: 'chat',
  platforms: [
    {
      platform: 'discord',
      ingress: {
        eventName: 'messageCreate',
        filter: (msg) => msg.channel.type === ChannelType.DM && !msg.author.bot,
        requiredScopes: ['GatewayIntentBits.DirectMessages', 'GatewayIntentBits.MessageContent'],
        // ✅ Default builder can handle DMs with fieldMapping
        fieldMapping: {
          userId: (msg) => msg.author.id,
          userName: (msg) => msg.author.username,
          channelId: (msg) => msg.channel.id,
          messageText: (msg) => msg.content,
          messageId: (msg) => msg.id,
          custom: {
            isDM: () => true  // Flag for downstream processors
          }
        }
      },
      egress: {
        method: 'sendDM',
        requiredScopes: [],  // DMs don't require special permissions
        translator: (evt) => ({
          userId: evt.identity.external.id,
          content: extractEgressTextFromEvent(evt)
        })
      }
    },
    {
      platform: 'slack',
      ingress: {
        eventName: 'message',
        filter: (evt) => evt.channel_type === 'im',
        requiredScopes: ['im:history'],
        // ✅ Default builder works for Slack DMs
        fieldMapping: {
          userId: 'event.user',
          channelId: 'event.channel',
          messageText: 'event.text',
          messageId: 'event.ts',
          custom: {
            isDM: () => true
          }
        }
      },
      egress: {
        method: 'sendDM',
        requiredScopes: ['chat:write', 'im:write'],
        translator: async (evt, client) => {
          // Need to open DM channel first
          const dmChannel = await client.conversations.open({ users: evt.identity.external.id });
          return {
            channel: dmChannel.channel.id,
            text: extractEgressTextFromEvent(evt)
          };
        }
      }
    }
  ]
};

// Example 4: Voice join (requires CUSTOM builder - complex multi-parameter event) ⚠️
export const VOICE_JOIN_V1: EventDefinition = {
  type: 'voice.join.v1',
  version: '1',
  schema: { /* JSON Schema */ },
  category: 'presence',
  platforms: [
    {
      platform: 'discord',
      ingress: {
        eventName: 'voiceStateUpdate',
        filter: (oldState, newState) => !oldState.channel && newState.channel,  // User joined
        requiredScopes: ['GatewayIntentBits.GuildVoiceStates'],
        // ⚠️ Custom builder required (two parameters + complex diff logic)
        builder: (oldState, newState) => ({
          v: '2',
          type: 'voice.join.v1',
          correlationId: randomUUID(),
          traceId: randomUUID(),
          ingress: {
            connector: 'discord',
            channel: newState.channel.id,
            platformUserId: newState.member.user.id,
            platformUserName: newState.member.user.username
          },
          voice: {  // Custom event-specific data
            channelId: newState.channel.id,
            channelName: newState.channel.name,
            previousChannelId: oldState.channel?.id,
            deaf: newState.deaf,
            mute: newState.mute,
            selfDeaf: newState.selfDeaf,
            selfMute: newState.selfMute
          },
          identity: extractIdentity(newState.member.user),
          routing: { stage: 'initial', currentStep: 0 },
          metadata: {
            rawPlatformPayload: { oldState, newState }
          }
        })
      }
    }
  ]
};

// Registry exports
export const EVENT_REGISTRY = {
  'chat.message.v1': CHAT_MESSAGE_V1,
  'dm.message.v1': DIRECT_MESSAGE_V1,
  'typing.start.v1': TYPING_INDICATOR_V1,
  'voice.join.v1': VOICE_JOIN_V1,
  'reaction.add.v1': REACTION_ADD_V1,
  'presence.update.v1': PRESENCE_UPDATE_V1,
  // ... more events
};
```

---

### 3.3 Generic Envelope Builder

**Purpose**: **SINGLE universal builder** for ALL platforms - eliminates the need for platform-specific default builders entirely.

**Key Insight**: 90% of envelope builders do the same thing with different field paths. Instead of creating a default builder per platform, use ONE generic builder with platform-specific field mappings.

**Benefits**:
- ✅ Zero boilerplate for new integrations
- ✅ Consistent extraction logic across all platforms
- ✅ Field mappings are data (YAML/JSON) not code
- ✅ Automatic fallback path support
- ✅ Platform-specific quirks isolated in configuration

**Architecture**:

```typescript
// src/services/ingress/core/generic-envelope-builder.ts (NEW)

export interface GenericFieldMapping {
  // Required fields
  userId: string | ((evt: any) => string);
  channelId: string | ((evt: any) => string);

  // Optional fields with fallback paths
  userName?: {
    path?: string | ((evt: any) => string);
    fallbacks?: string[];  // Platform-specific fallback paths
  };
  messageText?: {
    path?: string | ((evt: any) => string);
    fallbacks?: string[];
  };
  messageId?: {
    path?: string | ((evt: any) => string);
    fallbacks?: string[];
  };

  // Custom fields (event-specific data)
  custom?: Record<string, string | ((evt: any) => any)>;

  // Platform-specific event wrapper (e.g., 'event' for Slack)
  eventWrapper?: string;
}

export interface GenericBuilderContext {
  platform: string;
  eventType: string;
  platformEvent: any;
  fieldMapping: GenericFieldMapping;
}

/**
 * Universal envelope builder that works for ALL platforms
 * Eliminates the need for platform-specific default builders
 */
export function buildGenericEnvelope(ctx: GenericBuilderContext): InternalEventV2 {
  const { platform, eventType, platformEvent, fieldMapping } = ctx;

  // Handle platform-specific event wrappers (e.g., Slack nests events under 'event')
  const evt = fieldMapping.eventWrapper
    ? _.get(platformEvent, fieldMapping.eventWrapper) || platformEvent
    : platformEvent;

  // Extract required fields
  const userId = extractWithFallbacks(evt, fieldMapping.userId);
  const channelId = extractWithFallbacks(evt, fieldMapping.channelId);

  // Extract optional fields with fallbacks
  const userName = extractWithFallbacks(evt, fieldMapping.userName);
  const messageText = extractWithFallbacks(evt, fieldMapping.messageText);
  const messageId = extractWithFallbacks(evt, fieldMapping.messageId);

  // Standard InternalEventV2 construction (SAME for ALL platforms)
  return {
    v: '2',
    type: eventType,
    correlationId: randomUUID(),
    traceId: randomUUID(),

    ingress: {
      connector: platform,
      channel: channelId,
      platformUserId: userId,
      platformUserName: userName || userId,  // Fallback to ID if name missing
      timestamp: new Date().toISOString()
    },

    // Only include message if we have text or ID
    ...(messageText || messageId ? {
      message: {
        id: messageId || randomUUID(),
        text: messageText || '',
        rawPlatformPayload: evt
      }
    } : {}),

    identity: {
      external: {
        id: userId,
        platform,
        handle: userName || userId
      },
      internal: { id: '' }  // Populated by auth-service
    },

    routing: {
      stage: 'initial',
      currentStep: 0
    },

    // Extract custom fields from fieldMapping
    ...(fieldMapping.custom ? extractCustomFields(evt, fieldMapping.custom) : {}),

    metadata: {
      rawPlatformPayload: platformEvent,
      platformEventName: extractPlatformEventName(platformEvent, platform)
    }
  };
}

/**
 * Extract field using path/function with optional fallback paths
 */
function extractWithFallbacks(
  obj: any,
  mapping: string | { path?: string | Function; fallbacks?: string[] } | Function | undefined
): string {
  if (!mapping) return '';

  // Direct function
  if (typeof mapping === 'function') {
    return String(mapping(obj) || '');
  }

  // Direct path string
  if (typeof mapping === 'string') {
    return String(_.get(obj, mapping) || '');
  }

  // Object with path and fallbacks
  if (typeof mapping === 'object') {
    // Try primary path
    if (mapping.path) {
      const primary = typeof mapping.path === 'function'
        ? mapping.path(obj)
        : _.get(obj, mapping.path);
      if (primary !== undefined && primary !== null) {
        return String(primary);
      }
    }

    // Try fallback paths
    if (mapping.fallbacks) {
      for (const fallback of mapping.fallbacks) {
        const value = _.get(obj, fallback);
        if (value !== undefined && value !== null) {
          return String(value);
        }
      }
    }
  }

  return '';
}

function extractCustomFields(obj: any, custom: Record<string, string | Function>): any {
  const result: any = {};
  for (const [key, extractor] of Object.entries(custom)) {
    if (typeof extractor === 'function') {
      result[key] = extractor(obj);
    } else {
      result[key] = _.get(obj, extractor);
    }
  }
  return result;
}

function extractPlatformEventName(evt: any, platform: string): string {
  // Platform-specific event name extraction
  switch (platform) {
    case 'discord':
      return evt.constructor?.name || 'DiscordEvent';
    case 'slack':
      return evt.event?.type || evt.type || 'SlackEvent';
    case 'twitch':
      return 'subscription' in evt ? 'EventSub' : 'IRC';
    case 'telegram':
      return Object.keys(evt).find(k => k !== 'update_id') || 'TelegramUpdate';
    default:
      return 'UnknownEvent';
  }
}
```

**Usage Examples**:

```typescript
// Discord - no platform-specific builder needed!
const discordEvent = buildGenericEnvelope({
  platform: 'discord',
  eventType: 'typing.start.v1',
  platformEvent: discordTypingEvent,
  fieldMapping: {
    userId: 'user.id',
    userName: {
      path: 'user.username',
      fallbacks: ['user.globalName', 'user.id']
    },
    channelId: 'channel.id'
  }
});

// Slack - handles event wrapper automatically
const slackEvent = buildGenericEnvelope({
  platform: 'slack',
  eventType: 'chat.message.v1',
  platformEvent: slackEventPayload,
  fieldMapping: {
    eventWrapper: 'event',  // Slack wraps events
    userId: 'user',
    userName: {
      fallbacks: ['user_profile.real_name', 'user']
    },
    channelId: 'channel',
    messageText: 'text',
    messageId: 'ts'
  }
});

// Telegram - same generic builder!
const telegramEvent = buildGenericEnvelope({
  platform: 'telegram',
  eventType: 'chat.message.v1',
  platformEvent: telegramUpdate.message,
  fieldMapping: {
    userId: 'from.id',
    userName: {
      path: 'from.username',
      fallbacks: ['from.first_name', 'from.id']
    },
    channelId: 'chat.id',
    messageText: 'text',
    messageId: 'message_id'
  }
});
```

#### Decision Matrix: Custom vs. Generic Builder

| Scenario | Use Generic Builder | Use Custom Builder |
|----------|-------------------|-------------------|
| **Simple message events** | ✅ Yes | ❌ No |
| **Typing indicators** | ✅ Yes | ❌ No |
| **Presence updates** | ✅ Yes | ❌ No |
| **Reactions** | ✅ Yes | ❌ No |
| **DM messages** | ✅ Yes | ❌ No |
| **User join/leave** | ✅ Yes | ❌ No |
| **Voice state (single parameter)** | ✅ Yes | ❌ No |
| **Voice state changes (oldState, newState)** | ❌ No | ✅ Yes |
| **Message edits (oldMsg, newMsg)** | ❌ No | ✅ Yes |
| **Complex data transformation** | ❌ No | ✅ Yes |
| **Event with sub-type detection** | ⚠️ Maybe (JSONLogic filter) | ✅ Yes if complex |

**Rule of Thumb**: If you can extract all data using paths/fallbacks → use generic builder (95% of events). Custom builders only for multi-parameter events or complex transformations.

---

### 3.4 Configuration-Based Event Registry

**Purpose**: Event mappings as **YAML/JSON configuration files** instead of TypeScript code - enables dynamic loading, plugin architecture, and zero-code platform additions.

**Key Benefit**: Add Telegram support without modifying Discord code or rebuilding existing integrations.

**Architecture**:

```
config/
  events/                    # Event type definitions
    chat-message.v1.yaml
    dm-message.v1.yaml
    typing-start.v1.yaml
    reaction-add.v1.yaml

  platforms/                 # Platform-specific mappings
    discord/
      chat-message.v1.yaml   # How Discord handles chat messages
      dm-message.v1.yaml
      typing-start.v1.yaml
    slack/
      chat-message.v1.yaml
      typing-start.v1.yaml
    telegram/                # NEW - no code changes needed!
      chat-message.v1.yaml
      dm-message.v1.yaml
```

**Event Definition** (`config/events/chat-message.v1.yaml`):

```yaml
type: chat.message.v1
version: '1'
category: chat
description: Chat message sent in a public channel or group
schema:
  $ref: ./schemas/chat-message.v1.json
```

**Platform Mapping** (`config/platforms/telegram/chat-message.v1.yaml`):

```yaml
platform: telegram
eventType: chat.message.v1

ingress:
  eventName: message

  # JSONLogic filter (serializable!)
  filter:
    and:
      - { "!!": { var: "text" } }
      - { "!": { var: "from.is_bot" } }
      - { "in": [{ var: "chat.type" }, ["group", "supergroup"]] }

  requiredScopes:
    - messages:read

  # Uses generic builder with this field mapping
  fieldMapping:
    userId: from.id
    userName:
      path: from.username
      fallbacks:
        - from.first_name
        - from.id
    channelId: chat.id
    messageText: text
    messageId: message_id
    custom:
      chatType: chat.type
      forwardOrigin: forward_origin

egress:
  method: sendText
  requiredScopes:
    - messages:write

  # Field mapping for egress (symmetric with ingress!)
  fieldMapping:
    chat_id: egress.channel
    text:
      extract: text
      from:
        - message.text
        - annotations[?kind=='response'].value | [0]
    parse_mode: "Markdown"  # Static value
    disable_web_page_preview: true
```

**Loading Configuration**:

```typescript
// src/services/ingress/core/config-registry.ts (NEW)

export class ConfigBasedEventRegistry {
  private events: Map<string, EventDefinition> = new Map();
  private platformMappings: Map<string, Map<string, PlatformEventMapping>> = new Map();

  async load(configPath: string = './config'): Promise<void> {
    // Load event definitions
    const eventFiles = await glob(`${configPath}/events/*.yaml`);
    for (const file of eventFiles) {
      const eventDef = await this.loadEventDefinition(file);
      this.events.set(eventDef.type, eventDef);
    }

    // Load platform mappings
    const platforms = await fs.readdir(`${configPath}/platforms`);
    for (const platform of platforms) {
      const mappingFiles = await glob(`${configPath}/platforms/${platform}/*.yaml`);
      const platformMap = new Map<string, PlatformEventMapping>();

      for (const file of mappingFiles) {
        const mapping = await this.loadPlatformMapping(file);
        platformMap.set(mapping.eventType, mapping);
      }

      this.platformMappings.set(platform, platformMap);
    }

    this.logger.info('config-registry.loaded', {
      events: this.events.size,
      platforms: this.platformMappings.size
    });
  }

  private async loadEventDefinition(file: string): Promise<EventDefinition> {
    const yaml = await fs.readFile(file, 'utf-8');
    const config = YAML.parse(yaml);

    return {
      type: config.type,
      version: config.version,
      category: config.category,
      description: config.description,
      schema: config.schema ? await this.loadSchema(config.schema.$ref) : {}
    };
  }

  private async loadPlatformMapping(file: string): Promise<PlatformEventMapping> {
    const yaml = await fs.readFile(file, 'utf-8');
    const config = YAML.parse(yaml);

    return {
      platform: config.platform,
      eventType: config.eventType,
      ingress: config.ingress ? {
        eventName: config.ingress.eventName,
        filter: config.ingress.filter ? this.compileFilter(config.ingress.filter) : undefined,
        requiredScopes: config.ingress.requiredScopes,
        fieldMapping: config.ingress.fieldMapping
      } : undefined,
      egress: config.egress ? {
        method: config.egress.method,
        requiredScopes: config.egress.requiredScopes,
        fieldMapping: config.egress.fieldMapping
      } : undefined
    };
  }

  private compileFilter(filterConfig: any): (evt: any) => boolean {
    // Compile JSONLogic filter to JavaScript function
    return (evt: any) => jsonLogic.apply(filterConfig, evt);
  }

  // Query methods
  findByType(eventType: string): EventDefinition | undefined {
    return this.events.get(eventType);
  }

  findPlatformMapping(platform: string, eventType: string): PlatformEventMapping | undefined {
    return this.platformMappings.get(platform)?.get(eventType);
  }

  findByPlatformEvent(platform: string, platformEventName: string): Array<{
    eventDef: EventDefinition;
    mapping: PlatformEventMapping;
  }> {
    const results: Array<{ eventDef: EventDefinition; mapping: PlatformEventMapping }> = [];
    const platformMap = this.platformMappings.get(platform);

    if (!platformMap) return results;

    for (const [eventType, mapping] of platformMap) {
      if (mapping.ingress?.eventName === platformEventName) {
        const eventDef = this.events.get(eventType);
        if (eventDef) {
          results.push({ eventDef, mapping });
        }
      }
    }

    return results;
  }

  // Runtime reloading (for development)
  async reload(): Promise<void> {
    this.events.clear();
    this.platformMappings.clear();
    await this.load();
  }
}
```

**Benefits**:

1. **Plugin Architecture**: Package integrations as npm modules
```bash
npm install @bitbrat/integration-telegram
# Auto-discovered via package.json:
# "bitbrat": { "integration": "./config/platforms/telegram" }
```

2. **No Code Changes**: Add Telegram without touching Discord
3. **Runtime Reloading**: Update configs without redeploying
4. **Validation**: JSON Schema validation for all configs
5. **Testing**: Load test configs for integration tests
6. **Version Control**: Track platform changes independently

---

### 3.5 Translation Engine Design

**Purpose**: Bidirectional translation between internal events and platform-specific payloads.

**Key Feature**: Automatically uses default builders when no custom builder is specified, falling back to platform-specific defaults with field mapping.

```typescript
// src/services/ingress/core/translation-engine.ts (NEW)

export class TranslationEngine {
  // 🆕 Platform default builders registry
  private defaultBuilders: Map<string, (ctx: any) => InternalEventV2> = new Map([
    ['discord', buildDiscordDefaultEnvelope],
    ['slack', buildSlackDefaultEnvelope],
    ['twitch', buildTwitchDefaultEnvelope]
  ]);

  constructor(
    private readonly eventRegistry: EventRegistry,
    private readonly logger: Logger
  ) {}

  /**
   * Inbound translation: Platform event → InternalEventV2
   * 🆕 Uses custom builder if provided, otherwise falls back to platform default
   */
  async translateInbound(
    platform: string,
    platformEventType: string,
    platformEvent: any
  ): Promise<InternalEventV2 | null> {
    // Find event definition by platform event type
    const eventDef = this.eventRegistry.findByPlatformEvent(platform, platformEventType);

    if (!eventDef) {
      this.logger.warn('translation.inbound.unknown_event', { platform, platformEventType });
      return null;
    }

    const mapping = eventDef.platforms.find(p => p.platform === platform);
    if (!mapping?.ingress) {
      this.logger.error('translation.inbound.no_mapping', { platform, eventType: eventDef.type });
      return null;
    }

    // Apply filter (if specified)
    if (mapping.ingress.filter && !mapping.ingress.filter(platformEvent)) {
      this.logger.debug('translation.inbound.filtered', { platform, eventType: eventDef.type });
      return null;
    }

    let internalEvent: InternalEventV2;

    // 🔑 Use custom builder if provided, otherwise use platform default
    if (mapping.ingress.builder) {
      // Custom builder for complex events
      this.logger.debug('translation.inbound.custom_builder', {
        platform,
        eventType: eventDef.type
      });
      internalEvent = mapping.ingress.builder(platformEvent);
    } else {
      // Default builder with field mapping (90% of events)
      const defaultBuilder = this.defaultBuilders.get(platform);
      if (!defaultBuilder) {
        this.logger.error('translation.inbound.no_default_builder', { platform });
        return null;
      }

      this.logger.debug('translation.inbound.default_builder', {
        platform,
        eventType: eventDef.type,
        hasFieldMapping: !!mapping.ingress.fieldMapping
      });

      internalEvent = defaultBuilder({
        eventType: eventDef.type,       // Pass event type from registry
        platformEvent,
        fieldMapping: mapping.ingress.fieldMapping
      });
    }

    // Validate against schema
    if (eventDef.schema) {
      const valid = this.validateEvent(internalEvent, eventDef.schema);
      if (!valid) {
        this.logger.error('translation.inbound.schema_validation_failed', {
          platform,
          eventType: eventDef.type
        });
        return null;
      }
    }

    return internalEvent;
  }

  /**
   * Outbound translation: InternalEventV2 → Platform payload
   */
  async translateOutbound(
    event: InternalEventV2,
    targetPlatform: string
  ): Promise<{ method: string; payload: any } | null> {
    const eventDef = this.eventRegistry.findByType(event.type);

    if (!eventDef) {
      logger.error('translation.outbound.unknown_type', { type: event.type });
      return null;
    }

    const mapping = eventDef.platforms.find(p => p.platform === targetPlatform);
    if (!mapping?.egress) {
      logger.warn('translation.outbound.platform_unsupported', {
        type: event.type,
        platform: targetPlatform
      });
      return null;
    }

    // Translate to platform payload
    const payload = await mapping.egress.translator(event);

    return {
      method: mapping.egress.method,
      payload
    };
  }
}
```

**Usage in IntegrationBit**:

```typescript
// src/common/integration-bit.ts (MODIFIED)

private async processEgress(event: InternalEventV2): Promise<void> {
  const platform = event.egress?.connector;
  const connector = this.connectorManager.getConnectorByPlatform(platform);

  // NEW: Use translation engine
  const translation = await this.translationEngine.translateOutbound(event, platform);

  if (!translation) {
    logger.warn('integration-bit.egress-translation-failed', {
      type: event.type,
      platform
    });
    return;
  }

  // Call platform-specific method
  const method = (connector as any)[translation.method];
  if (typeof method === 'function') {
    await method.call(connector, ...Object.values(translation.payload));
  } else {
    logger.error('integration-bit.egress-method-not-found', {
      method: translation.method,
      platform
    });
  }
}
```

---

### 3.5 Subscription Manager Design

**Purpose**: Runtime management of event subscriptions and permissions.

```typescript
// src/services/ingress/core/subscription-manager.ts (NEW)

export interface Subscription {
  id: string;
  platform: string;
  eventType: string;
  target: string;  // Channel ID, user ID, etc.
  status: 'active' | 'pending' | 'failed';
  createdAt: string;
  metadata?: Record<string, any>;
}

export class SubscriptionManager {
  constructor(
    private readonly eventRegistry: EventRegistry,
    private readonly connectorManager: ConnectorManager,
    private readonly documentStore: any  // For persistence
  ) {}

  /**
   * Subscribe to an external event
   */
  async subscribe(
    platform: string,
    eventType: string,
    target: string,
    opts?: { validatePermissions?: boolean }
  ): Promise<Subscription> {
    // Validate event type
    const eventDef = this.eventRegistry.findByType(eventType);
    if (!eventDef) {
      throw new Error(`Unknown event type: ${eventType}`);
    }

    // Check platform support
    const mapping = eventDef.platforms.find(p => p.platform === platform);
    if (!mapping?.ingress) {
      throw new Error(`Platform ${platform} does not support event ${eventType}`);
    }

    // Validate permissions/scopes
    if (opts?.validatePermissions && mapping.ingress.requiredScopes) {
      await this.validateScopes(platform, mapping.ingress.requiredScopes);
    }

    // Create subscription record
    const subscription: Subscription = {
      id: randomUUID(),
      platform,
      eventType,
      target,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    // Persist subscription
    await this.documentStore.set(`subscriptions/${subscription.id}`, subscription);

    // Delegate to platform-specific subscription logic
    const connector = this.connectorManager.getConnectorByPlatform(platform);
    if ('subscribe' in connector && typeof (connector as any).subscribe === 'function') {
      await (connector as any).subscribe(eventType, target);
    }

    subscription.status = 'active';
    await this.documentStore.set(`subscriptions/${subscription.id}`, subscription);

    return subscription;
  }

  /**
   * Unsubscribe from an external event
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = await this.documentStore.get(`subscriptions/${subscriptionId}`);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    // Delegate to platform
    const connector = this.connectorManager.getConnectorByPlatform(subscription.platform);
    if ('unsubscribe' in connector && typeof (connector as any).unsubscribe === 'function') {
      await (connector as any).unsubscribe(subscription.eventType, subscription.target);
    }

    // Remove subscription record
    await this.documentStore.delete(`subscriptions/${subscriptionId}`);
  }

  /**
   * List all active subscriptions
   */
  async listSubscriptions(filter?: { platform?: string; eventType?: string }): Promise<Subscription[]> {
    const allSubs = await this.documentStore.query('subscriptions');

    if (!filter) return allSubs;

    return allSubs.filter(sub =>
      (!filter.platform || sub.platform === filter.platform) &&
      (!filter.eventType || sub.eventType === filter.eventType)
    );
  }

  private async validateScopes(platform: string, requiredScopes: string[]): Promise<void> {
    // TODO: Query OAuth token scopes and validate
    // For now, log a warning
    logger.warn('subscription-manager.scope-validation-not-implemented', {
      platform,
      requiredScopes
    });
  }
}
```

**MCP Integration**:

```typescript
// src/apps/ingress-egress-service.ts (MODIFIED)

export class IngressEgressServer extends IntegrationBit {
  constructor() {
    super(config);

    // Register MCP tools for subscription management
    this.registerTool('subscribe_to_event', 'Subscribe to an external platform event', subscribeSchema,
      async ({ platform, eventType, target }) => {
        const sub = await this.subscriptionManager.subscribe(platform, eventType, target);
        return { subscriptionId: sub.id, status: 'active' };
      }
    );

    this.registerTool('unsubscribe_from_event', 'Unsubscribe from an external platform event', unsubscribeSchema,
      async ({ subscriptionId }) => {
        await this.subscriptionManager.unsubscribe(subscriptionId);
        return { status: 'unsubscribed' };
      }
    );

    this.registerTool('list_subscriptions', 'List all active event subscriptions', listSchema,
      async ({ platform, eventType }) => {
        const subs = await this.subscriptionManager.listSubscriptions({ platform, eventType });
        return { subscriptions: subs };
      }
    );
  }
}
```

---

## Developer Experience

### 4.1 Integration Levels

**Purpose**: Progressive enhancement path from "Hello World" to full bidirectional integration.

#### Level 0: Connector Setup (5 minutes)

**Goal**: Create minimal connector structure

```bash
npm run brat -- integration create telegram
```

**Generated files**:
```
src/services/ingress/telegram/
  connector-adapter.ts      # Minimal IngressConnector
  telegram-client.ts         # Platform SDK wrapper
  connector-adapter.test.ts  # Test skeleton
```

**Minimal connector**:
```typescript
export class TelegramConnectorAdapter implements IngressConnector {
  constructor(private client: TelegramClient) {}

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  getSnapshot(): ConnectorSnapshot {
    return {
      platform: 'telegram',
      state: this.client.isConnected() ? 'connected' : 'disconnected',
      metadata: {}
    };
  }
}
```

#### Level 1: Ingress (10 minutes)

**Goal**: Receive chat messages from platform

**Add platform mapping** (`config/platforms/telegram/chat-message.v1.yaml`):
```yaml
platform: telegram
eventType: chat.message.v1
ingress:
  eventName: message
  fieldMapping:
    userId: from.id
    userName: from.username
    channelId: chat.id
    messageText: text
    messageId: message_id
```

**Register with IntegrationBit**:
```typescript
// src/apps/ingress-egress-service.ts
import { createTelegramConnector } from '../services/ingress/telegram';

const config: IntegrationBitConfig = {
  connectors: [
    { name: 'telegram', factory: createTelegramConnector, enabled: true }
  ]
};
```

**Test**:
```bash
npm run brat -- integration test telegram \
  --event message \
  --fixture ./test/fixtures/telegram-message.json

# Output:
# ✅ Normalized to InternalEventV2
# ✅ Event type: chat.message.v1
# ✅ User ID extracted: 123456789
# ✅ User name extracted: john_doe
# ✅ Channel ID extracted: -1001234567890
```

#### Level 2: Egress (30 minutes)

**Goal**: Send messages back to platform

**Implement EgressConnector**:
```typescript
export class TelegramConnectorAdapter
  implements IngressConnector, EgressConnector {

  async sendText(text: string, chatId: string): Promise<void> {
    await this.client.sendMessage(chatId, text);
  }
}
```

**Add egress mapping** (`config/platforms/telegram/chat-message.v1.yaml`):
```yaml
egress:
  method: sendText
  fieldMapping:
    chat_id: egress.channel
    text: message.text
```

**Test**:
```bash
npm run brat -- integration test-egress telegram \
  --event chat.message.v1 \
  --fixture ./test/fixtures/internal-event-v2.json

# Output:
# ✅ Translated to platform payload
# ✅ Method: sendText
# ✅ Parameters: { chat_id: "-1001234567890", text: "Hello from BitBrat!" }
```

#### Level 3: Webhooks (1 hour)

**Goal**: Receive events via HTTP webhooks (optional - some platforms need this)

**Implement WebhookConnector**:
```typescript
export class TelegramConnectorAdapter
  implements IngressConnector, EgressConnector, WebhookConnector {

  verifySignature(req: WebhookRequest): boolean {
    const secret = crypto.createHash('sha256')
      .update(this.config.BOT_TOKEN)
      .digest();
    const checkString = [
      req.headers['x-telegram-bot-api-secret-token']
    ].join('\n');

    return crypto.timingSafeEqual(secret, Buffer.from(checkString));
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    // CRITICAL: Return 200 OK within 3 seconds
    setImmediate(async () => {
      await this.processUpdate(req.body);
    });

    return { status: 200, body: { ok: true } };
  }
}
```

#### Level 4: Full Bidirectional (2 hours)

**Goal**: Support DMs, reactions, rich content

**Add DM support**:
```yaml
# config/platforms/telegram/dm-message.v1.yaml
platform: telegram
eventType: dm.message.v1
ingress:
  eventName: message
  filter:
    "==": [{ var: "chat.type" }, "private"]
  fieldMapping:
    userId: from.id
    userName: from.username
    channelId: chat.id
    messageText: text
egress:
  method: sendDM
  fieldMapping:
    chat_id: identity.external.id
    text: message.text
```

**Implement additional methods**:
```typescript
async sendDM(text: string, userId: string): Promise<void> {
  await this.client.sendMessage(userId, text);
}

async addReaction(messageId: string, emoji: string, chatId: string): Promise<void> {
  await this.client.setReaction(chatId, parseInt(messageId), emoji);
}
```

---

### 4.2 Adding Your First Integration

**Tutorial: Add Telegram in 10 Minutes**

**Step 1: Generate Connector**
```bash
npm run brat -- integration create telegram \
  --api-client "@telegraf/telegraf" \
  --docs "https://core.telegram.org/bots/api"
```

**Step 2: Configure Event Mapping**
```bash
# Create config/platforms/telegram/chat-message.v1.yaml
cat > config/platforms/telegram/chat-message.v1.yaml <<EOF
platform: telegram
eventType: chat.message.v1
ingress:
  eventName: message
  filter:
    and:
      - { "!!": { var: "text" } }
      - { "!": { var: "from.is_bot" } }
  fieldMapping:
    userId: from.id
    userName: from.username
    channelId: chat.id
    messageText: text
    messageId: message_id
egress:
  method: sendText
  fieldMapping:
    chat_id: egress.channel
    text: message.text
EOF
```

**Step 3: Implement Client Wrapper**
```typescript
// src/services/ingress/telegram/telegram-client.ts
import { Telegraf } from 'telegraf';

export class TelegramClient {
  private bot: Telegraf;

  constructor(token: string) {
    this.bot = new Telegraf(token);
  }

  async start(onMessage: (msg: any) => void): Promise<void> {
    this.bot.on('message', onMessage);
    await this.bot.launch();
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.bot.telegram.sendMessage(chatId, text);
  }

  isConnected(): boolean {
    return this.bot.botInfo !== undefined;
  }
}
```

**Step 4: Create Connector Adapter**
```typescript
// src/services/ingress/telegram/connector-adapter.ts
export class TelegramConnectorAdapter implements IngressConnector, EgressConnector {
  constructor(
    private client: TelegramClient,
    private publisher: Publisher
  ) {}

  async start(): Promise<void> {
    await this.client.start((msg) => {
      // Translation engine handles normalization automatically
      this.publisher.publish(msg);
    });
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async sendText(text: string, chatId: string): Promise<void> {
    await this.client.sendMessage(chatId, text);
  }

  getSnapshot(): ConnectorSnapshot {
    return {
      platform: 'telegram',
      state: this.client.isConnected() ? 'connected' : 'disconnected',
      metadata: {}
    };
  }
}

// Factory function
export function createTelegramConnector(config: IConfig): TelegramConnectorAdapter {
  const client = new TelegramClient(config.TELEGRAM_BOT_TOKEN);
  return new TelegramConnectorAdapter(client, publisher);
}
```

**Step 5: Register Connector**
```typescript
// src/apps/ingress-egress-service.ts
import { createTelegramConnector } from '../services/ingress/telegram';

const integrationConfig: IntegrationBitConfig = {
  connectors: [
    // Existing connectors
    { name: 'discord', factory: createDiscordConnector, enabled: true },
    { name: 'slack', factory: createSlackConnector, enabled: true },

    // New connector
    { name: 'telegram', factory: createTelegramConnector, enabled: true }
  ]
};
```

**Step 6: Test**
```bash
# Validate configuration
npm run brat -- integration validate telegram

# Test with fixture
npm run brat -- integration test telegram \
  --event message \
  --fixture ./test/fixtures/telegram-message.json

# Run local integration test
TELEGRAM_BOT_TOKEN=your_token npm run local
```

**Done!** Telegram messages now flow through BitBrat's event pipeline.

---

### 4.3 Testing & Validation

#### CLI Validation Tool

**Validate Integration**:
```bash
npm run brat -- integration validate telegram

# Output:
# ✅ Platform configuration found: config/platforms/telegram/
# ✅ Event mappings: 3 found
#    - chat.message.v1
#    - dm.message.v1
#    - typing.start.v1
# ✅ All field paths valid
# ✅ Required scopes documented
# ⚠️  Warning: No webhook configuration (optional)
# ❌ Missing egress method: sendReaction (required for reaction.add.v1)
```

**Test Event Normalization**:
```bash
npm run brat -- integration test telegram \
  --event message \
  --fixture ./test/fixtures/telegram-message.json \
  --verbose

# Output:
# ✅ Fixture loaded: 847 bytes
# ✅ Event matched: chat.message.v1
# ✅ Filter passed
# ✅ Generic builder used
#
# Field Extraction:
#   userId: 123456789 (from.id)
#   userName: john_doe (from.username)
#   channelId: -1001234567890 (chat.id)
#   messageText: "Hello world!" (text)
#   messageId: 42 (message_id)
#
# ✅ Normalized to InternalEventV2:
# {
#   "v": "2",
#   "type": "chat.message.v1",
#   "ingress": {
#     "connector": "telegram",
#     "platformUserId": "123456789",
#     "platformUserName": "john_doe",
#     "channel": "-1001234567890"
#   },
#   "message": {
#     "id": "42",
#     "text": "Hello world!"
#   }
# }
```

**Test Egress Translation**:
```bash
npm run brat -- integration test-egress telegram \
  --event chat.message.v1 \
  --fixture ./test/fixtures/internal-event-v2.json

# Output:
# ✅ Event type: chat.message.v1
# ✅ Platform: telegram
# ✅ Egress mapping found
#
# Field Mapping:
#   chat_id: "-1001234567890" (from egress.channel)
#   text: "Response from LLM" (from message.text)
#
# ✅ Translated to platform payload:
# Method: sendText
# Arguments:
#   - chat_id: "-1001234567890"
#   - text: "Response from LLM"
```

#### Integration Test Harness

```typescript
// src/services/ingress/telegram/connector-adapter.test.ts

describe('TelegramConnectorAdapter', () => {
  let adapter: TelegramConnectorAdapter;
  let mockClient: jest.Mocked<TelegramClient>;
  let mockPublisher: jest.Mocked<Publisher>;

  beforeEach(() => {
    mockClient = createMockTelegramClient();
    mockPublisher = createMockPublisher();
    adapter = new TelegramConnectorAdapter(mockClient, mockPublisher);
  });

  describe('ingress', () => {
    it('should normalize chat messages using generic builder', async () => {
      const fixture = await loadFixture('telegram-message.json');

      await adapter.start();
      mockClient.emit('message', fixture);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          v: '2',
          type: 'chat.message.v1',
          ingress: expect.objectContaining({
            connector: 'telegram',
            platformUserId: '123456789'
          })
        })
      );
    });
  });

  describe('egress', () => {
    it('should translate InternalEventV2 to sendMessage call', async () => {
      await adapter.sendText('Hello', '-1001234567890');

      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        '-1001234567890',
        'Hello'
      );
    });
  });
});
```

#### Fixture Generator

```bash
# Generate fixture from live event
npm run brat -- integration capture telegram \
  --output ./test/fixtures/telegram-message.json \
  --sanitize

# Generates:
# {
#   "update_id": 12345,
#   "message": {
#     "message_id": 42,
#     "from": {
#       "id": 123456789,
#       "username": "john_doe",
#       "first_name": "John",
#       "is_bot": false
#     },
#     "chat": {
#       "id": -1001234567890,
#       "type": "group",
#       "title": "Test Group"
#     },
#     "text": "Hello world!",
#     "date": 1704067200
#   }
# }
```

---

## Phased Migration Plan

### Phase 0: Developer Experience Foundation (Week 1-2) **PRIORITY 1**

**Goal**: Build developer-first infrastructure - generic builder + config-based registry

**Why First**: Makes ALL subsequent phases easier. Adding Telegram becomes trivial once this is done.

**Tasks**:
1. ✅ Implement generic envelope builder (`buildGenericEnvelope`)
   - Single builder for ALL platforms
   - Supports field mapping with fallbacks
   - Handles platform-specific event wrappers
2. ✅ Create config-based event registry (`ConfigBasedEventRegistry`)
   - Load events from `config/events/*.yaml`
   - Load platform mappings from `config/platforms/{platform}/*.yaml`
   - JSONLogic filter compilation
   - Runtime reloading support
3. ✅ Migrate existing events to YAML
   - `config/events/chat-message.v1.yaml`
   - `config/platforms/discord/chat-message.v1.yaml`
   - `config/platforms/slack/chat-message.v1.yaml`
   - `config/platforms/twitch/chat-message.v1.yaml`
4. ✅ Implement egress field mapping
   - Symmetric with ingress
   - Static value support
   - JMESPath extraction support
5. ✅ Create CLI validation tools
   - `npm run brat -- integration validate <platform>`
   - `npm run brat -- integration test <platform>`
   - `npm run brat -- integration test-egress <platform>`
   - `npm run brat -- integration capture <platform>` (fixture generator)
6. ✅ Create integration scaffold generator
   - `npm run brat -- integration create <platform>`

**Deliverables**:
- `src/services/ingress/core/generic-envelope-builder.ts` (NEW)
- `src/services/ingress/core/config-registry.ts` (NEW)
- `src/services/ingress/core/egress-translator.ts` (NEW)
- `config/events/*.yaml` (event definitions)
- `config/platforms/{discord,slack,twitch}/*.yaml` (platform mappings)
- `tools/brat/src/oclif-commands/integration/*.ts` (CLI commands)
- Documentation: `documentation/guides/adding-integrations.md`

**Key Benefit**: Add Telegram in 10 minutes (was: several hours). Add new event type with 5 lines of YAML (was: 60+ lines of TypeScript).

**Success Criteria**:
- ✅ Existing Discord/Slack/Twitch work without code changes (config migration only)
- ✅ CLI validation catches all config errors
- ✅ Test harness runs without deploying

**Risk**: Medium - Requires careful migration of existing platform code. Mitigation: Feature flag for config-based vs code-based registry.

---

### Phase 1: Bidirectional DM Support (Week 3-4)

**Goal**: Implement full DM capabilities as pilot for broader patterns.

#### Phase 1A: DM Ingress

**Tasks**:
1. ✅ Add DM detection to Discord ingress client
   - Listen to DM channels (remove guild filter)
   - Set `event.type = 'dm.message.v1'` for DMs
2. ✅ Add DM detection to Slack ingress client
   - Check for `channel.startsWith('D')`
   - Set `event.type = 'dm.message.v1'` for DMs
3. ✅ Add DM support to Twitch EventSub
   - Subscribe to whisper events
   - Normalize to `dm.message.v1`
4. ✅ Register `dm.message.v1` in event registry

**Deliverables**:
- Updated ingress clients with DM detection
- DM event definition in registry
- Tests for DM ingress

#### Phase 1B: DM Egress

**Tasks**:
1. ✅ Implement `sendDM()` for Discord
   - `users.fetch()` → `createDM()` → `send()`
2. ✅ Implement `sendDM()` for Slack
   - `conversations.open()` → `chat.postMessage()`
3. ✅ Rename Twitch `sendWhisper()` → `sendDM()` (keep alias)
4. ✅ Update `IntegrationBit.processEgress()` to route DMs
   - Check `event.type` or `event.egress.messageType`
   - Call `sendDM()` for DM events

**Deliverables**:
- DM egress methods on all connectors
- Smart routing in `IntegrationBit`
- Tests for DM egress

**Success Criteria**:
- ✅ Can receive DMs on all platforms
- ✅ Can send DMs to users on all platforms
- ✅ DMs differentiated from channel messages
- ✅ 90%+ test coverage

---

### Phase 2: Translation Engine Integration (Week 5-6)

**Goal**: Replace hardcoded egress logic with translation engine.

**Tasks**:
1. ✅ Implement `TranslationEngine.translateOutbound()`
2. ✅ Register chat and DM events in registry with translations
3. ✅ Refactor `IntegrationBit.processEgress()` to use translation engine
4. ✅ Add translation for moderation actions (`banUser`)
5. ✅ Add validation and error handling

**Deliverables**:
- Working translation engine
- Refactored egress routing
- Event registry with 5+ event types

**Success Criteria**:
- ✅ All existing egress functionality preserved
- ✅ New events can be added declaratively
- ✅ Platform-specific code isolated in registry

---

### Phase 3: Reaction Support (Week 7-8)

**Goal**: Implement bidirectional reaction support as next event type.

#### Phase 3A: Reaction Ingress

**Tasks**:
1. ✅ Discord: Listen to `messageReactionAdd` events
2. ✅ Slack: Subscribe to `reaction_added` events
3. ✅ Normalize to `reaction.add.v1`
4. ✅ Register in event registry

#### Phase 3B: Reaction Egress

**Tasks**:
1. ✅ Implement `addReaction()` for Discord
2. ✅ Implement `addReaction()` for Slack
3. ✅ Add reaction translation to registry
4. ✅ Update egress routing

**Deliverables**:
- Bidirectional reaction support for Discord/Slack
- Tests for reaction ingress/egress

**Success Criteria**:
- ✅ Can receive reactions on messages
- ✅ Can add reactions to messages
- ✅ Twitch gracefully skips (no reaction support)

---

### Phase 4: Thread Support (Week 9-10)

**Goal**: Implement thread-aware messaging.

**Tasks**:
1. ✅ Detect thread messages on ingress
2. ✅ Add `event.thread` field to schema
3. ✅ Implement `sendThreadReply()` for platforms that support it
4. ✅ Update egress routing to handle threads

**Deliverables**:
- Thread detection on ingress
- Thread-aware egress
- Tests

---

### Phase 5: Subscription Manager (Week 11-12)

**Goal**: Runtime subscription management.

**Tasks**:
1. ✅ Implement `SubscriptionManager`
2. ✅ Add persistence for subscription state
3. ✅ Expose MCP tools for subscription management
4. ✅ Add scope validation
5. ✅ Add webhook lifecycle management

**Deliverables**:
- Working subscription manager
- MCP tools for subscription control
- Documentation

**Success Criteria**:
- ✅ Can subscribe to events at runtime
- ✅ Subscriptions persist across restarts
- ✅ Scope validation prevents unauthorized subscriptions

---

### Phase 6: Comprehensive Event Coverage (Week 13-16)

**Goal**: Add remaining event types.

**Event Types**:
- Presence updates (`presence.update.v1`)
- User join/leave (`user.join.v1`, `user.leave.v1`)
- Typing indicators (`typing.start.v1`)
- Stream events (`stream.online.v1`, `stream.offline.v1`)
- Moderation events (`moderation.timeout.v1`, `moderation.delete.v1`)

---

## Technical Specifications

### 5.1 Event Schema Standardization

**Base Event Schema** (all events extend this):

```typescript
interface BaseInternalEvent {
  v: '2';
  type: InternalEventType;
  correlationId: string;
  traceId: string;
  ingress: Ingress;
  identity: Identity;
  egress: Egress;
  routing: Routing;
  qos?: QOSV1;
  metadata?: Record<string, any>;
}
```

**Chat Message Event**:

```typescript
interface ChatMessageEvent extends BaseInternalEvent {
  type: 'chat.message.v1';
  message: {
    id: string;
    text: string;
    rawPlatformPayload: any;
  };
}
```

**DM Event**:

```typescript
interface DirectMessageEvent extends BaseInternalEvent {
  type: 'dm.message.v1';
  message: {
    id: string;
    text: string;
    rawPlatformPayload: any;
  };
  dm: {
    userId: string;
    conversationId?: string;  // Platform-specific
  };
}
```

**Reaction Event**:

```typescript
interface ReactionEvent extends BaseInternalEvent {
  type: 'reaction.add.v1' | 'reaction.remove.v1';
  reaction: {
    messageId: string;
    userId: string;
    emoji: string;
    emojiId?: string;  // For custom emojis
    rawPlatformPayload: any;
  };
}
```

---

### 5.2 Connector Interface Extensions

**Updated `EgressConnector`**:

```typescript
export interface EgressConnector {
  // Text messaging (existing)
  sendText(text: string, target?: string): Promise<void>;

  // DM support (NEW)
  sendDM?(text: string, userId: string): Promise<void>;

  // Reaction support (NEW)
  addReaction?(messageId: string, emoji: string, channelId?: string): Promise<void>;
  removeReaction?(messageId: string, emoji: string, channelId?: string): Promise<void>;

  // Thread support (NEW)
  sendThreadReply?(text: string, threadId: string, channelId?: string): Promise<void>;

  // Rich content (NEW)
  sendRichMessage?(content: RichContent, target?: string): Promise<void>;

  // Moderation (existing + extended)
  banUser?(platformUserId: string, reason?: string): Promise<void>;
  timeoutUser?(platformUserId: string, durationSeconds: number, reason?: string): Promise<void>;
  deleteMessage?(messageId: string, channelId?: string): Promise<void>;

  // Capability query (NEW)
  supportsEvent?(eventType: string): boolean;
}
```

**New `IngressConnector` Extensions**:

```typescript
export interface IngressConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSnapshot(): ConnectorSnapshot;
  getMetadata?(): ConnectorMetadata;

  // Dynamic subscription (NEW)
  subscribe?(eventType: string, target: string): Promise<void>;
  unsubscribe?(eventType: string, target: string): Promise<void>;
  listSubscriptions?(): Promise<Subscription[]>;
}
```

---

### 5.3 Configuration Changes

**New Environment Variables**:

```bash
# Event gateway configuration
ENABLE_EVENT_GATEWAY=true
EVENT_REGISTRY_PATH=./config/event-registry.json

# Subscription management
ENABLE_DYNAMIC_SUBSCRIPTIONS=true
SUBSCRIPTION_STORE=postgres  # or firestore

# Feature flags
ENABLE_DM_SUPPORT=true
ENABLE_REACTION_SUPPORT=true
ENABLE_THREAD_SUPPORT=true
```

---

## Risk Assessment

### High Risk

**1. Breaking Changes to Egress Flow**
- **Risk**: Refactoring `processEgress()` could break existing functionality
- **Mitigation**:
  - Feature flag for new translation engine
  - Comprehensive regression testing
  - Gradual rollout per platform
  - Fallback to old logic if translation fails

**2. OAuth Scope Requirements**
- **Risk**: New event types may require additional OAuth scopes users haven't granted
- **Mitigation**:
  - Scope validation before subscription
  - Graceful degradation if scopes missing
  - User-friendly error messages with re-auth instructions
  - Documentation of required scopes per event type

### Medium Risk

**3. Platform API Rate Limits**
- **Risk**: More event types = more API calls = hitting rate limits
- **Mitigation**:
  - Rate limiting layer in connectors
  - Backoff/retry logic
  - Subscription quotas per platform

**4. Event Schema Versioning**
- **Risk**: Breaking changes to event schemas as platform APIs evolve
- **Mitigation**:
  - Versioned event types (`v1`, `v2`, etc.)
  - Schema validation with fallback
  - Migration guides for version upgrades

### Low Risk

**5. DM Privacy/Security**
- **Risk**: Accidentally logging DM content
- **Mitigation**:
  - Sanitize DM content in logs
  - DM-specific logging policies
  - Audit trail for DM access

---

## Appendices

### Appendix A: Event Type Taxonomy

```
chat.*              # Chat-related events
  - chat.message.v1
  - chat.command.v1
  - chat.typing.v1

dm.*                # Direct messages
  - dm.message.v1
  - dm.typing.v1

reaction.*          # Message reactions
  - reaction.add.v1
  - reaction.remove.v1

presence.*          # User presence
  - presence.update.v1
  - presence.online.v1
  - presence.offline.v1

moderation.*        # Moderation actions
  - moderation.ban.v1
  - moderation.timeout.v1
  - moderation.delete.v1

stream.*            # Stream events
  - stream.online.v1
  - stream.offline.v1
  - stream.title_change.v1

user.*              # User lifecycle
  - user.join.v1
  - user.leave.v1
  - user.first_message.v1
```

### Appendix B: Platform Capability Matrix

| Event Type | Discord | Slack | Twitch | Notes |
|------------|---------|-------|--------|-------|
| `chat.message.v1` | ✅ | ✅ | ✅ | All platforms |
| `dm.message.v1` | ✅ | ✅ | ✅ (whispers) | Full support |
| `reaction.add.v1` | ✅ | ✅ | ❌ | Twitch: no reactions |
| `presence.update.v1` | ✅ | ✅ | ⚠️ (online/offline only) | Limited on Twitch |
| `typing.start.v1` | ✅ | ✅ | ❌ | Twitch: no typing indicator |
| `thread.reply.v1` | ✅ | ✅ | ❌ | Twitch: no threads |
| `moderation.ban.v1` | ✅ | ❌ | ✅ | Slack: no ban API |
| `stream.online.v1` | ⚠️ (Go Live) | ❌ | ✅ | Discord partial |

---

## Conclusion

The path to a bidirectional event gateway is **achievable through phased implementation**, starting with DM support as a pilot.

**Key Success Factors**:
1. **Event Registry**: Central source of truth for event type mappings
2. **Translation Engine**: Bidirectional platform ↔ internal translation
3. **Incremental Migration**: Phase 1 (DM) validates patterns before broader rollout
4. **Feature Flags**: Safe rollout with fallback to existing behavior
5. **Comprehensive Testing**: 90%+ coverage for all new event paths

**Timeline**: 16 weeks (4 months) to full event gateway
**Immediate Focus**: Phase 1 (DM support) - 4 weeks

**Recommendation**: Proceed with Phase 1 implementation, using DM support to validate architectural patterns before scaling to all event types.

---

**Document Version**: 1.0
**Last Updated**: 2026-08-14T04:15:00Z
**Next Review**: After Phase 1 completion

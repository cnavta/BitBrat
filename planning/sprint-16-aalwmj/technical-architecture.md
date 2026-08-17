# Technical Architecture: Twitch EventSub Full Integration
## Sprint 16 (sprint-16-aalwmj)

**Architect**: Claude Code
**Owner**: christophernavta
**Created**: 2026-08-16
**Status**: Planning

---

## Executive Summary

This document provides a comprehensive technical architecture for implementing full Twitch EventSub integration in the BitBrat platform. The goal is to move beyond the current hardcoded 4-event limitation to a flexible, configuration-driven system that supports Twitch's complete EventSub catalog (90+ event types) with granular whitelisting capabilities.

**Current State**: 4 hardcoded EventSub subscriptions (channel.follow, channel.update, stream.online, stream.offline)
**Target State**: YAML-driven subscription management supporting all EventSub event types with runtime filtering

**Key Deliverables**:
1. YAML-based subscription configuration system
2. Dynamic subscription manager with runtime enable/disable
3. Extensible event builder registry for all EventSub event types
4. Enhanced observability for subscription health and event metrics
5. Backward-compatible migration path

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Twitch EventSub Catalog](#2-twitch-eventsub-catalog)
3. [Gap Analysis](#3-gap-analysis)
4. [Architecture Principles](#4-architecture-principles)
5. [Proposed Architecture](#5-proposed-architecture)
6. [Implementation Plan](#6-implementation-plan)
7. [Migration Strategy](#7-migration-strategy)
8. [Testing Strategy](#8-testing-strategy)
9. [Deployment Strategy](#9-deployment-strategy)
10. [Success Metrics](#10-success-metrics)
11. [Future Enhancements](#11-future-enhancements)

---

## 1. Current State Analysis

### 1.1 Architecture Overview

The BitBrat platform currently implements Twitch integration through a **dual-ingestion architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    TWITCH PLATFORM                          │
└────────────┬────────────────────────┬───────────────────────┘
             │                        │
      ┌──────▼──────┐          ┌──────▼────────┐
      │  IRC Chat   │          │   EventSub    │
      │  (PRIVMSG)  │          │  (System)     │
      └──────┬──────┘          └──────┬────────┘
             │                        │
    ┌────────▼─────────┐    ┌─────────▼──────────┐
    │ TwitchIrcClient  │    │ TwitchEventSubClient│
    │ (Twurple Chat)   │    │ (Twurple EventSub)  │
    └────────┬─────────┘    └─────────┬──────────┘
             │                        │
             └────────┬───────────────┘
                      │
              ┌───────▼────────┐
              │ ITwitchIngress │
              │  Publisher     │
              └───────┬────────┘
                      │
              ┌───────▼────────────────┐
              │ Message Bus (NATS)     │
              │ internal.ingress.v1    │
              └────────────────────────┘
```

**Key Components**:

#### A. TwitchIrcClient
- **Location**: `src/services/ingress/twitch/twitch-irc-client.ts` (629 lines)
- **Protocol**: WebSocket via Twurple Chat (`@twurple/chat`)
- **Purpose**: Real-time chat messages (PRIVMSG)
- **Events**: Chat messages, whispers/DMs (via Helix API)
- **Features**: Self-message filtering, `!debug`/`!trace` commands for authorized users

#### B. TwitchEventSubClient
- **Location**: `src/services/ingress/twitch/eventsub-client.ts` (310 lines)
- **Protocol**: WebSocket via Twurple EventSub (`@twurple/eventsub-ws`)
- **Purpose**: System/broadcaster events
- **Events**: 4 hardcoded subscriptions per channel
  - `channel.follow` (v2) - requires `moderator:read:followers` scope
  - `channel.update` (v2) - channel metadata changes
  - `stream.online` (v1) - stream started
  - `stream.offline` (v1) - stream ended

**Hardcoded Subscription Logic** (`eventsub-client.ts:111-259`):
```typescript
// channel.follow (v2)
const followSub = this.listener.onChannelFollow(userId, auth.userId, (event) => {
  const internalEvent = this.builder.buildFollow(event, { ... });
  this.publisher.publish(internalEvent);
});

// channel.update
const updateSub = this.listener.onChannelUpdate(userId, (event) => {
  const internalEvent = this.builder.buildUpdate(event, { ... });
  this.publisher.publish(internalEvent);
});

// stream.online
const onlineSub = this.listener.onStreamOnline(userId, async (evt) => {
  const stream = await evt.getStream();
  const internalEvent = this.builder.buildStreamOnline(event, { ... });
  this.publisher.publish(internalEvent);
  // Also publishes mutation: stream.state = 'on'
});

// stream.offline
const offlineSub = this.listener.onStreamOffline(userId, (event) => {
  const internalEvent = this.builder.buildStreamOffline(event, { ... });
  this.publisher.publish(internalEvent);
  // Also publishes mutation: stream.state = 'off'
});
```

#### C. EventSubEnvelopeBuilder
- **Location**: `src/services/ingress/twitch/eventsub-envelope-builder.ts` (280 lines)
- **Purpose**: Normalizes Twitch EventSub events to `InternalEventV2` envelopes
- **Current Builders**:
  - `buildFollow()` → `system.twitch.follow`
  - `buildUpdate()` → `system.twitch.update`
  - `buildStreamOnline()` → `system.stream.online`
  - `buildStreamOffline()` → `system.stream.offline`

**Envelope Structure**:
```typescript
{
  v: '2',
  type: 'system.twitch.follow',  // Internal event type
  correlationId: uuid(),
  traceId: uuid(),
  ingress: {
    ingressAt: ISO timestamp,
    source: 'ingress.twitch.eventsub',
    connector: 'twitch',
    channel: '#channelname'
  },
  identity: { external: { id, platform, displayName, metadata } },
  egress: { destination, connector, channel },
  externalEvent: {
    id: 'eventsub-{correlationId}',
    source: 'twitch.eventsub',
    kind: 'channel.follow',
    version: '2',
    createdAt: ISO timestamp,
    metadata: { ... },
    rawPayload: { ... }
  },
  routing: { stage: 'initial', slip: [], history: [] }
}
```

### 1.2 Current Limitations

#### Critical Gaps
1. **No Event Filtering**
   - All subscriptions hardcoded in `eventsub-client.ts`
   - No way to enable/disable specific event types
   - No per-channel subscription customization
   - Cannot add new EventSub events without code changes

2. **Limited EventSub Coverage**
   - Only 4 of 90+ available event types supported
   - Missing: subscriptions, raids, redemptions, hype trains, polls, predictions, bits, automod, moderation events, charity, etc.

3. **No Dynamic Subscription Management**
   - Subscriptions created at startup only
   - No runtime add/remove capability
   - No subscription list/status API
   - No graceful handling of scope changes

4. **Tight Coupling**
   - EventSub subscriptions hardcoded in client class
   - Limited extensibility (adding events requires code changes)
   - No declarative configuration (can't configure via YAML)

5. **Missing Observability**
   - No subscription health metrics exposed
   - No event rate/volume tracking
   - No error rate by subscription type
   - No latency measurements

### 1.3 Current Dependencies

**NPM Packages**:
- `@twurple/eventsub-ws`: EventSub WebSocket listener
- `@twurple/eventsub-base`: EventSub type definitions
- `@twurple/api`: Twitch API client (Helix)
- `@twurple/auth`: RefreshingAuthProvider for token management
- `@twurple/chat`: IRC client (separate from EventSub)

**Infrastructure**:
- NATS message bus (`internal.ingress.v1` topic)
- PostgreSQL (token storage via `TwitchCredentialsProvider`)
- Redis (idempotency tracking - Sprint 1)

**Configuration** (`architecture.yaml`):
- Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
- Environment: `DEBUG_USERS_TWITCH` (comma-separated authorized users)
- Feature flags: `twitchEnabled`, `twitchDisableConnect`, `ENABLE_CONFIG_REGISTRY`

---

## 2. Twitch EventSub Catalog

### 2.1 Complete Event Inventory

Twitch EventSub exposes **90+ event types** across 8 categories. Below is the comprehensive catalog extracted from official documentation.

#### Channel Events (60+ events)

**Automod Management** (4 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `automod.message.hold` | v1, v2 | `moderator:manage:automod` | Automod catches message for review |
| `automod.message.update` | v1, v2 | `moderator:manage:automod` | Automod queue message status changes |
| `automod.settings.update` | v1 | `moderator:read:automod_settings` | Broadcaster updates automod settings |
| `automod.terms.update` | v1 | `moderator:manage:automod` | Broadcaster updates automod terms |

**Channel Information** (2 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.update` | v2 | None | Category, title, labels, language changes |
| `channel.follow` | v2 | `moderator:read:followers` | New follower |

**Monetization & Bits** (3 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.bits.use` | v1 | `bits:read` | Bits used via cheers, Power-ups |
| `channel.cheer` | v1 | `bits:read` | User cheer events |
| `channel.custom_power_up_redemption.add` | v1 | `bits:read` | Custom Power-up redemption |

**Subscriptions** (4 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.subscribe` | v1 | `channel:read:subscriptions` | New subscription (excludes resubscriptions) |
| `channel.subscription.end` | v1 | `channel:read:subscriptions` | Subscription expires |
| `channel.subscription.gift` | v1 | `channel:read:subscriptions` | Gift subscription |
| `channel.subscription.message` | v1 | `channel:read:subscriptions` | Resubscription chat message |

**Chat Management** (8 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.chat.clear` | v1 | `user:read:chat` | Moderator clears all chat |
| `channel.chat.clear_user_messages` | v1 | `user:read:chat` | User's messages cleared |
| `channel.chat.message` | v1 | `user:read:chat` | Any chat message sent |
| `channel.chat.message_delete` | v1 | `user:read:chat` | Moderator removes specific message |
| `channel.chat.notification` | v1 | `user:read:chat` | In-chat events (subscriptions, raids) |
| `channel.chat_settings.update` | v1 | `user:read:chat` | Chat mode updates |
| `channel.chat.user_message_hold` | v1 | `user:read:chat` | User's message caught by automod |
| `channel.chat.user_message_update` | v1 | `user:read:chat` | User's message automod status changes |

**Moderation** (9 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.ban` | v1 | `channel:moderate` | User timeout or ban |
| `channel.unban` | v1 | `channel:moderate` | User unban |
| `channel.unban_request.create` | v1 | `moderator:read:unban_requests` | User creates unban request |
| `channel.unban_request.resolve` | v1 | `moderator:read:unban_requests` | Unban request resolved |
| `channel.moderate` | v1, v2 | `channel:moderate` | Moderator actions (v2 includes warnings) |
| `channel.moderator.add` | v1 | `channel:moderate` | Moderator privileges granted |
| `channel.moderator.remove` | v1 | `channel:moderate` | Moderator removal |
| `channel.warning.send` | v1 | Broadcaster/moderator | User receives warning |
| `channel.warning.acknowledge` | v1 | Broadcaster/moderator | User acknowledges warning |

**User Engagement** (3 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.raid` | v1 | None | Broadcaster raids another channel |
| `channel.vip.add` | v1 | `channel:moderate` | VIP addition |
| `channel.vip.remove` | v1 | `channel:moderate` | VIP removal |

**Community Features** (8 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.shared_chat.begin` | v1 | None | Channel enters shared chat session |
| `channel.shared_chat.update` | v1 | None | Active shared chat session changes |
| `channel.shared_chat.end` | v1 | None | Channel leaves shared chat |
| `channel.guest_star_session.begin` | beta | TBD | Host starts Guest Star |
| `channel.guest_star_session.end` | beta | TBD | Guest Star session ends |
| `channel.guest_star_guest.update` | beta | TBD | Guest/slot updates |
| `channel.guest_star_settings.update` | beta | TBD | Host preference updates |
| `channel.shoutout.create` | v1 | None | Broadcaster sends Shoutout |
| `channel.shoutout.receive` | v1 | None | Broadcaster receives Shoutout |
| `channel.suspicious_user.message` | v1 | TBD | Suspicious user chat message |
| `channel.suspicious_user.update` | v1 | TBD | Suspicious user updated |

**Points & Rewards** (7 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.channel_points_automatic_reward_redemption.add` | v1, v2 | `channel:read:redemptions` | Automatic reward redemption |
| `channel.channel_points_custom_reward.add` | v1 | `channel:manage:redemptions` | Custom reward creation |
| `channel.channel_points_custom_reward.update` | v1 | `channel:manage:redemptions` | Custom reward update |
| `channel.channel_points_custom_reward.remove` | v1 | `channel:manage:redemptions` | Custom reward removal |
| `channel.channel_points_custom_reward_redemption.add` | v1 | `channel:read:redemptions` | Custom reward redemption |
| `channel.channel_points_custom_reward_redemption.update` | v1 | `channel:read:redemptions` | Redemption status update |

**Polls & Predictions** (7 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.poll.begin` | v1 | None | Poll start |
| `channel.poll.progress` | v1 | None | Poll responses |
| `channel.poll.end` | v1 | None | Poll ends |
| `channel.prediction.begin` | v1 | None | Prediction start |
| `channel.prediction.progress` | v1 | None | Prediction participation |
| `channel.prediction.lock` | v1 | None | Prediction lock |
| `channel.prediction.end` | v1 | None | Prediction ends |

**Monetization** (8 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.ad_break.begin` | v1 | `channel:read:ads` | Midroll commercial break start |
| `channel.hype_train.begin` | v2 | None | Hype Train activation |
| `channel.hype_train.progress` | v2 | None | Hype Train progress |
| `channel.hype_train.end` | v2 | None | Hype Train ends |
| `channel.goal.begin` | v1 | None | Goal creation |
| `channel.goal.progress` | v1 | None | Goal progress updates |
| `channel.goal.end` | v1 | None | Goal ends |
| `channel.shield_mode.begin` | v1 | None | Shield Mode activation |
| `channel.shield_mode.end` | v1 | None | Shield Mode deactivation |

**Charity** (4 events)
| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `channel.charity_campaign.donate` | v1 | None | Charity donation received |
| `channel.charity_campaign.start` | v1 | None | Campaign launch |
| `channel.charity_campaign.progress` | v1 | None | Campaign progress changes |
| `channel.charity_campaign.stop` | v1 | None | Campaign ends |

#### Stream Events (2 events)

| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `stream.online` | v1 | None | Broadcaster goes live |
| `stream.offline` | v1 | None | Broadcaster goes offline |

#### User Events (4 events)

| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `user.authorization.grant` | v1 | None | User grants authorization |
| `user.authorization.revoke` | v1 | None | Authorization revocation |
| `user.update` | v1 | None | Account updates |
| `user.whisper.message` | v1 | `user:read:chat` | Whisper receipt |

#### Conduit Events (1 event)

| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `conduit.shard.disabled` | v1 | None | Internal EventSub notification |

#### Extension & Drop Events (2 events)

| Event Type | Version | Required Scope | Description |
|------------|---------|----------------|-------------|
| `extension.bits_transaction.create` | v1 | `bits:read` | Extension Bits transactions |
| `drop.entitlement.grant` | v1 | None | Drop entitlement granting |

### 2.2 Event Priority Classification

For implementation planning, classify events into priority tiers:

**Tier 1: High Value (Immediate Implementation)**
- ✅ `channel.follow` (already implemented)
- ✅ `channel.update` (already implemented)
- ✅ `stream.online` (already implemented)
- ✅ `stream.offline` (already implemented)
- `channel.raid` - community engagement
- `channel.subscribe` - monetization
- `channel.subscription.message` - resubscriptions
- `channel.subscription.gift` - gift subs
- `channel.cheer` - bits/cheers
- `channel.channel_points_custom_reward_redemption.add` - channel points
- `channel.hype_train.begin/progress/end` - hype trains
- `channel.poll.begin/end` - polls
- `channel.prediction.begin/end` - predictions

**Tier 2: Moderation & Safety (Critical for Production)**
- `channel.ban` - timeout/ban events
- `channel.unban` - unban events
- `channel.moderate` - moderator actions
- `automod.message.hold` - automod catches message
- `channel.chat.message_delete` - message deletion
- `channel.warning.send` - user warnings
- `channel.suspicious_user.message` - suspicious users

**Tier 3: Advanced Features (Nice-to-Have)**
- `channel.chat.message` - all chat messages (overlap with IRC)
- `channel.ad_break.begin` - ad breaks
- `channel.goal.begin/progress/end` - goals
- `channel.charity_campaign.*` - charity events
- `channel.shoutout.create/receive` - shoutouts
- `channel.vip.add/remove` - VIP management
- `channel.shared_chat.*` - shared chat sessions
- `user.whisper.message` - whispers (overlap with IRC)

**Tier 4: Beta/Experimental (Future)**
- `channel.guest_star_session.*` - Guest Star (beta)
- `extension.*` - extension events
- `drop.*` - drop events
- `conduit.*` - internal EventSub events

---

## 3. Gap Analysis

### 3.1 Feature Gaps

| Feature | Current State | Desired State | Priority |
|---------|---------------|---------------|----------|
| **Event Coverage** | 4 events | 90+ events | P0 |
| **Subscription Config** | Hardcoded | YAML-driven | P0 |
| **Runtime Management** | None | Enable/disable at runtime | P1 |
| **Filtering/Whitelisting** | None | Per-channel, per-event | P0 |
| **Subscription Status** | None | Health metrics, status API | P1 |
| **Event Builders** | 4 builders | Registry-based, extensible | P0 |
| **Scope Validation** | Implicit | Explicit validation | P1 |
| **Error Handling** | Basic | Graceful degradation | P1 |
| **Observability** | Minimal | Metrics, traces, logs | P2 |

### 3.2 Technical Debt

1. **Token Aliasing Workaround** (`eventsub-client.ts:126-135`)
   - Bot token reused for broadcaster ID
   - Workaround for Twurple v7.4.0 hardcoded user context
   - **Impact**: Confusing, potential auth issues
   - **Resolution**: Proper broadcaster token management

2. **Hardcoded Subscriptions** (`eventsub-client.ts:137-258`)
   - All subscriptions in `start()` method
   - No abstraction or registry
   - **Impact**: Cannot add events without code changes
   - **Resolution**: Registry-based subscription system

3. **Missing Subscription Health**
   - No health checks or status API
   - **Impact**: Cannot monitor subscription failures
   - **Resolution**: Subscription status tracking

4. **Limited Error Handling**
   - Basic try/catch blocks
   - No retry logic or circuit breaking
   - **Impact**: Transient failures may cause subscription loss
   - **Resolution**: Retry logic, exponential backoff

### 3.3 Dependency Risks

**Twurple Library Constraints**:
- Version: 7.4.0+
- **Risk**: Breaking changes in EventSub API
- **Mitigation**: Pin versions, monitor changelogs

**Scope Management**:
- Some events require broadcaster-level scopes
- **Risk**: Bot token may lack required scopes
- **Mitigation**: Scope validation before subscription, graceful degradation

**Rate Limits**:
- Twitch enforces rate limits on EventSub subscriptions
- **Risk**: Too many subscriptions may hit limits
- **Mitigation**: Batch subscriptions, respect limits

---

## 4. Architecture Principles

### 4.1 Core Principles

1. **Configuration-Driven**
   - All subscriptions defined in YAML configuration
   - No hardcoded event types in application code
   - Runtime reconfiguration without service restart

2. **Fail-Open Strategy**
   - Missing event builders log warnings but don't crash
   - Scope validation failures skip subscription, continue startup
   - Graceful degradation for unsupported events

3. **Registry-Based Extensibility**
   - Event builder registry for adding new event types
   - Subscription manager registry for dynamic subscriptions
   - Plugin-style architecture for event handlers

4. **Observability-First**
   - All subscriptions emit health metrics
   - Event volume tracking per subscription type
   - Error rate and latency measurements
   - Structured logging with correlation IDs

5. **Backward Compatibility**
   - Existing 4 events continue working unchanged
   - Migration path from hardcoded to YAML config
   - Feature flag for gradual rollout

### 4.2 Design Constraints

1. **Twurple API Compatibility**
   - Must work with Twurple EventSub WebSocket API
   - Cannot bypass Twurple's subscription model
   - Respect Twurple's event handler signatures

2. **BitBrat Platform Patterns**
   - Follow ENRICH → NEXT pattern for event processing
   - Publish to `internal.ingress.v1` topic
   - Use `InternalEventV2` envelope structure
   - Maintain correlation IDs for tracing

3. **Performance Requirements**
   - < 100ms event processing latency (P95)
   - Support 10+ channels with 50+ subscriptions each
   - < 5% overhead from subscription management

4. **Security Requirements**
   - OAuth scope validation before subscription
   - Token refresh handling without service interruption
   - Secure storage of broadcaster tokens

---

## 5. Proposed Architecture

### 5.1 High-Level Design

```
┌──────────────────────────────────────────────────────────────┐
│                   TWITCH EVENTSUB API                        │
└────────────────────────┬─────────────────────────────────────┘
                         │ WebSocket
             ┌───────────▼──────────────┐
             │  EventSubWsListener      │
             │  (Twurple EventSub)      │
             └───────────┬──────────────┘
                         │
        ┌────────────────▼───────────────────┐
        │  TwitchEventSubClient (refactored) │
        │  - Subscription lifecycle          │
        │  - Event routing                   │
        │  - Health monitoring               │
        └────────────┬───────────────────────┘
                     │
        ┌────────────┼───────────────────────┐
        │            │                       │
  ┌─────▼──────┐ ┌──▼──────────────┐ ┌──────▼─────────┐
  │Subscription│ │Event Builder    │ │Subscription    │
  │ Config     │ │   Registry      │ │  Manager       │
  │  (YAML)    │ │                 │ │                │
  └─────┬──────┘ └──┬──────────────┘ └──────┬─────────┘
        │            │                       │
        │      ┌─────▼──────────┐            │
        │      │ 90+ Builders   │            │
        │      │ - buildFollow  │            │
        │      │ - buildRaid    │            │
        │      │ - buildCheer   │            │
        │      │ - buildSub     │            │
        │      │ - ...          │            │
        │      └────────────────┘            │
        │                                    │
        └───────────┬────────────────────────┘
                    │
            ┌───────▼────────┐
            │ ITwitchIngress │
            │  Publisher     │
            └───────┬────────┘
                    │
            ┌───────▼────────────────┐
            │ Message Bus (NATS)     │
            │ internal.ingress.v1    │
            └────────────────────────┘
```

### 5.2 Component Breakdown

#### A. Subscription Configuration (YAML)

**Location**: `config/twitch-eventsub/subscriptions.yaml`

```yaml
# Twitch EventSub Subscription Configuration
# Defines which EventSub events are enabled and their behavior

version: 1
subscriptions:
  # Channel Events - Information
  channel.follow:
    enabled: true
    version: 2
    scope: moderator:read:followers
    priority: high
    builder: buildFollow
    internalType: system.twitch.follow
    description: New follower event

  channel.update:
    enabled: true
    version: 2
    priority: high
    builder: buildUpdate
    internalType: system.twitch.update
    description: Channel metadata changes (title, category, language)

  # Stream Events
  stream.online:
    enabled: true
    version: 1
    priority: critical
    builder: buildStreamOnline
    internalType: system.stream.online
    description: Stream goes live
    mutation:
      key: stream.state
      value: on
      ttl: 21600

  stream.offline:
    enabled: true
    version: 1
    priority: critical
    builder: buildStreamOffline
    internalType: system.stream.offline
    description: Stream goes offline
    mutation:
      key: stream.state
      value: off
      ttl: 21600

  # Channel Events - Engagement
  channel.raid:
    enabled: true
    version: 1
    priority: high
    builder: buildRaid
    internalType: system.twitch.raid
    description: Broadcaster raids another channel

  # Channel Events - Monetization
  channel.subscribe:
    enabled: true
    version: 1
    scope: channel:read:subscriptions
    priority: high
    builder: buildSubscribe
    internalType: system.twitch.subscribe
    description: New subscription (not resubscription)

  channel.subscription.message:
    enabled: true
    version: 1
    scope: channel:read:subscriptions
    priority: high
    builder: buildSubscriptionMessage
    internalType: system.twitch.subscription.message
    description: Resubscription with message

  channel.subscription.gift:
    enabled: true
    version: 1
    scope: channel:read:subscriptions
    priority: high
    builder: buildSubscriptionGift
    internalType: system.twitch.subscription.gift
    description: Gift subscription

  channel.cheer:
    enabled: true
    version: 1
    scope: bits:read
    priority: high
    builder: buildCheer
    internalType: system.twitch.cheer
    description: User cheers with bits

  # Channel Points
  channel.channel_points_custom_reward_redemption.add:
    enabled: true
    version: 1
    scope: channel:read:redemptions
    priority: high
    builder: buildChannelPointsRedemption
    internalType: system.twitch.channel_points.redemption
    description: Channel points custom reward redemption

  # Hype Train
  channel.hype_train.begin:
    enabled: true
    version: 2
    priority: medium
    builder: buildHypeTrainBegin
    internalType: system.twitch.hype_train.begin
    description: Hype Train starts

  channel.hype_train.progress:
    enabled: false  # High volume, opt-in
    version: 2
    priority: low
    builder: buildHypeTrainProgress
    internalType: system.twitch.hype_train.progress
    description: Hype Train progress update

  channel.hype_train.end:
    enabled: true
    version: 2
    priority: medium
    builder: buildHypeTrainEnd
    internalType: system.twitch.hype_train.end
    description: Hype Train ends

  # Polls
  channel.poll.begin:
    enabled: true
    version: 1
    priority: medium
    builder: buildPollBegin
    internalType: system.twitch.poll.begin
    description: Poll starts

  channel.poll.end:
    enabled: true
    version: 1
    priority: medium
    builder: buildPollEnd
    internalType: system.twitch.poll.end
    description: Poll ends

  # Predictions
  channel.prediction.begin:
    enabled: true
    version: 1
    priority: medium
    builder: buildPredictionBegin
    internalType: system.twitch.prediction.begin
    description: Prediction starts

  channel.prediction.end:
    enabled: true
    version: 1
    priority: medium
    builder: buildPredictionEnd
    internalType: system.twitch.prediction.end
    description: Prediction ends

  # Moderation - DISABLED BY DEFAULT (high volume, opt-in)
  channel.ban:
    enabled: false
    version: 1
    scope: channel:moderate
    priority: medium
    builder: buildBan
    internalType: system.twitch.moderation.ban
    description: User timeout or ban

  channel.unban:
    enabled: false
    version: 1
    scope: channel:moderate
    priority: medium
    builder: buildUnban
    internalType: system.twitch.moderation.unban
    description: User unban

  channel.moderate:
    enabled: false
    version: 2
    scope: channel:moderate
    priority: medium
    builder: buildModerate
    internalType: system.twitch.moderation.action
    description: Moderator actions (includes warnings in v2)

  # Chat - DISABLED BY DEFAULT (overlap with IRC, high volume)
  channel.chat.message:
    enabled: false
    version: 1
    scope: user:read:chat
    priority: low
    builder: buildChatMessage
    internalType: chat.message.v1  # Same as IRC
    description: All chat messages (overlaps with IRC client)

  channel.chat.message_delete:
    enabled: false
    version: 1
    scope: user:read:chat
    priority: medium
    builder: buildChatMessageDelete
    internalType: system.twitch.chat.message_delete
    description: Moderator deletes specific message

  # ... Additional events follow same pattern ...

# Per-Channel Overrides (optional)
channelOverrides:
  bitbrat:
    # Enable moderation events for specific channel
    channel.ban:
      enabled: true
    channel.unban:
      enabled: true
    channel.moderate:
      enabled: true
```

**Schema Definition**: `config/schemas/eventsub-subscriptions.v1.yaml`
```yaml
$schema: http://json-schema.org/draft-07/schema#
title: Twitch EventSub Subscription Configuration
type: object
required:
  - version
  - subscriptions
properties:
  version:
    type: integer
    const: 1
  subscriptions:
    type: object
    additionalProperties:
      type: object
      required:
        - enabled
        - builder
        - internalType
      properties:
        enabled:
          type: boolean
          description: Whether this subscription is active
        version:
          type: integer
          description: EventSub API version (e.g., 1, 2)
          default: 1
        scope:
          type: string
          description: Required OAuth scope (if any)
        priority:
          type: string
          enum: [critical, high, medium, low]
          description: Event priority (affects ordering)
        builder:
          type: string
          pattern: ^build[A-Z][a-zA-Z0-9]*$
          description: Builder method name in EventSubEnvelopeBuilder
        internalType:
          type: string
          pattern: ^(system|chat)\.[a-z0-9.]+$
          description: Internal event type for InternalEventV2
        description:
          type: string
          description: Human-readable event description
        mutation:
          type: object
          description: Optional state mutation to publish
          required: [key, value]
          properties:
            key:
              type: string
            value:
              type: [string, number, boolean]
            ttl:
              type: integer
              description: TTL in seconds
  channelOverrides:
    type: object
    description: Per-channel subscription overrides
    additionalProperties:
      type: object
      additionalProperties:
        type: object
        properties:
          enabled:
            type: boolean
```

#### B. Event Builder Registry

**Location**: `src/services/ingress/twitch/event-builder-registry.ts`

```typescript
import { EventSubEnvelopeBuilder } from './eventsub-envelope-builder';
import { InternalEventV2 } from '../../../types/events';
import { EnvelopeBuilderOptions } from './envelope-builder';
import { logger } from '../../../common/logging';

/**
 * EventBuilderRegistry - Registry for EventSub event builders.
 *
 * Maps EventSub event types to builder methods in EventSubEnvelopeBuilder.
 * Enables dynamic subscription management based on YAML configuration.
 */
export class EventBuilderRegistry {
  private readonly builder: EventSubEnvelopeBuilder;
  private readonly registry: Map<string, EventBuilderFunction> = new Map();

  constructor() {
    this.builder = new EventSubEnvelopeBuilder();
    this.registerBuilders();
  }

  /**
   * Register all available builders.
   */
  private registerBuilders(): void {
    // Existing builders (Tier 1 - already implemented)
    this.register('buildFollow', this.builder.buildFollow.bind(this.builder));
    this.register('buildUpdate', this.builder.buildUpdate.bind(this.builder));
    this.register('buildStreamOnline', this.builder.buildStreamOnline.bind(this.builder));
    this.register('buildStreamOffline', this.builder.buildStreamOffline.bind(this.builder));

    // New builders (Tier 1 - high priority)
    this.register('buildRaid', this.builder.buildRaid.bind(this.builder));
    this.register('buildSubscribe', this.builder.buildSubscribe.bind(this.builder));
    this.register('buildSubscriptionMessage', this.builder.buildSubscriptionMessage.bind(this.builder));
    this.register('buildSubscriptionGift', this.builder.buildSubscriptionGift.bind(this.builder));
    this.register('buildCheer', this.builder.buildCheer.bind(this.builder));
    this.register('buildChannelPointsRedemption', this.builder.buildChannelPointsRedemption.bind(this.builder));
    this.register('buildHypeTrainBegin', this.builder.buildHypeTrainBegin.bind(this.builder));
    this.register('buildHypeTrainProgress', this.builder.buildHypeTrainProgress.bind(this.builder));
    this.register('buildHypeTrainEnd', this.builder.buildHypeTrainEnd.bind(this.builder));
    this.register('buildPollBegin', this.builder.buildPollBegin.bind(this.builder));
    this.register('buildPollEnd', this.builder.buildPollEnd.bind(this.builder));
    this.register('buildPredictionBegin', this.builder.buildPredictionBegin.bind(this.builder));
    this.register('buildPredictionEnd', this.builder.buildPredictionEnd.bind(this.builder));

    // Tier 2 - moderation events
    this.register('buildBan', this.builder.buildBan.bind(this.builder));
    this.register('buildUnban', this.builder.buildUnban.bind(this.builder));
    this.register('buildModerate', this.builder.buildModerate.bind(this.builder));

    // Tier 3 - chat events (overlap with IRC)
    this.register('buildChatMessage', this.builder.buildChatMessage.bind(this.builder));
    this.register('buildChatMessageDelete', this.builder.buildChatMessageDelete.bind(this.builder));

    logger.info('eventsub.builder_registry.initialized', { builders: this.registry.size });
  }

  /**
   * Register a builder function.
   */
  private register(name: string, fn: EventBuilderFunction): void {
    if (this.registry.has(name)) {
      logger.warn('eventsub.builder_registry.duplicate', { name });
    }
    this.registry.set(name, fn);
  }

  /**
   * Get a builder by name.
   * Returns null if not found (fail-open strategy).
   */
  get(name: string): EventBuilderFunction | null {
    const builder = this.registry.get(name);
    if (!builder) {
      logger.warn('eventsub.builder_registry.not_found', { name });
      return null;
    }
    return builder;
  }

  /**
   * Check if a builder exists.
   */
  has(name: string): boolean {
    return this.registry.has(name);
  }

  /**
   * List all registered builders.
   */
  list(): string[] {
    return Array.from(this.registry.keys());
  }
}

type EventBuilderFunction = (event: any, opts?: EnvelopeBuilderOptions) => InternalEventV2;
```

#### C. Subscription Manager

**Location**: `src/services/ingress/twitch/subscription-manager.ts`

```typescript
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { ApiClient } from '@twurple/api';
import { logger } from '../../../common/logging';
import { EventBuilderRegistry } from './event-builder-registry';
import { ITwitchIngressPublisher } from './publisher';
import { EventSubscriptionConfig, SubscriptionConfigLoader } from './subscription-config-loader';
import { v4 as uuidv4 } from 'uuid';

/**
 * SubscriptionManager - Manages EventSub subscriptions based on YAML config.
 *
 * Responsibilities:
 * - Load subscription config from YAML
 * - Validate OAuth scopes before subscription
 * - Register subscriptions with Twurple EventSubWsListener
 * - Track subscription health and status
 * - Support runtime enable/disable (future)
 */
export class SubscriptionManager {
  private readonly subscriptions: Map<string, SubscriptionStatus> = new Map();
  private readonly builderRegistry: EventBuilderRegistry;
  private readonly configLoader: SubscriptionConfigLoader;

  constructor(
    private readonly listener: EventSubWsListener,
    private readonly apiClient: ApiClient,
    private readonly publisher: ITwitchIngressPublisher,
    private readonly mutationPublisher: any,
    private readonly egressDestinationTopic?: string
  ) {
    this.builderRegistry = new EventBuilderRegistry();
    this.configLoader = new SubscriptionConfigLoader();
  }

  /**
   * Subscribe to all enabled events for a channel.
   */
  async subscribeChannel(channel: string, userId: string, botUserId: string): Promise<void> {
    const config = await this.configLoader.load();
    const channelOverrides = config.channelOverrides?.[channel] || {};

    for (const [eventType, eventConfig] of Object.entries(config.subscriptions)) {
      // Apply channel-specific overrides
      const finalConfig = {
        ...eventConfig,
        ...(channelOverrides[eventType] || {})
      };

      if (!finalConfig.enabled) {
        logger.debug('eventsub.subscription.skipped', { channel, eventType, reason: 'disabled' });
        continue;
      }

      // Validate builder exists
      if (!this.builderRegistry.has(finalConfig.builder)) {
        logger.warn('eventsub.subscription.skipped', {
          channel,
          eventType,
          reason: 'builder_not_found',
          builder: finalConfig.builder
        });
        continue;
      }

      // Validate scope (if required)
      if (finalConfig.scope) {
        const hasScope = await this.validateScope(userId, finalConfig.scope);
        if (!hasScope) {
          logger.warn('eventsub.subscription.skipped', {
            channel,
            eventType,
            reason: 'missing_scope',
            scope: finalConfig.scope
          });
          continue;
        }
      }

      // Subscribe
      await this.subscribe(channel, userId, botUserId, eventType, finalConfig);
    }

    logger.info('eventsub.channel.subscribed', {
      channel,
      total: this.subscriptions.size
    });
  }

  /**
   * Subscribe to a specific event type.
   */
  private async subscribe(
    channel: string,
    userId: string,
    botUserId: string,
    eventType: string,
    config: EventSubscriptionConfig
  ): Promise<void> {
    try {
      const subscriptionKey = `${channel}:${eventType}`;
      const builder = this.builderRegistry.get(config.builder)!;

      // Map EventSub type to Twurple listener method
      const listenerMethod = this.getListenerMethod(eventType);
      if (!listenerMethod) {
        logger.warn('eventsub.subscription.skipped', {
          channel,
          eventType,
          reason: 'no_listener_method'
        });
        return;
      }

      // Register subscription with Twurple
      const subscription = await listenerMethod.call(
        this.listener,
        userId,
        botUserId, // Some events require moderator ID (e.g., channel.follow)
        async (event: any) => {
          try {
            logger.debug('eventsub.event.received', { channel, eventType });

            // Build internal event
            const internalEvent = builder(event, {
              finalizationDestination: this.egressDestinationTopic
            });

            // Publish to message bus
            await this.publisher.publish(internalEvent);

            // Publish state mutation (if configured)
            if (config.mutation && this.mutationPublisher) {
              const mutation = {
                id: uuidv4(),
                op: 'set',
                key: config.mutation.key,
                value: config.mutation.value,
                actor: 'ingress-egress:twitch',
                reason: `Twitch EventSub: ${eventType}`,
                ts: new Date().toISOString(),
                ttl: config.mutation.ttl || 21600,
                metadata: { eventType, channel }
              };
              await this.mutationPublisher.publishJson(mutation);
            }

            // Update metrics
            this.updateMetrics(subscriptionKey, 'event_received');
          } catch (err: any) {
            logger.error('eventsub.event.handler_error', {
              channel,
              eventType,
              error: err.message,
              stack: err.stack
            });
            this.updateMetrics(subscriptionKey, 'event_error');
          }
        }
      );

      // Track subscription status
      this.subscriptions.set(subscriptionKey, {
        channel,
        eventType,
        config,
        subscription,
        status: 'active',
        subscribedAt: new Date(),
        eventCount: 0,
        errorCount: 0
      });

      logger.info('eventsub.subscription.registered', { channel, eventType });
    } catch (err: any) {
      logger.error('eventsub.subscription.failed', {
        channel,
        eventType,
        error: err.message,
        stack: err.stack
      });
      this.updateMetrics(`${channel}:${eventType}`, 'subscription_error');
    }
  }

  /**
   * Map EventSub event type to Twurple listener method.
   */
  private getListenerMethod(eventType: string): Function | null {
    const methodMap: Record<string, string> = {
      'channel.follow': 'onChannelFollow',
      'channel.update': 'onChannelUpdate',
      'stream.online': 'onStreamOnline',
      'stream.offline': 'onStreamOffline',
      'channel.raid': 'onChannelRaidTo', // Note: Twurple has onChannelRaidTo and onChannelRaidFrom
      'channel.subscribe': 'onChannelSubscription',
      'channel.subscription.message': 'onChannelSubscriptionMessage',
      'channel.subscription.gift': 'onChannelSubscriptionGift',
      'channel.cheer': 'onChannelCheer',
      'channel.channel_points_custom_reward_redemption.add': 'onChannelRedemptionAdd',
      'channel.hype_train.begin': 'onChannelHypeTrainBegin',
      'channel.hype_train.progress': 'onChannelHypeTrainProgress',
      'channel.hype_train.end': 'onChannelHypeTrainEnd',
      'channel.poll.begin': 'onChannelPollBegin',
      'channel.poll.end': 'onChannelPollEnd',
      'channel.prediction.begin': 'onChannelPredictionBegin',
      'channel.prediction.end': 'onChannelPredictionEnd',
      'channel.ban': 'onChannelBan',
      'channel.unban': 'onChannelUnban',
      'channel.moderate': 'onChannelModeratorAction', // v2 includes warnings
      // ... Add more mappings as needed
    };

    const methodName = methodMap[eventType];
    if (!methodName) {
      return null;
    }

    const method = (this.listener as any)[methodName];
    if (typeof method !== 'function') {
      logger.warn('eventsub.listener_method.not_found', { eventType, methodName });
      return null;
    }

    return method;
  }

  /**
   * Validate OAuth scope for subscription.
   */
  private async validateScope(userId: string, scope: string): Promise<boolean> {
    try {
      // Use Twitch API to validate token scopes
      const tokenInfo = await this.apiClient.tokenInfo;
      const scopes = tokenInfo?.scopes || [];
      return scopes.includes(scope);
    } catch (err: any) {
      logger.warn('eventsub.scope_validation.failed', {
        userId,
        scope,
        error: err.message
      });
      return false; // Fail-open: skip subscription if validation fails
    }
  }

  /**
   * Update subscription metrics.
   */
  private updateMetrics(subscriptionKey: string, metric: string): void {
    const status = this.subscriptions.get(subscriptionKey);
    if (!status) return;

    switch (metric) {
      case 'event_received':
        status.eventCount++;
        status.lastEventAt = new Date();
        break;
      case 'event_error':
        status.errorCount++;
        status.lastErrorAt = new Date();
        break;
      case 'subscription_error':
        status.status = 'error';
        status.errorCount++;
        status.lastErrorAt = new Date();
        break;
    }
  }

  /**
   * Get subscription status (for MCP tools, health checks).
   */
  getStatus(): SubscriptionStatus[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Unsubscribe from all events.
   */
  async unsubscribeAll(): Promise<void> {
    for (const [key, status] of this.subscriptions) {
      if (status.subscription && typeof status.subscription.stop === 'function') {
        status.subscription.stop();
      }
    }
    this.subscriptions.clear();
    logger.info('eventsub.subscriptions.cleared');
  }
}

interface SubscriptionStatus {
  channel: string;
  eventType: string;
  config: EventSubscriptionConfig;
  subscription: any;
  status: 'active' | 'error' | 'disabled';
  subscribedAt: Date;
  eventCount: number;
  errorCount: number;
  lastEventAt?: Date;
  lastErrorAt?: Date;
}
```

#### D. Subscription Config Loader

**Location**: `src/services/ingress/twitch/subscription-config-loader.ts`

```typescript
import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';
import { logger } from '../../../common/logging';

/**
 * SubscriptionConfigLoader - Loads EventSub subscription config from YAML.
 */
export class SubscriptionConfigLoader {
  private readonly configPath: string;
  private cachedConfig: SubscriptionConfig | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(
      process.cwd(),
      'config/twitch-eventsub/subscriptions.yaml'
    );
  }

  /**
   * Load subscription config (with caching).
   */
  async load(): Promise<SubscriptionConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const config = yaml.load(content) as SubscriptionConfig;

      // Validate config structure
      this.validate(config);

      this.cachedConfig = config;
      logger.info('eventsub.config.loaded', {
        path: this.configPath,
        subscriptions: Object.keys(config.subscriptions).length
      });

      return config;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        logger.warn('eventsub.config.not_found', { path: this.configPath });
        return this.getDefaultConfig();
      }
      logger.error('eventsub.config.load_failed', {
        path: this.configPath,
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Validate config structure.
   */
  private validate(config: SubscriptionConfig): void {
    if (!config.version || config.version !== 1) {
      throw new Error('Invalid config version (expected: 1)');
    }
    if (!config.subscriptions || typeof config.subscriptions !== 'object') {
      throw new Error('Invalid config: missing subscriptions');
    }

    for (const [eventType, eventConfig] of Object.entries(config.subscriptions)) {
      if (typeof eventConfig.enabled !== 'boolean') {
        throw new Error(`Invalid config: ${eventType}.enabled must be boolean`);
      }
      if (!eventConfig.builder || typeof eventConfig.builder !== 'string') {
        throw new Error(`Invalid config: ${eventType}.builder is required`);
      }
      if (!eventConfig.internalType || typeof eventConfig.internalType !== 'string') {
        throw new Error(`Invalid config: ${eventType}.internalType is required`);
      }
    }
  }

  /**
   * Get default config (fallback if YAML not found).
   */
  private getDefaultConfig(): SubscriptionConfig {
    return {
      version: 1,
      subscriptions: {
        'channel.follow': {
          enabled: true,
          version: 2,
          scope: 'moderator:read:followers',
          priority: 'high',
          builder: 'buildFollow',
          internalType: 'system.twitch.follow',
          description: 'New follower event'
        },
        'channel.update': {
          enabled: true,
          version: 2,
          priority: 'high',
          builder: 'buildUpdate',
          internalType: 'system.twitch.update',
          description: 'Channel metadata changes'
        },
        'stream.online': {
          enabled: true,
          version: 1,
          priority: 'critical',
          builder: 'buildStreamOnline',
          internalType: 'system.stream.online',
          description: 'Stream goes live',
          mutation: {
            key: 'stream.state',
            value: 'on',
            ttl: 21600
          }
        },
        'stream.offline': {
          enabled: true,
          version: 1,
          priority: 'critical',
          builder: 'buildStreamOffline',
          internalType: 'system.stream.offline',
          description: 'Stream goes offline',
          mutation: {
            key: 'stream.state',
            value: 'off',
            ttl: 21600
          }
        }
      }
    };
  }

  /**
   * Reload config (clears cache).
   */
  async reload(): Promise<SubscriptionConfig> {
    this.cachedConfig = null;
    return this.load();
  }
}

export interface SubscriptionConfig {
  version: number;
  subscriptions: Record<string, EventSubscriptionConfig>;
  channelOverrides?: Record<string, Record<string, Partial<EventSubscriptionConfig>>>;
}

export interface EventSubscriptionConfig {
  enabled: boolean;
  version?: number;
  scope?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  builder: string;
  internalType: string;
  description?: string;
  mutation?: {
    key: string;
    value: string | number | boolean;
    ttl?: number;
  };
}
```

#### E. Refactored TwitchEventSubClient

**Location**: `src/services/ingress/twitch/eventsub-client.ts` (refactored)

```typescript
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { logger } from '../../../common/logging';
import { IConfig } from '../../../types';
import { ITwitchCredentialsProvider } from './credentials-provider';
import { ITwitchIngressPublisher } from './publisher';
import { SubscriptionManager } from './subscription-manager';
import { TwitchConnectionState } from './twitch-irc-client';
import { INTERNAL_STATE_MUTATION_V1 } from '../../../types/state';

export interface TwitchEventSubClientOptions {
  cfg: IConfig;
  credentialsProvider: ITwitchCredentialsProvider;
  egressDestinationTopic?: string;
  disableConnect?: boolean;
}

export class TwitchEventSubClient {
  private mutationPublisher: import('../../message-bus').MessagePublisher | null = null;
  private listener: EventSubWsListener | null = null;
  private subscriptionManager: SubscriptionManager | null = null;
  private state: TwitchConnectionState = 'DISCONNECTED';
  private botUserId?: string;
  private botDisplayName?: string;
  private lastError: { code?: string; message: string } | null = null;

  constructor(
    private readonly publisher: ITwitchIngressPublisher,
    private readonly channels: string[],
    private readonly options: TwitchEventSubClientOptions
  ) {}

  async start(): Promise<void> {
    const disabled =
      this.options.disableConnect === true ||
      process.env.NODE_ENV === 'test' ||
      this.options.cfg.twitchEnabled === false ||
      this.options.cfg.twitchDisableConnect === true;

    if (disabled) {
      logger.info('twitch.eventsub.disabled', { reason: 'config or test env' });
      this.state = 'CONNECTED';
      return;
    }

    this.state = 'CONNECTING';
    try {
      logger.info('twitch.eventsub.starting', { channels: this.channels });

      // Get bot auth
      const auth = await this.options.credentialsProvider.getChatAuth(this.channels[0]);
      if (!auth.userId) {
        throw new Error('twitch_auth_missing_user_id');
      }

      this.botUserId = auth.userId;
      this.botDisplayName = auth.login || this.channels[0];

      // Setup RefreshingAuthProvider
      const authProvider = new RefreshingAuthProvider({
        clientId: this.options.cfg.twitchClientId!,
        clientSecret: this.options.cfg.twitchClientSecret!,
      });

      if (typeof this.options.credentialsProvider.saveRefreshedToken === 'function') {
        authProvider.onRefresh(async (userId, tokenData) => {
          await this.options.credentialsProvider.saveRefreshedToken!({
            ...(tokenData as any),
            userId,
          });
        });
      }

      authProvider.addUser(auth.userId, {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken || null,
        expiresIn: auth.expiresIn ?? null,
        obtainmentTimestamp: auth.obtainmentTimestamp ?? 0,
        scope: auth.scope || [],
      }, ['chat', 'eventsub']);

      // Load broadcaster auth if available
      const broadcasterAuth = typeof this.options.credentialsProvider.getBroadcasterAuth === 'function'
        ? await this.options.credentialsProvider.getBroadcasterAuth(this.channels[0])
        : null;

      if (broadcasterAuth && broadcasterAuth.userId) {
        logger.info('twitch.eventsub.broadcaster_auth_found', { userId: broadcasterAuth.userId });
        authProvider.addUser(broadcasterAuth.userId, {
          accessToken: broadcasterAuth.accessToken,
          refreshToken: broadcasterAuth.refreshToken || null,
          expiresIn: broadcasterAuth.expiresIn ?? null,
          obtainmentTimestamp: broadcasterAuth.obtainmentTimestamp ?? 0,
          scope: broadcasterAuth.scope || [],
        }, ['chat', 'eventsub']);
      }

      const apiClient = new ApiClient({ authProvider });
      this.listener = new EventSubWsListener({ apiClient });

      // Initialize mutation publisher
      try {
        const prefix = this.options.cfg?.busPrefix ?? process.env.BUS_PREFIX ?? '';
        const subject = `${prefix}${INTERNAL_STATE_MUTATION_V1}`;
        const { createMessagePublisher } = require('../../message-bus');
        this.mutationPublisher = createMessagePublisher(subject);
      } catch (e: any) {
        logger.warn('twitch.eventsub.mutation_publisher_init_failed', { error: e?.message || String(e) });
        this.mutationPublisher = null;
      }

      // Initialize SubscriptionManager
      this.subscriptionManager = new SubscriptionManager(
        this.listener,
        apiClient,
        this.publisher,
        this.mutationPublisher,
        this.options.egressDestinationTopic
      );

      // Subscribe to all channels
      for (const channel of this.channels) {
        const user = await apiClient.users.getUserByName(channel);
        if (!user) {
          logger.warn('twitch.eventsub.user_not_found', { channel });
          continue;
        }

        const userId = user.id;

        // Alias bot token for broadcaster ID if needed (Twurple v7.4.0 workaround)
        if (userId !== auth.userId && (!broadcasterAuth || broadcasterAuth.userId !== userId)) {
          logger.info('twitch.eventsub.aliasing_bot_token', { broadcasterId: userId, botId: auth.userId });
          authProvider.addUser(userId, {
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken || null,
            expiresIn: auth.expiresIn ?? null,
            obtainmentTimestamp: auth.obtainmentTimestamp ?? 0,
            scope: auth.scope || [],
          }, ['chat', 'eventsub']);
        }

        // Subscribe channel (YAML-driven)
        await this.subscriptionManager.subscribeChannel(channel, userId, auth.userId);
      }

      this.listener.start();
      this.state = 'CONNECTED';
      this.lastError = null;
      logger.info('twitch.eventsub.started', {
        subscriptions: this.subscriptionManager.getStatus().length
      });
    } catch (err: any) {
      this.state = 'ERROR';
      this.lastError = { message: err.message };
      logger.error('twitch.eventsub.start_failed', { error: err.message });
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.state = 'DISCONNECTED';
    if (this.subscriptionManager) {
      await this.subscriptionManager.unsubscribeAll();
    }
    if (this.listener) {
      this.listener.stop();
      this.listener = null;
    }
    logger.info('twitch.eventsub.stopped');
  }

  getSnapshot() {
    const subscriptions = this.subscriptionManager?.getStatus() || [];
    return {
      state: this.state,
      userId: this.botUserId,
      displayName: this.botDisplayName,
      active: !!this.listener,
      subscriptions: subscriptions.length,
      subscriptionDetails: subscriptions.map(s => ({
        channel: s.channel,
        eventType: s.eventType,
        status: s.status,
        eventCount: s.eventCount,
        errorCount: s.errorCount
      })),
      lastError: this.lastError,
      joinedChannels: this.channels.map(c => c.startsWith('#') ? c : `#${c}`),
    };
  }
}
```

### 5.3 Event Builder Implementations

All new event builders follow the same pattern as existing builders. Example:

**Location**: `src/services/ingress/twitch/eventsub-envelope-builder.ts` (extended)

```typescript
/**
 * Maps a channel.raid event to InternalEventV2.
 */
buildRaid(
  event: {
    raidingBroadcasterId: string;
    raidingBroadcasterName: string;
    raidingBroadcasterDisplayName: string;
    toBroadcasterId: string;
    toBroadcasterName: string;
    toBroadcasterDisplayName: string;
    viewers: number;
  },
  opts?: EnvelopeBuilderOptions
): InternalEventV2 {
  const uuid = opts?.uuid || crypto.randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());
  const correlationId = uuid();

  const externalEvent: ExternalEventV1 = {
    id: `raid-${correlationId}`,
    source: 'twitch.eventsub',
    kind: 'channel.raid',
    version: '1',
    createdAt: nowIso(),
    metadata: {
      raidingBroadcasterId: event.raidingBroadcasterId,
      raidingBroadcasterLogin: event.raidingBroadcasterName,
      raidingBroadcasterDisplayName: event.raidingBroadcasterDisplayName,
      toBroadcasterId: event.toBroadcasterId,
      toBroadcasterLogin: event.toBroadcasterName,
      toBroadcasterDisplayName: event.toBroadcasterDisplayName,
      viewers: event.viewers,
    },
    rawPayload: event as any,
  };

  return {
    v: '2',
    type: 'system.twitch.raid',
    correlationId,
    traceId: uuid(),
    ingress: {
      ingressAt: nowIso(),
      source: 'ingress.twitch.eventsub',
      connector: 'twitch',
      channel: `#${event.toBroadcasterName}`,
    },
    identity: {
      external: {
        id: event.raidingBroadcasterId,
        platform: 'twitch',
        displayName: event.raidingBroadcasterDisplayName,
        metadata: {
          login: event.raidingBroadcasterName,
          toBroadcasterId: event.toBroadcasterId,
          toBroadcasterLogin: event.toBroadcasterName,
          viewers: event.viewers,
        }
      }
    },
    egress: {
      destination: opts?.finalizationDestination || '',
      connector: 'twitch',
      channel: `#${event.toBroadcasterName}`
    },
    externalEvent,
    routing: {
      stage: 'initial',
      slip: [],
      history: [],
    }
  };
}

/**
 * Maps a channel.subscribe event to InternalEventV2.
 */
buildSubscribe(
  event: {
    userId: string;
    userName: string;
    userDisplayName: string;
    broadcasterId: string;
    broadcasterName: string;
    broadcasterDisplayName: string;
    tier: '1000' | '2000' | '3000' | 'Prime';
    isGift: boolean;
  },
  opts?: EnvelopeBuilderOptions
): InternalEventV2 {
  const uuid = opts?.uuid || crypto.randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());
  const correlationId = uuid();

  const externalEvent: ExternalEventV1 = {
    id: `sub-${correlationId}`,
    source: 'twitch.eventsub',
    kind: 'channel.subscribe',
    version: '1',
    createdAt: nowIso(),
    metadata: {
      userId: event.userId,
      userLogin: event.userName,
      userDisplayName: event.userDisplayName,
      broadcasterId: event.broadcasterId,
      broadcasterLogin: event.broadcasterName,
      broadcasterDisplayName: event.broadcasterDisplayName,
      tier: event.tier,
      isGift: event.isGift,
    },
    rawPayload: event as any,
  };

  return {
    v: '2',
    type: 'system.twitch.subscribe',
    correlationId,
    traceId: uuid(),
    ingress: {
      ingressAt: nowIso(),
      source: 'ingress.twitch.eventsub',
      connector: 'twitch',
      channel: `#${event.broadcasterName}`,
    },
    identity: {
      external: {
        id: event.userId,
        platform: 'twitch',
        displayName: event.userDisplayName,
        metadata: {
          login: event.userName,
          broadcasterId: event.broadcasterId,
          broadcasterLogin: event.broadcasterName,
          tier: event.tier,
          isGift: event.isGift,
        }
      }
    },
    egress: {
      destination: opts?.finalizationDestination || '',
      connector: 'twitch',
      channel: `#${event.broadcasterName}`
    },
    externalEvent,
    routing: {
      stage: 'initial',
      slip: [],
      history: [],
    }
  };
}

// ... Additional builders follow same pattern ...
```

---

## 6. Implementation Plan

### Phase 1: Foundation (Week 1)
**Goal**: Establish YAML configuration system and registry pattern

**Tasks**:
1. Create `config/twitch-eventsub/subscriptions.yaml` with Tier 1 events
2. Create `config/schemas/eventsub-subscriptions.v1.yaml` JSON schema
3. Implement `SubscriptionConfigLoader` class
4. Implement `EventBuilderRegistry` class
5. Write unit tests for config loader and registry
6. Update architecture.yaml to reference new config files

**Deliverables**:
- YAML config file (20+ events)
- JSON schema for validation
- Config loader with caching
- Builder registry with 4 existing builders
- Unit tests (>80% coverage)

**Success Criteria**:
- Config loads without errors
- Schema validation passes
- Registry finds all 4 existing builders
- Tests pass

---

### Phase 2: Subscription Manager (Week 1-2)
**Goal**: Implement dynamic subscription management

**Tasks**:
1. Implement `SubscriptionManager` class
2. Refactor `TwitchEventSubClient` to use `SubscriptionManager`
3. Implement event type → Twurple method mapping
4. Implement OAuth scope validation
5. Implement subscription status tracking
6. Add metrics for event count, error count
7. Write unit tests for subscription manager
8. Write integration tests for end-to-end flow

**Deliverables**:
- `SubscriptionManager` class
- Refactored `TwitchEventSubClient`
- Subscription health tracking
- Unit + integration tests

**Success Criteria**:
- All 4 existing events still work
- Subscriptions created from YAML config
- Scope validation prevents invalid subscriptions
- Status tracking captures metrics
- Tests pass

---

### Phase 3: Event Builders (Week 2-3)
**Goal**: Implement builders for Tier 1 high-value events

**Tasks**:
1. Implement `buildRaid()` - channel.raid
2. Implement `buildSubscribe()` - channel.subscribe
3. Implement `buildSubscriptionMessage()` - channel.subscription.message
4. Implement `buildSubscriptionGift()` - channel.subscription.gift
5. Implement `buildCheer()` - channel.cheer
6. Implement `buildChannelPointsRedemption()` - channel.channel_points_custom_reward_redemption.add
7. Implement `buildHypeTrainBegin/Progress/End()` - channel.hype_train.*
8. Implement `buildPollBegin/End()` - channel.poll.*
9. Implement `buildPredictionBegin/End()` - channel.prediction.*
10. Register all new builders in `EventBuilderRegistry`
11. Update YAML config to enable new events
12. Write unit tests for each builder
13. Write integration tests for new event types

**Deliverables**:
- 13 new event builders
- Updated YAML config (17+ enabled events)
- Unit tests for all builders
- Integration tests

**Success Criteria**:
- All new builders produce valid `InternalEventV2` envelopes
- Events published to `internal.ingress.v1`
- Tests pass (>80% coverage)

---

### Phase 4: Moderation & Advanced Events (Week 3-4)
**Goal**: Implement Tier 2 moderation events and Tier 3 advanced features

**Tasks**:
1. Implement `buildBan()` - channel.ban
2. Implement `buildUnban()` - channel.unban
3. Implement `buildModerate()` - channel.moderate (v2)
4. Implement `buildChatMessage()` - channel.chat.message (overlap with IRC)
5. Implement `buildChatMessageDelete()` - channel.chat.message_delete
6. Add per-channel overrides to YAML config
7. Write unit tests for moderation builders
8. Document overlap between EventSub chat and IRC chat

**Deliverables**:
- 5 new moderation/chat event builders
- Per-channel override support in config loader
- Documentation on EventSub vs IRC chat

**Success Criteria**:
- Moderation events disabled by default
- Per-channel overrides work correctly
- Tests pass

---

### Phase 5: Observability & MCP Tools (Week 4)
**Goal**: Add observability and runtime control

**Tasks**:
1. Add MCP tool: `twitch.eventsub.subscriptions.list()`
2. Add MCP tool: `twitch.eventsub.subscriptions.status()`
3. Add MCP tool: `twitch.eventsub.config.reload()`
4. Add structured logging for all subscription events
5. Add metrics: event count, error count, latency (P50, P95, P99)
6. Add health check endpoint: `/_debug/twitch/eventsub`
7. Update `getSnapshot()` to include detailed subscription status
8. Write MCP tool tests

**Deliverables**:
- 3 MCP tools for EventSub management
- Metrics tracking
- Health check endpoint
- Enhanced snapshot API

**Success Criteria**:
- MCP tools return accurate subscription status
- Metrics track event volume and errors
- Health check shows subscription health
- Tests pass

---

### Phase 6: Testing & Validation (Week 4-5)
**Goal**: Comprehensive testing and validation

**Tasks**:
1. Create test fixtures for all 20+ event types
2. Write unit tests for all components (>85% coverage)
3. Write integration tests for end-to-end flow
4. Test per-channel overrides
5. Test scope validation (missing scopes, invalid tokens)
6. Test error handling (network failures, API errors)
7. Test config reload without service restart
8. Load testing (10 channels, 50+ subscriptions, 1000 events/min)
9. Deploy to agent-dev environment for validation
10. Test with real Twitch EventSub (staging)

**Deliverables**:
- 100+ unit tests
- 20+ integration tests
- Load test report
- Agent-dev validation report

**Success Criteria**:
- >85% test coverage
- All tests pass
- Load tests show <100ms P95 latency
- Agent-dev deployment successful

---

### Phase 7: Documentation (Week 5)
**Goal**: Complete documentation for users and developers

**Tasks**:
1. Write user guide: Configuring Twitch EventSub subscriptions
2. Write developer guide: Adding new EventSub event types
3. Update architecture.yaml documentation
4. Write migration guide: Upgrading from hardcoded to YAML config
5. Document MCP tools for EventSub management
6. Create Twitch EventSub event catalog (markdown table)
7. Update CLAUDE.md with EventSub patterns

**Deliverables**:
- User guide (documentation/guides/twitch-eventsub-config.md)
- Developer guide (documentation/guides/adding-eventsub-events.md)
- Migration guide (planning/sprint-16-aalwmj/migration-guide.md)
- MCP tool reference (documentation/reference/mcp-tools-twitch.md)
- Event catalog (documentation/reference/twitch-eventsub-catalog.md)

**Success Criteria**:
- All guides complete and accurate
- Examples tested and working
- Reviewed by stakeholders

---

### Phase 8: Deployment & Rollout (Week 5-6)
**Goal**: Deploy to production with gradual rollout

**Tasks**:
1. Feature flag: `ENABLE_EVENTSUB_YAML_CONFIG` (default: false)
2. Deploy to staging with feature flag enabled
3. Monitor for 48 hours (errors, latency, event volume)
4. Enable feature flag for 10% of channels (canary)
5. Monitor for 72 hours
6. Enable for 50% of channels
7. Monitor for 72 hours
8. Enable for 100% of channels
9. Remove legacy hardcoded subscriptions (deprecate)
10. Close sprint

**Deliverables**:
- Staging deployment
- Canary rollout (10% → 50% → 100%)
- Monitoring dashboard
- Rollback plan

**Success Criteria**:
- Zero errors in staging
- <100ms P95 latency in production
- Event volume matches expectations
- Successful 100% rollout

---

## 7. Migration Strategy

### 7.1 Backward Compatibility

**Goal**: Ensure existing 4 events continue working during migration.

**Approach**:
1. **Default Config**: If YAML config not found, fall back to hardcoded defaults
2. **Feature Flag**: `ENABLE_EVENTSUB_YAML_CONFIG` to toggle between old and new
3. **Dual Mode**: Both systems can coexist during migration

**Implementation**:
```typescript
// In TwitchEventSubClient.start()
const useYamlConfig = process.env.ENABLE_EVENTSUB_YAML_CONFIG === 'true';

if (useYamlConfig) {
  // New path: SubscriptionManager
  this.subscriptionManager = new SubscriptionManager(...);
  await this.subscriptionManager.subscribeChannel(channel, userId, botUserId);
} else {
  // Legacy path: Hardcoded subscriptions
  await this.subscribeHardcoded(channel, userId, botUserId);
}
```

### 7.2 Migration Steps

**Step 1: Add YAML Config (No Behavior Change)**
- Deploy YAML config file
- Deploy config loader
- Deploy builder registry
- Feature flag OFF (still using hardcoded)

**Step 2: Enable Feature Flag in Staging**
- Set `ENABLE_EVENTSUB_YAML_CONFIG=true` in staging
- Monitor for errors
- Validate all 4 events still work

**Step 3: Gradual Production Rollout**
- Enable for 10% of channels (canary)
- Monitor for 72 hours
- Enable for 50% of channels
- Monitor for 72 hours
- Enable for 100% of channels

**Step 4: Remove Legacy Code**
- Delete hardcoded subscription logic
- Remove feature flag
- Update tests to only test new path

### 7.3 Rollback Plan

**Scenario**: New YAML-driven system has critical bugs in production

**Rollback Actions**:
1. Set `ENABLE_EVENTSUB_YAML_CONFIG=false` (immediate)
2. Restart `ingress-egress` service (< 30 seconds downtime)
3. Monitor legacy path for stability
4. Root cause analysis on new system
5. Fix bugs in staging before retry

**Recovery Time Objective (RTO)**: < 5 minutes
**Recovery Point Objective (RPO)**: Zero data loss (events replay from message bus)

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Coverage Target**: >85%

**Components to Test**:
1. `SubscriptionConfigLoader`
   - Valid YAML parsing
   - Invalid YAML error handling
   - Missing config fallback to defaults
   - Schema validation
   - Config caching

2. `EventBuilderRegistry`
   - Builder registration
   - Builder lookup (found/not found)
   - List all builders
   - Duplicate registration handling

3. `SubscriptionManager`
   - Channel subscription flow
   - Scope validation (valid/invalid)
   - Subscription status tracking
   - Metrics updates (event count, error count)
   - Unsubscribe all

4. `EventSubEnvelopeBuilder` (all 20+ builders)
   - Valid event → `InternalEventV2` mapping
   - Missing fields handling
   - Optional fields handling
   - Correct `externalEvent` structure
   - Correct `internalType` mapping

5. `TwitchEventSubClient` (refactored)
   - Start/stop lifecycle
   - Dual auth (bot + broadcaster)
   - Token aliasing workaround
   - Subscription manager integration
   - Snapshot API

**Example Test**:
```typescript
describe('SubscriptionConfigLoader', () => {
  it('should load valid YAML config', async () => {
    const loader = new SubscriptionConfigLoader('test/fixtures/eventsub-config.yaml');
    const config = await loader.load();
    expect(config.version).toBe(1);
    expect(config.subscriptions['channel.follow'].enabled).toBe(true);
  });

  it('should fall back to default config if file not found', async () => {
    const loader = new SubscriptionConfigLoader('/nonexistent/path.yaml');
    const config = await loader.load();
    expect(config.subscriptions['channel.follow']).toBeDefined();
  });

  it('should throw on invalid config version', async () => {
    const loader = new SubscriptionConfigLoader('test/fixtures/invalid-version.yaml');
    await expect(loader.load()).rejects.toThrow('Invalid config version');
  });
});
```

### 8.2 Integration Tests

**Scenarios to Test**:
1. **End-to-End Event Flow**
   - Mock Twitch EventSub WebSocket
   - Trigger `channel.follow` event
   - Verify `InternalEventV2` published to `internal.ingress.v1`
   - Verify mutation published to `internal.state.mutation.v1`

2. **YAML Config Integration**
   - Load config from file
   - Subscribe to enabled events only
   - Verify disabled events skipped
   - Verify scope validation prevents invalid subscriptions

3. **Per-Channel Overrides**
   - Global config disables `channel.ban`
   - Channel override enables `channel.ban`
   - Verify subscription created for override channel only

4. **Error Handling**
   - Missing event builder → skip subscription, log warning
   - Invalid OAuth scope → skip subscription, log warning
   - Twitch API error → graceful degradation

**Example Test**:
```typescript
describe('Twitch EventSub Integration', () => {
  it('should publish InternalEventV2 for channel.follow event', async () => {
    const mockPublisher = new MockTwitchIngressPublisher();
    const client = new TwitchEventSubClient(mockPublisher, ['testchannel'], options);

    await client.start();

    // Simulate Twitch EventSub event
    const mockFollowEvent = {
      userId: '12345',
      userName: 'follower',
      userDisplayName: 'Follower',
      broadcasterId: '67890',
      broadcasterName: 'testchannel',
      broadcasterDisplayName: 'TestChannel',
      followDate: new Date()
    };

    // Trigger event (via mock listener)
    mockListener.triggerEvent('channel.follow', mockFollowEvent);

    // Verify InternalEventV2 published
    expect(mockPublisher.publishedEvents).toHaveLength(1);
    const event = mockPublisher.publishedEvents[0];
    expect(event.type).toBe('system.twitch.follow');
    expect(event.identity.external.id).toBe('12345');
  });
});
```

### 8.3 Load Testing

**Objective**: Validate performance under production-scale load

**Test Scenario**:
- **Channels**: 10 channels
- **Subscriptions per channel**: 20 events (200 total)
- **Event rate**: 1000 events/minute (16.7 events/second)
- **Duration**: 30 minutes

**Metrics to Measure**:
- Event processing latency (P50, P95, P99)
- CPU utilization
- Memory utilization
- Error rate (should be 0%)
- Message bus throughput

**Success Criteria**:
- P95 latency < 100ms
- P99 latency < 200ms
- CPU < 50%
- Memory < 500MB
- Error rate = 0%

---

## 9. Deployment Strategy

### 9.1 Environment Progression

**1. Local Development**
- Docker Compose stack
- Mock Twitch EventSub (test fixtures)
- Manual testing

**2. Agent-Dev Context**
- Isolated Docker environment
- PostgreSQL + NATS
- Deploy via `bit deploy ingress-egress --context agent-dev-eventsub-test`
- Validate service starts, subscriptions created
- Use MCP tools to inspect subscription status

**3. Staging**
- Real Twitch EventSub integration
- Staging credentials (separate Twitch app)
- Feature flag: `ENABLE_EVENTSUB_YAML_CONFIG=true`
- Monitor for 48 hours

**4. Production (Canary Rollout)**
- **10% Canary**: Enable feature flag for 1-2 channels
- Monitor for 72 hours (metrics, errors, logs)
- **50% Rollout**: Enable for 50% of channels
- Monitor for 72 hours
- **100% Rollout**: Enable for all channels
- Monitor for 1 week
- Remove legacy code after successful rollout

### 9.2 Deployment Checklist

**Pre-Deployment**:
- [ ] All tests passing (unit, integration, load)
- [ ] Code review approved
- [ ] YAML config validated (schema check)
- [ ] MCP tools tested
- [ ] Documentation updated
- [ ] Rollback plan documented
- [ ] Monitoring dashboard ready

**Deployment Steps**:
1. [ ] Deploy YAML config to all environments
2. [ ] Deploy code changes (feature flag OFF)
3. [ ] Enable feature flag in staging
4. [ ] Monitor staging for 48 hours
5. [ ] Enable feature flag for 10% of production channels
6. [ ] Monitor canary for 72 hours
7. [ ] Enable for 50% of production channels
8. [ ] Monitor for 72 hours
9. [ ] Enable for 100% of production channels
10. [ ] Monitor for 1 week
11. [ ] Remove legacy code
12. [ ] Close sprint

**Post-Deployment**:
- [ ] Monitor metrics for 1 week
- [ ] Collect feedback from users
- [ ] Document lessons learned
- [ ] Plan next iteration (Tier 2/3 events)

---

## 10. Success Metrics

### 10.1 Functional Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| **EventSub Events Supported** | 4 | 20+ (Tier 1) | Count of enabled events in YAML |
| **Subscription Success Rate** | N/A | >99% | (Subscriptions created / Subscriptions attempted) |
| **Scope Validation Accuracy** | N/A | 100% | (Invalid scopes rejected / Total invalid scopes) |
| **Event Processing Success Rate** | ~99% | >99.9% | (Events processed / Events received) |

### 10.2 Performance Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| **Event Processing Latency (P95)** | ~50ms | <100ms | Time from EventSub receipt to message bus publish |
| **Event Processing Latency (P99)** | ~100ms | <200ms | Same as above |
| **Subscription Startup Time** | ~2s | <5s | Time to create all subscriptions on service start |
| **Memory Utilization** | ~200MB | <500MB | Heap size with 200 subscriptions |
| **CPU Utilization** | ~10% | <50% | Under 1000 events/min load |

### 10.3 Reliability Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| **Service Uptime** | 99.5% | >99.9% | (Uptime hours / Total hours) |
| **Error Rate** | <0.1% | <0.01% | (Error events / Total events) |
| **Failed Subscription Recovery** | N/A | <1 hour | Time to detect and recover failed subscriptions |

### 10.4 Operational Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| **Configuration Reload Time** | N/A | <10s | Time to reload YAML config without restart |
| **Mean Time to Detect (MTTD)** | ~5 min | <1 min | Time to detect subscription failure |
| **Mean Time to Recover (MTTR)** | ~15 min | <5 min | Time to recover from failure |

---

## 11. Future Enhancements

### 11.1 Phase 2: Runtime Subscription Management

**Goal**: Enable/disable subscriptions without service restart

**Features**:
- MCP tool: `twitch.eventsub.subscribe(channel, eventType)`
- MCP tool: `twitch.eventsub.unsubscribe(channel, eventType)`
- MCP tool: `twitch.eventsub.enable(eventType)` (global)
- MCP tool: `twitch.eventsub.disable(eventType)` (global)
- Hot reload: Watch YAML config for changes, auto-reload

**Use Cases**:
- Temporarily disable high-volume events (e.g., `channel.hype_train.progress`)
- Enable new events without code deployment
- A/B testing different event subscriptions

### 11.2 Phase 3: Advanced Filtering

**Goal**: Fine-grained event filtering beyond enable/disable

**Features**:
- **Sampling**: Only process N% of events (e.g., 10% of chat messages)
- **Rate Limiting**: Cap events per channel (e.g., max 100 events/min)
- **Conditional Filters**: JsonLogic-style filters (e.g., "only raids with >100 viewers")
- **Priority Queuing**: High-priority events bypass rate limits

**Configuration Example**:
```yaml
channel.hype_train.progress:
  enabled: true
  sampling: 0.1  # Only process 10% of events
  rateLimit: 10  # Max 10 events/min
  filter:
    and:
      - ">": [{ var: "level" }, 3]  # Only level 4+ hype trains
```

### 11.3 Phase 4: EventSub Conduits

**Goal**: Use Twitch's EventSub Conduit API for multi-shard subscriptions

**Benefits**:
- Support for 1000+ channels (single conduit supports 10k+ subscriptions)
- Automatic shard balancing
- Reduced EventSub API calls

**Architecture Changes**:
- Replace `EventSubWsListener` with `EventSubConduitListener`
- Manage conduit lifecycle (create, update, delete)
- Implement shard health monitoring

### 11.4 Phase 5: Event Replay & Audit Log

**Goal**: Store all EventSub events for replay and auditing

**Features**:
- PostgreSQL table: `twitch_eventsub_events`
- Columns: `id`, `channel`, `event_type`, `payload`, `created_at`, `processed_at`
- MCP tool: `twitch.eventsub.replay(channel, eventType, startTime, endTime)`
- Use case: Re-process events after bug fix, audit trail for compliance

### 11.5 Phase 6: Multi-Platform EventBus

**Goal**: Unify EventSub pattern across all platforms (Discord, Slack, Twilio)

**Architecture**:
- Generic `EventSubManager` interface
- Platform-specific implementations: `TwitchEventSubManager`, `DiscordEventSubManager`, etc.
- Unified YAML config: `config/platforms/{platform}/eventsub-subscriptions.yaml`
- Shared event builder registry pattern

---

## 12. Risks & Mitigations

### 12.1 Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Twurple API Breaking Changes** | High | Low | Pin versions, monitor changelogs, maintain test suite |
| **OAuth Scope Changes** | High | Low | Graceful degradation, scope validation, user notifications |
| **Rate Limits** | Medium | Medium | Respect Twitch rate limits, batch subscriptions, exponential backoff |
| **Memory Leaks** | High | Low | Load testing, memory profiling, leak detection in CI |
| **Message Bus Overload** | High | Low | Rate limiting, backpressure, circuit breaking |

### 12.2 Operational Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Config Typos** | Medium | Medium | JSON schema validation, pre-deployment checks, rollback plan |
| **Missing Event Builders** | Low | Medium | Fail-open strategy (log warning, skip subscription), unit tests |
| **Token Expiration** | Medium | Low | Token refresh handling, monitoring, alerting |
| **Subscription Failures** | Medium | Medium | Retry logic, exponential backoff, health checks |

### 12.3 Business Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **User Confusion** | Low | Medium | Documentation, migration guide, support resources |
| **Unexpected Costs** | Low | Low | Monitor event volume, cap subscriptions, cost alerts |
| **Feature Creep** | Medium | Medium | Stick to phased rollout, defer Tier 3/4 events to Phase 2 |

---

## 13. Appendices

### Appendix A: File Structure

```
src/
  services/
    ingress/
      twitch/
        eventsub-client.ts                    # Refactored client
        eventsub-envelope-builder.ts          # Extended with 20+ builders
        event-builder-registry.ts             # NEW: Builder registry
        subscription-manager.ts               # NEW: Subscription manager
        subscription-config-loader.ts         # NEW: Config loader
        twitch-irc-client.ts                  # Unchanged
        connector-adapter.ts                  # Unchanged
        credentials-provider.ts               # Unchanged
        publisher.ts                          # Unchanged
        factory.ts                            # Updated to use new components
        envelope-builder.ts                   # Unchanged
        index.ts                              # Updated exports

config/
  platforms/
    twitch/
      eventsub-subscriptions.yaml             # NEW: Subscription config
      chat-message.v1.yaml                    # Existing
      dm-message.v1.yaml                      # Existing
  schemas/
    eventsub-subscriptions.v1.yaml            # NEW: JSON schema

documentation/
  guides/
    twitch-eventsub-config.md                 # NEW: User guide
    adding-eventsub-events.md                 # NEW: Developer guide
  reference/
    twitch-eventsub-catalog.md                # NEW: Event catalog
    mcp-tools-twitch.md                       # NEW: MCP tool reference

planning/
  sprint-16-aalwmj/
    technical-architecture.md                 # This document
    migration-guide.md                        # NEW: Migration guide
    request-log.md                            # Sprint log
    sprint-manifest.yaml                      # Sprint metadata
```

### Appendix B: Key Dependencies

**NPM Packages**:
- `@twurple/eventsub-ws@^7.4.0` - EventSub WebSocket listener
- `@twurple/eventsub-base@^7.4.0` - EventSub type definitions
- `@twurple/api@^7.4.0` - Twitch API client (Helix)
- `@twurple/auth@^7.4.0` - RefreshingAuthProvider
- `js-yaml@^4.1.0` - YAML parsing
- `uuid@^9.0.0` - UUID generation

**BitBrat Platform**:
- `src/common/base-server.ts` - Bit base class
- `src/common/logging.ts` - Structured logging
- `src/services/message-bus.ts` - NATS publisher
- `src/types/events.ts` - InternalEventV2, ExternalEventV1
- `src/types/state.ts` - MutationProposal

### Appendix C: OAuth Scopes Reference

| Scope | Required For | Description |
|-------|--------------|-------------|
| `moderator:read:followers` | `channel.follow` | Read follower list |
| `bits:read` | `channel.cheer`, `channel.bits.use` | Read bits events |
| `channel:read:subscriptions` | `channel.subscribe`, `channel.subscription.*` | Read subscription events |
| `channel:read:redemptions` | `channel.channel_points_*` | Read channel points redemptions |
| `channel:manage:redemptions` | `channel.channel_points_custom_reward.*` | Manage custom rewards |
| `user:read:chat` | `channel.chat.*` | Read chat messages |
| `channel:moderate` | `channel.ban`, `channel.moderate`, etc. | Moderation actions |
| `channel:read:ads` | `channel.ad_break.begin` | Read ad break events |
| `moderator:read:automod_settings` | `automod.settings.update` | Read automod settings |
| `moderator:manage:automod` | `automod.*` | Manage automod |
| `moderator:read:unban_requests` | `channel.unban_request.*` | Read unban requests |

### Appendix D: Glossary

- **EventSub**: Twitch's event notification system (webhooks + WebSocket)
- **EventBus**: Generic term for event-driven architecture (used interchangeably with EventSub in this document)
- **Subscription**: Registration to receive specific event types from Twitch
- **Builder**: Function that converts Twitch EventSub event to `InternalEventV2`
- **Envelope**: `InternalEventV2` message structure used in BitBrat platform
- **Mutation**: State change proposal published to `internal.state.mutation.v1`
- **Scope**: OAuth permission required to access specific EventSub events
- **Twurple**: Third-party TypeScript library for Twitch API (used by BitBrat)
- **Conduit**: Twitch's high-throughput EventSub delivery mechanism (future enhancement)

---

## Document Control

**Version**: 1.0
**Last Updated**: 2026-08-16
**Author**: Claude Code (Architect)
**Reviewers**: TBD
**Status**: Draft
**Sprint**: sprint-16-aalwmj
**Related Documents**:
- `planning/sprint-16-aalwmj/sprint-manifest.yaml`
- `documentation/reference/twitch-integration-for-llm-agents.md`
- `CLAUDE.md` (Section 2: Integrating Chat Platforms)

---

**END OF DOCUMENT**

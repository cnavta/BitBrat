# Adding EventSub Events - Developer Guide

**Step-by-step guide for implementing new Twitch EventSub event types.**

This guide shows how to add new EventSub event types to the BitBrat platform. The implementation follows a consistent pattern across 4 files with automated registration.

**Sprint:** 16
**Skill Level:** Intermediate
**Time:** 3-4 hours per event (implementation + tests)
**Prerequisites:** TypeScript, Twurple EventSub API knowledge

---

## Quick Reference

| Step | File | Action | Time |
|------|------|--------|------|
| 1 | `eventsub-envelope-builder.ts` | Add builder method | 30min |
| 2 | `eventsub-envelope-builder.spec.ts` | Add unit tests | 30min |
| 3 | `event-builder-registry.ts` | Register builder | 5min |
| 4 | `subscription-manager.ts` | Map listener method | 10min |
| 5 | `subscriptions.yaml` | Add YAML config | 10min |
| 6 | Build + Test | Validate implementation | 15min |

**Total:** ~2 hours (implementation) + 1-2 hours (testing)

---

## Prerequisites

### Required Knowledge

- **TypeScript**: Interfaces, type annotations, async/await
- **Twurple EventSub**: Event types and listener methods
- **Twitch API**: Event structure and field meanings
- **Platform Events**: InternalEventV2 schema

### Required Documentation

- [Twitch EventSub Reference](https://dev.twitch.tv/docs/eventsub/)
- [Twurple EventSub Listeners](https://twurple.js.org/docs/eventsub/listeners/)
- [InternalEventV2 Schema](../reference/schemas/internal-event-v2.md)
- [EventSub Config Guide](./twitch-eventsub-config.md)

---

## Implementation Steps

### Step 1: Implement Builder Method

**File:** `src/services/ingress/twitch/eventsub-envelope-builder.ts`

Add a new method to `EventSubEnvelopeBuilder` class that maps Twitch EventSub event to `InternalEventV2`.

#### Pattern

```typescript
/**
 * Maps a <event.type> event to InternalEventV2.
 *
 * @param event - Twurple EventSubChannel<EventType> object
 * @param opts - Builder options (finalizationDestination, uuid, nowIso)
 * @returns InternalEventV2 envelope
 */
build<EventName>(
  event: {
    // Event-specific fields from Twurple type
    broadcasterId: string;
    broadcasterName: string;
    broadcasterDisplayName: string;
    // ... other required fields
  },
  opts?: EnvelopeBuilderOptions
): InternalEventV2 {
  // 1. Initialize helpers
  const uuid = opts?.uuid || crypto.randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());
  const correlationId = uuid();

  // 2. Build ExternalEventV1 (Twitch event metadata)
  const externalEvent: ExternalEventV1 = {
    id: event.id || `eventsub-${correlationId}`,  // Use event.id if available
    source: 'twitch.eventsub',
    kind: 'channel.<event.type>',                  // Twitch event type
    version: '1',                                  // Twitch API version
    createdAt: event.eventDate?.toISOString() || nowIso(),
    metadata: {
      // Event-specific fields (flatten Twitch event structure)
      broadcasterId: event.broadcasterId,
      broadcasterLogin: event.broadcasterName,
      broadcasterDisplayName: event.broadcasterDisplayName,
      // ... other relevant fields
    },
    rawPayload: event as any,
  };

  // 3. Build InternalEventV2
  return {
    v: '2',
    type: 'system.twitch.<event.name>',           // Internal event type
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
        id: event.userId || event.broadcasterId,  // Actor ID (user or broadcaster)
        platform: 'twitch',
        displayName: event.userDisplayName || event.broadcasterDisplayName,
        metadata: {
          login: event.userName || event.broadcasterName,
          // ... other identity fields
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
```

#### Example: channel.raid

```typescript
buildRaid(
  event: {
    raidingBroadcasterId: string;
    raidingBroadcasterName: string;
    raidingBroadcasterDisplayName: string;
    broadcasterId: string;
    broadcasterName: string;
    broadcasterDisplayName: string;
    viewers: number;
  },
  opts?: EnvelopeBuilderOptions
): InternalEventV2 {
  const uuid = opts?.uuid || crypto.randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());
  const correlationId = uuid();

  const externalEvent: ExternalEventV1 = {
    id: `eventsub-${correlationId}`,
    source: 'twitch.eventsub',
    kind: 'channel.raid',
    version: '1',
    createdAt: nowIso(),
    metadata: {
      raidingBroadcasterId: event.raidingBroadcasterId,
      raidingBroadcasterLogin: event.raidingBroadcasterName,
      raidingBroadcasterDisplayName: event.raidingBroadcasterDisplayName,
      broadcasterId: event.broadcasterId,
      broadcasterLogin: event.broadcasterName,
      broadcasterDisplayName: event.broadcasterDisplayName,
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
      channel: `#${event.broadcasterName}`,
    },
    identity: {
      external: {
        id: event.raidingBroadcasterId,  // Actor is raiding broadcaster
        platform: 'twitch',
        displayName: event.raidingBroadcasterDisplayName,
        metadata: {
          login: event.raidingBroadcasterName,
          targetBroadcasterId: event.broadcasterId,
          targetBroadcasterName: event.broadcasterName,
          viewers: event.viewers,
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
```

#### Field Mapping Guidelines

| Twitch Field | InternalEventV2 Location | Notes |
|--------------|--------------------------|-------|
| Event ID | `externalEvent.id` | Use event.id if available, otherwise generate |
| Event Type | `externalEvent.kind` | Twitch EventSub type (e.g., `channel.raid`) |
| Internal Type | `type` | Platform type (e.g., `system.twitch.raid`) |
| Broadcaster | `ingress.channel`, `egress.channel` | Always `#${broadcasterName}` |
| Actor (user) | `identity.external.id` | User performing action (follower, subscriber, raider, etc.) |
| Timestamp | `externalEvent.createdAt` | Event-specific timestamp or `nowIso()` |
| All fields | `externalEvent.metadata` | Flattened, snake_case preserved |
| Raw event | `externalEvent.rawPayload` | Original Twitch event object |

---

### Step 2: Add Unit Tests

**File:** `src/services/ingress/twitch/__tests__/eventsub-envelope-builder.spec.ts`

Add test cases for the new builder method.

#### Test Pattern

```typescript
describe('build<EventName>()', () => {
  it('should map <event.type> to InternalEventV2', () => {
    const mockEvent = {
      // Mock Twitch event fields
      broadcasterId: '12345',
      broadcasterName: 'testchannel',
      broadcasterDisplayName: 'TestChannel',
      // ... other required fields
    };

    const result = builder.build<EventName>(mockEvent, mockOpts);

    // Validate InternalEventV2 structure
    expect(result.v).toBe('2');
    expect(result.type).toBe('system.twitch.<event>');
    expect(result.correlationId).toBe('test-correlation-id');
    expect(result.traceId).toBe('test-trace-id');

    // Validate ingress
    expect(result.ingress.source).toBe('ingress.twitch.eventsub');
    expect(result.ingress.connector).toBe('twitch');
    expect(result.ingress.channel).toBe('#testchannel');

    // Validate identity
    expect(result.identity.external.id).toBe('<actor-id>');
    expect(result.identity.external.platform).toBe('twitch');

    // Validate externalEvent
    expect(result.externalEvent.kind).toBe('channel.<event.type>');
    expect(result.externalEvent.source).toBe('twitch.eventsub');
    expect(result.externalEvent.metadata.<field>).toBe('<value>');
  });

  it('should handle missing optional fields', () => {
    const mockEvent = {
      // Required fields only
      broadcasterId: '12345',
      broadcasterName: 'testchannel',
      broadcasterDisplayName: 'TestChannel',
    };

    const result = builder.build<EventName>(mockEvent, mockOpts);

    // Verify graceful handling of missing fields
    expect(result.externalEvent.metadata.<optionalField>).toBeUndefined();
  });

  it('should include raw payload', () => {
    const mockEvent = { /* ... */ };

    const result = builder.build<EventName>(mockEvent, mockOpts);

    expect(result.externalEvent.rawPayload).toEqual(mockEvent);
  });
});
```

#### Example: channel.raid Tests

```typescript
describe('buildRaid()', () => {
  it('should map channel.raid to InternalEventV2', () => {
    const mockEvent = {
      raidingBroadcasterId: '67890',
      raidingBroadcasterName: 'raider',
      raidingBroadcasterDisplayName: 'Raider',
      broadcasterId: '12345',
      broadcasterName: 'target',
      broadcasterDisplayName: 'Target',
      viewers: 150,
    };

    const result = builder.buildRaid(mockEvent, mockOpts);

    expect(result.v).toBe('2');
    expect(result.type).toBe('system.twitch.raid');
    expect(result.correlationId).toBe('test-correlation-id');

    // Identity is raiding broadcaster
    expect(result.identity.external.id).toBe('67890');
    expect(result.identity.external.displayName).toBe('Raider');
    expect(result.identity.external.metadata.viewers).toBe(150);

    // Channel is target broadcaster
    expect(result.ingress.channel).toBe('#target');
    expect(result.egress.channel).toBe('#target');

    // External event metadata
    expect(result.externalEvent.kind).toBe('channel.raid');
    expect(result.externalEvent.metadata.viewers).toBe(150);
    expect(result.externalEvent.metadata.raidingBroadcasterId).toBe('67890');
    expect(result.externalEvent.metadata.broadcasterId).toBe('12345');
  });
});
```

#### Test Coverage Requirements

- ✅ Basic event mapping (required fields)
- ✅ Optional field handling (graceful degradation)
- ✅ Raw payload preservation
- ✅ Edge cases (anonymous users, missing IDs, etc.)
- ✅ All metadata fields present in `externalEvent.metadata`

**Target:** >85% code coverage for builder method

---

### Step 3: Register Builder

**File:** `src/services/ingress/twitch/event-builder-registry.ts`

Register the new builder in `EventBuilderRegistry.registerBuilders()`.

#### Pattern

```typescript
private registerBuilders(): void {
  // ... existing registrations

  // <Category> builders
  this.register('build<EventName>', this.builder.build<EventName>.bind(this.builder));
}
```

#### Example

```typescript
private registerBuilders(): void {
  // Existing builders
  this.register('buildFollow', this.builder.buildFollow.bind(this.builder));
  this.register('buildUpdate', this.builder.buildUpdate.bind(this.builder));

  // Tier 1 builders
  this.register('buildRaid', this.builder.buildRaid.bind(this.builder));  // ← NEW
}
```

**Note:** Builder name must match YAML config `builder` field.

---

### Step 4: Map Listener Method

**File:** `src/services/ingress/twitch/subscription-manager.ts`

Add listener method mapping in `SubscriptionManager.getListenerMethod()`.

#### Pattern

```typescript
private getListenerMethod(eventType: string): string | null {
  const mapping: Record<string, string> = {
    // ... existing mappings
    'channel.<event.type>': 'on<EventName>',  // Twurple listener method
  };

  return mapping[eventType] || null;
}
```

#### Example

```typescript
private getListenerMethod(eventType: string): string | null {
  const mapping: Record<string, string> = {
    'channel.follow': 'onChannelFollow',
    'channel.update': 'onChannelUpdate',
    'channel.raid': 'onChannelRaid',  // ← NEW
  };

  return mapping[eventType] || null;
}
```

#### Finding Listener Method Names

1. Check [Twurple EventSub Listener docs](https://twurple.js.org/reference/eventsub-ws/classes/EventSubWsListener.html)
2. Search for event type in Twurple source code
3. Listener methods follow pattern: `on<PascalCaseEventType>`

**Examples:**
- `channel.follow` → `onChannelFollow`
- `channel.subscribe` → `onChannelSubscribe`
- `channel.channel_points_custom_reward_redemption.add` → `onChannelRedemptionAdd`

---

### Step 5: Add YAML Configuration

**File:** `config/twitch-eventsub/subscriptions.yaml`

Add subscription config for the new event.

#### Pattern

```yaml
subscriptions:
  channel.<event.type>:
    enabled: false  # Disabled by default (opt-in)
    version: 1      # Twitch API version
    scope: "oauth:scope"  # Required OAuth scope (optional field)
    priority: high|medium|low
    builder: build<EventName>
    internalType: system.twitch.<event.name>
    description: "Human-readable description - includes key data points and volume notes"
    mutation:  # Optional - only for state-changing events
      key: "state.key"
      value: "state.value"
      ttl: 21600
```

#### Example: channel.raid

```yaml
subscriptions:
  channel.raid:
    enabled: false  # Disabled by default (opt-in)
    version: 1
    priority: high
    builder: buildRaid
    internalType: system.twitch.raid
    description: Broadcaster raids another channel - includes viewer count
```

#### Field Guidelines

| Field | Required | Guidelines |
|-------|----------|------------|
| `enabled` | ✅ Yes | `false` for new events (opt-in), `true` only for critical platform events |
| `version` | ❌ No | Twitch API version (default: `1`, use `2` if Twitch upgraded API) |
| `scope` | ❌ No | OAuth scope if event requires authorization (see Twitch docs) |
| `priority` | ❌ No | `critical` (stream state), `high` (engagement/monetization), `medium` (useful), `low` (high volume) |
| `builder` | ✅ Yes | Builder method name (must match registry registration) |
| `internalType` | ✅ Yes | Platform event type (follow existing naming patterns) |
| `description` | ❌ No | Human-readable description (mention volume if high, special requirements) |
| `mutation` | ❌ No | Only for state-changing events (stream.online, stream.offline) |

#### Categorization

Add event to correct section in YAML:

- **Core Events**: Platform essentials (follow, update, stream state) - enabled by default
- **Tier 1**: High-value engagement/monetization - disabled by default
- **Tier 2**: Moderation/high-volume - disabled by default, include HIGH VOLUME warning

---

### Step 6: Build and Test

Validate implementation.

```bash
# 1. Build
npm run build
# Expected: Clean compilation, no TypeScript errors

# 2. Run tests
npm test -- --testPathPattern="eventsub-envelope-builder"
# Expected: All tests passing, >85% coverage

# 3. Run all Twitch tests
npm test -- --testPathPattern="twitch"
# Expected: All 184+ tests passing

# 4. Validate config
npm run brat -- config validate config/twitch-eventsub/subscriptions.yaml
# Expected: YAML valid, schema passes
```

---

## Complete Example: channel.subscribe

### 1. Builder Method

```typescript
// src/services/ingress/twitch/eventsub-envelope-builder.ts
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
    id: `eventsub-${correlationId}`,
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
```

### 2. Tests

```typescript
// src/services/ingress/twitch/__tests__/eventsub-envelope-builder.spec.ts
describe('buildSubscribe()', () => {
  it('should map channel.subscribe to InternalEventV2', () => {
    const mockEvent = {
      userId: '98765',
      userName: 'subscriber',
      userDisplayName: 'Subscriber',
      broadcasterId: '12345',
      broadcasterName: 'streamer',
      broadcasterDisplayName: 'Streamer',
      tier: '1000' as const,
      isGift: false,
    };

    const result = builder.buildSubscribe(mockEvent, mockOpts);

    expect(result.type).toBe('system.twitch.subscribe');
    expect(result.identity.external.id).toBe('98765');
    expect(result.externalEvent.kind).toBe('channel.subscribe');
    expect(result.externalEvent.metadata.tier).toBe('1000');
    expect(result.externalEvent.metadata.isGift).toBe(false);
  });

  it('should handle gift subscriptions', () => {
    const mockEvent = {
      userId: '98765',
      userName: 'subscriber',
      userDisplayName: 'Subscriber',
      broadcasterId: '12345',
      broadcasterName: 'streamer',
      broadcasterDisplayName: 'Streamer',
      tier: '2000' as const,
      isGift: true,
    };

    const result = builder.buildSubscribe(mockEvent, mockOpts);

    expect(result.externalEvent.metadata.isGift).toBe(true);
    expect(result.externalEvent.metadata.tier).toBe('2000');
  });
});
```

### 3. Registry

```typescript
// src/services/ingress/twitch/event-builder-registry.ts
private registerBuilders(): void {
  // ... existing
  this.register('buildSubscribe', this.builder.buildSubscribe.bind(this.builder));
}
```

### 4. Listener Mapping

```typescript
// src/services/ingress/twitch/subscription-manager.ts
private getListenerMethod(eventType: string): string | null {
  const mapping: Record<string, string> = {
    // ... existing
    'channel.subscribe': 'onChannelSubscribe',
  };
  return mapping[eventType] || null;
}
```

### 5. YAML Config

```yaml
# config/twitch-eventsub/subscriptions.yaml
subscriptions:
  channel.subscribe:
    enabled: false
    version: 1
    scope: channel:read:subscriptions
    priority: high
    builder: buildSubscribe
    internalType: system.twitch.subscribe
    description: New subscription (excludes resubscriptions) - includes tier and gift status
```

---

## Testing in Agent-Dev

After implementing, test in agent-dev environment:

```bash
# 1. Provision agent-dev
agent_dev.provision({ name: "agent-dev-eventsub-test" })

# 2. Deploy ingress-egress service
bit deploy ingress-egress --context agent-dev-eventsub-test

# 3. Enable feature flag
# Edit .env in agent-dev:
ENABLE_EVENTSUB_YAML_CONFIG=true

# 4. Enable new event in config
# Edit subscriptions.yaml:
channel.subscribe:
  enabled: true

# 5. Restart service
bit deploy ingress-egress --context agent-dev-eventsub-test

# 6. Verify subscription created
twitch.eventsub.subscriptions.status()
# Expected: channel.subscribe listed with status "active"

# 7. Simulate event (if possible) or monitor logs

# 8. Clean up
agent_dev.destroy({ name: "agent-dev-eventsub-test", confirm: true })
```

---

## Common Pitfalls

### 1. Builder Method Name Mismatch

**Problem:** YAML `builder` field doesn't match registry registration

```yaml
# subscriptions.yaml
builder: buildRaid  # Must match exactly
```

```typescript
// event-builder-registry.ts
this.register('buildraid', ...);  // ❌ WRONG - case mismatch
this.register('buildRaid', ...);  // ✅ CORRECT
```

### 2. Listener Method Not Found

**Problem:** Event type → listener method mapping incorrect

```typescript
// ❌ WRONG
'channel.raid': 'onRaid'  // Missing "Channel" prefix

// ✅ CORRECT
'channel.raid': 'onChannelRaid'
```

**Fix:** Check Twurple documentation for exact method name.

### 3. Missing OAuth Scope

**Problem:** Event requires scope but not specified in YAML

```yaml
# ❌ WRONG - missing scope
channel.subscribe:
  enabled: true
  builder: buildSubscribe

# ✅ CORRECT
channel.subscribe:
  enabled: true
  scope: channel:read:subscriptions  # Required
  builder: buildSubscribe
```

**Symptom:** Subscription skipped with log `subscription_manager.scope_missing`

### 4. Identity Actor Incorrect

**Problem:** `identity.external.id` points to wrong user

```typescript
// For channel.follow:
identity: {
  external: {
    id: event.broadcasterId,  // ❌ WRONG - follower is actor, not broadcaster
  }
}

// ✅ CORRECT
identity: {
  external: {
    id: event.userId,  // Follower is the actor
  }
}
```

**Rule:** Identity should be the user performing the action (follower, subscriber, raider, etc.), NOT the broadcaster.

### 5. Internal Type Naming Inconsistency

**Problem:** Internal event type doesn't follow platform patterns

```yaml
# ❌ WRONG - inconsistent patterns
internalType: twitch.raid
internalType: raid.twitch
internalType: system.raid

# ✅ CORRECT - follow existing pattern
internalType: system.twitch.raid
```

**Rule:** Use `system.twitch.<event>` for Twitch platform events.

---

## Event-Specific Guidelines

### Moderation Events

- **Priority:** `medium`
- **Volume:** HIGH (mark in description)
- **Scope:** `channel:moderate`
- **Identity:** Target user (banned user, warned user, etc.)
- **Metadata:** Include moderator info, reason, duration

### Monetization Events

- **Priority:** `high`
- **Enabled:** `false` (opt-in)
- **Scope:** Varies (`channel:read:subscriptions`, `bits:read`, etc.)
- **Identity:** Paying user (subscriber, cheerer, etc.)
- **Metadata:** Include amounts, tiers, messages

### Community Events

- **Priority:** `medium` to `high`
- **Enabled:** `false` (opt-in)
- **Scope:** Often none
- **Identity:** Participating user (raider, poll voter, etc.)
- **Metadata:** Include engagement metrics (viewer count, votes, etc.)

### State-Changing Events

- **Priority:** `critical`
- **Enabled:** `true` (platform essential)
- **Mutation:** Required (stream.online, stream.offline only)
- **Identity:** Broadcaster

---

## Checklist

Before submitting PR:

- [ ] Builder method implemented in `eventsub-envelope-builder.ts`
- [ ] Unit tests added with >85% coverage
- [ ] Builder registered in `event-builder-registry.ts`
- [ ] Listener method mapped in `subscription-manager.ts`
- [ ] YAML config added to `subscriptions.yaml`
- [ ] `npm run build` succeeds
- [ ] All Twitch tests passing (`npm test -- --testPathPattern="twitch"`)
- [ ] Event tested in agent-dev (or documented why not possible)
- [ ] Identity actor is correct (user performing action, not broadcaster)
- [ ] OAuth scope documented (if required)
- [ ] High-volume events marked in description

---

## Reference

### Related Documentation

- [EventSub Config Guide](./twitch-eventsub-config.md)
- [EventSub Event Catalog](../reference/twitch-eventsub-catalog.md)
- [InternalEventV2 Schema](../reference/schemas/internal-event-v2.md)
- [Migration Guide](../../planning/sprint-16-aalwmj/migration-guide.md)

### External Resources

- [Twitch EventSub Subscription Types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/)
- [Twurple EventSubWsListener Reference](https://twurple.js.org/reference/eventsub-ws/classes/EventSubWsListener.html)
- [Twitch OAuth Scopes](https://dev.twitch.tv/docs/authentication/scopes/)

### Support

- Sprint Artifacts: `planning/sprint-16-aalwmj/`
- Example Implementation: M3 (Tier 1 events), M4 (Tier 2 events)
- Test Fixtures: `src/services/ingress/twitch/__tests__/eventsub-envelope-builder.spec.ts`

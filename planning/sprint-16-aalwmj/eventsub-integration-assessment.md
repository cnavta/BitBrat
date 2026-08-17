# EventSub Integration Assessment
**Sprint**: sprint-16-aalwmj
**Date**: 2026-08-16
**Status**: Integration Gap Identified

---

## Executive Summary

The EventSub infrastructure (M1-M4) is **fully implemented and tested** with all 22 event builders operational and 184/184 tests passing. However, **critical integration work is missing** - the EventSub client is never instantiated or started in production code.

**Impact**: EventSub cannot process any events until integrated into the service factory and connector adapter.

**Recommendation**: Expand M5 to include integration work (7 additional hours) before implementing observability features.

---

## Components Status

### ✅ COMPLETE - Core Infrastructure (M1-M4)

#### 1. Configuration System
- ✅ YAML config: `config/twitch-eventsub/subscriptions.yaml`
- ✅ JSON Schema: `config/schemas/eventsub-subscriptions.v1.yaml`
- ✅ Config Loader: `subscription-config-loader.ts` (with caching, reload)
- ✅ Config validation and parsing

#### 2. Event Builders (22 total)
- ✅ EventSubEnvelopeBuilder: 22 builder methods
  - 4 existing: follow, update, stream.online, stream.offline
  - 13 Tier 1 (M3): raid, subs, bits, channel points, hype trains, polls, predictions
  - 5 Tier 2 (M4): ban, unban, moderate, chat message, message delete
- ✅ EventBuilderRegistry: Builder registration and lookup
- ✅ All builders tested (184/184 tests passing)
- ✅ Integration tests updated for 22 builders

#### 3. Subscription Management
- ✅ SubscriptionManager class (`subscription-manager.ts`)
  - YAML-driven subscription orchestration
  - OAuth scope validation before subscription
  - Per-channel override support
  - Metrics tracking (eventCount, errorCount, timestamps)
  - getStatus() for monitoring
  - reloadConfig() for runtime updates
- ✅ Listener method mapping (22 EventSub types → Twurple methods)
- ✅ State mutation publisher integration

#### 4. EventSub Client
- ✅ TwitchEventSubClient class (`eventsub-client.ts`)
  - Feature flag support (ENABLE_EVENTSUB_YAML_CONFIG)
  - SubscriptionManager integration (line 131-136)
  - Hardcoded fallback for backward compatibility
  - getSnapshot() includes subscriptionStatus (line 385)
  - Mutation publisher support
  - Multi-channel support

### ❌ MISSING - Integration Layer

#### 1. Factory Integration (`factory.ts`)
**Problem**: EventSub client never instantiated

**Current State**:
```typescript
// Line 159-173: Only creates IRC client
const client = new TwitchIrcClient(
  envelopeBuilder,
  publisher,
  config.twitchChannels || [],
  { cfg: config, credentialsProvider, egressDestinationTopic, debugUsers }
);

return new TwitchConnectorAdapter(client); // Only wraps IRC
```

**Missing**:
- ❌ TwitchEventSubClient instantiation
- ❌ EventSub client start() call
- ❌ No way to access EventSub from connector

#### 2. Connector Adapter (`connector-adapter.ts`)
**Problem**: Only wraps IRC client, no EventSub exposure

**Current State**:
```typescript
export class TwitchConnectorAdapter implements IngressConnector {
  constructor(private readonly client: ITwitchIrcClient) {} // IRC only

  async start(): Promise<void> { await this.client.start(); }
  async stop(): Promise<void> { await this.client.stop(); }
  getSnapshot(): ConnectorSnapshot { return mapIrcSnapshot(this.client.getSnapshot()); }
}
```

**Missing**:
- ❌ EventSub client reference
- ❌ getSubscriptionStatus() method
- ❌ reloadSubscriptionConfig() method
- ❌ getSubscriptionList() method
- ❌ Dual-client lifecycle management

#### 3. Service Integration (`ingress-egress-service.ts`)
**Problem**: No EventSub-specific features

**Missing**:
- ❌ No MCP tools for EventSub observability
- ❌ No health check endpoint for EventSub
- ❌ No EventSub debug endpoint (/_debug/twitch/eventsub)

### 🔶 PARTIAL - Observability (M5)

#### 1. getSnapshot() Enhancement (M5-T5)
- ✅ EventSub client includes subscriptionStatus (eventsub-client.ts:385)
- ❌ Not exposed via connector adapter
- ❌ Not accessible from service layer

#### 2. Structured Logging
- ✅ Basic logging in SubscriptionManager
  - subscription_manager.event_received (line 209)
  - subscription_manager.event_processed (line 231)
  - subscription_manager.handler_error (line 237)
- ✅ Event processing logs with correlationId potential
- 🔶 Could add more context (builder name, internal type)

#### 3. Metrics
- ✅ Subscription metrics tracked in SubscriptionStatus interface:
  - eventCount, errorCount
  - createdAt, lastEventAt, lastErrorAt
- ❌ Not exposed via MCP tools
- ❌ No dedicated metrics endpoint

---

## Integration Gaps - Priority Order

### P0 - Critical for EventSub to Work

#### 1. Modify factory.ts to create EventSub client
**File**: `src/services/ingress/twitch/factory.ts`
**Effort**: 2 hours

**Changes**:
- Import TwitchEventSubClient
- Instantiate alongside IRC client with same credentials/config/publisher
- Return both clients (or composite wrapper)

**Approach**:
```typescript
// After line 170 (IRC client creation)
const eventSubClient = new TwitchEventSubClient(
  publisher,
  config.twitchChannels || [],
  { cfg: config, credentialsProvider, egressDestinationTopic }
);

// Option A: Return composite adapter
return new TwitchConnectorAdapter(client, eventSubClient);

// Option B: Start EventSub in factory, return IRC adapter with reference
await eventSubClient.start(); // Only if ENABLE_EVENTSUB_YAML_CONFIG=true
// ... store reference for later access
```

#### 2. Update connector-adapter.ts for dual clients
**File**: `src/services/ingress/twitch/connector-adapter.ts`
**Effort**: 2 hours

**Changes**:
- Accept optional EventSub client in constructor
- Expose EventSub methods:
  - `getSubscriptionStatus(): SubscriptionStatus[]`
  - `reloadSubscriptionConfig(): Promise<void>`
  - `listSubscriptions(): SubscriptionConfig`
- Update getSnapshot() to include EventSub data when available
- Manage both client lifecycles (start/stop)

**Approach**:
```typescript
export class TwitchConnectorAdapter implements IngressConnector {
  constructor(
    private readonly ircClient: ITwitchIrcClient,
    private readonly eventSubClient?: TwitchEventSubClient
  ) {}

  async start(): Promise<void> {
    await this.ircClient.start();
    if (this.eventSubClient) {
      await this.eventSubClient.start();
    }
  }

  getSubscriptionStatus(): SubscriptionStatus[] {
    return this.eventSubClient?.getSnapshot().subscriptionStatus || [];
  }

  async reloadSubscriptionConfig(): Promise<void> {
    // Access via eventSubClient internals (may need to expose on client)
  }
}
```

#### 3. Feature flag handling
**File**: `src/services/ingress/twitch/factory.ts`
**Effort**: 1 hour

**Changes**:
- Check ENABLE_EVENTSUB_YAML_CONFIG before starting EventSub
- Log EventSub enable/disable state
- Graceful fallback if EventSub disabled

### P1 - Required for M5 (Observability)

#### 4. Add MCP tools to ingress-egress service
**File**: `src/apps/ingress-egress-service.ts` (or IntegrationBit base)
**Effort**: 6 hours (2h each tool)

**Tools**:
1. `twitch.eventsub.subscriptions.list` (M5-T1)
   - Returns array of subscription configs from YAML
   - Shows enabled status, builder name, internal type

2. `twitch.eventsub.subscriptions.status` (M5-T2)
   - Calls connector.getSubscriptionStatus()
   - Returns runtime health: eventCount, errorCount, timestamps
   - Filterable by channel

3. `twitch.eventsub.config.reload` (M5-T3)
   - Calls connector.reloadSubscriptionConfig()
   - Returns success/error status
   - Note: Does NOT recreate subscriptions (requires restart)

**Approach**:
```typescript
// In ingress-egress-service.ts or via setup() hook
const twitchConnector = this.connectorManager.getConnector('twitch');

this.registerTool(
  'twitch.eventsub.subscriptions.status',
  'Get EventSub subscription health status',
  z.object({ channel: z.string().optional() }),
  async (args) => {
    const status = twitchConnector?.getSubscriptionStatus() || [];
    return args.channel
      ? status.filter(s => s.channel === args.channel)
      : status;
  }
);
```

#### 5. Add health check endpoint
**File**: `src/common/integration-bit.ts` or connector-specific
**Effort**: 1 hour

**Endpoint**: `/_debug/twitch/eventsub`

**Response**:
```json
{
  "enabled": true,
  "useYamlConfig": true,
  "subscriptionCount": 22,
  "activeSubscriptions": 4,
  "totalEvents": 1523,
  "totalErrors": 2,
  "subscriptions": [
    {"channel": "bitbrat", "eventType": "channel.follow", "status": "active", "eventCount": 45}
  ]
}
```

#### 6. Enhanced logging
**Files**: `subscription-manager.ts`, `eventsub-client.ts`
**Effort**: 2 hours

**Enhancements**:
- Add builder name to event_processed logs
- Add internal type to event logs
- Ensure correlationId in all event logs
- Add subscription lifecycle events (created, failed, unsubscribed)

### P2 - Nice to Have

#### 7. Integration tests (M2-T13, deferred)
**File**: New test file
**Effort**: 3 hours

**Tests**:
- Mock Twurple EventSubWsListener
- Load real YAML config
- Verify subscriptions created
- Simulate events, verify InternalEventV2 published
- Test channel overrides
- Test scope validation

#### 8. Documentation (M2-T14, deferred to M7)
**File**: `documentation/reference/environment-variables.md`
**Effort**: 0.5 hours

**Content**:
- ENABLE_EVENTSUB_YAML_CONFIG flag
- Migration path from hardcoded to YAML
- Feature flag rollout strategy

---

## Revised M5 Task Breakdown

### Phase 1: Integration (Missing M2 Work) - 7 hours

| Task | File | Effort | Priority |
|------|------|--------|----------|
| M5-INT-1: Create EventSub client in factory | factory.ts | 2h | P0 |
| M5-INT-2: Update connector adapter for dual clients | connector-adapter.ts | 2h | P0 |
| M5-INT-3: Feature flag handling | factory.ts | 1h | P0 |
| M5-INT-4: Integration testing in agent-dev | Manual | 2h | P0 |

### Phase 2: Observability (Original M5) - 14 hours

| Task | File | Effort | Priority |
|------|------|--------|----------|
| M5-T1: MCP tool - list subscriptions | ingress-egress-service.ts | 2h | P1 |
| M5-T2: MCP tool - subscription status | ingress-egress-service.ts | 2h | P1 |
| M5-T3: MCP tool - config reload | ingress-egress-service.ts | 2h | P1 |
| M5-T4: Health check endpoint | integration-bit.ts | 1h | P1 |
| M5-T5: Enhanced getSnapshot() | ✅ Complete | 0h | - |
| M5-T6: Structured logging - subscriptions | subscription-manager.ts | 1h | P1 |
| M5-T7: Structured logging - events | subscription-manager.ts | 1h | P1 |
| M5-T8: Metrics infrastructure | ✅ Complete | 0h | - |
| M5-T9: MCP tool tests | New test file | 2h | P1 |
| M5-T10: Milestone review | Documentation | 1h | P0 |

**Phase 1 Total**: 7 hours
**Phase 2 Total**: 12 hours (was 14h, -2h for already complete work)
**M5 Total**: 19 hours (was 15 hours estimated)

---

## Recommendation

**Proceed with revised M5 in two phases**:

1. **Phase 1 (Integration)**: Wire EventSub into production service
   - Enables EventSub to actually run
   - Validates in agent-dev before observability work
   - Unblocks Phase 2

2. **Phase 2 (Observability)**: Add MCP tools and monitoring
   - Now works with real running EventSub
   - Can be tested end-to-end
   - Provides operational visibility

**Alternative**: Defer integration to M6 and add stub MCP tools in M5
- Tools return "EventSub not enabled"
- Less value, but faster M5 completion
- Integration risk pushed to M6

**Recommended**: Proceed with full integration in M5 Phase 1 for end-to-end validation.

---

**Assessment Date**: 2026-08-16
**Assessor**: Claude Code
**Next Action**: Update backlog.yaml with revised M5 tasks

# M5 Integration Plan
**Sprint**: sprint-16-aalwmj
**Date**: 2026-08-16
**Status**: Ready for Implementation

---

## Executive Summary

**Critical Finding**: EventSub infrastructure (M1-M4) is complete and tested (184/184 tests passing), but **EventSub client is never instantiated in production code**. This integration gap must be resolved before observability features can be added.

**Solution**: Expand M5 into two phases:
- **Phase 1 (NEW)**: Integration work (7 hours) - Wire EventSub into production
- **Phase 2 (ORIGINAL)**: Observability work (12 hours) - MCP tools, health checks, logging

**Total M5 Effort**: 22 hours (was 15 hours, +7h for integration)

---

## Phase 1: Integration (M5-INT-1 through M5-INT-4) - 7 hours

### M5-INT-1: Create EventSub Client in Factory (2h) ⚡ CRITICAL

**File**: `src/services/ingress/twitch/factory.ts`

**Current State**:
```typescript
// Line 159-173: Only creates IRC client
const client = new TwitchIrcClient(...);
return new TwitchConnectorAdapter(client); // EventSub never created!
```

**Implementation**:
```typescript
// After IRC client creation (line 170)
import { TwitchEventSubClient } from './eventsub-client';

// Create EventSub client with same credentials/config
const eventSubClient = new TwitchEventSubClient(
  publisher,
  config.twitchChannels || [],
  {
    cfg: config,
    credentialsProvider,
    egressDestinationTopic,
  }
);

// Return connector adapter with both clients
return new TwitchConnectorAdapter(client, eventSubClient);
```

**Acceptance**:
- ✅ Import TwitchEventSubClient
- ✅ Instantiate with same credentials/config as IRC client
- ✅ Pass to connector adapter constructor
- ✅ Build succeeds, no TypeScript errors

---

### M5-INT-2: Update Connector Adapter for Dual Clients (2h) ⚡ CRITICAL

**File**: `src/services/ingress/twitch/connector-adapter.ts`

**Current State**:
```typescript
export class TwitchConnectorAdapter implements IngressConnector {
  constructor(private readonly client: ITwitchIrcClient) {} // IRC only

  async start(): Promise<void> { await this.client.start(); }
  async stop(): Promise<void> { await this.client.stop(); }
  getSnapshot(): ConnectorSnapshot { return mapIrcSnapshot(...); }
}
```

**Implementation**:
```typescript
import { TwitchEventSubClient } from './eventsub-client';
import { SubscriptionStatus } from './subscription-manager';

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

  async stop(): Promise<void> {
    await this.ircClient.stop();
    if (this.eventSubClient) {
      await this.eventSubClient.stop();
    }
  }

  getSnapshot(): ConnectorSnapshot {
    const ircSnapshot = mapIrcSnapshot(this.ircClient.getSnapshot());

    if (this.eventSubClient) {
      const eventSubSnapshot = this.eventSubClient.getSnapshot();
      return {
        ...ircSnapshot,
        eventSub: {
          enabled: true,
          useYamlConfig: eventSubSnapshot.useYamlConfig,
          subscriptionCount: eventSubSnapshot.subscriptions,
          subscriptionStatus: eventSubSnapshot.subscriptionStatus,
        }
      };
    }

    return ircSnapshot;
  }

  // EventSub-specific methods for MCP tools
  getSubscriptionStatus(): SubscriptionStatus[] {
    if (!this.eventSubClient) return [];
    return this.eventSubClient.getSnapshot().subscriptionStatus || [];
  }

  async reloadSubscriptionConfig(): Promise<void> {
    if (!this.eventSubClient || !this.eventSubClient['subscriptionManager']) {
      throw new Error('EventSub not enabled or subscription manager not available');
    }
    // Access subscription manager (may need to expose on client)
    await this.eventSubClient['subscriptionManager'].reloadConfig();
  }

  listSubscriptions(): any {
    if (!this.eventSubClient || !this.eventSubClient['subscriptionManager']) {
      return { subscriptions: {}, channelOverrides: {} };
    }
    // Return loaded config (may need to expose on client)
    return this.eventSubClient['config'] || { subscriptions: {}, channelOverrides: {} };
  }
}
```

**Acceptance**:
- ✅ Accept optional EventSub client in constructor
- ✅ Manage both client lifecycles (start/stop)
- ✅ Update getSnapshot() to include EventSub data when available
- ✅ Expose getSubscriptionStatus() method
- ✅ Expose reloadSubscriptionConfig() method
- ✅ Expose listSubscriptions() method
- ✅ Graceful handling when EventSub not provided

---

### M5-INT-3: Feature Flag and Error Handling (1h) ⚡ CRITICAL

**Files**:
- `src/services/ingress/twitch/factory.ts`
- `src/services/ingress/twitch/connector-adapter.ts`

**Implementation**:

**In factory.ts**:
```typescript
// After EventSub client creation
const useYamlConfig = process.env.ENABLE_EVENTSUB_YAML_CONFIG === 'true';

if (useYamlConfig) {
  logger.info('twitch.factory.eventsub.enabled', {
    channels: config.twitchChannels,
    yamlConfig: true,
  });
} else {
  logger.info('twitch.factory.eventsub.disabled', {
    reason: 'ENABLE_EVENTSUB_YAML_CONFIG not set',
  });
}

// EventSub client created regardless, but only started if flag enabled
// (start() call happens in connector adapter based on flag)
```

**In connector-adapter.ts start()**:
```typescript
async start(): Promise<void> {
  await this.ircClient.start();

  if (this.eventSubClient) {
    try {
      await this.eventSubClient.start(); // Has internal feature flag check
      logger.info('twitch.connector.eventsub.started');
    } catch (error: any) {
      logger.error('twitch.connector.eventsub.start_failed', {
        error: error.message,
        stack: error.stack,
      });
      // Fail-open: Continue even if EventSub fails to start
    }
  }
}
```

**Acceptance**:
- ✅ Check feature flag before starting EventSub
- ✅ Log EventSub enable/disable state
- ✅ Graceful error handling if EventSub start fails
- ✅ EventSub methods return empty/null when not available
- ✅ IRC continues to work even if EventSub fails

---

### M5-INT-4: Validation in agent-dev (2h) ⚡ CRITICAL

**Objective**: Deploy to agent-dev and validate end-to-end EventSub integration

**Steps**:

1. **Provision agent-dev context**:
```bash
mcp__bitbrat-dev__agent_dev_provision({ name: "agent-dev-m5-eventsub" })
```

2. **Deploy ingress-egress service**:
```bash
# In agent-dev context, set feature flag
export ENABLE_EVENTSUB_YAML_CONFIG=true

# Deploy service
bit deploy ingress-egress --context agent-dev-m5-eventsub
```

3. **Verify EventSub client starts**:
```bash
# Check logs for EventSub startup
fleet.logs({
  bit: "ingress-egress",
  context: "agent-dev-m5-eventsub",
  level: ["info", "error"]
})

# Look for:
# - "twitch.factory.eventsub.enabled"
# - "twitch.eventsub.starting"
# - "twitch.eventsub.started"
# - "subscription_manager.subscribed" (for each enabled event)
```

4. **Verify getSnapshot() includes EventSub data**:
```bash
# Use bit.info or debug endpoint
fleet.info({ bit: "ingress-egress", context: "agent-dev-m5-eventsub" })

# Check for eventSub section in snapshot
```

5. **Verify subscription creation**:
```bash
# Check logs for subscription manager activity
# Look for enabled events being subscribed
```

6. **Clean up**:
```bash
mcp__bitbrat-dev__agent_dev_destroy({
  name: "agent-dev-m5-eventsub",
  confirm: true
})
```

**Acceptance**:
- ✅ Agent-dev context provisioned successfully
- ✅ Service deploys without errors
- ✅ EventSub client starts (logs confirm)
- ✅ Subscriptions created (logs show subscription_manager.subscribed)
- ✅ getSnapshot() includes eventSub data
- ✅ No errors in logs (or only expected errors)
- ✅ Context cleaned up

**Expected Log Output**:
```
[INFO] twitch.factory.eventsub.enabled { channels: ["bitbrat"], yamlConfig: true }
[INFO] twitch.eventsub.starting { channels: ["bitbrat"] }
[INFO] twitch.eventsub.using_yaml_config { channels: ["bitbrat"] }
[INFO] subscription_manager.initialized { builderCount: 22, builders: [...] }
[INFO] subscription_manager.subscribing_channel { channel: "bitbrat", userId: "...", moderatorUserId: "..." }
[INFO] subscription_manager.subscribed { eventType: "channel.follow", channel: "bitbrat", internalType: "system.twitch.follow" }
... (repeated for each enabled event)
[INFO] twitch.eventsub.started { useYamlConfig: true }
[INFO] twitch.connector.eventsub.started
```

---

## Phase 2: Observability (M5-T1 through M5-T10) - 12 hours

### M5-T1: MCP Tool - List Subscriptions (2h)

**File**: `src/apps/ingress-egress-service.ts` or via setup() override

**Implementation**:
```typescript
// In service setup() or constructor
protected async setup(): Promise<void> {
  await super.setup(); // IntegrationBit setup

  // Access Twitch connector
  const twitchConnector = this.connectorManager.getConnector('twitch') as TwitchConnectorAdapter;

  if (twitchConnector) {
    this.registerTool(
      'twitch.eventsub.subscriptions.list',
      'List all EventSub subscription configurations from YAML',
      z.object({}),
      async () => {
        try {
          const config = twitchConnector.listSubscriptions();
          return {
            version: config.version || 1,
            subscriptionCount: Object.keys(config.subscriptions || {}).length,
            enabledCount: Object.values(config.subscriptions || {}).filter((s: any) => s.enabled).length,
            subscriptions: config.subscriptions || {},
            channelOverrides: config.channelOverrides || {},
          };
        } catch (error: any) {
          return {
            error: error.message,
            available: false,
            reason: 'EventSub not enabled or config not loaded',
          };
        }
      }
    );
  }
}
```

**Acceptance**:
- ✅ Returns subscription config from YAML
- ✅ Shows enabled/disabled status for each event
- ✅ Includes subscription count, enabled count
- ✅ Returns error object if EventSub not available
- ✅ Tool registered in service

### M5-T2: MCP Tool - Subscription Status (2h)

**Implementation**:
```typescript
this.registerTool(
  'twitch.eventsub.subscriptions.status',
  'Get runtime EventSub subscription health status',
  z.object({
    channel: z.string().optional().describe('Filter by channel name')
  }),
  async (args) => {
    try {
      const allStatus = twitchConnector.getSubscriptionStatus();
      const filtered = args.channel
        ? allStatus.filter(s => s.channel === args.channel)
        : allStatus;

      return {
        totalSubscriptions: allStatus.length,
        filteredCount: filtered.length,
        subscriptions: filtered.map(s => ({
          channel: s.channel,
          eventType: s.eventType,
          status: s.status,
          eventCount: s.eventCount,
          errorCount: s.errorCount,
          createdAt: s.createdAt,
          lastEventAt: s.lastEventAt,
          lastErrorAt: s.lastErrorAt,
        })),
      };
    } catch (error: any) {
      return {
        error: error.message,
        available: false,
      };
    }
  }
);
```

**Acceptance**:
- ✅ Returns runtime subscription status
- ✅ Includes eventCount, errorCount, timestamps
- ✅ Filterable by channel (optional)
- ✅ Returns empty array if EventSub not available

### M5-T3: MCP Tool - Config Reload (2h)

**Implementation**:
```typescript
this.registerTool(
  'twitch.eventsub.config.reload',
  'Reload EventSub YAML config without restart (NOTE: Does not recreate subscriptions)',
  z.object({}),
  async () => {
    try {
      await twitchConnector.reloadSubscriptionConfig();
      return {
        success: true,
        message: 'Config reloaded successfully',
        note: 'Existing subscriptions NOT updated - requires service restart',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
);
```

**Acceptance**:
- ✅ Calls SubscriptionManager.reloadConfig()
- ✅ Returns success/error status
- ✅ Warns that subscriptions not recreated
- ✅ Returns error if EventSub not available

### M5-T4: Health Check Endpoint (1h)

Add debug endpoint in `integration-bit.ts` or connector-specific handler:

```typescript
// In setupDebugEndpoints() or similar
this.app.get('/_debug/twitch/eventsub', (req, res) => {
  const connector = this.connectorManager.getConnector('twitch') as TwitchConnectorAdapter;

  if (!connector) {
    return res.json({ enabled: false, reason: 'Twitch connector not found' });
  }

  const snapshot = connector.getSnapshot();
  const eventSubData = snapshot.eventSub || { enabled: false };

  if (!eventSubData.enabled) {
    return res.json({ enabled: false, reason: 'EventSub not enabled' });
  }

  const status = connector.getSubscriptionStatus();

  res.json({
    enabled: true,
    useYamlConfig: eventSubData.useYamlConfig,
    subscriptionCount: eventSubData.subscriptionCount,
    activeSubscriptions: status.filter(s => s.status === 'active').length,
    totalEvents: status.reduce((sum, s) => sum + s.eventCount, 0),
    totalErrors: status.reduce((sum, s) => sum + s.errorCount, 0),
    subscriptions: status,
  });
});
```

**Acceptance**:
- ✅ Endpoint returns EventSub health data
- ✅ Includes subscription counts
- ✅ Includes event/error totals
- ✅ Returns per-subscription details

### M5-T5: Enhanced getSnapshot() ✅ ALREADY COMPLETE

**Status**: Complete in eventsub-client.ts:385

```typescript
getSnapshot() {
  return {
    // ... existing fields
    subscriptionStatus: this.subscriptionManager?.getStatus() || []
  };
}
```

No additional work needed - already implemented in M2/M3.

### M5-T6 & M5-T7: Structured Logging (2h)

Already mostly complete in subscription-manager.ts. Minor enhancements:

```typescript
// Add builder name and internal type to logs
logger.debug('subscription_manager.event_processed', {
  eventType,
  channel: channelName,
  internalType: eventConfig.internalType,
  builderName: eventConfig.builder,
  correlationId: internalEvent.correlationId, // Already in event
});
```

### M5-T8: Metrics Infrastructure ✅ ALREADY COMPLETE

**Status**: Complete in subscription-manager.ts (SubscriptionStatus interface)

Metrics already tracked:
- eventCount, errorCount
- createdAt, lastEventAt, lastErrorAt
- status (active/error/unsubscribed)

### M5-T9: MCP Tool Tests (2h)

Create test file testing all 3 MCP tools with mocked connector.

### M5-T10: Milestone Review (1h)

Create milestone-5-review.md documenting all integration and observability work.

---

## Summary

**Phase 1 (Integration)**:
- 4 critical tasks (M5-INT-1 through M5-INT-4)
- 7 hours effort
- Unblocks EventSub production use

**Phase 2 (Observability)**:
- 10 tasks (M5-T1 through M5-T10)
- 12 hours effort (down from 15h, as M5-T5 and M5-T8 already complete)
- MCP tools, health checks, logging

**Total M5**: 14 tasks, 19 hours

**Ready to Begin**: M5-INT-1 (Create EventSub client in factory)

---

**Document Created**: 2026-08-16
**Created By**: Claude Code
**Sprint**: sprint-16-aalwmj
**Status**: Ready for Implementation

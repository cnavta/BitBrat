# IntegrationBit Evolution Strategy
**Sprint**: sprint-13-eahhvf
**Role**: Architect
**Date**: 2026-08-14
**Status**: Design Proposal

---

## Executive Summary

**Question**: How does IntegrationBit factor into the Event Gateway architecture? Should it merge with the new components or be enhanced?

**Answer**: **IntegrationBit should evolve into the Event Gateway orchestrator through composition**, not replacement.

**Rationale**:
- ✅ IntegrationBit already does 80% of what an Event Gateway needs (lifecycle, routing, observability)
- ✅ Adding Event Registry, Translation Engine, and Subscription Manager as composed dependencies is clean architecture
- ✅ Backward compatible - existing functionality preserved while adding new capabilities
- ✅ Single point of integration - IntegrationBit remains the base class for all platform integrations

**Recommendation**: Enhance IntegrationBit by composing Event Gateway components, not by creating parallel systems.

---

## Current IntegrationBit Analysis

### Current Responsibilities (784 lines)

```typescript
export class IntegrationBit extends Bit {
  private connectorManager: ConnectorManager;          // ✅ Already manages connectors
  private instanceId: string;                          // ✅ Already instance-aware
  private egressTopic: string;                         // ✅ Already routes egress
  private statusMonitorInterval?: NodeJS.Timeout;      // ✅ Already monitors status

  constructor(config: IntegrationBitConfig) {
    // 1. Connector registration
    // 2. Webhook routing setup
    // 3. Egress routing setup
    // 4. Status monitoring setup
    // 5. Debug endpoints setup
  }

  private async registerConnectors() { /* ... */ }     // ✅ Connector lifecycle
  private setupWebhookRouting() { /* ... */ }          // ✅ Inbound routing
  private async setupEgressRouting() { /* ... */ }     // ✅ Outbound routing
  private async processEgress(event) { /* ... */ }     // ⚠️ Needs enhancement
  private setupStatusMonitoring() { /* ... */ }        // ✅ Observability
  private setupDebugEndpoints() { /* ... */ }          // ✅ Introspection
}
```

### Strengths

| Capability | Status | Notes |
|------------|--------|-------|
| **Connector Lifecycle** | ✅ Excellent | ConnectorManager handles start/stop/status |
| **Instance Management** | ✅ Excellent | Instance-specific egress topics, Cloud Run aware |
| **Webhook Routing** | ✅ Good | Generic POST /webhooks/:platform |
| **Egress Subscription** | ✅ Excellent | Dual subscription (instance + generic) |
| **Status Monitoring** | ✅ Excellent | Auto-publishes connector state changes |
| **Debug Endpoints** | ✅ Good | /_debug/instance, /_debug/connectors |
| **Fail-Open Strategy** | ✅ Excellent | Connector failures don't crash service |

### Weaknesses (What's Missing)

| Capability | Status | Impact |
|------------|--------|--------|
| **Event Type Awareness** | ❌ Missing | Treats all events as generic blobs |
| **Bidirectional Translation** | ❌ Missing | Only extracts text from egress events |
| **Event Registry** | ❌ Missing | No mapping of event types to platform capabilities |
| **Dynamic Subscriptions** | ❌ Missing | All subscriptions static at startup |
| **Capability Discovery** | ❌ Missing | Can't query what events a platform supports |
| **DM Routing** | ❌ Missing | Always calls `sendText()`, never `sendDM()` |

---

## Proposed Architecture: IntegrationBit as Event Gateway Orchestrator

### Design Principle: Composition Over Inheritance

**IntegrationBit should NOT become a monolithic "do everything" class.**

Instead, it should **orchestrate specialized components** via composition:

```typescript
export class IntegrationBit extends Bit {
  // Existing
  private connectorManager: ConnectorManager;          // ✅ Keep
  private instanceId: string;                          // ✅ Keep
  private egressTopic: string;                         // ✅ Keep

  // NEW: Event Gateway components (composed dependencies)
  private eventRegistry: EventRegistry;                // 🆕 Event type mappings
  private translationEngine: TranslationEngine;        // 🆕 Bidirectional translation
  private subscriptionManager: SubscriptionManager;    // 🆕 Runtime subscription control

  constructor(config: IntegrationBitConfig) {
    super({ serviceName: config.serviceName });

    // Existing initialization
    this.instanceId = this.resolveInstanceId();
    this.egressTopic = `internal.egress.v1.${this.instanceId}`;
    this.connectorManager = new ConnectorManager({ logger: this.getLogger() });

    // NEW: Initialize Event Gateway components
    this.eventRegistry = new EventRegistry();           // 🆕
    this.translationEngine = new TranslationEngine(     // 🆕
      this.eventRegistry,
      this.getLogger()
    );
    this.subscriptionManager = new SubscriptionManager( // 🆕
      this.eventRegistry,
      this.connectorManager,
      this.getResource('documentStore'),
      this.getLogger()
    );

    // Existing setup (enhanced)
    this.registerConnectors();           // ✅ Keep
    this.setupWebhookRouting();          // 🔧 Enhance (use event type detection)
    this.setupEgressRouting();           // 🔧 Enhance (use translation engine)
    this.setupStatusMonitoring();        // ✅ Keep
    this.setupDebugEndpoints();          // ✅ Keep
    this.setupSubscriptionTools();       // 🆕 Add MCP tools
  }
}
```

### Key Insight: Single Responsibility Separation

Each component has a **single, well-defined responsibility**:

| Component | Responsibility | Used By |
|-----------|---------------|---------|
| **EventRegistry** | Event type → platform mapping | TranslationEngine, SubscriptionManager |
| **TranslationEngine** | Bidirectional event translation | processEgress (outbound), webhook routing (inbound) |
| **SubscriptionManager** | Runtime subscription control | MCP tools, dynamic event management |
| **ConnectorManager** | Connector lifecycle | IntegrationBit (existing) |
| **IntegrationBit** | Orchestration + integration glue | Application layer |

**IntegrationBit's role**: Orchestrate these components to provide a unified Event Gateway interface.

---

## Detailed Component Integration

### 1. EventRegistry Integration

**Purpose**: Central registry of event type definitions.

**Integration Point**: Injected into TranslationEngine and SubscriptionManager.

```typescript
// IntegrationBit constructor
this.eventRegistry = new EventRegistry();

// Option 1: Load from configuration file
await this.eventRegistry.loadFromFile('./config/event-registry.json');

// Option 2: Register events programmatically
this.eventRegistry.register(CHAT_MESSAGE_V1);
this.eventRegistry.register(DIRECT_MESSAGE_V1);
this.eventRegistry.register(REACTION_ADD_V1);

// Option 3: Auto-discover from connectors (advanced)
for (const connector of this.connectorManager.listConnectors()) {
  const metadata = connector.getMetadata?.();
  if (metadata?.supportedEvents) {
    this.eventRegistry.registerPlatformEvents(metadata.platform, metadata.supportedEvents);
  }
}
```

**No changes to existing IntegrationBit behavior** - registry is passive until used by other components.

---

### 2. TranslationEngine Integration

**Purpose**: Bidirectional translation between internal events and platform actions.

**Integration Points**:
1. **Outbound** (existing `processEgress` method)
2. **Inbound** (new webhook event type detection)

#### 2.1 Enhanced `processEgress` (Outbound Translation)

**Before** (current implementation):

```typescript
private async processEgress(event: InternalEventV2): Promise<void> {
  const platform = event.egress?.connector;
  const connector = this.connectorManager.getConnectorByPlatform(platform);
  const text = extractEgressTextFromEvent(event);  // ⚠️ Text-only
  const targetChannel = event.egress?.channel || event.ingress?.channel;

  await egressConnector.sendText(text, targetChannel);  // ⚠️ Always sendText()
}
```

**After** (with TranslationEngine):

```typescript
private async processEgress(event: InternalEventV2): Promise<void> {
  const logger = this.getLogger();
  const platform = event.egress?.connector;
  const connector = this.connectorManager.getConnectorByPlatform(platform);

  if (!connector) {
    logger.warn('integration-bit.egress-unknown-platform', { platform });
    return;
  }

  try {
    // 🆕 Use translation engine for bidirectional translation
    const translation = await this.translationEngine.translateOutbound(event, platform);

    if (!translation) {
      // Fallback to legacy text extraction if translation fails
      logger.warn('integration-bit.egress-translation-failed', {
        type: event.type,
        platform,
        fallback: 'legacy_text_extraction'
      });

      const text = extractEgressTextFromEvent(event);
      const target = event.egress?.channel || event.ingress?.channel;
      await (connector as EgressConnector).sendText(text, target);
      return;
    }

    // 🆕 Call platform-specific method with translated payload
    const method = (connector as any)[translation.method];
    if (typeof method !== 'function') {
      logger.error('integration-bit.egress-method-not-found', {
        method: translation.method,
        platform
      });
      return;
    }

    // 🆕 Dynamic method invocation based on event type
    await method.call(connector, ...translation.args);

    logger.info('integration-bit.egress-sent', {
      correlationId: event.correlationId,
      platform,
      method: translation.method,
      eventType: event.type
    });

  } catch (error) {
    logger.error('integration-bit.egress-error', {
      correlationId: event.correlationId,
      platform,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
```

**Key Changes**:
- ✅ Uses `translationEngine.translateOutbound()` to map event type → platform method
- ✅ Dynamically calls correct method (`sendText`, `sendDM`, `addReaction`, etc.)
- ✅ Fallback to legacy text extraction for backward compatibility
- ✅ Event type aware (can route DMs, reactions, etc.)

#### 2.2 Enhanced Webhook Routing (Inbound Translation)

**Before** (current implementation):

```typescript
private setupWebhookRouting(): void {
  app.post('/webhooks/:platform', async (req, res) => {
    const platform = req.params.platform;
    const connector = this.connectorManager.getConnectorByPlatform(platform);

    // Verify signature
    const isValid = webhookConnector.verifySignature(req);
    if (!isValid) return res.status(403).json({ error: 'invalid_signature' });

    // Handle webhook (platform-specific logic in connector)
    const response = await webhookConnector.handleWebhook(req);
    return res.status(response.status).json(response.body);
  });
}
```

**After** (with event type detection):

```typescript
private setupWebhookRouting(): void {
  app.post('/webhooks/:platform', async (req, res) => {
    const platform = req.params.platform;
    const connector = this.connectorManager.getConnectorByPlatform(platform);

    if (!connector) {
      return res.status(404).json({ error: 'unknown_platform' });
    }

    const webhookConnector = connector as unknown as WebhookConnector;
    if (!webhookConnector.verifySignature || !webhookConnector.handleWebhook) {
      return res.status(501).json({ error: 'webhooks_not_supported' });
    }

    // Verify signature (existing)
    const isValid = webhookConnector.verifySignature(req);
    if (!isValid) {
      return res.status(403).json({ error: 'invalid_signature' });
    }

    // 🆕 Detect event type from platform webhook payload
    const platformEventType = this.detectWebhookEventType(platform, req.body);

    // 🆕 Log event type for observability
    this.getLogger().info('integration-bit.webhook-received', {
      platform,
      platformEventType,
      internalEventType: this.eventRegistry.findByPlatformEvent(platform, platformEventType)?.type
    });

    // Handle webhook (existing)
    const response = await webhookConnector.handleWebhook(req);
    return res.status(response.status).json(response.body);
  });
}

/**
 * 🆕 Detect platform event type from webhook payload
 */
private detectWebhookEventType(platform: string, payload: any): string {
  switch (platform) {
    case 'discord':
      return payload.t || 'unknown';  // Discord event type in 't' field
    case 'slack':
      return payload.event?.type || payload.type || 'unknown';
    case 'twilio':
      return payload.EventType || 'message';
    default:
      return 'unknown';
  }
}
```

**Key Changes**:
- ✅ Detects platform event type from webhook payload
- ✅ Maps platform event type to internal event type (via EventRegistry)
- ✅ Logs event type for observability
- ✅ Foundation for event-type-specific webhook handling

---

### 3. SubscriptionManager Integration

**Purpose**: Runtime control of event subscriptions.

**Integration Point**: MCP tools for subscription management.

```typescript
private setupSubscriptionTools(): void {
  // 🆕 MCP Tool: Subscribe to event
  this.registerTool(
    'subscribe_to_event',
    'Subscribe to an external platform event at runtime',
    {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['discord', 'slack', 'twitch'] },
        eventType: { type: 'string', description: 'Internal event type (e.g., reaction.add.v1)' },
        target: { type: 'string', description: 'Channel ID or user ID' }
      },
      required: ['platform', 'eventType', 'target']
    },
    async (args) => {
      const { platform, eventType, target } = args;

      const subscription = await this.subscriptionManager.subscribe(
        platform,
        eventType,
        target,
        { validatePermissions: true }
      );

      return {
        subscriptionId: subscription.id,
        status: subscription.status,
        platform,
        eventType,
        target
      };
    }
  );

  // 🆕 MCP Tool: Unsubscribe from event
  this.registerTool(
    'unsubscribe_from_event',
    'Unsubscribe from an external platform event',
    {
      type: 'object',
      properties: {
        subscriptionId: { type: 'string' }
      },
      required: ['subscriptionId']
    },
    async (args) => {
      await this.subscriptionManager.unsubscribe(args.subscriptionId);
      return { status: 'unsubscribed' };
    }
  );

  // 🆕 MCP Tool: List subscriptions
  this.registerTool(
    'list_subscriptions',
    'List all active event subscriptions',
    {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['discord', 'slack', 'twitch'] },
        eventType: { type: 'string' }
      }
    },
    async (args) => {
      const subscriptions = await this.subscriptionManager.listSubscriptions({
        platform: args.platform,
        eventType: args.eventType
      });

      return { subscriptions };
    }
  );
}
```

**Key Changes**:
- ✅ MCP tools for runtime subscription control
- ✅ No changes to existing IntegrationBit behavior (additive only)
- ✅ Subscription state persisted in documentStore

---

## Configuration Enhancement

### IntegrationBitConfig Extension

**Before**:

```typescript
export interface IntegrationBitConfig {
  serviceName: string;
  connectors: Array<{
    name: string;
    factory: ConnectorFactory;
    enabled?: boolean;
  }>;
}
```

**After**:

```typescript
export interface IntegrationBitConfig {
  serviceName: string;
  connectors: Array<{
    name: string;
    factory: ConnectorFactory;
    enabled?: boolean;
  }>;

  // 🆕 Event Gateway configuration (optional)
  eventGateway?: {
    /** Enable event registry (default: true) */
    enableRegistry?: boolean;

    /** Event registry configuration file path */
    registryPath?: string;

    /** Enable translation engine (default: true) */
    enableTranslation?: boolean;

    /** Enable subscription manager (default: true) */
    enableSubscriptions?: boolean;

    /** Enable dynamic subscription MCP tools (default: true) */
    enableSubscriptionTools?: boolean;
  };
}
```

**Usage**:

```typescript
// Enable all Event Gateway features (default)
const service = new IngressEgressServer();

// Disable Event Gateway features (backward compatibility)
const service = new IntegrationBit({
  serviceName: 'ingress-egress',
  connectors: [...],
  eventGateway: {
    enableRegistry: false,
    enableTranslation: false,
    enableSubscriptions: false
  }
});

// Gradual rollout: enable translation but not subscriptions
const service = new IntegrationBit({
  serviceName: 'ingress-egress',
  connectors: [...],
  eventGateway: {
    enableTranslation: true,
    enableSubscriptions: false  // Not ready yet
  }
});
```

---

## Migration Strategy: Backward Compatibility

### Phase 1: Add Components (No Behavior Change)

**Goal**: Add Event Gateway components to IntegrationBit without changing existing behavior.

```typescript
export class IntegrationBit extends Bit {
  private eventRegistry?: EventRegistry;          // 🆕 Optional
  private translationEngine?: TranslationEngine;  // 🆕 Optional
  private subscriptionManager?: SubscriptionManager; // 🆕 Optional

  constructor(config: IntegrationBitConfig) {
    super({ serviceName: config.serviceName });

    // Initialize Event Gateway components if enabled
    if (config.eventGateway?.enableRegistry !== false) {
      this.eventRegistry = new EventRegistry();
    }

    if (config.eventGateway?.enableTranslation !== false && this.eventRegistry) {
      this.translationEngine = new TranslationEngine(this.eventRegistry, this.getLogger());
    }

    if (config.eventGateway?.enableSubscriptions !== false && this.eventRegistry) {
      this.subscriptionManager = new SubscriptionManager(
        this.eventRegistry,
        this.connectorManager,
        this.getResource('documentStore'),
        this.getLogger()
      );
    }

    // Existing setup (unchanged)
    this.registerConnectors();
    this.setupWebhookRouting();
    this.setupEgressRouting();
    this.setupStatusMonitoring();
    this.setupDebugEndpoints();

    // New setup (only if enabled)
    if (this.subscriptionManager && config.eventGateway?.enableSubscriptionTools !== false) {
      this.setupSubscriptionTools();
    }
  }

  private async processEgress(event: InternalEventV2): Promise<void> {
    // Try translation engine first (if enabled)
    if (this.translationEngine) {
      const translation = await this.translationEngine.translateOutbound(event, platform);
      if (translation) {
        // Use translation
        await this.executeTranslation(connector, translation);
        return;
      }
    }

    // Fallback to legacy text extraction (existing behavior)
    const text = extractEgressTextFromEvent(event);
    const target = event.egress?.channel || event.ingress?.channel;
    await (connector as EgressConnector).sendText(text, target);
  }
}
```

**Result**:
- ✅ No breaking changes to existing deployments
- ✅ Event Gateway disabled by default (opt-in)
- ✅ Existing egress logic still works
- ✅ Can gradually enable Event Gateway features per deployment

### Phase 2: Enable by Default (Gradual Rollout)

Once Event Gateway components are validated:

```typescript
// Change defaults to enabled
eventGateway: {
  enableRegistry: true,      // Was: false → true
  enableTranslation: true,   // Was: false → true
  enableSubscriptions: false // Still false (not ready)
}
```

### Phase 3: Deprecate Legacy Logic

Once Event Gateway is stable and proven:

```typescript
private async processEgress(event: InternalEventV2): Promise<void> {
  if (!this.translationEngine) {
    // Deprecation warning
    this.getLogger().warn('integration-bit.legacy-egress-deprecated', {
      message: 'Event Gateway translation engine not enabled. This fallback will be removed in v2.0'
    });

    // Legacy logic (will be removed)
    const text = extractEgressTextFromEvent(event);
    await (connector as EgressConnector).sendText(text, target);
    return;
  }

  // Standard Event Gateway path
  const translation = await this.translationEngine.translateOutbound(event, platform);
  // ...
}
```

---

## Benefits of This Approach

### 1. Clean Separation of Concerns

| Concern | Responsibility | Component |
|---------|---------------|-----------|
| **Event Type Mappings** | What events exist and how they map to platforms | EventRegistry |
| **Translation Logic** | How to convert between internal and platform formats | TranslationEngine |
| **Subscription State** | What events are subscribed to | SubscriptionManager |
| **Connector Lifecycle** | Starting/stopping platform connections | ConnectorManager |
| **Orchestration** | Coordinating all the above | IntegrationBit |

Each component can be **tested independently** and **evolved separately**.

### 2. Backward Compatibility

- ✅ Existing deployments continue working unchanged
- ✅ Event Gateway features opt-in (feature flags)
- ✅ Gradual rollout per deployment
- ✅ Fallback to legacy logic if Event Gateway fails

### 3. Extensibility

Adding new event types requires only:
1. Define event in EventRegistry
2. Translation automatically works
3. Subscription management automatically works
4. No changes to IntegrationBit core logic

### 4. Testability

```typescript
// Unit test TranslationEngine independently
describe('TranslationEngine', () => {
  it('translates chat message to Discord payload', async () => {
    const registry = new EventRegistry();
    registry.register(CHAT_MESSAGE_V1);

    const engine = new TranslationEngine(registry, logger);
    const translation = await engine.translateOutbound(chatEvent, 'discord');

    expect(translation.method).toBe('sendText');
    expect(translation.args).toEqual([expectedText, expectedChannel]);
  });
});

// Integration test IntegrationBit with Event Gateway
describe('IntegrationBit with Event Gateway', () => {
  it('routes DM events to sendDM method', async () => {
    const service = new IntegrationBit({
      serviceName: 'test',
      connectors: [{ name: 'discord', factory: mockDiscordConnector }],
      eventGateway: { enableTranslation: true }
    });

    await service.processEgress(dmEvent);

    expect(mockDiscordConnector.sendDM).toHaveBeenCalledWith(text, userId);
  });
});
```

### 5. Observable and Debuggable

```typescript
// Enhanced debug endpoint
app.get('/_debug/event-gateway', (req, res) => {
  res.json({
    eventRegistry: {
      registeredEvents: this.eventRegistry?.listEvents() || [],
      eventCount: this.eventRegistry?.count() || 0
    },
    translationEngine: {
      enabled: !!this.translationEngine,
      supportedPlatforms: ['discord', 'slack', 'twitch']
    },
    subscriptionManager: {
      enabled: !!this.subscriptionManager,
      activeSubscriptions: this.subscriptionManager?.listSubscriptions() || []
    }
  });
});
```

---

## Recommended Implementation Sequence

### Step 1: Create EventRegistry (Week 1)
- Define EventRegistry class
- Define EventDefinition interface
- Register core event types (chat, DM)
- Unit tests

**Deliverable**: `src/services/ingress/core/event-registry.ts`

### Step 2: Create TranslationEngine (Week 1-2)
- Define TranslationEngine class
- Implement `translateOutbound()`
- Add event type → platform method mapping
- Unit tests

**Deliverable**: `src/services/ingress/core/translation-engine.ts`

### Step 3: Integrate into IntegrationBit (Week 2)
- Add optional EventRegistry field
- Add optional TranslationEngine field
- Enhance `processEgress()` with fallback
- Feature flag configuration
- Integration tests

**Deliverable**: Enhanced `src/common/integration-bit.ts`

### Step 4: Add SubscriptionManager (Week 3-4)
- Define SubscriptionManager class
- Implement subscribe/unsubscribe
- Add MCP tools
- Persistence layer
- Unit + integration tests

**Deliverable**: `src/services/ingress/core/subscription-manager.ts`

### Step 5: Validation & Rollout (Week 4)
- Deploy with Event Gateway disabled (default)
- Enable in staging environment
- Monitor and validate
- Enable in production
- Document migration guide

---

## Conclusion

**IntegrationBit should evolve through composition, not replacement.**

The Event Gateway components (EventRegistry, TranslationEngine, SubscriptionManager) should be **composed into IntegrationBit** as optional dependencies, enabling:

✅ **Clean architecture** - Single responsibility per component
✅ **Backward compatibility** - Existing functionality preserved
✅ **Testability** - Independent unit tests for each component
✅ **Extensibility** - New event types added declaratively
✅ **Gradual rollout** - Feature flags for safe deployment

**IntegrationBit's role** evolves from "platform adapter" to "Event Gateway orchestrator" while maintaining all existing responsibilities.

This approach delivers the Event Gateway vision **without breaking existing deployments** and **without creating parallel systems**.

---

**Document Version**: 1.0
**Last Updated**: 2026-08-14T04:45:00Z
**Status**: Recommended Approach

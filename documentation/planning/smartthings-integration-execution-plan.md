# SmartThings Integration - Execution Plan

## Document Information

**Status:** Implementation Ready
**Lead Implementor:** Engineering Team
**Date:** 2026-08-16
**Version:** 1.0
**Based On:** documentation/architecture/smartthings-integration-technical-architecture.md
**Estimated Timeline:** 4-6 weeks (4 sprints)

---

## Executive Summary

This execution plan breaks down the SmartThings integration implementation into **actionable, trackable tasks** organized across **4 sprints**. The plan leverages existing BitBrat Platform patterns (Twilio webhook connector) to minimize implementation complexity and maximize code reuse.

**Key Implementation Strategy:**
- **Reuse Twilio pattern:** Webhook-based connector with dual IngressConnector + WebhookConnector interfaces
- **Config-driven translation:** YAML-based event mapping (minimal custom code)
- **Phased rollout:** Foundation → Egress → Advanced → Production
- **Test-driven:** Unit, integration, and E2E tests for each component

**Dependencies:**
- SmartThings Developer Account (obtain OAuth credentials)
- Test SmartThings devices or simulator
- Existing ingress-egress service infrastructure
- ConfigRegistry and TranslationEngine (already implemented)

---

## Sprint Breakdown

### Sprint 1: Foundation & Webhook Ingress (2 weeks)
**Goal:** Implement basic webhook ingress, OAuth2 foundation, and DEVICE_EVENT handling

**Story Points:** 21
**Priority:** P0 (Critical Path)

### Sprint 2: Egress & Device Control (1 week)
**Goal:** Implement device command execution and bidirectional communication

**Story Points:** 13
**Priority:** P0 (Critical Path)

### Sprint 3: Advanced Events & Features (1 week)
**Goal:** Support additional event types and advanced capabilities

**Story Points:** 13
**Priority:** P1 (High Priority)

### Sprint 4: Production Hardening (1 week)
**Goal:** Error handling, monitoring, documentation, load testing

**Story Points:** 13
**Priority:** P1 (High Priority)

**Total Story Points:** 60

---

## Sprint 1: Foundation & Webhook Ingress

### Objectives
- ✅ Create SmartThings connector directory structure
- ✅ Implement OAuth2 authentication foundation
- ✅ Build webhook handler with sink confirmation
- ✅ Support DEVICE_EVENT ingress
- ✅ Create YAML event mappings
- ✅ Unit tests for core components

### Dependencies
- SmartThings Developer Account with OAuth credentials
- ConfigRegistry and TranslationEngine (existing)
- Webhook endpoint exposed via ingress-egress service

### Task Breakdown

#### 1.1 Project Setup (3 SP)
**Files to Create:**
```
src/services/ingress/smartthings/
├── index.ts
├── types.ts
├── factory.ts
├── connector-adapter.ts
├── webhook-handler.ts
├── oauth-client.ts (stub for Sprint 1)
└── __tests__/
    ├── webhook-handler.test.ts
    └── connector-adapter.test.ts
```

**Subtasks:**
- [x] Create directory structure
- [x] Create types.ts with SmartThings-specific types
- [x] Create index.ts with exports
- [x] Set up Jest test configuration
- [x] Add SmartThings dependencies to package.json

**Acceptance Criteria:**
- Directory structure matches existing connectors (Discord, Twilio)
- TypeScript compiles without errors
- Jest test suite runs (even with empty tests)

---

#### 1.2 SmartThings Types Definition (2 SP)

**File:** `src/services/ingress/smartthings/types.ts`

**Implementation:**
```typescript
/**
 * SmartThings event notification types
 */
export type SmartThingsNotificationType = 'SINK_CONFIRMATION' | 'EVENT';

/**
 * SmartThings event types
 */
export type SmartThingsEventType =
  | 'DEVICE_EVENT'
  | 'DEVICE_HEALTH_EVENT'
  | 'DEVICE_LIFECYCLE_EVENT'
  | 'APPLIANCE_DIAGNOSTIC_EVENT'
  | 'MODE_EVENT'
  | 'SCENE_LIFECYCLE_EVENT'
  | 'HUB_HEALTH_EVENT'
  | 'LOCATION_LIFECYCLE_EVENT';

/**
 * Sink confirmation payload
 */
export interface SmartThingsSinkConfirmation {
  notificationType: 'SINK_CONFIRMATION';
  version: string;
  sinkConfiguration: {
    targetUrl: string;
    sinkId: string;
  };
  confirmationUrl: string;
}

/**
 * Event notification payload (batched)
 */
export interface SmartThingsEventNotification {
  notificationType: 'EVENT';
  version: string;
  accountId: string;
  eventNotification: {
    locationGroupId: string;
    events: SmartThingsEvent[];
  };
}

/**
 * Individual SmartThings event (DEVICE_EVENT)
 */
export interface SmartThingsDeviceEvent {
  eventId: string;
  eventType: 'DEVICE_EVENT';
  eventTime: string; // ISO 8601
  deviceId: string;
  deviceName?: string;
  locationId: string;
  locationName?: string;
  capability: string;
  attribute: string;
  value: any;
  unit?: string;
  stateChange: boolean;
  subscriptionId: string;
}

/**
 * Union type for all SmartThings events
 */
export type SmartThingsEvent = SmartThingsDeviceEvent; // Expand in later sprints

/**
 * SmartThings webhook request payload
 */
export type SmartThingsWebhookPayload =
  | SmartThingsSinkConfirmation
  | SmartThingsEventNotification;

/**
 * SmartThings connector configuration
 */
export interface SmartThingsConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  webhookUrl: string;
  scopes: string[];
  redirectUri: string;
}

/**
 * SmartThings connector state snapshot
 */
export interface SmartThingsSnapshot {
  state: 'DISCONNECTED' | 'CONNECTED' | 'ERROR';
  lastEventReceivedAt?: string;
  eventsProcessed24h: number;
  sinkStatus?: 'REGISTERED' | 'UNREGISTERED';
  subscriptionCount: number;
  lastError?: string;
}
```

**Acceptance Criteria:**
- All SmartThings payload types defined
- Types match SmartThings API documentation
- No TypeScript compilation errors

---

#### 1.3 Webhook Handler Implementation (5 SP)

**File:** `src/services/ingress/smartthings/webhook-handler.ts`

**Implementation Pattern:** Follow Twilio webhook handler structure

**Key Methods:**
```typescript
export class SmartThingsWebhookHandler {
  constructor(
    private readonly translationEngine: TranslationEngine,
    private readonly publisher: IngressPublisher,
    private readonly config: IConfig,
    private readonly logger: Logger
  ) {
    this.processedEventIds = new Set<string>();
  }

  /**
   * Handle incoming webhook request
   */
  async handleRequest(payload: SmartThingsWebhookPayload): Promise<WebhookResponse> {
    // Route based on notification type
    if (payload.notificationType === 'SINK_CONFIRMATION') {
      return this.handleSinkConfirmation(payload);
    }

    if (payload.notificationType === 'EVENT') {
      return this.handleEventBatch(payload);
    }

    throw new Error('Unknown notification type');
  }

  /**
   * Handle sink confirmation challenge
   */
  private handleSinkConfirmation(payload: SmartThingsSinkConfirmation): WebhookResponse {
    this.logger.info('smartthings.webhook.sink_confirmation', {
      sinkId: payload.sinkConfiguration.sinkId,
      targetUrl: payload.sinkConfiguration.targetUrl
    });

    // Echo confirmation (required by SmartThings)
    return {
      status: 200,
      body: {
        targetUrl: payload.sinkConfiguration.targetUrl,
        confirmationUrl: payload.confirmationUrl
      }
    };
  }

  /**
   * Handle batched event notification
   */
  private async handleEventBatch(payload: SmartThingsEventNotification): Promise<WebhookResponse> {
    const { events } = payload.eventNotification;

    this.logger.info('smartthings.webhook.event_batch', {
      accountId: payload.accountId,
      locationGroupId: payload.eventNotification.locationGroupId,
      eventCount: events.length
    });

    for (const event of events) {
      try {
        await this.processEvent(event);
      } catch (err: any) {
        this.logger.error('smartthings.webhook.event_error', {
          eventId: event.eventId,
          error: err.message
        });
        // Continue processing other events (partial failure)
      }
    }

    return { status: 200, body: { status: 'ok', processed: events.length } };
  }

  /**
   * Process individual event
   */
  private async processEvent(event: SmartThingsEvent): Promise<void> {
    // Deduplication check
    if (this.processedEventIds.has(event.eventId)) {
      this.logger.debug('smartthings.webhook.duplicate_event', { eventId: event.eventId });
      return;
    }

    // Translate to InternalEventV2
    const internalEvent = await this.translationEngine.translateInbound(
      'smartthings',
      event.eventType,
      event
    );

    // Publish to internal.ingress.v1
    await this.publisher.publish(internalEvent);

    // Track processed ID (with TTL cleanup)
    this.markProcessed(event.eventId);

    this.logger.info('smartthings.webhook.event_processed', {
      eventId: event.eventId,
      eventType: event.eventType,
      internalType: internalEvent.type
    });
  }

  /**
   * Mark event as processed (deduplication)
   */
  private markProcessed(eventId: string): void {
    this.processedEventIds.add(eventId);

    // Auto-cleanup after 5 minutes
    setTimeout(() => {
      this.processedEventIds.delete(eventId);
    }, 300000);
  }
}
```

**Subtasks:**
- [x] Implement sink confirmation handler
- [x] Implement event batch parsing
- [x] Implement deduplication logic
- [x] Integrate with TranslationEngine
- [x] Add structured logging

**Acceptance Criteria:**
- Sink confirmation returns correct response format
- Event batches are parsed and processed individually
- Deduplication prevents duplicate event processing
- Events are translated and published successfully
- Partial failures don't block entire batch

---

#### 1.4 Connector Adapter Implementation (5 SP)

**File:** `src/services/ingress/smartthings/connector-adapter.ts`

**Implementation Pattern:** Follow Twilio connector adapter (dual interface)

**Key Implementation:**
```typescript
export class SmartThingsConnectorAdapter implements IngressConnector, WebhookConnector {
  private snapshot: SmartThingsSnapshot;

  constructor(
    private readonly webhookHandler: SmartThingsWebhookHandler,
    private readonly config: IConfig,
    private readonly logger: Logger
  ) {
    this.snapshot = {
      state: 'DISCONNECTED',
      eventsProcessed24h: 0,
      subscriptionCount: 0
    };
  }

  /**
   * IngressConnector: Start (no-op for webhook-based)
   */
  async start(): Promise<void> {
    this.logger.info('smartthings.connector.start');
    this.snapshot.state = 'CONNECTED';
    // Future: Could register webhook sink here via OAuth
  }

  /**
   * IngressConnector: Stop
   */
  async stop(): Promise<void> {
    this.logger.info('smartthings.connector.stop');
    this.snapshot.state = 'DISCONNECTED';
  }

  /**
   * IngressConnector: Get snapshot
   */
  getSnapshot(): ConnectorSnapshot {
    return {
      state: this.snapshot.state,
      lastError: this.snapshot.lastError ? { message: this.snapshot.lastError } : null,
      counters: {
        eventsProcessed24h: this.snapshot.eventsProcessed24h,
        subscriptionCount: this.snapshot.subscriptionCount
      },
      lastMessageAt: this.snapshot.lastEventReceivedAt,
      sinkStatus: this.snapshot.sinkStatus
    } as ConnectorSnapshot;
  }

  /**
   * IngressConnector: Get metadata
   */
  getMetadata(): ConnectorMetadata {
    return {
      platform: 'smartthings',
      version: '1.0.0',
      authMethod: 'oauth2',
      capabilities: {
        ingress: {
          method: 'webhook',
          realtime: true,
          requiresWebhook: true,
          requiresPublicUrl: true
        },
        egress: {
          chat: false,
          dm: false,
          reactions: false,
          threads: false
        },
        moderation: {
          ban: false,
          timeout: false,
          delete: false
        }
      }
    };
  }

  /**
   * WebhookConnector: Verify signature (no-op for SmartThings)
   */
  verifySignature(req: WebhookRequest): boolean {
    // SmartThings doesn't provide webhook signatures
    // Security relies on HTTPS + sink confirmation challenge
    this.logger.debug('smartthings.webhook.verify_signature.skipped');
    return true;
  }

  /**
   * WebhookConnector: Handle webhook
   */
  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    this.snapshot.lastEventReceivedAt = new Date().toISOString();

    try {
      const response = await this.webhookHandler.handleRequest(req.body);

      // Update counters
      if (req.body.notificationType === 'EVENT') {
        this.snapshot.eventsProcessed24h += req.body.eventNotification.events.length;
      }

      return response;
    } catch (err: any) {
      this.snapshot.lastError = err.message;
      this.logger.error('smartthings.webhook.error', { error: err.message });
      throw err;
    }
  }
}
```

**Acceptance Criteria:**
- Implements IngressConnector interface
- Implements WebhookConnector interface
- Returns accurate snapshot data
- Handles webhook requests successfully
- Signature verification returns true (no-op)

---

#### 1.5 Factory Function Implementation (2 SP)

**File:** `src/services/ingress/smartthings/factory.ts`

**Implementation:**
```typescript
import type { ConnectorFactory } from '../../../common/integration-bit';
import { SmartThingsConnectorAdapter } from './connector-adapter';
import { SmartThingsWebhookHandler } from './webhook-handler';
import { TranslationEngine } from '../core/translation-engine';
import { ConfigRegistry } from '../core/config-registry';
import { logger } from '../../../common/logging';
import type { IConfig } from '../../../types';

/**
 * Creates a SmartThings connector configured for the IntegrationBit framework.
 *
 * @param config - Platform configuration
 * @param opts - Factory options
 * @returns Promise resolving to configured SmartThingsConnectorAdapter
 */
export const createSmartThingsConnector: ConnectorFactory = async (config: IConfig, opts) => {
  const { publisherFactory } = opts;

  // Create publisher for ingress events
  const publisher = publisherFactory('internal.ingress.v1');

  // Initialize ConfigRegistry and TranslationEngine
  const registry = new ConfigRegistry({ configPath: 'config' });
  await registry.load();

  const translationEngine = new TranslationEngine(registry);

  // Create webhook handler
  const webhookHandler = new SmartThingsWebhookHandler(
    translationEngine,
    publisher,
    config,
    logger
  );

  // Create connector adapter
  return new SmartThingsConnectorAdapter(webhookHandler, config, logger);
};
```

**Acceptance Criteria:**
- Factory function signature matches ConnectorFactory type
- Creates all required components
- Returns configured adapter
- Integrates with existing ConfigRegistry/TranslationEngine

---

#### 1.6 YAML Event Mapping - DEVICE_EVENT (3 SP)

**Files to Create:**
```
config/platforms/smartthings/
└── device-event.v1.yaml

config/events/
└── iot-device-event.v1.yaml
```

**config/platforms/smartthings/device-event.v1.yaml:**
```yaml
# SmartThings DEVICE_EVENT → iot.device.event.v1
platformEvent: DEVICE_EVENT
internalEventType: iot.device.event.v1
priority: 0

fieldMapping:
  # Identity mapping (use location as user context)
  userId: locationId
  userName: locationName

  # Device identification
  deviceId: deviceId
  deviceName: deviceName
  capability: capability
  attribute: attribute

  # Event data
  value: value
  unit: unit
  timestamp: eventTime

  # Location context
  locationId: locationId
  locationName: locationName

  # Custom fields (preserved in InternalEventV2.custom)
  custom:
    stateChange: stateChange
    eventId: eventId
    subscriptionId: subscriptionId

metadata:
  description: SmartThings device capability/attribute change event
  platformDocUrl: https://developer.smartthings.com/docs/enterprise/enterprise-api-overview/eventing/overview
  createdBy: Engineering Team
  createdAt: "2026-08-16"
```

**config/events/iot-device-event.v1.yaml:**
```yaml
type: iot.device.event.v1
description: IoT device state change event (motion, contact, temperature, etc.)
version: 1
category: ingress

metadata:
  createdBy: Engineering Team
  createdAt: "2026-08-16"
  owningTeam: integrations
  relatedEvents:
    - iot.device.health-event.v1
    - iot.appliance.event.v1

schema:
  properties:
    identity:
      type: object
      required: [external]
      properties:
        external:
          type: object
          required: [id, platform]
          properties:
            platform:
              type: string
              const: smartthings
    ingress:
      type: object
      required: [connector]
      properties:
        connector:
          type: string
          const: smartthings
    custom:
      type: object
      required: [deviceId, capability, attribute, value]
  required:
    - identity
    - ingress
    - custom
```

**Subtasks:**
- [x] Create platform mapping YAML
- [x] Create internal event definition YAML
- [x] Validate YAML syntax
- [x] Test with ConfigRegistry

**Acceptance Criteria:**
- YAML files are syntactically correct
- ConfigRegistry successfully loads mappings
- TranslationEngine successfully translates sample events
- Field mappings match SmartThings API payload structure

---

#### 1.7 Unit Tests - Webhook Handler (4 SP)

**File:** `src/services/ingress/smartthings/__tests__/webhook-handler.test.ts`

**Test Cases:**
```typescript
describe('SmartThingsWebhookHandler', () => {
  describe('Sink Confirmation', () => {
    it('should return correct confirmation response', async () => {
      const payload: SmartThingsSinkConfirmation = {
        notificationType: 'SINK_CONFIRMATION',
        version: '2',
        sinkConfiguration: {
          targetUrl: 'https://bitbrat.dev/webhook/smartthings',
          sinkId: 'sink-123'
        },
        confirmationUrl: 'https://api.smartthings.com/confirm/abc'
      };

      const response = await handler.handleRequest(payload);

      expect(response.status).toBe(200);
      expect(response.body.targetUrl).toBe(payload.sinkConfiguration.targetUrl);
      expect(response.body.confirmationUrl).toBe(payload.confirmationUrl);
    });
  });

  describe('Event Batch Processing', () => {
    it('should process single DEVICE_EVENT', async () => {
      const payload: SmartThingsEventNotification = {
        notificationType: 'EVENT',
        version: '2',
        accountId: 'acc-123',
        eventNotification: {
          locationGroupId: 'loc-group-456',
          events: [{
            eventId: 'evt-789',
            eventType: 'DEVICE_EVENT',
            eventTime: '2026-08-16T10:30:00Z',
            deviceId: 'dev-001',
            deviceName: 'Front Door Sensor',
            locationId: 'loc-456',
            locationName: 'Home',
            capability: 'contactSensor',
            attribute: 'contact',
            value: 'open',
            stateChange: true,
            subscriptionId: 'sub-001'
          }]
        }
      };

      const response = await handler.handleRequest(payload);

      expect(response.status).toBe(200);
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);

      const publishedEvent = mockPublisher.publish.mock.calls[0][0];
      expect(publishedEvent.type).toBe('iot.device.event.v1');
      expect(publishedEvent.custom.deviceId).toBe('dev-001');
      expect(publishedEvent.custom.value).toBe('open');
    });

    it('should process batched events', async () => {
      const payload = createBatchPayload(5); // 5 events

      const response = await handler.handleRequest(payload);

      expect(response.status).toBe(200);
      expect(mockPublisher.publish).toHaveBeenCalledTimes(5);
    });

    it('should deduplicate events', async () => {
      const payload = createEventPayload('evt-duplicate');

      await handler.handleRequest(payload);
      await handler.handleRequest(payload); // Duplicate

      expect(mockPublisher.publish).toHaveBeenCalledTimes(1); // Only once
    });

    it('should handle partial batch failures gracefully', async () => {
      // Mock translation engine to fail on 2nd event
      mockTranslationEngine.translateInbound
        .mockResolvedValueOnce(createInternalEvent())
        .mockRejectedValueOnce(new Error('Translation failed'))
        .mockResolvedValueOnce(createInternalEvent());

      const payload = createBatchPayload(3);

      const response = await handler.handleRequest(payload);

      expect(response.status).toBe(200);
      expect(mockPublisher.publish).toHaveBeenCalledTimes(2); // 1st and 3rd succeeded
    });
  });
});
```

**Acceptance Criteria:**
- All test cases pass
- Code coverage > 90%
- Edge cases covered (empty batch, malformed payload, etc.)

---

#### 1.8 Unit Tests - Connector Adapter (3 SP)

**File:** `src/services/ingress/smartthings/__tests__/connector-adapter.test.ts`

**Test Cases:**
```typescript
describe('SmartThingsConnectorAdapter', () => {
  describe('IngressConnector Interface', () => {
    it('should start successfully', async () => {
      await adapter.start();

      const snapshot = adapter.getSnapshot();
      expect(snapshot.state).toBe('CONNECTED');
    });

    it('should stop successfully', async () => {
      await adapter.start();
      await adapter.stop();

      const snapshot = adapter.getSnapshot();
      expect(snapshot.state).toBe('DISCONNECTED');
    });

    it('should return metadata', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.platform).toBe('smartthings');
      expect(metadata.authMethod).toBe('oauth2');
      expect(metadata.capabilities.ingress.method).toBe('webhook');
      expect(metadata.capabilities.ingress.requiresWebhook).toBe(true);
    });
  });

  describe('WebhookConnector Interface', () => {
    it('should verify signature (always returns true)', () => {
      const req: WebhookRequest = {
        headers: {},
        body: {},
        url: '/webhook/smartthings'
      };

      expect(adapter.verifySignature(req)).toBe(true);
    });

    it('should handle webhook successfully', async () => {
      const req: WebhookRequest = {
        headers: {},
        body: createSinkConfirmationPayload(),
        url: '/webhook/smartthings'
      };

      const response = await adapter.handleWebhook(req);

      expect(response.status).toBe(200);
    });

    it('should update snapshot after webhook', async () => {
      const req: WebhookRequest = {
        headers: {},
        body: createEventNotificationPayload(3),
        url: '/webhook/smartthings'
      };

      await adapter.handleWebhook(req);

      const snapshot = adapter.getSnapshot();
      expect(snapshot.counters?.eventsProcessed24h).toBe(3);
      expect(snapshot.lastMessageAt).toBeDefined();
    });
  });
});
```

**Acceptance Criteria:**
- All test cases pass
- Code coverage > 90%
- Both interfaces fully tested

---

### Sprint 1 Deliverables Checklist

- [ ] SmartThings connector directory structure created
- [ ] Types defined (types.ts)
- [ ] Webhook handler implemented and tested
- [ ] Connector adapter implemented and tested
- [ ] Factory function created
- [ ] YAML event mappings created (device-event.v1.yaml)
- [ ] Unit tests passing (>90% coverage)
- [ ] Documentation updated (README in smartthings folder)
- [ ] Code reviewed and merged

**Sprint 1 Success Metrics:**
- Webhook endpoint can receive SmartThings events
- Sink confirmation challenge handled correctly
- DEVICE_EVENT successfully translated to iot.device.event.v1
- All unit tests passing

---

## Sprint 2: Egress & Device Control

### Objectives
- ✅ Implement SmartThingsEgressClient
- ✅ Support device command execution (switch, lock, dimmer)
- ✅ Support device status queries
- ✅ Implement OAuth2 token management
- ✅ Add egress field mapping to YAML configs
- ✅ Integration tests with SmartThings sandbox

### Dependencies
- Sprint 1 completed
- SmartThings OAuth2 credentials configured
- Test SmartThings account with devices

### Task Breakdown

#### 2.1 OAuth Client Implementation (5 SP)

**File:** `src/services/ingress/smartthings/oauth-client.ts`

**Implementation:**
```typescript
import { IAuthTokenStoreV2 } from '../../../types';
import { logger } from '../../../common/logging';

export class SmartThingsOAuthClient {
  constructor(
    private readonly tokenStore: IAuthTokenStoreV2,
    private readonly config: {
      clientId: string;
      clientSecret: string;
      authorizationUrl: string;
      tokenUrl: string;
      scopes: string[];
      redirectUri: string;
    }
  ) {}

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state
    });

    return `${this.config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, userId: string): Promise<void> {
    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json();

    await this.tokenStore.saveToken({
      platform: 'smartthings',
      userId,
      externalId: data.account_id || userId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      scopes: this.config.scopes,
      metadata: {}
    });

    logger.info('smartthings.oauth.token_saved', { userId });
  }

  /**
   * Refresh access token
   */
  async refreshToken(userId: string): Promise<string> {
    const token = await this.tokenStore.getToken('smartthings', userId);

    if (!token?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      })
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = await response.json();

    await this.tokenStore.saveToken({
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || token.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString()
    });

    logger.info('smartthings.oauth.token_refreshed', { userId });

    return data.access_token;
  }

  /**
   * Get valid access token (auto-refresh if needed)
   */
  async getAccessToken(userId: string): Promise<string> {
    const token = await this.tokenStore.getToken('smartthings', userId);

    if (!token) {
      throw new Error('No token found for user');
    }

    // Refresh if expiring in < 5 minutes
    const expiresAt = new Date(token.expiresAt).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresAt - now < fiveMinutes) {
      logger.debug('smartthings.oauth.token_expiring_soon', { userId });
      return this.refreshToken(userId);
    }

    return token.accessToken;
  }
}
```

**Acceptance Criteria:**
- OAuth authorization URL generation works
- Code exchange saves token correctly
- Token refresh updates stored token
- Auto-refresh before expiration (5min buffer)

---

#### 2.2 Egress Client Implementation (5 SP)

**File:** `src/services/ingress/smartthings/egress-client.ts`

**Implementation:**
```typescript
export class SmartThingsEgressClient {
  private readonly baseUrl = 'https://api.smartthings.com/v1';

  constructor(
    private readonly oauthClient: SmartThingsOAuthClient,
    private readonly userId: string, // BitBrat user ID
    private readonly logger: Logger
  ) {}

  /**
   * Send device command
   */
  async sendDeviceCommand(
    deviceId: string,
    capability: string,
    command: { command: string; arguments?: any[] }
  ): Promise<void> {
    const token = await this.oauthClient.getAccessToken(this.userId);

    const response = await fetch(`${this.baseUrl}/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        commands: [{
          capability,
          command: command.command,
          arguments: command.arguments || []
        }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device command failed: ${response.status} - ${error}`);
    }

    this.logger.info('smartthings.egress.command_sent', {
      deviceId,
      capability,
      command: command.command
    });
  }

  /**
   * Query device status
   */
  async queryDeviceStatus(deviceId: string): Promise<any> {
    const token = await this.oauthClient.getAccessToken(this.userId);

    const response = await fetch(`${this.baseUrl}/devices/${deviceId}/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device status query failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * List user devices
   */
  async listDevices(locationId?: string): Promise<any[]> {
    const token = await this.oauthClient.getAccessToken(this.userId);

    const url = new URL(`${this.baseUrl}/devices`);
    if (locationId) {
      url.searchParams.set('locationId', locationId);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`List devices failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.items || [];
  }
}
```

**Acceptance Criteria:**
- Device commands execute successfully
- Device status queries return correct data
- OAuth token auto-refresh works
- API errors handled gracefully

---

#### 2.3 Update Connector Adapter with Egress (2 SP)

**File:** `src/services/ingress/smartthings/connector-adapter.ts` (update)

**Add to SmartThingsConnectorAdapter:**
```typescript
export class SmartThingsConnectorAdapter implements IngressConnector, WebhookConnector, EgressConnector {
  constructor(
    private readonly webhookHandler: SmartThingsWebhookHandler,
    private readonly egressClient: SmartThingsEgressClient, // NEW
    private readonly config: IConfig,
    private readonly logger: Logger
  ) {
    // ...
  }

  /**
   * EgressConnector: Send device command
   */
  async sendDeviceCommand(deviceId: string, capability: string, command: any): Promise<void> {
    await this.egressClient.sendDeviceCommand(deviceId, capability, command);
  }

  /**
   * EgressConnector: Query device status
   */
  async queryDeviceStatus(deviceId: string): Promise<any> {
    return this.egressClient.queryDeviceStatus(deviceId);
  }

  /**
   * EgressConnector: sendText (not applicable for IoT)
   */
  async sendText(text: string, target?: string): Promise<void> {
    throw new Error('sendText not supported for SmartThings connector');
  }
}
```

**Update getMetadata():**
```typescript
getMetadata(): ConnectorMetadata {
  return {
    platform: 'smartthings',
    version: '1.0.0',
    authMethod: 'oauth2',
    capabilities: {
      ingress: {
        method: 'webhook',
        realtime: true,
        requiresWebhook: true,
        requiresPublicUrl: true
      },
      egress: {
        chat: false,
        dm: false,
        reactions: false,
        threads: false
      },
      moderation: {
        ban: false,
        timeout: false,
        delete: false
      }
    }
  };
}
```

**Acceptance Criteria:**
- EgressConnector interface implemented
- Device commands work via adapter
- Metadata reflects egress capabilities

---

#### 2.4 Integration Tests (4 SP)

**File:** `src/services/ingress/smartthings/__tests__/integration.test.ts`

**Test Cases:**
```typescript
describe('SmartThings Integration Tests', () => {
  describe('OAuth Flow', () => {
    it('should generate valid authorization URL', () => {
      const url = oauthClient.getAuthorizationUrl('state-123');

      expect(url).toContain('https://api.smartthings.com/oauth/authorize');
      expect(url).toContain('client_id=');
      expect(url).toContain('state=state-123');
    });

    // Manual test: Exchange code for token (requires real OAuth flow)
    it.skip('should exchange code for token', async () => {
      const code = 'MANUAL_TEST_CODE';
      await oauthClient.exchangeCodeForToken(code, 'test-user-123');

      const token = await tokenStore.getToken('smartthings', 'test-user-123');
      expect(token).toBeDefined();
      expect(token?.accessToken).toBeDefined();
    });
  });

  describe('Device Commands', () => {
    // Requires SmartThings test account with devices
    it.skip('should send switch on command', async () => {
      await egressClient.sendDeviceCommand(
        'test-switch-001',
        'switch',
        { command: 'on' }
      );

      // Verify device state changed
      const status = await egressClient.queryDeviceStatus('test-switch-001');
      expect(status.components.main.switch.switch.value).toBe('on');
    });

    it.skip('should query device status', async () => {
      const status = await egressClient.queryDeviceStatus('test-sensor-001');

      expect(status).toHaveProperty('components');
      expect(status.components).toHaveProperty('main');
    });

    it.skip('should list devices', async () => {
      const devices = await egressClient.listDevices();

      expect(Array.isArray(devices)).toBe(true);
      expect(devices.length).toBeGreaterThan(0);
    });
  });

  describe('End-to-End Flow', () => {
    it.skip('should process webhook and trigger device command', async () => {
      // 1. Simulate webhook from SmartThings (motion detected)
      const webhookPayload = createMotionEventPayload();
      await adapter.handleWebhook({ body: webhookPayload, headers: {}, url: '/webhook' });

      // 2. Wait for event processing
      await delay(1000);

      // 3. Verify internal event published
      const events = await getPublishedEvents('internal.ingress.v1');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('iot.device.event.v1');

      // 4. Send command back to SmartThings (turn on light)
      await adapter.sendDeviceCommand('test-light-001', 'switch', { command: 'on' });

      // 5. Verify command succeeded
      const status = await adapter.queryDeviceStatus('test-light-001');
      expect(status.components.main.switch.switch.value).toBe('on');
    });
  });
});
```

**Acceptance Criteria:**
- OAuth flow tested (manual)
- Device commands tested against real devices
- Integration with webhook → egress flow verified

---

### Sprint 2 Deliverables Checklist

- [ ] OAuth client implemented
- [ ] Egress client implemented
- [ ] Connector adapter updated with egress methods
- [ ] Integration tests created
- [ ] Egress commands verified with SmartThings test account
- [ ] Documentation updated

**Sprint 2 Success Metrics:**
- Device commands execute successfully
- Device status queries work
- OAuth token refresh automatic
- Integration tests passing

---

## Sprint 3: Advanced Events & Features

### Objectives
- ✅ Support DEVICE_HEALTH_EVENT
- ✅ Support APPLIANCE_DIAGNOSTIC_EVENT
- ✅ Support MODE_EVENT
- ✅ Implement event filtering (by location, device type)
- ✅ Rate limit handling with exponential backoff

### Task Breakdown

#### 3.1 Additional Event Type Mappings (3 SP)

**Create YAML mappings:**
- config/platforms/smartthings/device-health-event.v1.yaml
- config/platforms/smartthings/appliance-diagnostic-event.v1.yaml
- config/platforms/smartthings/mode-event.v1.yaml

**Create internal event definitions:**
- config/events/iot-device-health-event.v1.yaml
- config/events/iot-appliance-event.v1.yaml
- config/events/iot-mode-event.v1.yaml

**Acceptance Criteria:**
- All YAML mappings created
- ConfigRegistry loads new mappings
- TranslationEngine successfully translates each event type

---

#### 3.2 Event Filtering (3 SP)

**Update webhook handler to support filtering:**
```typescript
private async processEvent(event: SmartThingsEvent): Promise<void> {
  // Apply filters (if configured)
  if (this.config.smartthings?.eventFilters) {
    const { deviceTypes, locations, capabilities } = this.config.smartthings.eventFilters;

    if (deviceTypes && !deviceTypes.includes(event.deviceType)) {
      this.logger.debug('smartthings.event_filtered.device_type', { deviceType: event.deviceType });
      return;
    }

    if (locations && !locations.includes(event.locationId)) {
      this.logger.debug('smartthings.event_filtered.location', { locationId: event.locationId });
      return;
    }

    if (capabilities && !capabilities.includes(event.capability)) {
      this.logger.debug('smartthings.event_filtered.capability', { capability: event.capability });
      return;
    }
  }

  // Continue processing...
}
```

**Acceptance Criteria:**
- Events filtered by device type
- Events filtered by location
- Events filtered by capability

---

#### 3.3 Rate Limiting & Backoff (4 SP)

**Implement rate limiter for egress:**
```typescript
export class SmartThingsRateLimiter {
  private requestQueue: Array<() => Promise<any>> = [];
  private processing = false;
  private readonly requestsPerSecond: number;
  private readonly burstSize: number;

  constructor(config: { requestsPerSecond: number; burstSize: number }) {
    this.requestsPerSecond = config.requestsPerSecond;
    this.burstSize = config.burstSize;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const batch = this.requestQueue.splice(0, this.burstSize);

      await Promise.all(batch.map(fn => fn()));

      if (this.requestQueue.length > 0) {
        await this.delay(1000 / this.requestsPerSecond);
      }
    }

    this.processing = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Integrate with egress client:**
```typescript
export class SmartThingsEgressClient {
  private rateLimiter: SmartThingsRateLimiter;

  async sendDeviceCommand(...args: any[]): Promise<void> {
    return this.rateLimiter.execute(() => this._sendDeviceCommand(...args));
  }

  private async _sendDeviceCommand(...): Promise<void> {
    // Existing implementation
  }
}
```

**Acceptance Criteria:**
- Rate limiting prevents API overload
- Burst requests handled correctly
- Exponential backoff on errors

---

### Sprint 3 Deliverables Checklist

- [ ] Additional event types supported (health, appliance, mode)
- [ ] Event filtering implemented
- [ ] Rate limiting implemented
- [ ] Tests for new event types
- [ ] Tests for filtering
- [ ] Tests for rate limiting

**Sprint 3 Success Metrics:**
- All event types translate correctly
- Filters reduce noise effectively
- Rate limiting prevents API errors

---

## Sprint 4: Production Hardening

### Objectives
- ✅ Comprehensive error handling
- ✅ Monitoring and observability
- ✅ Load testing
- ✅ Documentation (setup guide, API reference)
- ✅ Performance optimization

### Task Breakdown

#### 4.1 Error Handling & Resilience (4 SP)

**Implement retry logic with exponential backoff:**
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; baseDelay: number }
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < options.maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      // Don't retry on 4xx errors (client errors)
      if (err.status >= 400 && err.status < 500) {
        throw err;
      }

      const delay = options.baseDelay * Math.pow(2, i);
      logger.warn('smartthings.retry', { attempt: i + 1, delay, error: err.message });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
```

**Add circuit breaker:**
```typescript
export class CircuitBreaker {
  private failures = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private lastFailureTime?: number;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime! > 60000) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= 5) {
      this.state = 'OPEN';
      logger.error('smartthings.circuit_breaker_open', { failures: this.failures });
    }
  }
}
```

**Acceptance Criteria:**
- Retries on transient errors
- Circuit breaker prevents cascading failures
- 4xx errors don't trigger retries

---

#### 4.2 Monitoring & Metrics (3 SP)

**Implement Prometheus-style metrics:**
```typescript
export class SmartThingsMetrics {
  private readonly webhookRequestsTotal = new Counter({
    name: 'smartthings_webhook_requests_total',
    help: 'Total webhook requests received',
    labelNames: ['status']
  });

  private readonly eventsReceivedTotal = new Counter({
    name: 'smartthings_events_received_total',
    help: 'Total events received from SmartThings',
    labelNames: ['event_type']
  });

  private readonly eventsProcessedTotal = new Counter({
    name: 'smartthings_events_processed_total',
    help: 'Total events processed successfully',
    labelNames: ['event_type', 'status']
  });

  private readonly apiRequestsTotal = new Counter({
    name: 'smartthings_api_requests_total',
    help: 'Total API requests to SmartThings',
    labelNames: ['endpoint', 'status']
  });

  private readonly processingDuration = new Histogram({
    name: 'smartthings_event_processing_duration_seconds',
    help: 'Event processing duration',
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
  });
}
```

**Acceptance Criteria:**
- Metrics exposed via /metrics endpoint
- Key metrics tracked (requests, events, errors)
- Processing duration measured

---

#### 4.3 Load Testing (3 SP)

**Create load test script:**
```typescript
// test/load/smartthings-load.test.ts
describe('SmartThings Load Tests', () => {
  it('should handle 100 events/second', async () => {
    const events = [];
    for (let i = 0; i < 1000; i++) {
      events.push(createDeviceEventPayload(`evt-${i}`));
    }

    const startTime = Date.now();

    await Promise.all(
      events.map(event =>
        sendWebhook('/webhook/smartthings', createBatchPayload([event]))
      )
    );

    const duration = Date.now() - startTime;
    const throughput = events.length / (duration / 1000);

    expect(throughput).toBeGreaterThan(100); // > 100 events/second
  });

  it('should handle large batches (100 events/batch)', async () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      createDeviceEventPayload(`evt-${i}`)
    );

    const payload = createBatchPayload(events);

    const response = await sendWebhook('/webhook/smartthings', payload);

    expect(response.status).toBe(200);
  });
});
```

**Acceptance Criteria:**
- System handles 100 events/second
- Large batches (100 events) processed correctly
- No memory leaks under load

---

#### 4.4 Documentation (3 SP)

**Create setup guide:**
`documentation/guides/smartthings-setup-guide.md`

**Create API reference:**
`documentation/reference/smartthings-connector-api.md`

**Update architecture docs:**
`documentation/architecture/smartthings-integration-technical-architecture.md`

**Acceptance Criteria:**
- Setup guide complete with screenshots
- API reference documents all methods
- Architecture docs updated

---

### Sprint 4 Deliverables Checklist

- [ ] Error handling implemented
- [ ] Circuit breaker implemented
- [ ] Metrics exposed
- [ ] Load tests passing
- [ ] Documentation complete
- [ ] Performance optimized

**Sprint 4 Success Metrics:**
- < 500ms latency (p99)
- > 99.9% success rate
- Load tests passing
- Documentation complete

---

## Risk Mitigation

### Technical Risks

| Risk | Mitigation | Owner |
|------|-----------|-------|
| SmartThings API changes | Version API calls, monitor changelog | Engineering |
| OAuth token expiration | Auto-refresh with 5min buffer | Engineering |
| Rate limiting from SmartThings | Implement request queue + backoff | Engineering |
| Event flooding | Implement filtering + deduplication | Engineering |
| Memory leaks (long-running) | Load testing, memory profiling | QA |

### Operational Risks

| Risk | Mitigation | Owner |
|------|-----------|-------|
| User setup complexity | Detailed setup guide, UI wizard | Product |
| Device compatibility | Document supported capabilities | Engineering |
| Production incidents | Monitoring, alerting, runbooks | DevOps |

---

## Dependencies

### External Dependencies
- SmartThings Developer Account (Week 1)
- OAuth credentials (Week 1)
- Test devices or simulator (Week 1)

### Internal Dependencies
- ConfigRegistry (existing)
- TranslationEngine (existing)
- IAuthTokenStoreV2 (existing)
- ingress-egress service (existing)

---

## Success Criteria

### Functional Requirements
✅ Receive DEVICE_EVENT webhooks
✅ Translate events to InternalEventV2
✅ Execute device commands
✅ OAuth2 authentication working
✅ Deduplication prevents duplicates

### Non-Functional Requirements
✅ < 500ms latency (p99)
✅ > 99.9% uptime
✅ 100 events/second throughput
✅ > 90% test coverage

### User Experience
✅ OAuth setup < 2 minutes
✅ Device events appear in < 1 second
✅ Device commands execute in < 2 seconds

---

## Timeline Summary

| Sprint | Duration | Start Date | End Date | Deliverable |
|--------|----------|-----------|----------|-------------|
| Sprint 1 | 2 weeks | Week 1 | Week 2 | Webhook ingress foundation |
| Sprint 2 | 1 week | Week 3 | Week 3 | Egress & device control |
| Sprint 3 | 1 week | Week 4 | Week 4 | Advanced events |
| Sprint 4 | 1 week | Week 5 | Week 5 | Production hardening |

**Total:** 5 weeks (adjustable based on team velocity)

---

## Conclusion

This execution plan provides a **detailed, actionable roadmap** for implementing SmartThings integration into BitBrat Platform. The phased approach ensures:

- **Incremental value delivery:** Each sprint produces working functionality
- **Risk mitigation:** Early validation of webhook and OAuth patterns
- **Quality assurance:** Test-driven development with >90% coverage
- **Production readiness:** Comprehensive error handling, monitoring, and documentation

**Next Steps:**
1. Review and approve execution plan
2. Obtain SmartThings Developer Account and OAuth credentials
3. Assign tasks to engineering team
4. Kick off Sprint 1

---

**Document Status:** ✅ Ready for Implementation
**Reviewed By:** Lead Implementor, Engineering Manager
**Approved By:** TBD
**Implementation Start Date:** TBD

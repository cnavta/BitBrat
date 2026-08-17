# Samsung SmartThings Integration - Technical Architecture

## Document Information

**Status:** Feasibility Study & Architecture Proposal
**Author:** Architecture Team
**Date:** 2026-08-16
**Version:** 1.0
**Platform:** Samsung SmartThings IoT Platform
**Delivery Method:** Webhook (HTTPS)

---

## Executive Summary

### Feasibility Assessment: ✅ HIGHLY FEASIBLE

The Samsung SmartThings platform integration is **highly feasible** and aligns well with BitBrat Platform's existing event gateway architecture. SmartThings provides a mature, enterprise-grade webhook-based eventing system that can deliver IoT device events (motion sensors, door locks, temperature changes, appliance status, etc.) to external systems in real-time.

**Key Success Factors:**
- SmartThings uses webhook-based event delivery, matching BitBrat's existing Twilio pattern
- Comprehensive OAuth2 authentication support
- Enterprise-level eventing API with batched event delivery
- Well-documented API with JSON payload structure
- Active developer community and examples
- Support for both consumer and enterprise accounts

**Primary Use Cases:**
1. Home automation event detection (motion, door open/close, temperature)
2. Appliance status monitoring (washer/dryer completion, refrigerator alerts)
3. Security events (intrusion detection, camera motion)
4. Environmental monitoring (smoke detectors, water leak sensors)
5. Smart lock access events

---

## 1. Platform Overview

### 1.1 SmartThings Platform Capabilities

Samsung SmartThings is a comprehensive IoT platform that supports:

- **Devices**: 1000+ compatible smart home devices (lights, locks, sensors, cameras, appliances)
- **Capabilities**: Standardized device capabilities (motion, contact, temperature, switch, etc.)
- **Event Types**: Device state changes, health events, lifecycle events, mode changes, scenes
- **Delivery**: HTTPS webhooks with batched event delivery
- **Authentication**: OAuth2 authorization code flow + Personal Access Tokens (PAT)
- **API Coverage**: Device control, status queries, subscriptions, locations, scenes, rules

### 1.2 Event Categories

SmartThings supports the following event notification types:

| Event Type | Description | Example Use Case |
|------------|-------------|------------------|
| `DEVICE_EVENT` | Device capability/attribute changes | Motion detected, door opened, temperature changed |
| `DEVICE_HEALTH_EVENT` | Device online/offline status | Sensor battery low, device disconnected |
| `DEVICE_LIFECYCLE_EVENT` | Device creation, update, deletion | New device paired, device removed |
| `APPLIANCE_DIAGNOSTIC_EVENT` | Samsung appliance diagnostics | Washer cycle complete, error codes |
| `MODE_EVENT` | Location mode changes | Home/Away/Night mode |
| `SCENE_LIFECYCLE_EVENT` | Scene activation | "Good morning" scene triggered |
| `HUB_HEALTH_EVENT` | SmartThings hub status | Hub offline |
| `LOCATION_LIFECYCLE_EVENT` | Location changes | New home added |

### 1.3 Alignment with BitBrat Architecture

SmartThings integration matches BitBrat's existing patterns:

✅ **Webhook-based delivery** (like Twilio)
✅ **OAuth2 authentication** (like Discord, Slack)
✅ **JSON event payloads** (standard across all platforms)
✅ **Batched event delivery** (similar to Enterprise eventing pattern)
✅ **HTTPS-only requirement** (matches BitBrat security standards)
✅ **Challenge-response verification** (like Discord interactions)

---

## 2. Technical Architecture

### 2.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    SmartThings Cloud                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Devices     │───▶│  Eventing    │───▶│  Webhook     │      │
│  │  (sensors,   │    │  Engine      │    │  Sink        │      │
│  │  locks, etc) │    │              │    │              │      │
│  └──────────────┘    └──────────────┘    └──────┬───────┘      │
└────────────────────────────────────────────────│─────────────────┘
                                                  │ HTTPS POST
                                                  │ (batched events)
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BitBrat Platform                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              ingress-egress Service                       │  │
│  │                                                            │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  SmartThingsConnectorAdapter                       │  │  │
│  │  │  (implements WebhookConnector, EgressConnector)    │  │  │
│  │  │                                                      │  │  │
│  │  │  ┌─────────────────────────────────────────────┐   │  │  │
│  │  │  │  SmartThingsWebhookHandler                  │   │  │  │
│  │  │  │  - Signature verification                   │   │  │  │
│  │  │  │  - Sink confirmation handling               │   │  │  │
│  │  │  │  - Event payload parsing                    │   │  │  │
│  │  │  │  - Deduplication                            │   │  │  │
│  │  │  └──────────────┬──────────────────────────────┘   │  │  │
│  │  │                 │                                   │  │  │
│  │  │                 ▼                                   │  │  │
│  │  │  ┌─────────────────────────────────────────────┐   │  │  │
│  │  │  │  TranslationEngine                          │   │  │  │
│  │  │  │  (YAML config-driven)                       │   │  │  │
│  │  │  │                                              │   │  │  │
│  │  │  │  Reads: config/platforms/smartthings/       │   │  │  │
│  │  │  │    - device-event.v1.yaml                   │   │  │  │
│  │  │  │    - device-health-event.v1.yaml            │   │  │  │
│  │  │  └──────────────┬──────────────────────────────┘   │  │  │
│  │  │                 │                                   │  │  │
│  │  │                 ▼                                   │  │  │
│  │  │  ┌─────────────────────────────────────────────┐   │  │  │
│  │  │  │  IngressPublisher                           │   │  │  │
│  │  │  │  → internal.ingress.v1 topic                │   │  │  │
│  │  │  └─────────────────────────────────────────────┘   │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  SmartThingsEgressClient                           │  │  │
│  │  │  - sendDeviceCommand(deviceId, capability, cmd)   │  │  │
│  │  │  - queryDeviceStatus(deviceId)                    │  │  │
│  │  │  - OAuth token refresh                            │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Event Router Service                         │  │
│  │  - Rule matching (JSONLogic)                             │  │
│  │  - Routing slip assignment                               │  │
│  │  - Enrichment routing                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              LLM Bot Service                              │  │
│  │  - React to IoT events                                   │  │
│  │  - Generate automation suggestions                       │  │
│  │  - Send device commands via egress                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

#### 2.2.1 SmartThingsConnectorAdapter
**Location:** `src/services/ingress/smartthings/connector-adapter.ts`

Implements:
- `WebhookConnector`: Webhook verification and event handling
- `EgressConnector`: Device command execution
- `IngressConnector`: Lifecycle management (optional for webhook-based connectors)

```typescript
class SmartThingsConnectorAdapter implements WebhookConnector, EgressConnector {
  constructor(
    private readonly webhookHandler: SmartThingsWebhookHandler,
    private readonly egressClient: SmartThingsEgressClient,
    private readonly config: IConfig
  ) {}

  // WebhookConnector interface
  verifySignature(req: WebhookRequest): boolean;
  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse>;

  // EgressConnector interface
  async sendDeviceCommand(deviceId: string, capability: string, command: any): Promise<void>;
  async queryDeviceStatus(deviceId: string): Promise<DeviceStatus>;

  // IngressConnector interface (minimal for webhook-based)
  async start(): Promise<void>; // No-op or subscription setup
  async stop(): Promise<void>;  // Cleanup
  getSnapshot(): ConnectorSnapshot;
  getMetadata(): ConnectorMetadata;
}
```

#### 2.2.2 SmartThingsWebhookHandler
**Location:** `src/services/ingress/smartthings/webhook-handler.ts`

Responsibilities:
- Parse SmartThings webhook POST requests
- Handle `SINK_CONFIRMATION` lifecycle (challenge-response)
- Handle `EVENT` notifications (batched events)
- Extract individual events from batches
- Invoke TranslationEngine for normalization
- Publish to `internal.ingress.v1`
- Deduplication (event ID tracking)

```typescript
class SmartThingsWebhookHandler {
  async handleRequest(req: WebhookRequest): Promise<WebhookResponse> {
    // 1. Parse notification type
    if (req.body.notificationType === 'SINK_CONFIRMATION') {
      return this.handleSinkConfirmation(req.body);
    }

    if (req.body.notificationType === 'EVENT') {
      return this.handleEventBatch(req.body);
    }

    throw new Error('Unknown notification type');
  }

  private handleSinkConfirmation(payload: any): WebhookResponse {
    // Echo challenge value
    return {
      statusCode: 200,
      body: JSON.stringify({
        targetUrl: payload.sinkConfiguration.targetUrl,
        confirmationUrl: payload.confirmationUrl
      })
    };
  }

  private async handleEventBatch(payload: any): Promise<WebhookResponse> {
    const events = payload.eventNotification.events;

    for (const event of events) {
      // Check deduplication
      if (this.isDuplicate(event.eventId)) continue;

      // Translate to InternalEventV2
      const internalEvent = await this.translationEngine.translateInbound(
        'smartthings',
        event.eventType,
        event
      );

      // Publish
      await this.publisher.publish(internalEvent);

      // Track processed ID
      this.markProcessed(event.eventId);
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) };
  }
}
```

#### 2.2.3 SmartThingsEgressClient
**Location:** `src/services/ingress/smartthings/egress-client.ts`

Responsibilities:
- Execute device commands (turn on/off, set level, unlock, etc.)
- Query device status
- OAuth2 token management (refresh)
- Rate limit handling
- API error handling

```typescript
class SmartThingsEgressClient {
  constructor(
    private readonly tokenStore: IAuthTokenStoreV2,
    private readonly config: IConfig
  ) {}

  async sendDeviceCommand(
    deviceId: string,
    capability: string,
    command: { command: string; arguments?: any[] }
  ): Promise<void> {
    const token = await this.tokenStore.getAccessToken('smartthings');

    await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
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
  }

  async queryDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    const token = await this.tokenStore.getAccessToken('smartthings');

    const response = await fetch(
      `https://api.smartthings.com/v1/devices/${deviceId}/status`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    return response.json();
  }
}
```

---

## 3. Event Mapping Configuration

### 3.1 Device Event Mapping

**File:** `config/platforms/smartthings/device-event.v1.yaml`

```yaml
# SmartThings DEVICE_EVENT → iot.device.event.v1
platformEvent: DEVICE_EVENT
internalEventType: iot.device.event.v1
priority: 0

# Optional filter: Only motion capability events
# filter:
#   "==": [{ "var": "capability" }, "motionSensor"]

fieldMapping:
  # Identity mapping
  userId: subscriptionName  # Or account ID
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
    locationGroupId: locationGroupId
    subscriptionId: subscriptionId

egress:
  method: sendDeviceCommand
  fieldMapping:
    deviceId: egress.target
    capability: command.capability
    command: command.data

metadata:
  description: SmartThings device capability/attribute change event
  platformDocUrl: https://developer.smartthings.com/docs/enterprise/enterprise-api-overview/eventing/overview
  createdBy: Architecture Team
  createdAt: "2026-08-16"
```

### 3.2 Internal Event Type Definition

**File:** `config/events/iot-device-event.v1.yaml`

```yaml
type: iot.device.event.v1
description: IoT device state change event (motion, contact, temperature, etc.)
version: 1
category: ingress

schema:
  type: object
  required:
    - deviceId
    - capability
    - attribute
    - value
    - timestamp
  properties:
    deviceId:
      type: string
      description: Platform-specific device identifier
    deviceName:
      type: string
      description: Human-readable device name
    capability:
      type: string
      description: Device capability (motionSensor, contactSensor, temperatureMeasurement, etc.)
    attribute:
      type: string
      description: Capability attribute (motion, contact, temperature, etc.)
    value:
      description: Attribute value (active/inactive, open/closed, numeric, etc.)
    unit:
      type: string
      description: Unit of measurement (F, C, %, etc.)
    timestamp:
      type: string
      format: date-time
      description: Event timestamp (ISO 8601)
    locationId:
      type: string
      description: Location/home identifier
    locationName:
      type: string
      description: Location name

supportedPlatforms:
  - smartthings
  # Future: hubitat, home-assistant, etc.

metadata:
  createdBy: Architecture Team
  createdAt: "2026-08-16"
```

### 3.3 Example Event Translation

#### Input: SmartThings DEVICE_EVENT Payload

```json
{
  "notificationType": "EVENT",
  "version": "2",
  "accountId": "abc-123",
  "eventNotification": {
    "locationGroupId": "loc-group-456",
    "events": [
      {
        "eventId": "evt-789",
        "eventType": "DEVICE_EVENT",
        "eventTime": "2026-08-16T10:30:00Z",
        "deviceId": "dev-motion-001",
        "deviceName": "Front Door Motion Sensor",
        "locationId": "loc-456",
        "locationName": "Home",
        "capability": "motionSensor",
        "attribute": "motion",
        "value": "active",
        "stateChange": true,
        "subscriptionId": "sub-001"
      }
    ]
  }
}
```

#### Output: InternalEventV2

```json
{
  "v": "2",
  "type": "iot.device.event.v1",
  "correlationId": "uuid-generated",
  "traceId": "trace-generated",

  "ingress": {
    "ingressAt": "2026-08-16T10:30:00.123Z",
    "source": "ingress.smartthings",
    "connector": "smartthings",
    "channel": "webhook"
  },

  "identity": {
    "external": {
      "id": "loc-456",
      "platform": "smartthings",
      "displayName": "Home",
      "metadata": {
        "accountId": "abc-123",
        "locationGroupId": "loc-group-456"
      }
    }
  },

  "message": {
    "text": "Front Door Motion Sensor: motion = active",
    "id": "evt-789",
    "timestamp": "2026-08-16T10:30:00Z"
  },

  "custom": {
    "deviceId": "dev-motion-001",
    "deviceName": "Front Door Motion Sensor",
    "capability": "motionSensor",
    "attribute": "motion",
    "value": "active",
    "locationId": "loc-456",
    "locationName": "Home",
    "stateChange": true,
    "eventId": "evt-789",
    "locationGroupId": "loc-group-456",
    "subscriptionId": "sub-001"
  },

  "egress": {
    "destination": "smartthings.dev-motion-001",
    "type": "command",
    "connector": "smartthings",
    "channel": "api"
  },

  "routing": {
    "stage": "initial",
    "slip": [],
    "history": []
  }
}
```

---

## 4. Authentication & Authorization

### 4.1 OAuth2 Authorization Code Flow

SmartThings requires OAuth2 for production integrations (as of 2025, Personal Access Tokens are limited to 24-hour validity).

#### Flow Sequence

```
User                    BitBrat              SmartThings
 |                         |                      |
 |-- 1. Connect Request -->|                      |
 |                         |                      |
 |                         |-- 2. Redirect ------>|
 |                         |    /authorize        |
 |                         |                      |
 |<------- 3. Approval UI ----------------------->|
 |                         |                      |
 |-- 4. Grant Permission ->|                      |
 |                         |                      |
 |<-- 5. Callback ---------|                      |
 |    (authorization code) |                      |
 |                         |                      |
 |                         |-- 6. Exchange Code ->|
 |                         |    /token            |
 |                         |                      |
 |                         |<- 7. Access Token ---|
 |                         |    (+ Refresh Token) |
 |                         |                      |
 |<-- 8. Connected --------|                      |
```

#### Implementation

**OAuth Configuration:**
```typescript
const oauthConfig = {
  clientId: process.env.SMARTTHINGS_CLIENT_ID,
  clientSecret: process.env.SMARTTHINGS_CLIENT_SECRET,
  authorizationUrl: 'https://api.smartthings.com/oauth/authorize',
  tokenUrl: 'https://api.smartthings.com/oauth/token',
  scopes: [
    'r:devices:*',      // Read device status
    'x:devices:*',      // Execute device commands
    'r:locations:*',    // Read locations
    'r:scenes:*',       // Read scenes
    'x:scenes:*'        // Execute scenes
  ],
  redirectUri: 'https://bitbrat.dev/oauth/smartthings/callback'
};
```

**Token Storage:**
```typescript
interface SmartThingsToken {
  platform: 'smartthings';
  userId: string;           // Internal BitBrat user ID
  externalId: string;       // SmartThings account ID
  accessToken: string;
  refreshToken: string;
  expiresAt: string;        // ISO 8601
  scopes: string[];
  metadata: {
    locationIds: string[];  // Authorized locations
  };
}
```

Tokens stored in `IAuthTokenStoreV2` (Firestore `auth-tokens` collection).

### 4.2 Webhook Sink Registration

After OAuth, register webhook sink for event delivery:

```typescript
async function registerWebhookSink(accessToken: string, accountId: string): Promise<string> {
  const response = await fetch(
    `https://api.smartthings.com/v1/accounts/${accountId}/sinks`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'bitbrat-webhook',
        type: 'HTTPS_SINK',
        endpoint: 'https://bitbrat.dev/webhook/smartthings'
      })
    }
  );

  const sink = await response.json();
  return sink.sinkId; // Store for later management
}
```

### 4.3 Event Subscriptions

Subscribe to specific event types:

```typescript
async function createEventSubscription(
  accessToken: string,
  accountId: string,
  sinkId: string
): Promise<void> {
  await fetch(
    `https://api.smartthings.com/v1/accounts/${accountId}/subscriptions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'all-device-events',
        sinkId: sinkId,
        eventTypes: [
          'DEVICE_EVENT',
          'DEVICE_HEALTH_EVENT',
          'DEVICE_LIFECYCLE_EVENT'
        ],
        // Optional: filter by specific devices or locations
        filter: {
          locationIds: ['loc-456']
        }
      })
    }
  );
}
```

---

## 5. Data Flow Examples

### 5.1 Motion Detection Flow

```
1. Physical Event
   └─ Motion sensor detects movement

2. SmartThings Cloud
   └─ Generates DEVICE_EVENT
   └─ Batches with other recent events
   └─ POST to webhook sink

3. BitBrat ingress-egress Service
   └─ SmartThingsWebhookHandler receives POST
   └─ Verifies signature (if implemented)
   └─ Parses event batch
   └─ Iterates through events

4. Translation
   └─ TranslationEngine.translateInbound('smartthings', 'DEVICE_EVENT', event)
   └─ Loads config/platforms/smartthings/device-event.v1.yaml
   └─ Maps fields to InternalEventV2
   └─ Sets type: 'iot.device.event.v1'

5. Publication
   └─ IngressPublisher.publish(internalEvent)
   └─ Publishes to internal.ingress.v1 topic

6. Event Router
   └─ Receives from internal.ingress.v1
   └─ Evaluates rules (JSONLogic)
   └─ Assigns routing slip: ['auth', 'llm-bot']

7. Auth Enrichment
   └─ Attaches user identity
   └─ Loads user preferences (e.g., "notify me of motion")

8. LLM Bot Reaction
   └─ Analyzes: "Front door motion detected at 10:30 AM"
   └─ Checks rules: "If motion + nobody home → alert user"
   └─ Generates response: "Motion detected at front door. Security cameras activated."

9. Egress
   └─ Sends notification to user's Discord/Slack
   └─ (Optional) Sends command to SmartThings to turn on lights
   └─ SmartThingsEgressClient.sendDeviceCommand('light-001', 'switch', {command: 'on'})
```

### 5.2 Appliance Completion Flow

```
1. Washer completes cycle
   └─ Samsung washer sends diagnostic event

2. SmartThings Cloud
   └─ APPLIANCE_DIAGNOSTIC_EVENT
   └─ eventType: "COMPLETION_EVENT"

3. BitBrat Processing
   └─ Translate to iot.appliance.event.v1
   └─ Route to LLM Bot

4. LLM Bot
   └─ "Washer cycle complete. Would you like to start the dryer?"

5. User Response (via Discord/Slack)
   └─ "Yes, start dryer on normal cycle"

6. LLM Bot Parses Command
   └─ Extracts intent: start_dryer
   └─ Parameters: cycle=normal

7. Egress Command
   └─ SmartThingsEgressClient.sendDeviceCommand(
       'dryer-001',
       'dryer',
       { command: 'start', arguments: ['normal'] }
     )
```

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Sprint 1) - 1-2 weeks

**Deliverables:**
- [ ] Create SmartThings connector directory structure
- [ ] Implement OAuth2 flow (authorization + token refresh)
- [ ] Create `SmartThingsWebhookHandler` with sink confirmation
- [ ] Implement basic DEVICE_EVENT handling
- [ ] Create YAML event mapping configs
- [ ] Unit tests for webhook handler

**Files to Create:**
```
src/services/ingress/smartthings/
├── factory.ts
├── connector-adapter.ts
├── webhook-handler.ts
├── egress-client.ts
├── types.ts
└── __tests__/
    ├── webhook-handler.test.ts
    └── connector-adapter.test.ts

config/platforms/smartthings/
├── device-event.v1.yaml
├── device-health-event.v1.yaml
└── appliance-diagnostic-event.v1.yaml

config/events/
├── iot-device-event.v1.yaml
├── iot-device-health-event.v1.yaml
└── iot-appliance-event.v1.yaml
```

### Phase 2: Egress & Device Control (Sprint 2) - 1 week

**Deliverables:**
- [ ] Implement `SmartThingsEgressClient`
- [ ] Device command execution (switch, lock, dimmer)
- [ ] Device status queries
- [ ] Egress field mapping in YAML configs
- [ ] Integration tests with SmartThings sandbox

### Phase 3: Advanced Features (Sprint 3) - 1 week

**Deliverables:**
- [ ] Scene execution support
- [ ] Mode change detection
- [ ] Appliance diagnostic events
- [ ] Event filtering (by location, device type)
- [ ] Rate limit handling with exponential backoff

### Phase 4: Production Readiness (Sprint 4) - 1 week

**Deliverables:**
- [ ] Signature verification (if SmartThings supports it)
- [ ] Error handling and retry logic
- [ ] Monitoring and observability (correlation IDs)
- [ ] Documentation (setup guide, supported devices)
- [ ] Load testing (simulated event batches)

---

## 7. Configuration Examples

### 7.1 Environment Variables

```bash
# SmartThings OAuth
SMARTTHINGS_CLIENT_ID=your-client-id
SMARTTHINGS_CLIENT_SECRET=your-client-secret
SMARTTHINGS_REDIRECT_URI=https://bitbrat.dev/oauth/smartthings/callback

# Webhook endpoint
SMARTTHINGS_WEBHOOK_URL=https://bitbrat.dev/webhook/smartthings

# Feature flags
ENABLE_SMARTTHINGS_INTEGRATION=true
SMARTTHINGS_DEBUG_MODE=false
```

### 7.2 architecture.yaml Configuration

```yaml
services:
  ingress-egress:
    connectors:
      smartthings:
        enabled: true
        type: webhook
        deliveryMethod: webhook
        authMethod: oauth2

        oauth:
          clientId: ${SMARTTHINGS_CLIENT_ID}
          clientSecret: ${SMARTTHINGS_CLIENT_SECRET}
          authorizationUrl: https://api.smartthings.com/oauth/authorize
          tokenUrl: https://api.smartthings.com/oauth/token
          scopes:
            - r:devices:*
            - x:devices:*
            - r:locations:*
            - r:scenes:*
            - x:scenes:*
          redirectUri: ${SMARTTHINGS_REDIRECT_URI}

        webhook:
          endpoint: ${SMARTTHINGS_WEBHOOK_URL}
          verifySignature: false  # SmartThings doesn't provide signature headers

        eventTypes:
          - DEVICE_EVENT
          - DEVICE_HEALTH_EVENT
          - DEVICE_LIFECYCLE_EVENT
          - APPLIANCE_DIAGNOSTIC_EVENT
          - MODE_EVENT
          - SCENE_LIFECYCLE_EVENT

        deduplication:
          enabled: true
          ttlSeconds: 300
          keyField: eventId

        egress:
          enabled: true
          rateLimit:
            requestsPerSecond: 10
            burstSize: 20
```

---

## 8. Security Considerations

### 8.1 Authentication Security

✅ **OAuth2 token storage:** Encrypted in Firestore with access controls
✅ **Token refresh:** Automatic refresh before expiration
✅ **Scope minimization:** Request only necessary permissions
✅ **HTTPS only:** All communication encrypted

### 8.2 Webhook Security

⚠️ **No signature verification:** SmartThings doesn't provide HMAC signatures (as of 2026)
✅ **HTTPS required:** TLS encryption for webhook delivery
✅ **Challenge-response:** Sink confirmation prevents unauthorized registration
✅ **Deduplication:** Prevents replay attacks via event ID tracking

**Mitigation for no signature:**
- Use HTTPS with strong TLS configuration
- Implement IP allowlisting for SmartThings webhook sources (if IPs are static)
- Monitor for unusual event patterns

### 8.3 Data Privacy

- **User data:** Device names, locations, event data must comply with privacy policies
- **Retention:** Define TTL for IoT events (recommend 30-90 days)
- **Access control:** RBAC for who can see/control devices

---

## 9. Monitoring & Observability

### 9.1 Metrics to Track

```typescript
// Prometheus-style metrics
smartthings_webhook_requests_total{status="success|failure"}
smartthings_events_received_total{event_type="DEVICE_EVENT|..."}
smartthings_events_processed_total{status="success|failure"}
smartthings_api_requests_total{endpoint="/devices|/scenes", status="2xx|4xx|5xx"}
smartthings_token_refresh_total{status="success|failure"}
smartthings_deduplication_hits_total
```

### 9.2 Logging

```json
{
  "level": "info",
  "service": "ingress-egress",
  "connector": "smartthings",
  "correlationId": "uuid",
  "message": "Processed SmartThings event batch",
  "eventCount": 3,
  "eventTypes": ["DEVICE_EVENT", "DEVICE_EVENT", "MODE_EVENT"],
  "locationGroupId": "loc-group-456",
  "processingTimeMs": 45
}
```

### 9.3 Health Checks

```typescript
// Connector health snapshot
{
  "platform": "smartthings",
  "state": "CONNECTED",
  "lastEventReceivedAt": "2026-08-16T10:30:00Z",
  "eventsProcessed24h": 1243,
  "tokenExpiresAt": "2026-08-17T10:30:00Z",
  "sinkStatus": "REGISTERED",
  "subscriptionCount": 5
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Webhook payload parsing
- Event translation (SmartThings → InternalEventV2)
- OAuth token refresh logic
- Deduplication logic
- Egress command formatting

### 10.2 Integration Tests

- Sink confirmation flow (mock SmartThings challenge)
- Event batch processing (simulated webhooks)
- Device command execution (SmartThings sandbox/test account)
- OAuth flow (automated with test credentials)

### 10.3 End-to-End Tests

```typescript
describe('SmartThings Motion Detection E2E', () => {
  it('should detect motion and trigger notification', async () => {
    // 1. Simulate webhook POST from SmartThings
    const webhookPayload = createMotionEventPayload();

    // 2. POST to /webhook/smartthings
    const response = await request(app)
      .post('/webhook/smartthings')
      .send(webhookPayload);

    expect(response.status).toBe(200);

    // 3. Wait for event processing
    await delay(1000);

    // 4. Verify internal event was published
    const internalEvents = await getPublishedEvents('internal.ingress.v1');
    expect(internalEvents).toHaveLength(1);
    expect(internalEvents[0].type).toBe('iot.device.event.v1');

    // 5. Verify LLM bot processed it
    const egressEvents = await getPublishedEvents('egress.discord.v1');
    expect(egressEvents[0].message.text).toContain('motion detected');
  });
});
```

---

## 11. Risk Assessment

### 11.1 Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| No webhook signature verification | Medium | HTTPS + IP allowlisting + deduplication |
| SmartThings API rate limits | Medium | Implement exponential backoff + request queue |
| OAuth token expiration | Low | Automated refresh with 5-minute buffer |
| Event batch size variability | Low | Streaming parser, process events individually |
| SmartThings API downtime | Medium | Graceful degradation, retry with exponential backoff |

### 11.2 Operational Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| User setup complexity (OAuth) | Medium | Clear documentation, setup wizard |
| Device compatibility issues | Low | Use standard capabilities, document supported devices |
| Event flooding from chatty devices | Medium | Rate limiting, event filtering |

---

## 12. Future Enhancements

### 12.1 Phase 2 Features

- **SmartApps integration:** Custom SmartApps for advanced automation
- **Scene management:** Create/modify scenes via BitBrat commands
- **Rule engine integration:** Define automation rules ("When X, then Y")
- **Multi-location support:** Manage multiple homes/locations
- **Device grouping:** Control multiple devices as a group

### 12.2 Advanced Capabilities

- **Predictive automation:** ML-based pattern recognition ("You usually lock the door at 10 PM")
- **Voice command integration:** "Tell BitBrat to turn off all lights"
- **Energy monitoring:** Track power usage, provide insights
- **Security integration:** Camera snapshots on motion, intrusion alerts

---

## 13. Success Criteria

### 13.1 Functional Requirements

✅ Successfully authenticate via OAuth2
✅ Receive and process DEVICE_EVENT webhooks
✅ Translate SmartThings events to InternalEventV2 format
✅ Execute device commands (switch, lock, dimmer)
✅ Handle event batches (1-100 events per POST)
✅ Deduplication prevents duplicate processing

### 13.2 Non-Functional Requirements

✅ **Latency:** < 500ms from webhook receipt to internal event publication
✅ **Availability:** 99.9% uptime for webhook endpoint
✅ **Throughput:** Handle 100 events/second (batched)
✅ **Security:** OAuth tokens encrypted at rest, HTTPS for all communication

### 13.3 User Experience

✅ OAuth setup completes in < 2 minutes
✅ Device events appear in chat within 1 second
✅ Device commands execute within 2 seconds
✅ Clear error messages for common issues

---

## 14. Conclusion

The Samsung SmartThings integration is **highly feasible** and represents a natural extension of BitBrat Platform's event gateway architecture. The webhook-based delivery model aligns perfectly with existing patterns (Twilio), and the comprehensive API provides robust device control capabilities.

**Key Strengths:**
- Well-documented API with active developer community
- Enterprise-grade eventing system with batched delivery
- OAuth2 authentication for secure, long-term access
- Support for 1000+ device types and capabilities
- Aligns with BitBrat's config-driven translation architecture

**Recommended Approach:**
1. Implement as webhook-based connector (like Twilio)
2. Use YAML config-driven translation (minimal custom code)
3. OAuth2 for authentication with automated token refresh
4. Start with DEVICE_EVENT, expand to other event types
5. Phased rollout: Foundation → Egress → Advanced → Production

**Timeline:** 4-6 weeks for full implementation across 4 sprints

**Next Steps:**
1. Obtain SmartThings Developer Account
2. Register API App for OAuth credentials
3. Create test environment with sample devices
4. Begin Sprint 1 implementation

---

## Appendix A: SmartThings Event Type Reference

| Event Type | Description | Key Fields |
|------------|-------------|------------|
| DEVICE_EVENT | Device state change | deviceId, capability, attribute, value |
| DEVICE_HEALTH_EVENT | Device online/offline | deviceId, status, reason |
| DEVICE_LIFECYCLE_EVENT | Device added/removed | deviceId, lifecycle (CREATE, UPDATE, DELETE) |
| APPLIANCE_DIAGNOSTIC_EVENT | Samsung appliance status | applianceId, diagnosticCode, message |
| MODE_EVENT | Location mode change | modeId, modeName (Home, Away, Night) |
| SCENE_LIFECYCLE_EVENT | Scene triggered | sceneId, sceneName |
| HUB_HEALTH_EVENT | Hub connectivity | hubId, status |

## Appendix B: SmartThings Capabilities Reference

Common device capabilities:

- **switch**: On/off control (lights, outlets)
- **switchLevel**: Dimmer level (0-100)
- **colorControl**: RGB/HSL color
- **lock**: Lock/unlock
- **motionSensor**: Motion detected (active/inactive)
- **contactSensor**: Open/closed (doors, windows)
- **temperatureMeasurement**: Temperature reading
- **relativeHumidityMeasurement**: Humidity %
- **presenceSensor**: Presence detection (present/not present)
- **smokeDetector**: Smoke detection (detected/clear)
- **waterSensor**: Water leak detection (wet/dry)

Full list: https://developer.smartthings.com/docs/devices/capabilities/capabilities-reference

## Appendix C: References

- SmartThings Developer Portal: https://developer.smartthings.com/
- Enterprise Eventing API: https://developer.smartthings.com/docs/enterprise/enterprise-api-overview/eventing/overview
- Public API Reference: https://developer.smartthings.com/docs/api/public
- OAuth Integration Guide: https://developer.smartthings.com/docs/connected-services/oauth-integrations
- Community Examples: https://github.com/SmartThingsCommunity/

---

**Document Status:** ✅ Ready for Review
**Review By:** Product, Engineering, Security
**Target Start Date:** TBD
**Estimated Completion:** 4-6 weeks post-approval

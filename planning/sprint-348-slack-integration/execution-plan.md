# Sprint 348: Slack Integration - Execution Plan

**Sprint**: 348
**Sprint Goal**: Integrate Slack using the Ingress-Egress Framework
**Start Date**: 2026-07-19
**Estimated Duration**: 12-16 hours
**Status**: In Progress

---

## Executive Summary

This sprint continues the work from Sprint 342 (Ingress-Egress Framework Foundation) by integrating Slack as the second platform. We'll leverage the established webhook infrastructure, proving the framework's reusability and identifying any gaps in the abstraction.

**Key Success Metrics**:
- ✅ Slack bot responds to @mentions in test channel
- ✅ All events published to event-router in Envelope v1 format
- ✅ 17+ unit tests passing with 100% coverage
- ✅ Architecture validator passes
- ✅ Socket Mode maintains connection for > 1 hour
- ✅ Zero signature verification failures in production

---

## Phase 1: Foundation & Setup (2-3 hours)

### SLACK-001: Create Slack Connector Directory Structure
**Priority**: P0
**Estimated**: 30 minutes
**Status**: Todo

**Objective**: Create directory structure following Sprint 342 blueprint

**Tasks**:
1. Create `src/services/ingress/slack/` directory
2. Create `src/services/ingress/slack/__tests__/` directory
3. Create stub files:
   - `connector-adapter.ts` - Main adapter (IngressConnector + WebhookConnector)
   - `slack-ingress-client.ts` - Socket Mode WebSocket client
   - `webhook-utils.ts` - Signature verification helpers
   - `envelope-builder.ts` - Convert Slack events → Envelope v1
   - `index.ts` - Public exports
   - `__tests__/connector-adapter.test.ts`
   - `__tests__/connector-adapter-webhook.test.ts`
   - `__tests__/webhook-utils.test.ts`

**Acceptance Criteria**:
- [ ] All directories created
- [ ] All stub files created with TypeScript boilerplate
- [ ] Files import necessary interfaces from `../core`
- [ ] No compilation errors

**Files Changed**:
- `src/services/ingress/slack/connector-adapter.ts` (new)
- `src/services/ingress/slack/slack-ingress-client.ts` (new)
- `src/services/ingress/slack/webhook-utils.ts` (new)
- `src/services/ingress/slack/envelope-builder.ts` (new)
- `src/services/ingress/slack/index.ts` (new)
- `src/services/ingress/slack/__tests__/connector-adapter.test.ts` (new)
- `src/services/ingress/slack/__tests__/connector-adapter-webhook.test.ts` (new)
- `src/services/ingress/slack/__tests__/webhook-utils.test.ts` (new)

---

### SLACK-002: Install Slack SDK Dependencies
**Priority**: P0
**Estimated**: 15 minutes
**Status**: Todo
**Dependencies**: SLACK-001

**Objective**: Install required NPM packages for Slack integration

**Tasks**:
1. Install `@slack/socket-mode` for Socket Mode WebSocket client
2. Install `@slack/web-api` for REST API (egress)
3. Install `@types/node` if missing (for crypto module)
4. Update `package.json` and `package-lock.json`

**Commands**:
```bash
npm install @slack/socket-mode @slack/web-api
```

**Acceptance Criteria**:
- [ ] Packages installed successfully
- [ ] `package.json` updated
- [ ] `package-lock.json` updated
- [ ] `npm run build` succeeds

**Files Changed**:
- `package.json` (modified)
- `package-lock.json` (modified)

---

### SLACK-003: Implement Slack Webhook Signature Verification
**Priority**: P0
**Estimated**: 1-2 hours
**Status**: Todo
**Dependencies**: SLACK-002

**Objective**: Implement Slack-specific webhook signature verification

**Implementation Details**:

```typescript
// src/services/ingress/slack/webhook-utils.ts
import crypto from 'crypto';

/**
 * Verify Slack webhook signature
 *
 * Algorithm: HMAC-SHA256 of `v0:timestamp:body`
 * Reference: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * @param secret - Slack signing secret (from SLACK_SIGNING_SECRET env var)
 * @param signature - x-slack-signature header value (format: v0=<hex>)
 * @param timestamp - x-slack-request-timestamp header value
 * @param body - Request body (parsed JSON object)
 * @returns true if signature is valid and timestamp is recent
 */
export function validateSlackSignature(
  secret: string,
  signature: string,
  timestamp: string,
  body: Record<string, any>
): boolean {
  // Reject old requests (replay attack prevention)
  const requestTime = parseInt(timestamp, 10) * 1000;
  const now = Date.now();
  if (Math.abs(now - requestTime) > 5 * 60 * 1000) {
    return false; // Older than 5 minutes
  }

  // Compute expected signature
  const bodyString = JSON.stringify(body);
  const signatureBaseString = `v0:${timestamp}:${bodyString}`;

  const expectedSignature = 'v0=' + crypto
    .createHmac('sha256', secret)
    .update(signatureBaseString, 'utf-8')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

**Unit Tests**:
1. Valid signature passes
2. Invalid signature fails
3. Expired timestamp (> 5 minutes) fails
4. Missing signature header fails
5. Malformed signature header fails

**Acceptance Criteria**:
- [ ] `validateSlackSignature()` function implemented
- [ ] 5+ unit tests passing
- [ ] Signature verification works with official Slack test vectors
- [ ] Replay attack prevention working (timestamp validation)

**Files Changed**:
- `src/services/ingress/slack/webhook-utils.ts` (modified)
- `src/services/ingress/slack/__tests__/webhook-utils.test.ts` (modified)

---

## Phase 2: Core Integration (4-6 hours)

### SLACK-004: Implement Envelope Builder
**Priority**: P0
**Estimated**: 1-2 hours
**Status**: Todo
**Dependencies**: SLACK-003

**Objective**: Normalize Slack events to Envelope v1 format

**Implementation**:

```typescript
// src/services/ingress/slack/envelope-builder.ts
import type { InternalEventV2 } from '../../../types/events';
import { randomUUID } from 'crypto';

export interface SlackEventMeta {
  type: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
}

export function buildSlackEnvelope(
  event: SlackEventMeta,
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string;
  }
): InternalEventV2 {
  const uuid = opts?.uuid || randomUUID;
  const nowIso = opts?.nowIso || (() => new Date().toISOString());

  return {
    id: uuid(),
    correlationId: uuid(),
    platform: 'slack',
    source: {
      platform: 'slack',
      platformUserId: event.user || 'unknown',
      platformChannelId: event.channel || 'unknown',
      platformMessageId: event.ts || uuid(),
    },
    message: {
      text: event.text || '',
      timestamp: nowIso(),
    },
    egressDestination: opts?.egressDestination || event.channel,
    timestamp: nowIso(),
    version: 'v2',
    routingSlip: [],
    annotations: [],
  };
}
```

**Acceptance Criteria**:
- [ ] Envelope builder implemented
- [ ] Unit tests cover all event types
- [ ] Envelope v1 schema validated
- [ ] Thread support (thread_ts) implemented

**Files Changed**:
- `src/services/ingress/slack/envelope-builder.ts` (modified)
- `src/services/ingress/slack/__tests__/envelope-builder.test.ts` (new)

---

### SLACK-005: Implement Socket Mode Client
**Priority**: P0
**Estimated**: 2-3 hours
**Status**: Todo
**Dependencies**: SLACK-004

**Objective**: Implement real-time ingress via Slack Socket Mode

**Implementation**:

```typescript
// src/services/ingress/slack/slack-ingress-client.ts
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { IngressPublisher, ConnectorSnapshot } from '../core';
import { buildSlackEnvelope } from './envelope-builder';
import { logger } from '../../../common/logging';

export class SlackIngressClient {
  private socketClient?: SocketModeClient;
  private webClient?: WebClient;
  private state: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
  private counters = {
    received: 0,
    published: 0,
    filtered: 0,
    failed: 0,
  };
  private lastMessageAt: string | null = null;

  constructor(
    private readonly appToken: string,
    private readonly botToken: string,
    private readonly publisher: IngressPublisher
  ) {}

  async start(): Promise<void> {
    logger.info('slack.client.starting');
    this.state = 'starting';

    this.webClient = new WebClient(this.botToken);
    this.socketClient = new SocketModeClient({
      appToken: this.appToken,
      logLevel: process.env.SLACK_LOG_LEVEL || 'info',
    });

    // Handle message events
    this.socketClient.on('message', async ({ event, body, ack }) => {
      try {
        await ack();
        this.counters.received++;

        // Filter bot messages to prevent loops
        if (event.bot_id) {
          this.counters.filtered++;
          return;
        }

        const envelope = buildSlackEnvelope(event);
        await this.publisher.publish(envelope);

        this.counters.published++;
        this.lastMessageAt = new Date().toISOString();

        logger.debug('slack.message.published', {
          correlationId: envelope.correlationId,
          user: event.user,
          channel: event.channel,
        });
      } catch (err: any) {
        this.counters.failed++;
        logger.error('slack.message.failed', { error: err.message });
      }
    });

    // Handle errors
    this.socketClient.on('error', (error) => {
      logger.error('slack.socket.error', { error: error.message });
      this.state = 'error';
    });

    // Handle disconnections
    this.socketClient.on('disconnect', () => {
      logger.warn('slack.socket.disconnected');
      this.state = 'stopped';
    });

    await this.socketClient.start();
    this.state = 'running';
    logger.info('slack.client.started');
  }

  async stop(): Promise<void> {
    logger.info('slack.client.stopping');
    await this.socketClient?.disconnect();
    this.state = 'stopped';
    logger.info('slack.client.stopped');
  }

  getSnapshot(): ConnectorSnapshot {
    return {
      state: this.state,
      id: 'slack-socket-mode',
      displayName: 'Slack Socket Mode',
      lastError: null,
      counters: this.counters,
      lastMessageAt: this.lastMessageAt,
    };
  }
}
```

**Acceptance Criteria**:
- [ ] Socket Mode client connects successfully
- [ ] Message events published to event-router
- [ ] Bot messages filtered (prevent loops)
- [ ] Counters track received/published/filtered/failed
- [ ] Graceful shutdown on stop()
- [ ] Error handling and logging

**Files Changed**:
- `src/services/ingress/slack/slack-ingress-client.ts` (modified)
- `src/services/ingress/slack/__tests__/slack-ingress-client.test.ts` (new)

---

### SLACK-006: Implement SlackConnectorAdapter
**Priority**: P0
**Estimated**: 1-2 hours
**Status**: Todo
**Dependencies**: SLACK-005

**Objective**: Implement dual-mode connector (IngressConnector + WebhookConnector)

**Implementation**:

```typescript
// src/services/ingress/slack/connector-adapter.ts
import type {
  IngressConnector,
  ConnectorSnapshot,
  WebhookConnector,
  WebhookRequest,
  WebhookResponse,
  ConnectorMetadata
} from '../core';
import type { SlackIngressClient } from './slack-ingress-client';
import { logger } from '../../../common/logging';
import { validateSlackSignature } from './webhook-utils';
import { buildSlackEnvelope } from './envelope-builder';
import type { IConfig } from '../../../types';

export class SlackConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: SlackIngressClient,
    private readonly config?: IConfig
  ) {}

  //
  // IngressConnector implementation (Socket Mode)
  //

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  getSnapshot(): ConnectorSnapshot {
    return this.client.getSnapshot();
  }

  async sendText(text: string, target?: string): Promise<void> {
    logger.debug('slack.adapter.sendText', { target, textLength: text?.length });
    if (!target) {
      throw new Error('slack_connector_adapter.target_required');
    }
    // Egress via Slack Web API (implemented in SLACK-009)
    throw new Error('slack_egress_not_implemented');
  }

  //
  // WebhookConnector implementation (Events API)
  //

  verifySignature(req: WebhookRequest): boolean {
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];

    if (!signature || !timestamp) {
      logger.warn('slack.webhook.missing_headers');
      return false;
    }

    const secret = this.config?.slackSigningSecret;
    if (!secret) {
      logger.error('slack.webhook.no_signing_secret');
      return false;
    }

    const valid = validateSlackSignature(
      secret,
      signature as string,
      timestamp as string,
      req.body
    );

    if (!valid) {
      logger.warn('slack.webhook.invalid_signature');
    }

    return valid;
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const { type, challenge, event } = req.body;

    logger.debug('slack.webhook.received', { type, eventType: event?.type });

    // Handle URL verification challenge
    if (type === 'url_verification') {
      logger.info('slack.webhook.url_verification', { challenge });
      return { status: 200, body: { challenge } };
    }

    // Handle event callbacks
    if (type === 'event_callback') {
      // IMPORTANT: Return 200 OK immediately (< 3-second SLA)
      // Process event asynchronously after response
      setImmediate(async () => {
        try {
          const envelope = buildSlackEnvelope(event);
          await this.client['publisher'].publish(envelope);
          logger.debug('slack.webhook.event_published', {
            correlationId: envelope.correlationId,
            eventType: event.type,
          });
        } catch (err: any) {
          logger.error('slack.webhook.event_failed', { error: err.message });
        }
      });

      return { status: 200, body: { ok: true } };
    }

    logger.warn('slack.webhook.unsupported_type', { type });
    return { status: 400, body: { error: 'unsupported_event_type' } };
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'slack',
      version: '1.0.0',
      authMethod: 'oauth2',
      capabilities: {
        ingress: {
          method: 'hybrid',  // Socket Mode (primary) + Events API (fallback)
          realtime: true,
          requiresWebhook: false,  // Socket Mode doesn't require webhooks
          requiresPublicUrl: false,  // Socket Mode doesn't require public URL
        },
        egress: {
          chat: true,
          dm: true,
          reactions: true,
          threads: true,
        },
        moderation: {
          ban: false,  // Slack doesn't support banning via API
          timeout: false,
          delete: true,  // Can delete messages
        },
      },
    };
  }
}
```

**Acceptance Criteria**:
- [ ] Implements both IngressConnector and WebhookConnector
- [ ] URL verification challenge handled correctly
- [ ] Event callbacks processed asynchronously (< 3-second SLA)
- [ ] Signature verification delegates to webhook-utils
- [ ] Metadata accurately reflects Slack capabilities

**Files Changed**:
- `src/services/ingress/slack/connector-adapter.ts` (modified)
- `src/services/ingress/slack/index.ts` (modified - export adapter)

---

## Phase 3: Testing (2-3 hours)

### SLACK-007: Unit Tests for Webhook Connector
**Priority**: P0
**Estimated**: 1-2 hours
**Status**: Todo
**Dependencies**: SLACK-006

**Objective**: Create comprehensive test suite for WebhookConnector interface

**Test Cases** (17+ tests):

**File: `connector-adapter-webhook.test.ts`**

1. **Signature Verification**
   - [ ] Valid signature passes
   - [ ] Invalid signature fails
   - [ ] Missing signature header fails
   - [ ] Missing timestamp header fails
   - [ ] Expired timestamp fails (> 5 minutes)
   - [ ] Malformed signature fails

2. **URL Verification Challenge**
   - [ ] Returns challenge value with 200 OK
   - [ ] Logs url_verification event

3. **Event Callback Handling**
   - [ ] Returns 200 OK immediately (< 100ms)
   - [ ] Processes event asynchronously (setImmediate)
   - [ ] Publishes envelope to event-router
   - [ ] Handles errors gracefully (logs, doesn't throw)

4. **Unsupported Event Types**
   - [ ] Returns 400 Bad Request for unknown event types

5. **Metadata Validation**
   - [ ] Platform is 'slack'
   - [ ] Capabilities.ingress.method is 'hybrid'
   - [ ] Capabilities.egress.threads is true

**Acceptance Criteria**:
- [ ] 17+ unit tests passing
- [ ] 100% coverage of webhook code paths
- [ ] Tests run in < 5 seconds
- [ ] No actual Slack API calls (mocked)

**Files Changed**:
- `src/services/ingress/slack/__tests__/connector-adapter-webhook.test.ts` (modified)

---

### SLACK-008: Integration Tests (Multi-Platform Validation)
**Priority**: P1
**Estimated**: 1 hour
**Status**: Todo
**Dependencies**: SLACK-007

**Objective**: Validate generic webhook routing with multiple platforms

**Test Cases**:

```typescript
// tests/integration/webhook-routing.test.ts
describe('Generic Webhook Routing', () => {
  describe('POST /webhooks/:platform', () => {
    it('should route Twilio webhooks to TwilioConnectorAdapter', async () => {
      const res = await request(app)
        .post('/webhooks/twilio')
        .send(twilioEventPayload)
        .set('X-Twilio-Signature', validTwilioSignature)
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should route Slack webhooks to SlackConnectorAdapter', async () => {
      const res = await request(app)
        .post('/webhooks/slack')
        .send(slackEventPayload)
        .set('x-slack-signature', validSlackSignature)
        .set('x-slack-request-timestamp', timestamp)
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should handle Slack URL verification challenge', async () => {
      const res = await request(app)
        .post('/webhooks/slack')
        .send({ type: 'url_verification', challenge: 'test123' })
        .expect(200);

      expect(res.body).toHaveProperty('challenge', 'test123');
    });

    it('should return 404 for unknown platform', async () => {
      const res = await request(app)
        .post('/webhooks/unknown')
        .send({})
        .expect(404);
    });

    it('should return 403 for invalid signature', async () => {
      const res = await request(app)
        .post('/webhooks/slack')
        .send(slackEventPayload)
        .set('x-slack-signature', 'invalid')
        .set('x-slack-request-timestamp', timestamp)
        .expect(403);
    });
  });
});
```

**Acceptance Criteria**:
- [ ] All integration tests passing
- [ ] Generic route works for both Twilio and Slack
- [ ] Platform lookup via ConnectorManager validated
- [ ] 404 handling for unknown platforms
- [ ] 403 handling for invalid signatures

**Files Changed**:
- `tests/integration/webhook-routing.test.ts` (new)

---

## Phase 4: Integration & Deployment (2-3 hours)

### SLACK-009: Register Slack Connector in ingress-egress-service
**Priority**: P0
**Estimated**: 1 hour
**Status**: Todo
**Dependencies**: SLACK-006

**Objective**: Register Slack connector with ConnectorManager

**Implementation**:

```typescript
// src/apps/ingress-egress-service.ts (around line 80-100)

// Register Slack connector (Socket Mode + Events API)
if (config.slackAppToken && config.slackBotToken) {
  logger.info('slack.connector.initializing');

  const slackClient = new SlackIngressClient(
    config.slackAppToken,
    config.slackBotToken,
    publisher
  );

  const slackConnector = new SlackConnectorAdapter(slackClient, config);
  manager.register('slack', slackConnector);

  logger.info('slack.connector.registered', {
    socketMode: true,
    eventsApi: !!config.slackSigningSecret,
  });
} else {
  logger.warn('slack.connector.skipped', {
    reason: 'missing_credentials',
    hasAppToken: !!config.slackAppToken,
    hasBotToken: !!config.slackBotToken,
  });
}
```

**Configuration** (add to `architecture.yaml`):

```yaml
services:
  ingress-egress:
    secrets:
      - SLACK_APP_TOKEN       # xapp-... (Socket Mode)
      - SLACK_BOT_TOKEN       # xoxb-... (OAuth2)
      - SLACK_SIGNING_SECRET  # Webhook signature verification (Events API)
```

**Acceptance Criteria**:
- [ ] Connector registered when credentials present
- [ ] Gracefully handles missing credentials (logs warning)
- [ ] Webhook route `/webhooks/slack` automatically works
- [ ] No code changes needed to webhook routing logic

**Files Changed**:
- `src/apps/ingress-egress-service.ts` (modified)
- `architecture.yaml` (modified - add secrets)

---

### SLACK-010: Implement Slack Egress (sendText)
**Priority**: P0
**Estimated**: 1 hour
**Status**: Todo
**Dependencies**: SLACK-009

**Objective**: Implement egress via Slack Web API

**Implementation**:

```typescript
// src/services/ingress/slack/connector-adapter.ts (update sendText method)

async sendText(text: string, target?: string): Promise<void> {
  logger.debug('slack.adapter.sendText', { target, textLength: text?.length });

  if (!target) {
    throw new Error('slack_connector_adapter.target_required');
  }

  try {
    const result = await this.client['webClient'].chat.postMessage({
      channel: target,
      text: text,
    });

    logger.info('slack.egress.sent', {
      channel: target,
      ts: result.ts,
    });
  } catch (err: any) {
    logger.error('slack.egress.failed', {
      channel: target,
      error: err.message,
    });
    throw err;
  }
}
```

**Acceptance Criteria**:
- [ ] Messages sent to Slack channels successfully
- [ ] Errors logged and propagated
- [ ] Unit tests cover success and failure cases

**Files Changed**:
- `src/services/ingress/slack/connector-adapter.ts` (modified)
- `src/services/ingress/slack/__tests__/connector-adapter.test.ts` (modified)

---

### SLACK-011: Architecture Validation
**Priority**: P1
**Estimated**: 30 minutes
**Status**: Todo
**Dependencies**: SLACK-010

**Objective**: Validate SlackConnectorAdapter against framework compliance

**Command**:
```bash
npm run validate:ingress-architecture
```

**Expected Output**:
```
Validating Ingress Architecture...

Twilio Connector:
  ✓ Implements WebhookConnector
  ✓ verifySignature() exists
  ✓ handleWebhook() exists
  ✓ getMetadata() exists
  ✓ Metadata.platform is 'twilio'
  ✓ Metadata.capabilities defined

Slack Connector:
  ✓ Implements WebhookConnector
  ✓ verifySignature() exists
  ✓ handleWebhook() exists
  ✓ getMetadata() exists
  ✓ Metadata.platform is 'slack'
  ✓ Metadata.capabilities.ingress.method is 'hybrid'
  ✓ Metadata.capabilities.egress.threads is true

All checks passed!
```

**Acceptance Criteria**:
- [ ] All architecture validation checks pass
- [ ] No deprecated patterns detected
- [ ] Metadata accurately reflects capabilities

**Files Changed**:
- `tools/validate-ingress-architecture.ts` (modified - add Slack checks)

---

### SLACK-012: Remove Deprecated Twilio Route
**Priority**: P1
**Estimated**: 15 minutes
**Status**: Todo
**Dependencies**: SLACK-009

**Objective**: Clean up deprecated Twilio webhook route

**Rationale**: Twilio now uses generic `/webhooks/twilio` route (Sprint 342 IEF-008)

**Changes**:

```typescript
// src/apps/ingress-egress-service.ts

// REMOVE THIS (deprecated route):
// app.post('/twilio/webhook', async (req, res) => {
//   logger.warn('twilio.webhook.deprecated_route_used');
//   // ... handler code
// });
```

**Acceptance Criteria**:
- [ ] Deprecated route removed from code
- [ ] Tests updated to use generic `/webhooks/twilio` route
- [ ] Deployment logs show zero traffic on old route (monitor before removal)

**Files Changed**:
- `src/apps/ingress-egress-service.ts` (modified)
- `src/services/ingress/twilio/__tests__/*.test.ts` (modified - update route paths)

---

## Phase 5: Documentation & Closure (1-2 hours)

### SLACK-013: Documentation Update
**Priority**: P1
**Estimated**: 1 hour
**Status**: Todo
**Dependencies**: SLACK-011

**Objective**: Update documentation to reflect Slack integration

**Changes**:

1. **CLAUDE.md** - Update webhook pattern section:
   ```markdown
   ### Integrating Chat Platforms: The Webhook Pattern

   **RULE: Use this pattern when integrating external chat platforms (Twilio, Slack, Discord, etc.).**

   Examples in Production:
   - **Twilio** (`src/services/ingress/twilio/connector-adapter.ts`): Hybrid mode
   - **Slack** (`src/services/ingress/slack/connector-adapter.ts`): Hybrid mode (Socket Mode + Events API)
   ```

2. **adding-ingress-platform.md** - Update platform examples:
   ```markdown
   **Platform Examples**:
   - **Twilio**: HMAC-SHA1 of (URL + sorted body params)
   - **Slack**: HMAC-SHA256 of (`v0:timestamp:body`)
   - **Discord**: Ed25519 signature verification
   - **GitHub**: HMAC-SHA256 of raw body
   ```

3. **Architecture validation guide** - Add Slack to validated platforms

**Acceptance Criteria**:
- [ ] CLAUDE.md references both Twilio and Slack
- [ ] Documentation reflects current state (deprecated route removed)
- [ ] Platform integration guide updated
- [ ] Future developers have Slack as reference implementation

**Files Changed**:
- `CLAUDE.md` (modified)
- `documentation/guides/adding-ingress-platform.md` (modified)
- `tools/validate-ingress-architecture.ts` (modified - update docs)

---

### SLACK-014: Sprint Retrospective
**Priority**: P1
**Estimated**: 1 hour
**Status**: Todo
**Dependencies**: All tasks

**Objective**: Document sprint outcomes and lessons learned

**Create**: `planning/sprint-348-slack-integration/retro.md`

**Sections**:
1. Executive Summary
2. Sprint Metrics (velocity, task breakdown, time investment)
3. What Went Well
4. What Didn't Go Well
5. Key Learnings
6. Action Items (immediate and future)
7. Risks & Mitigations
8. Handoff to Sprint 349+ (Discord, Teams)

**Key Questions to Answer**:
- Did the framework save time vs building from scratch?
- What gaps were identified in the abstraction?
- What improvements should be made for future platforms?
- What was the actual time spent vs estimated?

**Acceptance Criteria**:
- [ ] Comprehensive retrospective document created
- [ ] Action items identified for future sprints
- [ ] Framework ROI analysis documented
- [ ] Lessons captured for Discord/Teams integrations

**Files Changed**:
- `planning/sprint-348-slack-integration/retro.md` (new)

---

## Success Criteria

### Sprint Complete When:
- [x] All P0 tasks completed
- [ ] All P1 tasks completed
- [ ] 17+ unit tests passing (100% coverage)
- [ ] Integration tests passing
- [ ] Architecture validator passes
- [ ] Documentation updated
- [ ] Retrospective completed

### Production Validation Checklist:
- [ ] Slack bot deployed to staging
- [ ] Socket Mode connection maintained for > 1 hour
- [ ] @mention messages trigger event-router flow
- [ ] Messages published in Envelope v1 format
- [ ] Webhook signature verification passes (Events API)
- [ ] No errors in logs for 24 hours
- [ ] Rate limit handling tested

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Socket Mode connectivity issues | Medium | High | Implement reconnection logic, fallback to Events API |
| Rate limit enforcement | High | Medium | Implement retry queue with exponential backoff |
| Webhook signature verification failures | Low | High | Comprehensive unit tests, production monitoring |
| Thread support complexity | Low | Medium | Defer threading to future sprint if needed |

---

## Timeline

| Phase | Duration | Start | End |
|-------|----------|-------|-----|
| Phase 1: Foundation & Setup | 2-3 hours | Day 1 | Day 1 |
| Phase 2: Core Integration | 4-6 hours | Day 1-2 | Day 2 |
| Phase 3: Testing | 2-3 hours | Day 2 | Day 2 |
| Phase 4: Integration & Deployment | 2-3 hours | Day 2-3 | Day 3 |
| Phase 5: Documentation & Closure | 1-2 hours | Day 3 | Day 3 |

**Total Estimated**: 12-16 hours over 3 days

---

## Next Steps

1. ✅ Execution plan approved
2. ⏭️ Create YAML backlog
3. ⏭️ Begin SLACK-001 (directory structure)
4. ⏭️ Daily standup updates via todo list

---

**Plan Status**: Approved
**Ready to Execute**: Yes
**Next Action**: Create YAML backlog

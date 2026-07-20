# Sprint 348: Slack Integration - Continuation Plan

**Sprint**: 348
**Base Sprint**: 342 (Ingress-Egress Framework Foundation)
**Sprint Goal**: Integrate Slack as the second platform using the webhook framework
**Status**: Planning
**Created**: 2026-07-19

---

## Executive Summary

Sprint 342 successfully delivered a production-ready webhook infrastructure framework, validating the design with Twilio as the reference implementation. Sprint 348 continues this work by integrating **Slack** as the second platform, proving the framework's reusability and identifying any gaps in the abstraction.

**Key Objectives:**
1. Implement `SlackConnectorAdapter` using the established webhook framework
2. Support Slack's Events API (webhook-based) and Socket Mode (WebSocket-based)
3. Validate the framework with a production deployment
4. Remove deprecated Twilio webhook route (IEF-008 cleanup)
5. Document lessons learned for future platform integrations

---

## Sprint 342 Foundation - What We're Building On

### Completed Infrastructure (Sprint 342)

✅ **WebhookConnector Interface**
- `verifySignature(req: WebhookRequest): boolean`
- `handleWebhook(req: WebhookRequest): Promise<WebhookResponse>`
- `getMetadata(): ConnectorMetadata`

✅ **Generic Webhook Routing**
- `POST /webhooks/:platform` route
- Platform lookup via `ConnectorManager`
- < 3-second SLA enforcement

✅ **Architecture Validation Tooling**
- `tools/validate-ingress-architecture.ts`
- Validates WebhookConnector compliance
- Detects deprecated patterns

✅ **Comprehensive Documentation**
- `documentation/guides/adding-ingress-platform.md` (650+ lines)
- Platform-specific signature algorithms
- Common pitfalls and solutions

✅ **Twilio Reference Implementation**
- 17 unit tests (100% pass rate)
- Production-validated webhook handler
- Zero breaking changes during migration

### Known Issues from Sprint 342

⚠️ **IEF-004 BLOCKED: Raw Body Middleware**
- Cannot implement raw body middleware in child classes
- `base-server.ts:129` already installs `express.json()` globally
- **Impact on Slack**: Low - Slack works with parsed `req.body` (timestamp + body string for signature)
- **Action**: Document as limitation, defer base-server refactoring

⏸️ **IEF-006 DEFERRED: Integration Tests**
- Unit tests adequate for Sprint 342
- Integration tests valuable for multi-platform validation
- **Action**: Add integration tests in Sprint 348 (test Twilio + Slack together)

---

## Slack Integration Design

### Slack API Overview

Slack provides two primary event delivery methods:

| Method | Transport | Use Case | Auth | Complexity |
|--------|-----------|----------|------|------------|
| **Events API** | Webhook (HTTP POST) | Production apps, public distribution | OAuth2 + Signing Secret | Low |
| **Socket Mode** | WebSocket | Development, private apps | Bot Token + App Token | Medium |

**Recommendation**: Implement **both** methods, with Socket Mode as the primary ingress method (lower latency, simpler deployment) and Events API as fallback/production option.

### Slack Events Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Slack Platform                            │
│                                                              │
│  Events: message.channels, message.groups, app_mention      │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │ (Socket Mode)           │ (Events API)
        ▼                         ▼
┌──────────────────┐      ┌──────────────────────┐
│ WebSocket Client │      │ POST /webhooks/slack │
│ @slack/socket-   │      │                      │
│ mode             │      │ - Verify signature   │
│                  │      │ - Return 200 < 3s    │
└────────┬─────────┘      └──────────┬───────────┘
         │                           │
         └─────────────┬─────────────┘
                       ▼
         ┌────────────────────────────────────┐
         │ SlackConnectorAdapter              │
         │                                    │
         │ - Normalize events → Envelope v1   │
         │ - Publish to event-router          │
         │ - Handle rate limits               │
         └────────────────────────────────────┘
```

### Key Requirements

1. **Signature Verification** (Events API only)
   - Algorithm: HMAC-SHA256 of `v0:timestamp:body`
   - Header: `x-slack-signature`
   - Timestamp: `x-slack-request-timestamp`
   - Replay attack prevention: Reject requests > 5 minutes old

2. **Event Types**
   - `message.channels`: Public channel messages
   - `message.groups`: Private channel messages
   - `message.im`: Direct messages
   - `app_mention`: @mentions of the bot
   - `reaction_added`: Reactions to messages

3. **OAuth2 Flow**
   - Workspace installation via OAuth2
   - Bot token: `xoxb-...`
   - App token: `xapp-...` (Socket Mode only)
   - Token storage: PostgreSQL (via `auth-token-store`)

4. **Rate Limits**
   - Tier 1: 1+ req/sec
   - Tier 2: 20+ req/min
   - Tier 3: 50+ req/min
   - Tier 4: 100+ req/min
   - **Strategy**: Exponential backoff + retry queue

---

## Implementation Tasks

### Phase 1: Core Slack Integration (8-10 hours)

#### SLACK-001: Create Slack Connector Directory Structure
**Priority**: P0
**Estimated**: 30 minutes

Create directory structure following Sprint 342 blueprint:

```bash
src/services/ingress/slack/
├── connector-adapter.ts          # IngressConnector + WebhookConnector
├── slack-ingress-client.ts       # Socket Mode WebSocket client
├── webhook-utils.ts               # Signature verification
├── envelope-builder.ts            # Slack events → Envelope v1
├── index.ts                       # Public exports
└── __tests__/
    ├── connector-adapter.test.ts
    ├── connector-adapter-webhook.test.ts
    └── webhook-utils.test.ts
```

**Acceptance Criteria**:
- Directory structure matches Twilio pattern
- All files created with boilerplate
- No code implementation yet

---

#### SLACK-002: Implement Slack Webhook Signature Verification
**Priority**: P0
**Estimated**: 1-2 hours
**Dependencies**: SLACK-001

Implement `webhook-utils.ts` with Slack-specific signature algorithm:

```typescript
/**
 * Verify Slack webhook signature
 *
 * Algorithm: HMAC-SHA256 of `v0:timestamp:body`
 * Header: x-slack-signature (format: v0=<hex>)
 * Timestamp: x-slack-request-timestamp
 *
 * @param secret - Slack signing secret (from config)
 * @param signature - x-slack-signature header value
 * @param timestamp - x-slack-request-timestamp header value
 * @param body - Raw request body (stringified JSON)
 * @returns true if signature is valid
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
    return false;
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

**Acceptance Criteria**:
- Signature verification passes with valid test vectors
- Rejects requests > 5 minutes old
- Unit tests cover valid/invalid signatures, timestamp validation, malformed headers

---

#### SLACK-003: Implement SlackConnectorAdapter (WebhookConnector)
**Priority**: P0
**Estimated**: 2-3 hours
**Dependencies**: SLACK-002

Implement `connector-adapter.ts` with WebhookConnector interface:

```typescript
export class SlackConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: SlackIngressClient,
    private readonly config?: IConfig
  ) {}

  // WebhookConnector implementation
  verifySignature(req: WebhookRequest): boolean {
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];

    if (!signature || !timestamp) {
      return false;
    }

    return validateSlackSignature(
      this.config.slackSigningSecret,
      signature,
      timestamp,
      req.body
    );
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const { type, challenge, event } = req.body;

    // Handle URL verification challenge
    if (type === 'url_verification') {
      return { status: 200, body: { challenge } };
    }

    // Handle event callbacks
    if (type === 'event_callback') {
      setImmediate(async () => {
        await this.processSlackEvent(event);
      });
      return { status: 200, body: { ok: true } };
    }

    return { status: 400, body: { error: 'unsupported_event_type' } };
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'slack',
      version: '1.0.0',
      authMethod: 'oauth2',
      capabilities: {
        ingress: {
          method: 'hybrid',  // WebSocket (Socket Mode) + webhook (Events API)
          realtime: true,
          requiresWebhook: false,  // Socket Mode doesn't require webhooks
          requiresPublicUrl: false  // Socket Mode doesn't require public URL
        },
        egress: {
          chat: true,
          dm: true,
          reactions: true,
          threads: true
        },
        moderation: {
          ban: false,  // Slack doesn't support banning via API
          timeout: false,
          delete: true  // Can delete messages
        }
      }
    };
  }

  // IngressConnector methods (Socket Mode)
  async start(): Promise<void> { await this.client.start(); }
  async stop(): Promise<void> { await this.client.stop(); }
  getSnapshot(): ConnectorSnapshot { return this.client.getSnapshot(); }
  async sendText(text: string, target?: string): Promise<void> {
    // Egress via Slack Web API
  }
}
```

**Acceptance Criteria**:
- Implements both WebhookConnector and IngressConnector
- URL verification challenge handled correctly
- Event callbacks processed asynchronously (< 3-second SLA)
- Metadata accurately reflects Slack capabilities

---

#### SLACK-004: Implement Slack Socket Mode Client
**Priority**: P0
**Estimated**: 3-4 hours
**Dependencies**: SLACK-003

Implement `slack-ingress-client.ts` using `@slack/socket-mode`:

```typescript
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { IngressPublisher } from '../core';
import { buildSlackEnvelope } from './envelope-builder';

export class SlackIngressClient {
  private socketClient?: SocketModeClient;
  private webClient?: WebClient;
  private state: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';

  constructor(
    private readonly config: IConfig,
    private readonly publisher: IngressPublisher
  ) {}

  async start(): Promise<void> {
    this.state = 'starting';

    this.webClient = new WebClient(this.config.slackBotToken);
    this.socketClient = new SocketModeClient({
      appToken: this.config.slackAppToken,
      logger: {
        debug: (msg) => logger.debug('slack.socket.debug', { msg }),
        info: (msg) => logger.info('slack.socket.info', { msg }),
        warn: (msg) => logger.warn('slack.socket.warn', { msg }),
        error: (msg) => logger.error('slack.socket.error', { msg }),
      }
    });

    // Handle message events
    this.socketClient.on('message', async ({ event, ack }) => {
      await ack();

      const envelope = buildSlackEnvelope(event);
      await this.publisher.publish(envelope);
    });

    await this.socketClient.start();
    this.state = 'running';
  }

  async stop(): Promise<void> {
    await this.socketClient?.disconnect();
    this.state = 'stopped';
  }

  getSnapshot(): ConnectorSnapshot {
    return {
      state: this.state,
      id: 'slack-socket-mode',
      displayName: 'Slack Socket Mode',
      lastError: null,
      counters: { received: 0, published: 0, filtered: 0, failed: 0 },
      lastMessageAt: null
    };
  }
}
```

**Acceptance Criteria**:
- Socket Mode client connects successfully
- Message events published to event-router
- Graceful shutdown on stop()
- Error handling and reconnection logic

---

### Phase 2: Testing & Validation (2-3 hours)

#### SLACK-005: Unit Tests for Slack Connector
**Priority**: P0
**Estimated**: 2 hours
**Dependencies**: SLACK-002, SLACK-003, SLACK-004

Create comprehensive test suite (17+ tests, mirroring Twilio):

**Files**:
- `connector-adapter-webhook.test.ts`: WebhookConnector interface tests
- `webhook-utils.test.ts`: Signature verification tests
- `envelope-builder.test.ts`: Event normalization tests

**Test Coverage**:
- Signature verification (valid, invalid, expired timestamp)
- URL verification challenge
- Event callback handling
- Metadata validation
- Socket Mode connection/disconnection
- Error handling

**Acceptance Criteria**:
- 17+ unit tests passing
- 100% coverage of webhook code paths
- Tests run in < 5 seconds

---

#### SLACK-006: Integration Tests (Multi-Platform Validation)
**Priority**: P1
**Estimated**: 1 hour
**Dependencies**: SLACK-005

Create integration tests validating generic webhook routing with multiple platforms:

```typescript
describe('Generic Webhook Routing', () => {
  it('should route Twilio webhooks to TwilioConnectorAdapter', async () => {
    const res = await request(app)
      .post('/webhooks/twilio')
      .send(twilioEventPayload)
      .expect(200);
  });

  it('should route Slack webhooks to SlackConnectorAdapter', async () => {
    const res = await request(app)
      .post('/webhooks/slack')
      .send(slackEventPayload)
      .expect(200);
  });

  it('should return 404 for unknown platform', async () => {
    const res = await request(app)
      .post('/webhooks/unknown')
      .send({})
      .expect(404);
  });
});
```

**Acceptance Criteria**:
- Generic route works for both Twilio and Slack
- Platform lookup via ConnectorManager validated
- 404 handling for unknown platforms

---

### Phase 3: Configuration & Deployment (1-2 hours)

#### SLACK-007: Register Slack Connector in ingress-egress-service
**Priority**: P0
**Estimated**: 30 minutes
**Dependencies**: SLACK-004

Update `src/apps/ingress-egress-service.ts` to register Slack connector:

```typescript
// Register Slack connector
if (config.slackBotToken && config.slackAppToken) {
  const slackClient = new SlackIngressClient(config, publisher);
  const slackConnector = new SlackConnectorAdapter(slackClient, config);
  manager.register('slack', slackConnector);
  logger.info('slack.connector.registered');
}
```

**Acceptance Criteria**:
- Connector registered when config present
- Gracefully handles missing config (logs warning)
- Webhook route automatically works (no code changes needed)

---

#### SLACK-008: Architecture Validation
**Priority**: P1
**Estimated**: 30 minutes
**Dependencies**: SLACK-007

Run `tools/validate-ingress-architecture.ts` against SlackConnectorAdapter:

```bash
npm run validate:ingress-architecture
```

**Expected Output**:
```
✓ SlackConnectorAdapter implements WebhookConnector
✓ SlackConnectorAdapter.verifySignature() exists
✓ SlackConnectorAdapter.handleWebhook() exists
✓ SlackConnectorAdapter.getMetadata() exists
✓ Metadata.platform is 'slack'
✓ Metadata.capabilities.ingress defined
✓ Metadata.capabilities.egress defined
```

**Acceptance Criteria**:
- All architecture validation checks pass
- No deprecated patterns detected

---

#### SLACK-009: Remove Deprecated Twilio Route
**Priority**: P1
**Estimated**: 15 minutes
**Dependencies**: SLACK-007

Remove deprecated Twilio webhook route from `ingress-egress-service.ts`:

```typescript
// OLD (remove this)
app.post('/twilio/webhook', async (req, res) => {
  logger.warn('twilio.webhook.deprecated_route_used');
  // ... handler code
});
```

**Rationale**: Twilio now uses generic `/webhooks/twilio` route (Sprint 342 IEF-008)

**Acceptance Criteria**:
- Deprecated route removed
- Tests updated to use generic route
- Deployment logs show zero traffic on old route

---

#### SLACK-010: Documentation Update
**Priority**: P1
**Estimated**: 30 minutes
**Dependencies**: SLACK-008

Update documentation:

1. **CLAUDE.md**: Add Slack as second example in webhook pattern
2. **adding-ingress-platform.md**: Add Slack signature algorithm to platform examples
3. **Architecture validation guide**: Add Slack to validated platforms list

**Acceptance Criteria**:
- CLAUDE.md references both Twilio and Slack
- Documentation reflects current state (deprecated route removed)
- Future developers have Slack as reference implementation

---

### Phase 4: Sprint Closure (1 hour)

#### SLACK-011: Sprint Retrospective
**Priority**: P1
**Estimated**: 1 hour
**Dependencies**: All tasks

Create `planning/sprint-348-slack-integration/retro.md`:

- What went well
- What didn't go well
- Framework improvements identified
- Lessons for future platforms (Discord, Teams)
- Handoff to Sprint 349+

**Acceptance Criteria**:
- Comprehensive retrospective document
- Action items for future sprints
- Framework ROI analysis (time saved vs Sprint 342)

---

## Success Criteria

### Sprint Complete When:
1. ✅ SlackConnectorAdapter implements WebhookConnector + IngressConnector
2. ✅ Slack webhook route (`POST /webhooks/slack`) functional
3. ✅ Socket Mode ingress operational
4. ✅ 17+ unit tests passing (100% coverage)
5. ✅ Integration tests validate multi-platform routing
6. ✅ Architecture validator passes
7. ✅ Deprecated Twilio route removed
8. ✅ Documentation updated
9. ✅ Retrospective completed

### Deployment Validation:
1. Slack bot responds to @mentions in test channel
2. Messages published to event-router with correct Envelope v1 format
3. Webhook signature verification passes
4. Socket Mode maintains connection for > 1 hour
5. No errors in logs for 24 hours

---

## Estimated Effort

| Phase | Estimated Hours |
|-------|----------------|
| Phase 1: Core Slack Integration | 8-10 hours |
| Phase 2: Testing & Validation | 2-3 hours |
| Phase 3: Configuration & Deployment | 1-2 hours |
| Phase 4: Sprint Closure | 1 hour |
| **Total** | **12-16 hours** |

**Framework ROI**: Sprint 342 took ~7-8 hours. Sprint 348 estimated at 12-16 hours (including integration tests + cleanup). Without framework: 20+ hours.

**Time Saved**: ~30% reduction compared to building Slack integration from scratch.

---

## Risks & Mitigations

### Risk 1: Slack Socket Mode Connectivity Issues
**Likelihood**: Medium
**Impact**: High (no real-time ingress)

**Mitigation**:
- Implement reconnection logic with exponential backoff
- Fall back to Events API (webhook) if Socket Mode fails
- Monitor connection state via `getSnapshot()`

---

### Risk 2: Rate Limit Enforcement
**Likelihood**: High
**Impact**: Medium (API errors, degraded UX)

**Mitigation**:
- Implement retry queue with exponential backoff
- Monitor `x-rate-limit-*` headers
- Log rate limit events for analysis

---

### Risk 3: Webhook Signature Verification Failures
**Likelihood**: Low
**Impact**: High (security vulnerability)

**Mitigation**:
- Comprehensive unit tests (5+ test cases)
- Test with real Slack webhooks in development
- Monitor `slack.webhook.invalid_signature` logs

---

## Dependencies

### NPM Packages
- `@slack/socket-mode` (Socket Mode WebSocket client)
- `@slack/web-api` (Slack Web API client for egress)

### Configuration
```yaml
# architecture.yaml
services:
  ingress-egress:
    secrets:
      - SLACK_BOT_TOKEN       # xoxb-... (OAuth2 bot token)
      - SLACK_APP_TOKEN       # xapp-... (Socket Mode app token)
      - SLACK_SIGNING_SECRET  # Webhook signature verification
```

---

## Handoff to Future Sprints

### Sprint 349: Discord Migration
- Migrate Discord to webhook framework
- Discord uses Ed25519 signatures (different from HMAC-SHA256)
- Estimated: 8-10 hours (same as Slack, framework proven)

### Sprint 350: Teams Integration
- Microsoft Teams Events API
- OAuth2 + tenant-specific configuration
- Estimated: 10-12 hours (new OAuth flow patterns)

---

**Plan Status**: Ready for Review
**Next Step**: User approval to proceed with implementation

# Ingress-Egress Integration Framework
## Technical Architecture Document

**Sprint**: 342
**Author**: Claude (Architect Role)
**Date**: 2026-07-14
**Status**: Draft for Review

---

## Executive Summary

This document defines the canonical architecture for integrating new communication platforms (Slack, Teams, Telegram, etc.) into the BitBrat Platform's ingress-egress system. It establishes consistent patterns, interfaces, and best practices derived from analyzing existing integrations (Twitch, Discord, Twilio) and Slack's Events API requirements.

**Key Objectives:**
1. Define a unified connector framework for all platform integrations
2. Establish Slack as the reference implementation for this framework
3. Ensure real-time, event-driven architecture for all integrations
4. Maintain backward compatibility with existing connectors
5. Support both webhook-based (HTTP) and WebSocket-based event delivery

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Architectural Principles](#architectural-principles)
3. [Unified Connector Framework](#unified-connector-framework)
4. [Slack Integration Design](#slack-integration-design)
5. [Event Normalization](#event-normalization)
6. [Configuration Schema](#configuration-schema)
7. [Deployment Architecture](#deployment-architecture)
8. [Security & Reliability](#security--reliability)
9. [Migration Path](#migration-path)
10. [Implementation Checklist](#implementation-checklist)

---

## Current State Analysis

### Existing Architecture

BitBrat's `ingress-egress` service (src/apps/ingress-egress-service.ts:39) currently supports three platforms:

| Platform | Ingress Method | Egress Method | Auth Pattern | State |
|----------|---------------|---------------|--------------|-------|
| **Twitch** | IRC (Twurple) | IRC + Helix Whispers | OAuth2 + Refresh | Production |
| **Discord** | WebSocket (discord.js) | REST API | Bot Token | Production |
| **Twilio** | Webhook | Conversations API | API Key + Secret | Production |

### Architectural Patterns Identified

#### 1. Connector Abstraction
All platforms implement `IngressConnector` and `EgressConnector` interfaces (src/services/ingress/core/interfaces.ts:12-32):

```typescript
interface IngressConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSnapshot(): ConnectorSnapshot;
}

interface EgressConnector {
  sendText(text: string, target?: string): Promise<void>;
  banUser?(platformUserId: string, reason?: string): Promise<void>;
}
```

#### 2. Envelope Builder Pattern
Each platform provides an `EnvelopeBuilder<TMeta>` that normalizes platform-specific events to `InternalEventV2`:

```typescript
interface EnvelopeBuilder<TMeta> {
  build(meta: TMeta, opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string
  }): InternalEventV2;
}
```

#### 3. Publisher Abstraction
Platforms publish normalized events via `IngressPublisher`:

```typescript
interface IngressPublisher {
  publish(evt: InternalEventV2): Promise<void>;
}
```

#### 4. Connector Manager
`ConnectorManager` (src/services/ingress/core/connector-manager.ts:9) provides:
- Lifecycle management (start/stop)
- Platform-based lookup (`getConnectorByPlatform`)
- Unified snapshot/health reporting

### Current Limitations

1. **No Standard Webhook Handler Pattern**: Twilio webhooks are implemented ad-hoc in ingress-egress-service.ts:173
2. **Inconsistent Token Management**: Discord uses FirestoreAuthTokenStore, Twitch uses custom credential providers
3. **Hard-coded Platform Detection**: Egress routing uses string matching (src/apps/ingress-egress-service.ts:283-292)
4. **No Signature Verification Framework**: Only Twilio implements webhook signature validation
5. **Mixed Responsibility**: ingress-egress-service.ts handles both connector orchestration AND webhook routing

---

## Architectural Principles

### 1. Event-Driven First
All integrations MUST support real-time, event-driven communication. Platforms that lack native event APIs should poll at sub-second intervals or use long-polling/webhooks.

### 2. Separation of Concerns
```
┌─────────────────────────────────────────────────────────┐
│ ingress-egress-service.ts                               │
│  - Connector lifecycle orchestration                    │
│  - Generic egress routing (no platform logic)           │
│  - Health monitoring                                    │
└─────────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Platform     │ │ Platform     │ │ Platform     │
│ Connector    │ │ Connector    │ │ Connector    │
│              │ │              │ │              │
│ - Ingress    │ │ - Ingress    │ │ - Ingress    │
│ - Egress     │ │ - Egress     │ │ - Egress     │
│ - Auth       │ │ - Auth       │ │ - Auth       │
│ - Webhooks   │ │ - Webhooks   │ │ - Webhooks   │
└──────────────┘ └──────────────┘ └──────────────┘
```

### 3. Configuration-Driven
All platform-specific behavior (endpoints, credentials, features) MUST be configurable via `architecture.yaml` and environment variables.

### 4. Testability
Connectors MUST support:
- No-op mode (`NODE_ENV=test`)
- Explicit disable flags
- Mock credential providers

### 5. Observability
All connectors MUST:
- Emit structured logs at key lifecycle points
- Maintain counters (received, published, failed, filtered)
- Expose `getSnapshot()` for health checks

---

## Unified Connector Framework

### Directory Structure

```
src/services/ingress/
├── core/
│   ├── interfaces.ts           # Core abstractions
│   ├── connector-manager.ts    # Lifecycle orchestrator
│   ├── webhook-handler.ts      # NEW: Generic webhook framework
│   └── token-manager.ts        # NEW: Unified token/auth abstraction
├── <platform>/
│   ├── index.ts                # Public exports
│   ├── <platform>-ingress-client.ts
│   ├── <platform>-envelope-builder.ts
│   ├── <platform>-webhook-handler.ts  # If webhook-based
│   ├── publisher.ts
│   ├── connector-adapter.ts    # IngressConnector wrapper
│   └── __tests__/
```

### Core Interfaces (Enhanced)

```typescript
// src/services/ingress/core/interfaces.ts

export type EventDeliveryMethod = 'websocket' | 'webhook' | 'polling' | 'hybrid';

export interface ConnectorCapabilities {
  ingress: {
    method: EventDeliveryMethod;
    realtime: boolean;
    requiresWebhook: boolean;
    requiresPublicUrl: boolean;
  };
  egress: {
    chat: boolean;
    dm: boolean;
    reactions: boolean;
    threads: boolean;
  };
  moderation: {
    ban: boolean;
    timeout: boolean;
    delete: boolean;
  };
}

export interface ConnectorMetadata {
  platform: string;
  version: string;
  capabilities: ConnectorCapabilities;
  authMethod: 'oauth2' | 'bot_token' | 'api_key' | 'bearer';
}

export interface IngressConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSnapshot(): ConnectorSnapshot;
  getMetadata(): ConnectorMetadata;
}

export interface WebhookConnector extends IngressConnector {
  handleWebhook(req: WebhookRequest): Promise<WebhookResponse>;
  verifySignature(req: WebhookRequest): boolean;
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: any;
  rawBody?: Buffer;
  url: string;
  method: string;
}

export interface WebhookResponse {
  status: number;
  body?: any;
  headers?: Record<string, string>;
}
```

### Generic Webhook Handler

```typescript
// src/services/ingress/core/webhook-handler.ts

export class WebhookHandler {
  constructor(
    private readonly connector: WebhookConnector,
    private readonly logger: Logger
  ) {}

  /**
   * Express/Fastify-compatible request handler
   * Handles signature verification, 3-second response SLA, async processing
   */
  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    try {
      // 1. Extract webhook request
      const webhookReq: WebhookRequest = {
        headers: req.headers,
        body: req.body,
        rawBody: req.rawBody, // Must be available for signature verification
        url: req.originalUrl,
        method: req.method
      };

      // 2. Verify signature (platform-specific logic in connector)
      if (!this.connector.verifySignature(webhookReq)) {
        this.logger.warn('webhook.signature_invalid', { correlationId });
        res.status(403).json({ error: 'invalid_signature' });
        return;
      }

      // 3. IMMEDIATELY acknowledge (< 3 seconds SLA)
      res.status(200).json({ received: true });

      // 4. Async processing (queue-based, no blocking)
      setImmediate(async () => {
        try {
          await this.connector.handleWebhook(webhookReq);
          const duration = Date.now() - startTime;
          this.logger.info('webhook.processed', { correlationId, duration });
        } catch (err: any) {
          this.logger.error('webhook.processing_error', {
            correlationId,
            error: err.message
          });
        }
      });

    } catch (err: any) {
      const duration = Date.now() - startTime;
      this.logger.error('webhook.error', { correlationId, error: err.message, duration });
      res.status(500).json({ error: 'internal_error' });
    }
  }
}
```

---

## Slack Integration Design

### Architecture Decision: Webhook (HTTP) + Socket Mode Fallback

**Primary**: Webhook-based Events API
**Fallback**: Socket Mode for local/dev environments

**Rationale**:
- Slack recommends webhooks for production reliability
- BitBrat already runs on Cloud Run with public HTTPS endpoints
- Webhook mode avoids WebSocket connection refresh complexity
- Socket Mode enabled for local development without ngrok

### Slack Connector Structure

```
src/services/ingress/slack/
├── index.ts
├── slack-ingress-client.ts        # WebSocket (Socket Mode) client
├── slack-webhook-handler.ts       # Webhook handler
├── slack-envelope-builder.ts      # Event normalization
├── slack-signature-verifier.ts    # HMAC-SHA256 verification
├── publisher.ts                   # Publisher factory
├── connector-adapter.ts           # IngressConnector wrapper
├── types.ts                       # Slack event types
└── __tests__/
```

### Slack Events to InternalEventV2 Mapping

| Slack Event | InternalEventV2.type | Notes |
|-------------|---------------------|-------|
| `message` | `chat.message.v1` | Standard channel message |
| `app_mention` | `chat.message.v1` | Bot mention (add annotation) |
| `message.im` | `chat.message.v1` | Direct message (egress.type = 'dm') |
| `message.groups` | `chat.message.v1` | Private channel |
| `message.mpim` | `chat.message.v1` | Group DM |
| `reaction_added` | `chat.reaction.v1` | NEW event type |
| `message_changed` | `chat.message.edited.v1` | NEW event type |
| `message_deleted` | `chat.message.deleted.v1` | NEW event type |

### Envelope Builder Example

```typescript
// src/services/ingress/slack/slack-envelope-builder.ts

export class SlackEnvelopeBuilder implements EnvelopeBuilder<SlackMessageMeta> {
  build(meta: SlackMessageMeta, opts?: { ... }): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());

    return {
      v: '2',
      type: this.mapEventType(meta),
      correlationId: uuid(),
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.slack',
        connector: 'slack',
        channel: meta.channel,
      },
      identity: {
        external: {
          id: meta.userId,
          platform: 'slack',
          displayName: meta.userDisplayName,
          metadata: {
            teamId: meta.teamId,
            isBot: meta.isBot,
            isAppUser: meta.isAppUser,
          }
        }
      },
      egress: {
        destination: opts?.egressDestination || '',
        type: meta.channelType === 'im' ? 'dm' : 'chat',
        connector: 'slack',
        channel: meta.channel
      },
      message: {
        id: meta.messageTs,
        role: 'user',
        text: meta.text,
        rawPlatformPayload: meta
      },
      annotations: this.buildAnnotations(meta),
      routing: {
        stage: 'initial',
        slip: [],
        history: []
      }
    };
  }

  private mapEventType(meta: SlackMessageMeta): string {
    if (meta.subtype === 'message_changed') return 'chat.message.edited.v1';
    if (meta.subtype === 'message_deleted') return 'chat.message.deleted.v1';
    return 'chat.message.v1';
  }

  private buildAnnotations(meta: SlackMessageMeta): Annotation[] {
    const annotations: Annotation[] = [];

    // App mention annotation
    if (meta.mentions?.includes(meta.botUserId)) {
      annotations.push({
        id: crypto.randomUUID(),
        kind: 'mention',
        source: 'slack',
        createdAt: new Date().toISOString(),
        label: 'bot_mentioned',
        value: true
      });
    }

    // Thread annotation
    if (meta.threadTs) {
      annotations.push({
        id: crypto.randomUUID(),
        kind: 'thread',
        source: 'slack',
        createdAt: new Date().toISOString(),
        label: 'thread_ts',
        value: meta.threadTs
      });
    }

    return annotations;
  }
}
```

### Webhook Handler Implementation

```typescript
// src/services/ingress/slack/slack-webhook-handler.ts

export class SlackWebhookHandler implements WebhookConnector {
  private snapshot: ConnectorSnapshot = {
    state: 'CONNECTED',
    counters: { received: 0, published: 0, failed: 0 }
  };

  constructor(
    private readonly builder: SlackEnvelopeBuilder,
    private readonly publisher: IngressPublisher,
    private readonly config: IConfig,
    private readonly options: { egressDestinationTopic?: string }
  ) {}

  verifySignature(req: WebhookRequest): boolean {
    const slackSignature = req.headers['x-slack-signature'];
    const slackTimestamp = req.headers['x-slack-request-timestamp'];
    const signingSecret = this.config.slackSigningSecret;

    if (!slackSignature || !slackTimestamp || !signingSecret) {
      return false;
    }

    // Prevent replay attacks (timestamp > 5 min old)
    const timestamp = parseInt(slackTimestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      return false;
    }

    // Verify HMAC-SHA256 signature
    const baseString = `v0:${slackTimestamp}:${req.rawBody?.toString('utf8') || ''}`;
    const hmac = crypto.createHmac('sha256', signingSecret);
    const computed = 'v0=' + hmac.update(baseString).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(slackSignature)
    );
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const body = req.body;

    // URL verification challenge (initial setup)
    if (body.type === 'url_verification') {
      return {
        status: 200,
        body: { challenge: body.challenge }
      };
    }

    // Event callback
    if (body.type === 'event_callback') {
      const event = body.event;

      // Filter bot messages (prevent loops)
      if (event.bot_id || event.subtype === 'bot_message') {
        this.snapshot.counters!.filtered = (this.snapshot.counters!.filtered || 0) + 1;
        return { status: 200 };
      }

      const meta: SlackMessageMeta = {
        teamId: body.team_id,
        channel: event.channel,
        userId: event.user,
        userDisplayName: event.username || event.user,
        text: event.text,
        messageTs: event.ts,
        threadTs: event.thread_ts,
        channelType: event.channel_type,
        mentions: this.extractMentions(event.text),
        botUserId: body.authorizations?.[0]?.user_id,
        subtype: event.subtype
      };

      this.snapshot.counters!.received = (this.snapshot.counters!.received || 0) + 1;

      const envelope = this.builder.build(meta, {
        egressDestination: this.options.egressDestinationTopic
      });

      await this.publisher.publish(envelope);
      this.snapshot.counters!.published = (this.snapshot.counters!.published || 0) + 1;

      return { status: 200 };
    }

    return { status: 400, body: { error: 'unknown_event_type' } };
  }

  private extractMentions(text: string): string[] {
    const mentionRegex = /<@(U[A-Z0-9]+)>/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }

  // IngressConnector implementation
  async start(): Promise<void> {
    this.snapshot.state = 'CONNECTED';
  }

  async stop(): Promise<void> {
    this.snapshot.state = 'DISCONNECTED';
  }

  getSnapshot(): ConnectorSnapshot {
    return { ...this.snapshot };
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'slack',
      version: '1.0.0',
      capabilities: {
        ingress: {
          method: 'webhook',
          realtime: true,
          requiresWebhook: true,
          requiresPublicUrl: true
        },
        egress: {
          chat: true,
          dm: true,
          reactions: true,
          threads: true
        },
        moderation: {
          ban: false,
          timeout: false,
          delete: false
        }
      },
      authMethod: 'oauth2'
    };
  }

  // Egress implementation
  async sendText(text: string, channel?: string): Promise<void> {
    const targetChannel = channel || this.config.slackDefaultChannel;
    if (!targetChannel) {
      throw new Error('slack_no_channel');
    }

    const WebClient = require('@slack/web-api').WebClient;
    const client = new WebClient(this.config.slackBotToken);

    await client.chat.postMessage({
      channel: targetChannel,
      text
    });
  }
}
```

### Webhook Routing in ingress-egress-service.ts

```typescript
// src/apps/ingress-egress-service.ts (additions)

private setupWebhookRoutes(app: Express, manager: ConnectorManager) {
  // Generic webhook handler for any platform
  app.post('/webhooks/:platform', async (req, res) => {
    const platform = req.params.platform;
    const connector = manager.getConnectorByPlatform(platform);

    if (!connector || !('handleWebhook' in connector)) {
      res.status(404).json({ error: 'platform_not_found' });
      return;
    }

    const handler = new WebhookHandler(connector as WebhookConnector, logger);
    await handler.handle(req, res);
  });
}
```

---

## Event Normalization

### Standardized InternalEventV2 Fields

All platforms MUST populate these fields consistently:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `v` | string | Yes | Always "2" |
| `correlationId` | string | Yes | UUID v4 |
| `traceId` | string | Yes | UUID v4 |
| `type` | string | Yes | Event type (chat.message.v1, etc.) |
| `ingress.source` | string | Yes | `ingress.<platform>` |
| `ingress.connector` | string | Yes | Platform name (slack, twitch, etc.) |
| `ingress.channel` | string | No | Platform channel ID |
| `identity.external.id` | string | Yes | Platform user ID |
| `identity.external.platform` | string | Yes | Platform name |
| `identity.external.displayName` | string | No | User display name |
| `egress.destination` | string | Yes | Egress topic or empty string |
| `egress.connector` | string | Yes | Platform name |
| `egress.type` | string | Yes | 'chat' or 'dm' |
| `egress.channel` | string | No | Target channel for response |
| `message.id` | string | Yes | Platform message ID |
| `message.text` | string | Yes | Message content |
| `message.rawPlatformPayload` | object | No | Original platform event |

### Platform-Specific Annotations

Use `annotations[]` for platform-specific metadata:

```typescript
annotations: [
  {
    id: uuid(),
    kind: 'mention',     // Standard kinds: mention, thread, reaction, custom
    source: 'slack',     // Platform name
    createdAt: nowIso(),
    label: 'bot_mentioned',
    value: true
  },
  {
    id: uuid(),
    kind: 'thread',
    source: 'slack',
    createdAt: nowIso(),
    label: 'thread_ts',
    value: '1234567890.123456'
  }
]
```

---

## Configuration Schema

### architecture.yaml Updates

```yaml
services:
  ingress-egress:
    # ... existing config ...
    secrets:
      # Existing
      - TWITCH_CLIENT_ID
      - TWITCH_CLIENT_SECRET
      - DISCORD_BOT_TOKEN
      - TWILIO_AUTH_TOKEN
      # NEW: Slack
      - SLACK_BOT_TOKEN
      - SLACK_SIGNING_SECRET
      - SLACK_APP_TOKEN  # For Socket Mode fallback
    env:
      # Existing
      - TWITCH_CHANNELS
      - DISCORD_ENABLED
      - TWILIO_ENABLED
      # NEW: Slack
      - SLACK_ENABLED
      - SLACK_USE_SOCKET_MODE  # false (webhook) or true (Socket Mode)
      - SLACK_DEFAULT_CHANNEL
      - SLACK_WORKSPACE_ID
```

### Environment Variable Schema

| Variable | Type | Required | Default | Notes |
|----------|------|----------|---------|-------|
| `SLACK_ENABLED` | boolean | No | false | Enable Slack integration |
| `SLACK_USE_SOCKET_MODE` | boolean | No | false | Use Socket Mode (dev) vs webhooks (prod) |
| `SLACK_BOT_TOKEN` | string | Yes* | - | xoxb-* bot token |
| `SLACK_SIGNING_SECRET` | string | Yes* | - | Webhook signature verification |
| `SLACK_APP_TOKEN` | string | No | - | xapp-* token for Socket Mode |
| `SLACK_DEFAULT_CHANNEL` | string | No | - | Fallback channel for egress |
| `SLACK_WORKSPACE_ID` | string | No | - | For multi-workspace support |

*Required if `SLACK_ENABLED=true`

---

## Deployment Architecture

### Webhook URL Structure

```
Production:
https://bitbrat.ai/webhooks/slack
https://bitbrat.ai/webhooks/twilio

Staging:
https://staging.bitbrat.ai/webhooks/slack

Local (ngrok/hookdeck):
https://abc123.ngrok.io/webhooks/slack
```

### Load Balancer Configuration

```yaml
# infrastructure/terraform/lb/main.tf
resource "google_compute_url_map" "default" {
  # ... existing rules ...

  # Generic webhook routing
  path_matcher {
    name = "webhooks"
    path_rule {
      paths = ["/webhooks/*"]
      service = google_compute_backend_service.ingress_egress.id
    }
  }
}
```

### Cloud Run Scaling

```yaml
# architecture.yaml
services:
  ingress-egress:
    scaling:
      min: 1  # Never scale to zero (maintain connections)
      max: 3  # Limit concurrent webhook handlers
      targetConcurrentRequests: 80  # Slack 3-second SLA requires low concurrency
```

---

## Security & Reliability

### Webhook Security Checklist

- [ ] **Signature Verification**: All webhook platforms MUST verify HMAC signatures
- [ ] **Timestamp Validation**: Reject requests > 5 minutes old (prevent replay attacks)
- [ ] **HTTPS Only**: No HTTP webhook endpoints in production
- [ ] **Rate Limiting**: Per-platform rate limits (Slack: 30/minute/workspace)
- [ ] **Idempotency**: Deduplicate events using `correlationId` + platform message ID
- [ ] **Secret Rotation**: Support zero-downtime secret updates

### Reliability Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| Webhook Response Time | < 3 seconds | Slack requirement |
| Event Processing Success Rate | > 95% | Avoid Slack auto-disable |
| Signature Verification | 100% | No unauthenticated events |
| Message Deduplication | 100% | At-least-once delivery |
| Egress Delivery Rate | > 99% | With exponential backoff |

### Error Handling

```typescript
// Webhook processing errors should NOT fail the response
try {
  await this.publisher.publish(envelope);
} catch (err) {
  logger.error('webhook.publish_error', {
    platform,
    correlationId,
    error: err.message
  });
  // Still return 200 to Slack to avoid retries
  // Dead-letter the event for manual review
  await this.deadLetterQueue.publish({
    envelope,
    error: err.message
  });
}
```

---

## Migration Path

### Phase 1: Framework Foundation (Sprint 342)

**Deliverables:**
1. `src/services/ingress/core/webhook-handler.ts` - Generic webhook framework
2. `src/services/ingress/core/interfaces.ts` - Enhanced with WebhookConnector
3. Updated `ingress-egress-service.ts` - Generic `/webhooks/:platform` route
4. Documentation updates (this document)

**Success Criteria:**
- Twilio webhook migrated to new framework (backward compatible)
- No breaking changes to existing connectors
- 100% test coverage for webhook framework

### Phase 2: Slack Integration (Sprint 343)

**Deliverables:**
1. Complete Slack connector implementation
2. Webhook mode (production)
3. Socket Mode fallback (local dev)
4. OAuth2 flow for bot installation
5. Load balancer routing updates

**Success Criteria:**
- Slack messages flow through BitBrat event pipeline
- Egress responses delivered to Slack
- < 3 second webhook response time
- Signature verification enforced

### Phase 3: Backport Improvements (Sprint 344)

**Deliverables:**
1. Migrate Twitch to use enhanced interfaces
2. Migrate Discord to use enhanced interfaces
3. Unified token management across all platforms
4. Centralized configuration validation

**Success Criteria:**
- All platforms implement `ConnectorMetadata`
- All platforms use standardized error handling
- Architecture.yaml validation catches misconfigurations

### Phase 4: Additional Platforms (Future)

**Candidates:**
- Microsoft Teams (webhook + Bot Framework)
- Telegram (Bot API polling/webhooks)
- Matrix (WebSocket)
- IRC (generic IRC adapter)

---

## Implementation Checklist

### Slack Integration Tasks

#### Core Framework
- [ ] Create `src/services/ingress/core/webhook-handler.ts`
- [ ] Update `src/services/ingress/core/interfaces.ts` with WebhookConnector
- [ ] Add `rawBody` middleware to Express app (signature verification requirement)
- [ ] Add `/webhooks/:platform` route to ingress-egress-service.ts

#### Slack Connector
- [ ] Create `src/services/ingress/slack/` directory structure
- [ ] Implement `SlackEnvelopeBuilder`
- [ ] Implement `SlackWebhookHandler` with signature verification
- [ ] Implement `SlackEgressClient` (Web API integration)
- [ ] Add Socket Mode fallback client (optional for v1)
- [ ] Create connector-adapter.ts wrapper

#### Configuration
- [ ] Add Slack secrets to architecture.yaml
- [ ] Add Slack env vars to architecture.yaml
- [ ] Create Firestore schema for Slack tokens (if using OAuth)
- [ ] Add Slack app manifest documentation

#### Testing
- [ ] Unit tests for SlackEnvelopeBuilder
- [ ] Unit tests for signature verification
- [ ] Integration tests for webhook flow
- [ ] E2E test: Slack message -> BitBrat -> Slack response

#### Documentation
- [ ] Update CLAUDE.md with Slack integration
- [ ] Create `documentation/guides/slack-integration.md`
- [ ] Add Slack to architecture diagram
- [ ] Update CHANGELOG.md

#### Deployment
- [ ] Add SLACK_BOT_TOKEN to Secret Manager
- [ ] Add SLACK_SIGNING_SECRET to Secret Manager
- [ ] Update Cloud Run service with new env vars
- [ ] Configure Load Balancer webhook routing
- [ ] Set up Slack app Event Subscriptions (https://bitbrat.ai/webhooks/slack)
- [ ] Test in staging environment
- [ ] Production rollout with monitoring

---

## Appendix A: Slack Event Examples

### message Event (channel)
```json
{
  "type": "event_callback",
  "team_id": "T123456",
  "event": {
    "type": "message",
    "channel": "C123456",
    "user": "U123456",
    "text": "Hello BitBrat!",
    "ts": "1234567890.123456",
    "channel_type": "channel"
  }
}
```

### app_mention Event
```json
{
  "type": "event_callback",
  "team_id": "T123456",
  "event": {
    "type": "app_mention",
    "channel": "C123456",
    "user": "U123456",
    "text": "<@U_BOT_ID> what's the weather?",
    "ts": "1234567890.123456"
  }
}
```

### message Event (DM)
```json
{
  "type": "event_callback",
  "team_id": "T123456",
  "event": {
    "type": "message",
    "channel": "D123456",
    "user": "U123456",
    "text": "Private message",
    "ts": "1234567890.123456",
    "channel_type": "im"
  }
}
```

---

## Appendix B: Comparison Matrix

| Feature | Twitch | Discord | Twilio | Slack (Proposed) |
|---------|--------|---------|--------|------------------|
| **Ingress Method** | IRC | WebSocket | Webhook | Webhook + Socket Mode |
| **Real-time** | Yes | Yes | Yes | Yes |
| **Public URL Required** | No | No | Yes | Yes (webhook mode) |
| **Signature Verification** | No | No | Yes | Yes |
| **Auth Method** | OAuth2 + Refresh | Bot Token | API Key | OAuth2 |
| **Egress: Chat** | Yes | Yes | Yes | Yes |
| **Egress: DM** | Yes (Whisper) | Yes | Yes | Yes |
| **Egress: Threads** | No | Yes | No | Yes |
| **Moderation: Ban** | Yes | Yes | No | No |
| **Rate Limit** | 20 msg/30s | 50 msg/s | Varies | 1 msg/s (tier 1) |

---

## Appendix C: References

### Slack API Documentation
- Events API: https://api.slack.com/apis/events-api
- Socket Mode: https://api.slack.com/apis/connections/socket
- Signature Verification: https://api.slack.com/authentication/verifying-requests-from-slack
- Web API: https://api.slack.com/web

### BitBrat Platform
- Architecture: architecture.yaml
- Envelope Schema: documentation/schemas/envelope.v1.json
- Routing Slip: documentation/schemas/routing-slip.v1.json
- Connector Interfaces: src/services/ingress/core/interfaces.ts

### Related Sprints
- Sprint 152: Generic Egress Alignment
- Sprint 332: Reflex Service (deterministic behavior)
- Sprint 341: Agent Flow Pattern Documentation

---

**Document End**

For questions or clarifications, please contact the platform team or refer to `CLAUDE.md` for contribution guidelines.

# Sprint 342: Framework Foundation
## Technical Architecture (Sprint-Focused)

> **Full Architecture**: See [INGRESS_EGRESS_ARCHITECTURE.md](../../INGRESS_EGRESS_ARCHITECTURE.md) for complete 3-sprint design

---

## Sprint 342 Scope

**Goal**: Build and validate reusable webhook framework with Twilio migration

**Out of Scope**: Slack integration (Sprint 343), platform convergence (Sprint 344)

---

## Core Abstractions

### 1. WebhookHandler Class

**Location**: `src/services/ingress/core/webhook-handler.ts`

**Purpose**: Generic webhook request processor enforcing < 3-second SLA

**Key Features**:
- Signature verification delegation
- Async processing via `setImmediate()`
- Dead-letter queue integration
- Express/Fastify compatible

**Interface**:
```typescript
export class WebhookHandler {
  constructor(
    private readonly connector: WebhookConnector,
    private readonly logger: Logger
  );

  async handle(req: Request, res: Response): Promise<void>;
}
```

**Flow**:
1. Extract webhook request (headers, body, rawBody)
2. Verify signature (delegate to `connector.verifySignature()`)
3. **IMMEDIATELY** respond 200 OK (< 3s SLA)
4. Async process via `setImmediate(() => connector.handleWebhook())`
5. Errors → dead-letter queue

---

### 2. Enhanced Interfaces

**Location**: `src/services/ingress/core/interfaces.ts`

#### WebhookConnector

```typescript
export interface WebhookConnector extends IngressConnector {
  handleWebhook(req: WebhookRequest): Promise<WebhookResponse>;
  verifySignature(req: WebhookRequest): boolean;
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: any;
  rawBody?: Buffer;  // Required for HMAC verification
  url: string;
  method: string;
}

export interface WebhookResponse {
  status: number;
  body?: any;
  headers?: Record<string, string>;
}
```

#### ConnectorMetadata

```typescript
export interface ConnectorMetadata {
  platform: string;
  version: string;
  capabilities: ConnectorCapabilities;
  authMethod: 'oauth2' | 'bot_token' | 'api_key' | 'bearer';
}

export interface ConnectorCapabilities {
  ingress: {
    method: 'websocket' | 'webhook' | 'polling' | 'hybrid';
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
```

---

### 3. Generic Webhook Routing

**Location**: `src/apps/ingress-egress-service.ts`

**New Route**: `POST /webhooks/:platform`

**Implementation**:
```typescript
private setupWebhookRoutes(app: Express, manager: ConnectorManager) {
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

## Twilio Migration Strategy

### Current Implementation

**File**: `src/apps/ingress-egress-service.ts:173-226`

**Issues**:
- Inline signature verification (not reusable)
- Event processing in route handler (not abstracted)
- Custom webhook route (not generic)

### Target Implementation

**File**: `src/services/ingress/twilio/twilio-ingress-client.ts`

**Changes**:
1. Implement `WebhookConnector` interface
2. Move `validateTwilioSignature()` → `verifySignature()`
3. Move event processing → `handleWebhook()`
4. Add `getMetadata()` implementation

**Migration Path**:
1. Refactor TwilioIngressClient (IEF-007)
2. Deploy with both routes active (zero-downtime)
3. Verify functionality (IEF-009)
4. Remove old route (mark deprecated)

---

## Architecture Validation

**File**: `tools/validate-ingress-architecture.ts`

**Validates**:
- All WebhookConnectors implement `verifySignature()` and `handleWebhook()`
- ConnectorMetadata completeness
- No deprecated patterns (inline signature verification)

**Run**: Pre-commit hook via Husky

---

## Testing Strategy

### Unit Tests
- WebhookHandler: Signature verification, SLA enforcement, async processing
- Interfaces: Type checking, method signatures
- Twilio migration: Signature verification, event processing

### Integration Tests
- Generic webhook routing: Platform lookup, 404 handling
- Twilio migration: End-to-end webhook flow
- Concurrent processing: 10 simultaneous webhooks

### Load Tests
- Twilio webhook: 50 req/s for 60 seconds
- Latency: P99 < 3 seconds

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Webhook Response Time | P99 < 3s | Integration tests |
| Test Coverage | > 90% | Jest coverage report |
| Zero Regressions | 100% tests pass | CI/CD |
| Twilio Functionality | 100% preserved | Regression tests |

---

## Dependencies

### Prerequisites
- ✅ Development environment (Node 24.x, Docker, NATS)
- ✅ Firestore emulator
- ⏳ All existing tests passing

### NPM Packages
- Express (existing)
- crypto (Node built-in)
- No new dependencies

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking Twilio integration | Parallel route deployment, comprehensive regression tests |
| Performance regression | Load testing before/after, benchmarking |
| Signature verification bypass | Security review, penetration testing |

---

## Sprint 343 Preview

**Next Sprint**: Slack Integration
- Complete SlackWebhookHandler using this framework
- OAuth2 flow
- Production deployment

**Dependencies**: Sprint 342 must be complete and deployed to staging

---

**Document Version**: 1.0
**Last Updated**: 2026-07-14

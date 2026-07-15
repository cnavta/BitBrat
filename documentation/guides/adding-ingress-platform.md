# Adding a New Ingress Platform

**Audience**: Developers integrating new chat platforms (Slack, Discord, Matrix, etc.)
**Prerequisites**: Familiarity with TypeScript, Express.js, and the target platform's API
**Sprint**: 342 - Ingress-Egress Framework Foundation

---

## Overview

The Ingress-Egress Framework provides a standardized approach for integrating new chat platforms into BitBrat. This guide walks through creating a new platform connector that supports both real-time messaging and webhook-based event notifications.

### Key Concepts

- **IngressConnector**: Interface for real-time message ingress (WebSocket, polling, etc.)
- **WebhookConnector**: Interface for webhook-based event notifications
- **ConnectorAdapter**: Unified adapter implementing both interfaces
- **ConnectorMetadata**: Runtime-queryable platform capabilities
- **WebhookHandler**: Generic webhook request processor (< 3-second SLA)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│          ingress-egress-service                      │
│                                                      │
│  ┌────────────────┐      ┌────────────────────────┐ │
│  │ POST /webhooks │──────▶ WebhookHandler         │ │
│  │ /:platform     │      │ - verifySignature()    │ │
│  └────────────────┘      │ - handleWebhook()      │ │
│                          │ - < 3-second SLA       │ │
│                          └──────────┬─────────────┘ │
│                                     │               │
│                                     ▼               │
│                          ┌────────────────────────┐ │
│                          │ PlatformConnectorAdapter│ │
│                          │                        │ │
│                          │ Implements:            │ │
│                          │ - IngressConnector     │ │
│                          │ - WebhookConnector     │ │
│                          └────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Step-by-Step Implementation

### Step 1: Create Platform Directory

```bash
mkdir -p src/services/ingress/<platform>
cd src/services/ingress/<platform>
```

**File Structure**:
```
src/services/ingress/<platform>/
├── connector-adapter.ts          # Main adapter (IngressConnector + WebhookConnector)
├── <platform>-ingress-client.ts  # Real-time client (WebSocket/polling)
├── webhook-utils.ts               # Signature verification helpers
├── envelope-builder.ts            # Convert platform events → Envelope v1
├── index.ts                       # Public exports
└── __tests__/
    ├── connector-adapter.test.ts
    ├── connector-adapter-webhook.test.ts
    └── webhook-utils.test.ts
```

---

### Step 2: Implement Webhook Signature Verification

Most platforms sign webhook payloads using HMAC-SHA256. Implement platform-specific verification:

**Example: `webhook-utils.ts`**

```typescript
import crypto from 'crypto';

/**
 * Verify platform webhook signature using HMAC-SHA256
 *
 * @param secret - Platform webhook secret (from config)
 * @param signature - Signature from webhook headers
 * @param url - Full webhook URL (protocol + host + path + query)
 * @param body - Parsed request body
 * @returns true if signature is valid
 */
export function validatePlatformSignature(
  secret: string,
  signature: string,
  url: string,
  body: Record<string, any>
): boolean {
  // Platform-specific signature algorithm
  // Example for Twilio-style (URL + body):
  const data = url + Object.keys(body).sort().map(key => `${key}${body[key]}`).join('');

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(data, 'utf-8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

**Platform Examples**:
- **Twilio**: HMAC-SHA1 of (URL + sorted body params)
- **Slack**: HMAC-SHA256 of (`v0:timestamp:body`)
- **Discord**: Ed25519 signature verification
- **GitHub**: HMAC-SHA256 of raw body

---

### Step 3: Implement ConnectorAdapter

Create a unified adapter implementing both `IngressConnector` (for real-time) and `WebhookConnector` (for webhooks).

**Example: `connector-adapter.ts`**

```typescript
import type {
  IngressConnector,
  ConnectorSnapshot,
  WebhookConnector,
  WebhookRequest,
  WebhookResponse,
  ConnectorMetadata
} from '../core';
import type { PlatformIngressClient } from './<platform>-ingress-client';
import { logger } from '../../../common/logging';
import { validatePlatformSignature } from './webhook-utils';
import { IConfig } from '../../../types';

/**
 * PlatformConnectorAdapter
 *
 * Dual-mode connector for <Platform>:
 * - IngressConnector: Real-time message streaming via WebSocket/polling
 * - WebhookConnector: Event notifications for platform management
 *
 * @example
 * ```typescript
 * const client = new PlatformIngressClient(config);
 * const adapter = new PlatformConnectorAdapter(client, config);
 *
 * // Register with ConnectorManager
 * manager.register('<platform>', adapter);
 *
 * // Start real-time client
 * await adapter.start();
 *
 * // Webhook route automatically delegates to adapter via WebhookHandler
 * // POST /webhooks/<platform> → adapter.verifySignature() → adapter.handleWebhook()
 * ```
 *
 * @since Sprint 342
 */
export class PlatformConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: PlatformIngressClient,
    private readonly config?: IConfig
  ) {}

  //
  // IngressConnector implementation (real-time messaging)
  //

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  getSnapshot(): ConnectorSnapshot {
    const snapshot = this.client.getSnapshot();
    return {
      state: snapshot.state,
      id: snapshot.identity,
      displayName: snapshot.displayName,
      lastError: snapshot.lastError ? { message: snapshot.lastError } : null,
      counters: snapshot.counters,
      lastMessageAt: snapshot.lastMessageAt
    };
  }

  async sendText(text: string, target?: string): Promise<void> {
    logger.debug('<platform>.adapter.sendText', { target, textLength: text?.length });
    if (!target) {
      throw new Error('<platform>_connector_adapter.target_required');
    }
    await this.client.sendText(text, target);
  }

  //
  // WebhookConnector implementation (webhook events)
  //

  /**
   * Verify platform webhook signature
   *
   * @param req - Webhook request
   * @returns true if signature is valid, false otherwise
   */
  verifySignature(req: WebhookRequest): boolean {
    const signature = req.headers['x-<platform>-signature'];
    if (!signature) {
      logger.warn('<platform>.webhook.missing_signature');
      return false;
    }

    if (!this.config?.<platform>WebhookSecret) {
      logger.error('<platform>.webhook.missing_webhook_secret_config');
      return false;
    }

    // Reconstruct full URL for signature verification
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['host'];
    const url = `${protocol}://${host}${req.url}`;

    const isValid = validatePlatformSignature(
      this.config.<platform>WebhookSecret,
      signature,
      url,
      req.body
    );

    if (!isValid) {
      logger.warn('<platform>.webhook.invalid_signature', { url });
    }

    return isValid;
  }

  /**
   * Handle platform webhook event
   *
   * @param req - Webhook request
   * @returns Webhook response (200 OK or error)
   */
  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const { event_type, event_id } = req.body;

    logger.info('<platform>.webhook.received', { event_type, event_id });

    // Handle platform-specific events
    if (event_type === 'message.new') {
      // Example: Process new message event
      // Your logic here...
      logger.info('<platform>.webhook.message.new', { event_id });
    } else if (event_type === 'channel.created') {
      // Example: Handle channel creation
      logger.info('<platform>.webhook.channel.created', { event_id });
    }

    // Always return 200 OK to acknowledge receipt
    return { status: 200, body: { ok: true } };
  }

  /**
   * Get connector metadata (capabilities, platform info)
   */
  getMetadata(): ConnectorMetadata {
    return {
      platform: '<platform>',
      version: '1.0.0',
      authMethod: 'oauth2',  // or 'api_key', 'bot_token', 'bearer'
      capabilities: {
        ingress: {
          method: 'hybrid',  // 'websocket' | 'webhook' | 'polling' | 'hybrid'
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
          ban: true,
          timeout: true,
          delete: true
        }
      }
    };
  }
}
```

---

### Step 4: Register Connector

Register the connector in `ingress-egress-service.ts`:

```typescript
import { PlatformConnectorAdapter } from '../services/ingress/<platform>';

// In constructor:
if (cfg.<platform>Enabled) {
  const platformClient = new PlatformIngressClient(cfg);
  manager.register('<platform>', new PlatformConnectorAdapter(platformClient, cfg));
  logger.info('<platform>.init_ok');
}
```

---

### Step 5: Add Configuration

Update `architecture.yaml` and `IConfig` interface:

**architecture.yaml**:
```yaml
services:
  ingress-egress:
    env:
      PLATFORM_ENABLED: "true"
      PLATFORM_BOT_TOKEN: "${PLATFORM_BOT_TOKEN}"
    secrets:
      PLATFORM_WEBHOOK_SECRET: platform-webhook-secret
      PLATFORM_BOT_TOKEN: platform-bot-token
```

**src/types/config.ts**:
```typescript
export interface IConfig {
  // ... existing fields ...

  // <Platform> Configuration
  <platform>Enabled: boolean;
  <platform>BotToken?: string;
  <platform>WebhookSecret?: string;
}
```

---

### Step 6: Write Tests

Create comprehensive test coverage:

**connector-adapter-webhook.test.ts**:
```typescript
import { PlatformConnectorAdapter } from '../connector-adapter';
import { validatePlatformSignature } from '../webhook-utils';
import type { WebhookRequest } from '../../core';

jest.mock('../webhook-utils');

describe('PlatformConnectorAdapter - WebhookConnector', () => {
  let adapter: PlatformConnectorAdapter;
  let mockClient: any;
  let mockConfig: any;

  beforeEach(() => {
    mockClient = {
      start: jest.fn(),
      stop: jest.fn(),
      getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
      sendText: jest.fn()
    };

    mockConfig = {
      <platform>WebhookSecret: 'test-secret',
      <platform>BotToken: 'test-token'
    };

    adapter = new PlatformConnectorAdapter(mockClient, mockConfig);
    jest.clearAllMocks();
  });

  describe('verifySignature()', () => {
    it('should verify valid platform signature', () => {
      const mockRequest: WebhookRequest = {
        headers: {
          'x-<platform>-signature': 'valid-signature',
          'host': 'example.com',
          'x-forwarded-proto': 'https'
        },
        body: { event_type: 'message.new' },
        url: '/webhooks/<platform>',
        method: 'POST'
      };

      (validatePlatformSignature as jest.Mock).mockReturnValue(true);

      const result = adapter.verifySignature(mockRequest);

      expect(result).toBe(true);
      expect(validatePlatformSignature).toHaveBeenCalledWith(
        'test-secret',
        'valid-signature',
        'https://example.com/webhooks/<platform>',
        mockRequest.body
      );
    });

    it('should reject invalid signature', () => {
      const mockRequest: WebhookRequest = {
        headers: { 'x-<platform>-signature': 'invalid' },
        body: {},
        url: '/webhooks/<platform>',
        method: 'POST'
      };

      (validatePlatformSignature as jest.Mock).mockReturnValue(false);

      expect(adapter.verifySignature(mockRequest)).toBe(false);
    });
  });

  describe('handleWebhook()', () => {
    it('should handle platform event', async () => {
      const mockRequest: WebhookRequest = {
        headers: {},
        body: { event_type: 'message.new', event_id: '123' },
        url: '/webhooks/<platform>',
        method: 'POST'
      };

      const response = await adapter.handleWebhook(mockRequest);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });

  describe('getMetadata()', () => {
    it('should return platform metadata', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.platform).toBe('<platform>');
      expect(metadata.capabilities.ingress.method).toBe('hybrid');
    });
  });
});
```

---

## Webhook SLA Requirements

**CRITICAL**: Webhook handlers MUST respond within **3 seconds** to avoid platform retries.

The `WebhookHandler` enforces this by:
1. Verifying signature synchronously
2. Calling `handleWebhook()` synchronously
3. Using `setImmediate()` for async processing after response

**Example**:
```typescript
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  const { event_type, event_id } = req.body;

  // ✅ FAST: Acknowledge immediately
  logger.info('<platform>.webhook.received', { event_type });

  // ✅ FAST: Enqueue async work (optional)
  setImmediate(async () => {
    // Heavy processing happens AFTER 200 OK is sent
    await processEvent(event_type, event_id);
  });

  // ✅ FAST: Return 200 OK within milliseconds
  return { status: 200, body: { ok: true } };
}
```

**Anti-Patterns** (DO NOT):
```typescript
// ❌ SLOW: External API call before response
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  await fetch('https://external-api.com/process');  // BLOCKS response!
  return { status: 200, body: { ok: true } };
}

// ❌ SLOW: Database query before response
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  await db.collection('events').insertOne(req.body);  // BLOCKS response!
  return { status: 200, body: { ok: true } };
}
```

---

## Platform Examples

### Twilio (Hybrid Mode)
- **Ingress**: WebSocket (real-time) + Webhook (conversation management)
- **Signature**: HMAC-SHA1 of URL + sorted body params
- **Events**: `onConversationAdded`, `onMessageAdded`
- **Implementation**: `src/services/ingress/twilio/`

### Slack (Coming in Sprint 343)
- **Ingress**: Socket Mode (WebSocket) + Events API (webhook)
- **Signature**: HMAC-SHA256 of `v0:timestamp:body`
- **Events**: `message`, `app_mention`, `reaction_added`
- **Reference**: Sprint 343 implementation plan

---

## Validation

Run the architecture validator to ensure compliance:

```bash
npx ts-node tools/validate-ingress-architecture.ts
```

**Checks**:
- ✓ Implements `WebhookConnector` interface
- ✓ Implements required methods: `verifySignature()`, `handleWebhook()`, `getMetadata()`
- ✓ ConnectorMetadata includes all required fields
- ✓ No deprecated inline signature verification patterns
- ✓ Exported from `core/index.ts`

---

## Common Pitfalls

### 1. Signature Verification Failures

**Problem**: Cloud Run terminates SSL, so `req.protocol` is `http` but webhooks are signed with `https://`.

**Solution**: Always use `x-forwarded-proto` header:
```typescript
const protocol = req.headers['x-forwarded-proto'] || 'https';
const url = `${protocol}://${host}${req.url}`;
```

### 2. Webhook Timeouts

**Problem**: Platform retries webhook due to slow response (> 3 seconds).

**Solution**: Return 200 OK immediately, defer processing:
```typescript
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  setImmediate(() => heavyProcessing(req.body));  // Async after response
  return { status: 200, body: { ok: true } };      // Immediate response
}
```

### 3. Missing Config Validation

**Problem**: Connector starts without required credentials, fails at runtime.

**Solution**: Validate config in constructor:
```typescript
constructor(client: Client, config?: IConfig) {
  if (!config?.platformBotToken) {
    throw new Error('<platform>_connector.missing_bot_token');
  }
  this.client = client;
  this.config = config;
}
```

### 4. Incorrect Metadata

**Problem**: Capabilities don't match actual implementation.

**Solution**: Keep metadata in sync with code:
```typescript
capabilities: {
  ingress: {
    method: 'hybrid',        // ← Must match actual implementation
    realtime: true,          // ← Only if WebSocket/polling exists
    requiresWebhook: true,   // ← Only if webhook events needed
  }
}
```

---

## Next Steps

After implementing your platform connector:

1. **Test locally**:
   ```bash
   npm test -- <platform>
   npm run build
   npm run brat -- chat  # Test end-to-end
   ```

2. **Run validation**:
   ```bash
   npx ts-node tools/validate-ingress-architecture.ts
   ```

3. **Deploy to staging**:
   ```bash
   npm run brat -- deploy service ingress-egress --env staging
   ```

4. **Configure webhooks** at platform console:
   - URL: `https://your-domain.run.app/webhooks/<platform>`
   - Secret: Store in Google Secret Manager
   - Events: Subscribe to relevant event types

5. **Monitor logs**:
   ```bash
   npm run brat -- fleet logs ingress-egress --level info
   ```

---

## Related Documentation

- [Ingress-Egress Framework Architecture](../concepts/ingress-egress-architecture.md)
- [WebhookHandler Implementation](../../src/services/ingress/core/webhook-handler.ts)
- [Twilio Integration Example](../../src/services/ingress/twilio/)
- [Sprint 342: Framework Foundation](../../planning/sprint-342-ingress-egress-framework/implementation-plan.md)
- [Sprint 343: Slack Integration](../../planning/sprint-343-slack-integration/) (Coming soon)

---

**Questions?** See existing implementations in `src/services/ingress/twilio/` or consult the [Ingress-Egress Framework RFC](../../planning/sprint-342-ingress-egress-framework/technical-architecture.md).

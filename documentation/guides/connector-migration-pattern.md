# Connector Migration Pattern

**Migrating Chat Platform Integrations to the Connector Adapter Pattern**

This guide documents the migration pattern from legacy connector implementations to the modern `IngressConnector` + `WebhookConnector` adapter pattern, using the Discord integration (Sprint 11) as a reference.

---

## Table of Contents

1. [Overview](#overview)
2. [Before & After Architecture](#before--after-architecture)
3. [Migration Steps](#migration-steps)
4. [Discord Migration Example](#discord-migration-example)
5. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
6. [Testing Recommendations](#testing-recommendations)
7. [Template for Future Platforms](#template-for-future-platforms)

---

## Overview

### Why Migrate?

The connector adapter pattern provides:
- **Separation of Concerns**: Pure client logic separated from framework interfaces
- **Testability**: Easier to mock and test adapter vs client
- **Consistency**: Uniform interface across all chat platforms (Slack, Twitch, Discord, Twilio)
- **Webhook Support**: Built-in webhook handling with signature verification and SLA enforcement
- **Runtime Discovery**: Accurate metadata for fleet introspection

### Migration Scope

**Platforms Migrated**:
- ✅ **Twilio** (Sprint 337) - Hybrid mode (WebSocket + webhook)
- ✅ **Slack** (Sprint 342) - Socket Mode + Events API
- ✅ **Discord** (Sprint 11) - Gateway + Interactions API
- ✅ **Twitch** (Sprint 0.26.0) - IRC + EventSub webhooks

**Migration Effort**: 1-2 days per platform (depending on complexity)

**Risk Level**: Low (backward compatible with incremental migration)

---

## Before & After Architecture

### Before: Legacy Pattern

```
┌─────────────────────────────────────┐
│  DiscordIngressClient               │
│  (implements IngressConnector       │
│   implements EgressConnector)       │
│                                     │
│  - Business logic mixed with        │
│    framework interfaces             │
│  - No webhook support               │
│  - Hard to test (tight coupling)    │
└─────────────────────────────────────┘
          │
          │ registered directly
          ↓
┌─────────────────────────────────────┐
│  ConnectorManager                   │
│  manager.register('discord', client)│
└─────────────────────────────────────┘
```

**Problems**:
- ❌ Client mixes business logic with framework interfaces
- ❌ No webhook support (Interactions API not supported)
- ❌ Difficult to test (can't mock client separately from adapter)
- ❌ Metadata hardcoded or missing
- ❌ Inconsistent with other platforms

### After: Connector Adapter Pattern

```
┌──────────────────────────────────────┐
│  DiscordIngressClient (Pure Client)  │
│  - Pure Discord.js wrapper           │
│  - No framework interfaces           │
│  - Business logic only               │
│  - Easy to test                      │
└──────────────────────────────────────┘
          │
          │ composition
          ↓
┌──────────────────────────────────────┐
│  DiscordConnectorAdapter             │
│  (implements IngressConnector        │
│   implements WebhookConnector)       │
│                                      │
│  - Delegates to client               │
│  - Webhook signature verification    │
│  - Metadata provider                 │
└──────────────────────────────────────┘
          │
          │ registered
          ↓
┌──────────────────────────────────────┐
│  ConnectorManager                    │
│  manager.register('discord', adapter)│
└──────────────────────────────────────┘
```

**Benefits**:
- ✅ Client is pure (no framework coupling)
- ✅ Adapter provides framework compliance
- ✅ Webhook support built-in
- ✅ Easy to test (mock client, test adapter separately)
- ✅ Accurate metadata for fleet introspection
- ✅ Consistent with Slack, Twitch, Twilio

---

## Migration Steps

### Step 1: Refactor Envelope Builder to Functional Pattern

**Before**:
```typescript
// Old class-based envelope builder
export class DiscordEnvelopeBuilder {
  build(event: DiscordMessageMeta, opts?: any): InternalEventV2 {
    return {
      type: 'chat.message.v1',
      correlationId: opts?.correlationId || randomUUID(),
      // ... rest of envelope
    };
  }
}
```

**After**:
```typescript
// New functional envelope builder
export function buildDiscordEnvelope(
  event: DiscordMessageMeta,
  opts?: {
    uuid?: () => string;
    nowIso?: () => string;
    egressDestination?: string;
    correlationId?: string;
    debugMetadata?: DebugMetadata;
  }
): InternalEventV2 {
  return {
    type: 'chat.message.v1',
    correlationId: opts?.correlationId || opts?.uuid?.() || randomUUID(),
    // ... rest of envelope
  };
}

// Maintain backward compatibility with class wrapper
export class DiscordEnvelopeBuilder {
  build(event: DiscordMessageMeta, opts?: any): InternalEventV2 {
    return buildDiscordEnvelope(event, opts);
  }
}
```

**Why**: Functional builders are easier to test (pure functions) and support dependency injection.

### Step 2: Create Webhook Signature Verification Utilities

**File**: `src/services/ingress/<platform>/webhook-utils.ts`

```typescript
import nacl from 'tweetnacl';  // For Discord Ed25519
// OR
import crypto from 'crypto';   // For Slack/Twitch HMAC

/**
 * Validate platform webhook signature
 *
 * @param publicKey - Platform public key (Discord) or signing secret (Slack/Twitch)
 * @param signature - Signature from webhook headers
 * @param timestamp - Timestamp from webhook headers
 * @param body - Raw request body (Buffer or string)
 * @returns true if signature is valid
 */
export function validatePlatformSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: Buffer | any
): boolean {
  // Platform-specific signature verification logic
  // Discord: Ed25519 (tweetnacl)
  // Slack/Twitch: HMAC-SHA256 (crypto)
}

/**
 * Check if timestamp is within valid range (prevents replay attacks)
 */
export function isTimestampValid(timestamp: string, maxAgeMs: number = 300000): boolean {
  const now = Date.now();
  const requestTime = parseInt(timestamp, 10) * 1000;
  return Math.abs(now - requestTime) < maxAgeMs;
}
```

### Step 3: Extract Pure Client (Remove Framework Interfaces)

**Before**:
```typescript
export class DiscordIngressClient implements IngressConnector, EgressConnector {
  // Mixes business logic with framework interfaces
}
```

**After**:
```typescript
export class DiscordIngressClient {
  // Pure client - no framework interfaces
  // Only contains Discord.js business logic

  async start(): Promise<void> { /* ... */ }
  async stop(): Promise<void> { /* ... */ }
  getSnapshot(): ConnectorSnapshot { /* ... */ }
  async sendText(text: string, target?: string): Promise<void> { /* ... */ }
  async banUser(platformUserId: string, reason?: string): Promise<void> { /* ... */ }
}
```

**Changes**:
- Remove `implements IngressConnector, EgressConnector`
- Keep public API methods (start, stop, sendText, etc.)
- Update constructor to accept functional builder instead of class instance

### Step 4: Create Connector Adapter

**File**: `src/services/ingress/<platform>/connector-adapter.ts`

```typescript
import type {
  IngressConnector,
  ConnectorSnapshot,
  WebhookConnector,
  WebhookRequest,
  WebhookResponse,
  ConnectorMetadata,
} from '../core';
import type { PlatformIngressClient } from './platform-ingress-client';
import { logger } from '../../../common/logging';
import { validatePlatformSignature, isTimestampValid } from './webhook-utils';
import type { IConfig } from '../../../types';

export class PlatformConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: PlatformIngressClient,
    private readonly config?: IConfig
  ) {}

  // IngressConnector implementation (delegate to client)
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
    if (!target) {
      throw new Error('platform_connector_adapter.target_required');
    }
    await this.client.sendText(text, target);
  }

  async banUser(platformUserId: string, reason?: string): Promise<void> {
    await this.client.banUser(platformUserId, reason);
  }

  // WebhookConnector implementation
  verifySignature(req: WebhookRequest): boolean {
    const signature = req.headers['x-platform-signature'];
    const timestamp = req.headers['x-platform-timestamp'];

    if (!signature || !timestamp) {
      logger.warn('platform.webhook.missing_headers');
      return false;
    }

    if (!isTimestampValid(timestamp as string)) {
      logger.warn('platform.webhook.timestamp_invalid', { timestamp });
      return false;
    }

    const secret = this.config?.platformWebhookSecret;
    if (!secret) {
      logger.error('platform.webhook.no_secret');
      return false;
    }

    const rawBody = req.rawBody || req.body;
    const valid = validatePlatformSignature(secret, signature as string, timestamp as string, rawBody);

    if (!valid) {
      logger.warn('platform.webhook.invalid_signature');
    }

    return valid;
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    const { event_type, event_id } = req.body;

    logger.debug('platform.webhook.received', { event_type, event_id });

    // IMPORTANT: Return 200 OK within 3 seconds (SLA)
    setImmediate(async () => {
      try {
        // Process webhook event asynchronously
        await this.processWebhookEvent(event_type, event_id, req.body);
      } catch (err: any) {
        logger.error('platform.webhook.processing_failed', { error: err.message, event_id });
      }
    });

    return { status: 200, body: { ok: true } };
  }

  private async processWebhookEvent(type: string, id: string, data: any): Promise<void> {
    // Platform-specific webhook event processing
    logger.info('platform.webhook.processing', { type, id });
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'platform-name',
      version: '1.0.0',
      authMethod: 'oauth2',  // or 'bot_token', 'api_key', etc.
      capabilities: {
        ingress: {
          method: 'hybrid',  // 'websocket', 'polling', 'webhook', 'hybrid'
          realtime: true,
          requiresWebhook: true,
          requiresPublicUrl: true,
        },
        egress: {
          chat: true,
          dm: true,
          reactions: true,
          threads: true,
        },
        moderation: {
          ban: true,
          timeout: true,
          delete: true,
        },
      },
    };
  }
}
```

### Step 5: Update Service Registration

**Before**:
```typescript
// ingress-egress-service.ts
import { DiscordEnvelopeBuilder } from './services/ingress/discord/envelope-builder';
import { DiscordIngressClient } from './services/ingress/discord/discord-ingress-client';

const builder = new DiscordEnvelopeBuilder();
const discordClient = new DiscordIngressClient(builder, publisher, config);

manager.register('discord', discordClient);
```

**After**:
```typescript
// ingress-egress-service.ts
import { buildDiscordEnvelope } from './services/ingress/discord/envelope-builder';
import { DiscordIngressClient } from './services/ingress/discord/discord-ingress-client';
import { DiscordConnectorAdapter } from './services/ingress/discord/connector-adapter';

// Create pure client with functional builder
const discordClient = new DiscordIngressClient(
  buildDiscordEnvelope,  // Functional builder (not class instance)
  publisher,
  config,
  { egressDestinationTopic: 'internal.egress.v1' }
);

// Wrap with adapter
const discordAdapter = new DiscordConnectorAdapter(discordClient, config);

// Register adapter (not client)
manager.register('discord', discordAdapter);
```

### Step 6: Scaffold Comprehensive Tests

Create test files following the Slack/Twitch pattern:
- `connector-adapter.test.ts` - IngressConnector interface tests
- `connector-adapter-webhook.test.ts` - WebhookConnector interface tests
- `webhook-utils.test.ts` - Signature verification tests

**See**: `src/services/ingress/discord/__tests__/` for reference implementation

### Step 7: Update Configuration

Add webhook-related configuration:
```yaml
# architecture.yaml or IConfig interface
services:
  ingress-egress:
    env:
      PLATFORM_WEBHOOK_SECRET: "${PLATFORM_WEBHOOK_SECRET}"
      PLATFORM_PUBLIC_KEY: "${PLATFORM_PUBLIC_KEY}"  # For Ed25519 platforms (Discord)
```

---

## Discord Migration Example

### Timeline

**Sprint 11: Discord Integration Modernization**
- **Phase 1: Foundation** (1 day) - Envelope builder, webhook utils, test scaffolding
- **Phase 2: Core Migration** (2 days) - Extract client, create adapter, update registration
- **Phase 3: Enhancements** (1 day) - Debug mode, deduplication, webhook handler
- **Phase 4: Validation** (1 day) - Tests, integration testing, documentation

**Total**: 4-5 days

### Key Changes

1. **Envelope Builder**: Class → Functional pattern
   - Old: `new DiscordEnvelopeBuilder().build(meta)`
   - New: `buildDiscordEnvelope(meta, opts)`

2. **Client Extraction**: Removed framework interfaces
   - Old: `class DiscordIngressClient implements IngressConnector, EgressConnector`
   - New: `class DiscordIngressClient` (pure client)

3. **Adapter Creation**: New wrapper class
   - Created: `DiscordConnectorAdapter` implementing both interfaces
   - Delegates all IngressConnector methods to client
   - Implements WebhookConnector for Interactions API

4. **Webhook Support**: Added Interactions API
   - Created: `validateDiscordSignature()` using Ed25519 (tweetnacl)
   - Implemented: `handleWebhook()` with 3-second SLA enforcement
   - Supports: Ping (type 1), Application Commands (type 2)

5. **Debug Mode**: Added RBAC-enforced debug mode
   - Pattern: `!debug <message>`
   - RBAC: User ID whitelist (`DEBUG_USERS_DISCORD`)
   - Confirmation: Ephemeral message with correlation ID

### Files Changed

**Created**:
- `src/services/ingress/discord/connector-adapter.ts`
- `src/services/ingress/discord/webhook-utils.ts`
- `src/services/ingress/discord/__tests__/connector-adapter.test.ts`
- `src/services/ingress/discord/__tests__/connector-adapter-webhook.test.ts`
- `src/services/ingress/discord/__tests__/webhook-utils.test.ts`
- `planning/sprint-11-j1d49d/integration-testing-guide.md`
- `documentation/guides/connector-migration-pattern.md` (this file)

**Modified**:
- `src/services/ingress/discord/discord-ingress-client.ts` (removed interfaces, updated constructor)
- `src/services/ingress/discord/envelope-builder.ts` (added functional pattern)
- `src/services/ingress/discord/index.ts` (export adapter)
- `src/apps/ingress-egress-service.ts` (updated registration)
- `src/types/index.ts` (added `discordPublicKey` config)
- `CLAUDE.md` (documented Discord pattern)

### Test Coverage

**Unit Tests**: 129 passing + 25 TODO = 154 tests
- `connector-adapter.test.ts`: 48 passing + 6 TODO
- `connector-adapter-webhook.test.ts`: 81 passing + 19 TODO
- `webhook-utils.test.ts`: 19 passing (all)

**Integration Tests**: 25 manual test cases
- See: `planning/sprint-11-j1d49d/integration-testing-guide.md`

---

## Common Pitfalls & Solutions

### Pitfall 1: Breaking Public API

**Problem**: Changing client constructor signature breaks existing code

**Solution**: Maintain backward compatibility with gradual migration
```typescript
// Step 1: Support both patterns
constructor(
  builderOrFunction: DiscordEnvelopeBuilder | typeof buildDiscordEnvelope,
  publisher: any,
  config: IConfig
) {
  if (typeof builderOrFunction === 'function') {
    this.buildEnvelope = builderOrFunction;
  } else {
    this.buildEnvelope = (meta, opts) => builderOrFunction.build(meta, opts);
  }
}

// Step 2: Deprecate old pattern (add warnings)
// Step 3: Remove old pattern (after 3 sprints)
```

### Pitfall 2: Webhook Signature Verification Failures

**Problem**: Signatures fail due to body transformation or timestamp issues

**Solution**:
- Use `rawBody` (Buffer) instead of parsed body for signature verification
- Check `x-forwarded-proto` header for HTTPS when reconstructing URL
- Validate timestamp to prevent replay attacks (max age: 5 minutes)

```typescript
// Correct: Use rawBody
const rawBody = req.rawBody || req.body;
const valid = validateSignature(secret, signature, timestamp, rawBody);

// Correct: Check x-forwarded-proto
const protocol = req.headers['x-forwarded-proto'] || 'https';
const url = `${protocol}://${req.headers['host']}${req.url}`;
```

### Pitfall 3: Webhook SLA Violations

**Problem**: Slow webhook responses cause platform retries and duplicate processing

**Solution**: Always return 200 OK within 3 seconds, defer processing
```typescript
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  // IMPORTANT: Return immediately
  setImmediate(async () => {
    // Heavy processing here (after response sent)
    await processEvent(req.body);
  });

  return { status: 200, body: { ok: true } };  // < 3 seconds
}
```

### Pitfall 4: Missing Metadata Capabilities

**Problem**: Inaccurate metadata breaks fleet introspection and runtime discovery

**Solution**: Ensure metadata matches actual implementation
```typescript
getMetadata(): ConnectorMetadata {
  return {
    capabilities: {
      ingress: {
        method: 'hybrid',  // Must match: websocket, polling, webhook, hybrid
        requiresWebhook: false,  // Discord Gateway doesn't require webhook (Interactions API is optional)
      },
      egress: {
        reactions: true,  // Only set to true if actually implemented
      },
    },
  };
}
```

### Pitfall 5: Incomplete Test Coverage

**Problem**: Missing tests for edge cases (reconnect, error handling, deduplication)

**Solution**: Follow test scaffolding pattern from Slack/Discord
- **Test delegation**: Verify adapter delegates all methods to client
- **Test webhooks**: Ping, commands, signature verification, SLA enforcement
- **Test error handling**: Connection loss, invalid signatures, malformed payloads
- **Test deduplication**: Duplicate message detection, cache cleanup

---

## Testing Recommendations

### Unit Testing Strategy

1. **Test Client in Isolation**
   - Mock Discord.js/platform SDK
   - Test business logic without framework coupling
   - Verify message processing, filtering, deduplication

2. **Test Adapter in Isolation**
   - Mock client (jest.Mock)
   - Test interface compliance (IngressConnector, WebhookConnector)
   - Test delegation to client methods
   - Test webhook signature verification
   - Test metadata accuracy

3. **Test Utilities**
   - Test signature verification with known good/bad signatures
   - Test timestamp validation (expired, future, valid)
   - Test edge cases (malformed headers, missing data)

### Integration Testing Checklist

- [ ] **Basic Connectivity**: Service connects to platform
- [ ] **Message Processing**: Normal messages processed correctly
- [ ] **Message Filtering**: Bots, empty messages, wrong channels filtered
- [ ] **Debug Mode**: `!debug` prefix works with RBAC
- [ ] **Egress Responses**: Messages sent successfully
- [ ] **Deduplication**: Duplicate messages rejected
- [ ] **Webhook Handler**: Ping and commands handled correctly
- [ ] **Error Recovery**: Connection loss recovery, graceful shutdown
- [ ] **Observability**: Snapshot state accurate, logging complete

### Test Coverage Goals

- **Unit Tests**: ≥ 80% line coverage
- **Integration Tests**: All happy paths + critical error paths
- **Manual Tests**: Full integration testing checklist (see `integration-testing-guide.md`)

---

## Template for Future Platforms

Use this template when migrating a new chat platform:

### 1. Create Directory Structure

```
src/services/ingress/<platform>/
├── <platform>-ingress-client.ts      # Pure client (no interfaces)
├── connector-adapter.ts               # Adapter (implements interfaces)
├── envelope-builder.ts                # Functional envelope builder
├── webhook-utils.ts                   # Signature verification
├── index.ts                          # Exports
└── __tests__/
    ├── connector-adapter.test.ts
    ├── connector-adapter-webhook.test.ts
    └── webhook-utils.test.ts
```

### 2. Implement Core Files

**Pure Client** (`<platform>-ingress-client.ts`):
- No framework interfaces
- Pure platform SDK wrapper
- Public API: start(), stop(), getSnapshot(), sendText(), banUser()

**Connector Adapter** (`connector-adapter.ts`):
- Implements IngressConnector + WebhookConnector
- Delegates to client
- Handles webhooks with signature verification
- Provides accurate metadata

**Webhook Utils** (`webhook-utils.ts`):
- Platform-specific signature verification
- Timestamp validation
- Comprehensive JSDoc

**Envelope Builder** (`envelope-builder.ts`):
- Functional pattern (pure function)
- Dependency injection support (uuid, nowIso, correlationId, debugMetadata)
- Backward compatible class wrapper (optional)

### 3. Update Service Registration

```typescript
import { buildPlatformEnvelope } from './services/ingress/<platform>/envelope-builder';
import { PlatformIngressClient } from './services/ingress/<platform>/<platform>-ingress-client';
import { PlatformConnectorAdapter } from './services/ingress/<platform>/connector-adapter';

const client = new PlatformIngressClient(buildPlatformEnvelope, publisher, config);
const adapter = new PlatformConnectorAdapter(client, config);
manager.register('<platform>', adapter);
```

### 4. Test Comprehensively

- Unit tests for client (mock platform SDK)
- Unit tests for adapter (mock client)
- Unit tests for webhook utils
- Integration tests (manual checklist)

### 5. Document

- Update CLAUDE.md with platform-specific examples
- Create integration testing guide
- Update migration guide with lessons learned

---

## Migration Checklist

Use this checklist to track migration progress:

- [ ] **Phase 1: Foundation**
  - [ ] Refactor envelope builder to functional pattern
  - [ ] Create webhook signature verification utilities
  - [ ] Scaffold test files

- [ ] **Phase 2: Core Migration**
  - [ ] Extract pure client (remove framework interfaces)
  - [ ] Create connector adapter (implement interfaces)
  - [ ] Update service registration
  - [ ] Verify existing functionality unchanged

- [ ] **Phase 3: Enhancements**
  - [ ] Add debug mode support (if applicable)
  - [ ] Add message deduplication (if applicable)
  - [ ] Implement webhook handler (if applicable)
  - [ ] Add platform-specific features

- [ ] **Phase 4: Validation & Documentation**
  - [ ] Complete unit test implementations (≥ 80% coverage)
  - [ ] Create integration testing guide
  - [ ] Update CLAUDE.md with platform examples
  - [ ] Update this migration guide

---

## Lessons Learned (Sprint 11 - Discord)

### What Worked Well

1. **Functional Envelope Builder**: Pure functions are easier to test and support dependency injection
2. **Test-First Approach**: Scaffolding tests early clarified interface requirements
3. **Backward Compatibility**: Gradual migration prevented breaking changes
4. **Comprehensive Documentation**: Integration testing guide helped manual testing

### What Could Be Improved

1. **Automated Integration Tests**: Manual testing is thorough but time-consuming
2. **Type Safety**: WebhookRequest interface evolved during implementation (missing `method` property)
3. **Migration Tooling**: Could automate some repetitive migration steps

### Recommendations for Future Migrations

1. **Start with Test Scaffolding**: Define all test cases before implementation
2. **Use Existing Platforms as Reference**: Copy pattern from Slack/Twitch/Discord
3. **Test Incrementally**: Test each phase before moving to next
4. **Maintain Backward Compatibility**: Support old pattern during transition period
5. **Document as You Go**: Update docs incrementally, not at the end

---

## See Also

- [Adding a New Ingress Platform](./adding-ingress-platform.md) — Step-by-step integration guide
- [Discord Integration Example](../../src/services/ingress/discord/) — Reference implementation
- [Slack Integration Example](../../src/services/ingress/slack/) — Alternative reference
- [Twitch Integration Example](../../src/services/ingress/twitch/) — IRC + webhooks pattern
- [Discord Integration Testing Guide](../../planning/sprint-11-j1d49d/integration-testing-guide.md) — Manual testing checklist

---

**End of Connector Migration Pattern Guide**

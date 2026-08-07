---
title: "Debug Connector Interface: Standardized Debug Support for All Connectors"
sprint: 371
version: "1.0"
status: "draft"
created: "2026-07-28"
author: "Claude Code (Architect)"
audience: [developers, ai-agents]
purpose: "Define standardized debug interface for all Ingress/Egress Framework connectors"
prerequisites:
  - "Sprint 342: Ingress/Egress Framework (connector interfaces)"
  - "Sprint 348: Slack Integration"
related:
  - "technical-architecture.md"
  - "src/services/ingress/core/interfaces.ts"
tags: [connector-architecture, debug, standardization]
---

# Debug Connector Interface: Standardized Debug Support for All Connectors

## 1. Vision

**Goal:** Make debug mode a **first-class citizen** of the Connector architecture, with standardized hooks that all connectors implement.

**Principle:** Debug mode is not a platform-specific feature—it's a fundamental observability requirement for **all** event sources.

**Outcome:** Adding a new connector (Telegram, WhatsApp, etc.) automatically includes debug support with minimal custom code.

---

## 2. Connector Debug Contract

### 2.1. New Interface: `DebugCapableConnector`

**File:** `src/services/ingress/core/interfaces.ts`

```typescript
/**
 * Debug message metadata
 *
 * Platform-agnostic representation of a debug update.
 * Connectors format this into platform-specific messages.
 *
 * @since Sprint 371
 */
export interface DebugUpdate {
  /** Update type */
  type: 'activation' | 'progress' | 'error' | 'retry' | 'dlq' | 'complete';

  /** Correlation ID being debugged */
  correlationId: string;

  /** Human-readable message */
  message: string;

  /** Structured metadata for rich formatting */
  metadata?: {
    stage?: string;
    stepId?: string;
    nextStep?: string;
    duration?: number;
    error?: { code: string; message: string };
    [key: string]: any;
  };

  /** Timestamp */
  timestamp: string;
}

/**
 * Debug request metadata extracted from platform-specific message
 *
 * @since Sprint 371
 */
export interface DebugRequest {
  /** Platform-specific user identifier (e.g., Slack User ID, Twitch username) */
  userId: string;

  /** Channel/room/conversation where debug was requested */
  channel: string;

  /** Original message text (with !debug prefix) */
  originalText: string;

  /** Message text with debug prefix stripped */
  strippedText: string;

  /** Platform-specific message metadata (timestamp, thread ID, etc.) */
  platformMetadata?: Record<string, any>;
}

/**
 * Debug authorization result
 *
 * @since Sprint 371
 */
export interface DebugAuthResult {
  /** Whether user is authorized for debug mode */
  authorized: boolean;

  /** Reason for denial (if not authorized) */
  reason?: string;

  /** User roles/permissions that were checked */
  checkedRoles?: string[];
}

/**
 * Debug-capable connector interface
 *
 * Connectors that implement this interface can detect, authorize, and format
 * debug mode requests in a platform-specific way.
 *
 * @example
 * ```typescript
 * class SlackConnector implements IngressConnector, EgressConnector, DebugCapableConnector {
 *   detectDebugRequest(text: string, platformMeta: any): DebugRequest | null {
 *     const match = /^!debug\s+/i.exec(text);
 *     if (!match) return null;
 *
 *     return {
 *       userId: platformMeta.user,
 *       channel: platformMeta.channel,
 *       originalText: text,
 *       strippedText: text.replace(/^!debug\s+/i, ''),
 *       platformMetadata: { ts: platformMeta.ts, threadTs: platformMeta.thread_ts },
 *     };
 *   }
 *
 *   async authorizeDebugUser(userId: string): Promise<DebugAuthResult> {
 *     const allowed = this.config.debugUsers?.includes(userId);
 *     return {
 *       authorized: allowed,
 *       reason: allowed ? undefined : 'user_not_in_allowlist',
 *     };
 *   }
 *
 *   async sendDebugUpdate(update: DebugUpdate, channel: string): Promise<void> {
 *     const formatted = this.formatDebugUpdate(update);
 *     await this.sendText(formatted, channel);
 *   }
 *
 *   formatDebugUpdate(update: DebugUpdate): string {
 *     // Slack-specific formatting (could use Blocks API)
 *     const icon = update.type === 'complete' ? '✅' :
 *                  update.type === 'error' ? '❌' :
 *                  update.type === 'activation' ? '🔍' : '▶️';
 *     return `${icon} ${update.message}`;
 *   }
 * }
 * ```
 *
 * @since Sprint 371
 */
export interface DebugCapableConnector {
  /**
   * Detect if a platform-specific message is a debug request
   *
   * Implementations should check for platform-specific debug triggers:
   * - Slack: `!debug` prefix in message text
   * - Twitch: `!debug` prefix in chat message
   * - Discord: `!debug` prefix or slash command `/debug`
   * - Telegram: `/debug` command
   *
   * @param text - Message text from platform
   * @param platformMeta - Platform-specific metadata (user ID, channel, etc.)
   * @returns DebugRequest if debug mode detected, null otherwise
   */
  detectDebugRequest(text: string, platformMeta: any): DebugRequest | null;

  /**
   * Check if a user is authorized for debug mode
   *
   * Implementations should check platform-specific allowlists:
   * - Environment variable (e.g., DEBUG_USERS_SLACK)
   * - Database lookup (future: role-based auth)
   * - Platform-specific permissions (e.g., Slack workspace admin)
   *
   * @param userId - Platform-specific user identifier
   * @returns Authorization result
   */
  authorizeDebugUser(userId: string): Promise<DebugAuthResult>;

  /**
   * Send a debug update to the user
   *
   * Implementations should format and deliver debug updates using platform-specific APIs:
   * - Slack: chat.postMessage with Blocks API
   * - Twitch: PRIVMSG to channel
   * - Discord: channel.send with embeds
   * - Telegram: sendMessage with HTML formatting
   *
   * @param update - Platform-agnostic debug update
   * @param channel - Target channel/conversation
   */
  sendDebugUpdate(update: DebugUpdate, channel: string): Promise<void>;

  /**
   * Format a debug update for platform-specific display
   *
   * Implementations should convert DebugUpdate to platform-native format:
   * - Slack: Blocks API JSON
   * - Discord: Embed objects
   * - Twitch: Plain text with Twitch emotes
   * - Telegram: HTML or Markdown
   *
   * @param update - Platform-agnostic debug update
   * @returns Platform-specific formatted message
   */
  formatDebugUpdate(update: DebugUpdate): string | object;
}
```

---

### 2.2. Enhanced `ConnectorCapabilities`

**File:** `src/services/ingress/core/interfaces.ts`

```typescript
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

  /**
   * Debug mode capabilities
   *
   * @since Sprint 371
   */
  debug?: {
    /** Connector implements DebugCapableConnector interface */
    supported: boolean;

    /** Debug trigger pattern (e.g., "!debug", "/debug") */
    trigger: string;

    /** Supports rich formatting (Slack Blocks, Discord Embeds, etc.) */
    richFormatting: boolean;

    /** Supports ephemeral messages (visible only to requesting user) */
    ephemeralMessages: boolean;
  };
}
```

---

## 3. Base Connector Class

### 3.1. Abstract `BaseDebugConnector`

**File:** `src/services/ingress/core/base-debug-connector.ts` (new)

```typescript
import type { DebugCapableConnector, DebugRequest, DebugAuthResult, DebugUpdate } from './interfaces';
import { logger } from '../../../common/logging';

/**
 * Base implementation of DebugCapableConnector with common logic
 *
 * Connectors can extend this class to get standard debug behavior,
 * only implementing platform-specific methods.
 *
 * @since Sprint 371
 */
export abstract class BaseDebugConnector implements DebugCapableConnector {
  /**
   * Standard debug trigger pattern (overridable)
   */
  protected debugTrigger = /^!debug\s+/i;

  /**
   * Debug user allowlist from configuration
   */
  protected abstract getDebugUsers(): string[];

  /**
   * Platform name for logging
   */
  protected abstract getPlatformName(): string;

  /**
   * Standard implementation: detect !debug prefix
   *
   * Override for platform-specific triggers (e.g., Discord slash commands)
   */
  detectDebugRequest(text: string, platformMeta: any): DebugRequest | null {
    const match = this.debugTrigger.exec(text);
    if (!match) return null;

    const userId = this.extractUserId(platformMeta);
    const channel = this.extractChannel(platformMeta);

    if (!userId || !channel) {
      logger.warn('debug.detect.missing_metadata', {
        platform: this.getPlatformName(),
        hasUser: !!userId,
        hasChannel: !!channel,
      });
      return null;
    }

    return {
      userId,
      channel,
      originalText: text,
      strippedText: text.replace(this.debugTrigger, ''),
      platformMetadata: platformMeta,
    };
  }

  /**
   * Standard implementation: check allowlist from config
   *
   * Override for database-backed or role-based authorization
   */
  async authorizeDebugUser(userId: string): Promise<DebugAuthResult> {
    const allowlist = this.getDebugUsers();
    const authorized = allowlist.includes(userId);

    logger.info('debug.auth.check', {
      platform: this.getPlatformName(),
      userId,
      authorized,
      allowlistSize: allowlist.length,
    });

    return {
      authorized,
      reason: authorized ? undefined : 'user_not_in_allowlist',
      checkedRoles: ['debug'],
    };
  }

  /**
   * Standard implementation: format and send via sendText
   *
   * Override for rich formatting (Slack Blocks, Discord Embeds)
   */
  async sendDebugUpdate(update: DebugUpdate, channel: string): Promise<void> {
    const formatted = this.formatDebugUpdate(update);
    const text = typeof formatted === 'string' ? formatted : JSON.stringify(formatted);

    logger.debug('debug.update.send', {
      platform: this.getPlatformName(),
      type: update.type,
      correlationId: update.correlationId,
      channel,
    });

    await this.sendPlatformMessage(text, channel);
  }

  /**
   * Default plain text formatting
   *
   * Override for platform-specific rich formatting
   */
  formatDebugUpdate(update: DebugUpdate): string | object {
    const icon = this.getUpdateIcon(update.type);
    const timestamp = new Date(update.timestamp).toLocaleTimeString();

    let formatted = `${icon} ${update.message}`;

    if (update.metadata) {
      const details = Object.entries(update.metadata)
        .filter(([k, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');

      if (details) {
        formatted += `\n  ${details}`;
      }
    }

    return formatted;
  }

  /**
   * Platform-specific methods (must be implemented by subclass)
   */
  protected abstract extractUserId(platformMeta: any): string | null;
  protected abstract extractChannel(platformMeta: any): string | null;
  protected abstract sendPlatformMessage(text: string, channel: string): Promise<void>;

  /**
   * Helpers
   */
  protected getUpdateIcon(type: DebugUpdate['type']): string {
    switch (type) {
      case 'activation': return '🔍';
      case 'complete': return '✅';
      case 'error': return '❌';
      case 'retry': return '🔄';
      case 'dlq': return '⚠️';
      case 'progress': return '▶️';
      default: return '📍';
    }
  }
}
```

---

## 4. Platform Implementations

### 4.1. Slack Implementation

**File:** `src/services/ingress/slack/slack-debug-mixin.ts` (new)

```typescript
import { BaseDebugConnector } from '../core/base-debug-connector';
import type { DebugUpdate, ConnectorCapabilities } from '../core/interfaces';
import type { IConfig } from '../../../types';

export class SlackDebugMixin extends BaseDebugConnector {
  constructor(
    private readonly config: IConfig,
    private readonly webClient: any // Slack WebClient
  ) {
    super();
  }

  getPlatformName(): string {
    return 'slack';
  }

  getDebugUsers(): string[] {
    return (this.config.debugUsersSlack || '').split(',').map(u => u.trim()).filter(Boolean);
  }

  protected extractUserId(platformMeta: any): string | null {
    return platformMeta.user || null;
  }

  protected extractChannel(platformMeta: any): string | null {
    return platformMeta.channel || null;
  }

  protected async sendPlatformMessage(text: string, channel: string): Promise<void> {
    await this.webClient.chat.postMessage({ channel, text });
  }

  /**
   * Slack-specific: Use Blocks API for rich formatting
   */
  formatDebugUpdate(update: DebugUpdate): object {
    const icon = this.getUpdateIcon(update.type);

    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *${update.message}*`,
        },
      },
    ];

    // Add metadata as context block
    if (update.metadata && Object.keys(update.metadata).length > 0) {
      const elements = Object.entries(update.metadata)
        .filter(([k, v]) => v !== undefined && v !== null)
        .map(([k, v]) => ({
          type: 'mrkdwn',
          text: `*${k}:* ${JSON.stringify(v)}`,
        }));

      if (elements.length > 0) {
        blocks.push({
          type: 'context',
          elements: elements.slice(0, 10), // Max 10 context elements
        });
      }
    }

    // Add correlation ID as footer
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Correlation ID: \`${update.correlationId}\` | ${new Date(update.timestamp).toLocaleTimeString()}`,
        },
      ],
    });

    return { blocks };
  }

  /**
   * Slack-specific: Send ephemeral "Not authorized" message
   */
  async sendUnauthorizedMessage(userId: string, channel: string): Promise<void> {
    await this.webClient.chat.postEphemeral({
      channel,
      user: userId,
      text: '⚠️ Debug mode requires authorization. Contact your workspace admin to be added to DEBUG_USERS_SLACK.',
    });
  }

  /**
   * Slack debug capabilities
   */
  static getDebugCapabilities(): ConnectorCapabilities['debug'] {
    return {
      supported: true,
      trigger: '!debug',
      richFormatting: true,
      ephemeralMessages: true,
    };
  }
}
```

---

### 4.2. Twitch Implementation

**File:** `src/services/ingress/twitch/twitch-debug-mixin.ts` (new)

```typescript
import { BaseDebugConnector } from '../core/base-debug-connector';
import type { DebugUpdate } from '../core/interfaces';
import type { IConfig } from '../../../types';

export class TwitchDebugMixin extends BaseDebugConnector {
  constructor(
    private readonly config: IConfig,
    private readonly ircClient: any // Twitch IRC client
  ) {
    super();
  }

  getPlatformName(): string {
    return 'twitch';
  }

  getDebugUsers(): string[] {
    return (this.config.debugUsersTwitch || '').split(',').map(u => u.trim()).filter(Boolean);
  }

  protected extractUserId(platformMeta: any): string | null {
    // Twitch uses username as identifier
    return platformMeta.username || platformMeta.displayName || null;
  }

  protected extractChannel(platformMeta: any): string | null {
    return platformMeta.channel || null;
  }

  protected async sendPlatformMessage(text: string, channel: string): Promise<void> {
    await this.ircClient.say(channel, text);
  }

  /**
   * Twitch-specific: Plain text with Twitch emotes
   */
  formatDebugUpdate(update: DebugUpdate): string {
    const icon = this.getTwitchEmote(update.type);
    const timestamp = new Date(update.timestamp).toLocaleTimeString();

    let formatted = `${icon} ${update.message}`;

    // Add key metadata inline (Twitch doesn't support rich formatting)
    if (update.metadata?.stage || update.metadata?.stepId) {
      const stage = update.metadata.stage ? `[${update.metadata.stage}]` : '';
      const step = update.metadata.stepId ? `${update.metadata.stepId}` : '';
      formatted += ` ${stage} ${step}`.trim();
    }

    return formatted;
  }

  private getTwitchEmote(type: DebugUpdate['type']): string {
    // Use text-based emotes for Twitch compatibility
    switch (type) {
      case 'activation': return '[DEBUG]';
      case 'complete': return '[OK]';
      case 'error': return '[ERROR]';
      case 'retry': return '[RETRY]';
      case 'dlq': return '[DLQ]';
      case 'progress': return '>';
      default: return '•';
    }
  }

  static getDebugCapabilities() {
    return {
      supported: true,
      trigger: '!debug',
      richFormatting: false,
      ephemeralMessages: false,
    };
  }
}
```

---

## 5. Integration with Base Server

### 5.1. Enhanced `Bit.next()` with Connector-Aware Debug

**File:** `src/common/base-server.ts:858`

```typescript
protected async next(event: InternalEventV2, stepStatus?: RoutingStatus): Promise<void> {
  // ... existing idempotency check

  const isDebugMode = event.qos?.tracer === true;
  const debugMeta = event.metadata?.debug;

  // Find next pending step or fall back to egress
  const nextStep = event.routing.slip.find(s => s.status === 'PENDING');
  const topic = nextStep?.nextTopic || event.egress?.destination || INTERNAL_EGRESS_V1;

  // Debug: Send progress update via connector
  if (isDebugMode && debugMeta?.feedbackChannel) {
    try {
      const connector = this.getDebugConnector(event.egress.connector);
      if (connector) {
        const currentStepId = this.getCurrentStepId?.(event) || 'unknown';
        const update: DebugUpdate = {
          type: 'progress',
          correlationId: event.correlationId,
          message: `Processing step: ${currentStepId}`,
          metadata: {
            stage: event.routing.stage,
            stepId: currentStepId,
            nextStep: nextStep?.id || 'egress',
            topic,
          },
          timestamp: new Date().toISOString(),
        };

        await connector.sendDebugUpdate(update, debugMeta.feedbackChannel);
      }
    } catch (err: any) {
      logger.warn('debug.feedback.failed', {
        error: err.message,
        correlationId: event.correlationId
      });
    }
  }

  // Publish
  await publisher.publishJson(event, busAttrsFromEvent(event));

  // ... existing snapshot capture
}
```

---

### 5.2. Connector Lookup Helper

**File:** `src/common/base-server.ts` (new protected method)

```typescript
/**
 * Get debug-capable connector by platform type
 *
 * Looks up connector from ConnectorManager (if available).
 * Future: Use dependency injection or resource manager.
 */
protected getDebugConnector(connectorType: ConnectorType): DebugCapableConnector | null {
  // For now, this is a placeholder
  // In implementation, we'd access ConnectorManager via:
  // - Resource manager
  // - Singleton pattern
  // - Dependency injection

  // Example:
  // const manager = this.getResource<ConnectorManager>('connectorManager');
  // const connector = manager?.getConnectorByPlatform(connectorType);
  // return connector as DebugCapableConnector;

  return null; // TODO: Implement connector lookup
}
```

---

## 6. Connector Validation

### 6.1. Debug Compliance Test Suite

**File:** `src/services/ingress/core/__tests__/debug-connector-compliance.test.ts` (new)

```typescript
import type { DebugCapableConnector, DebugUpdate } from '../interfaces';

/**
 * Compliance test suite for DebugCapableConnector implementations
 *
 * All connectors MUST pass these tests to ensure standardized behavior.
 */
export function testDebugConnectorCompliance(
  connectorName: string,
  createConnector: () => DebugCapableConnector
) {
  describe(`${connectorName} - DebugCapableConnector Compliance`, () => {
    let connector: DebugCapableConnector;

    beforeEach(() => {
      connector = createConnector();
    });

    describe('detectDebugRequest', () => {
      it('should detect debug trigger in message', () => {
        const request = connector.detectDebugRequest('!debug test message', {
          user: 'user123',
          channel: 'channel456',
        });

        expect(request).not.toBeNull();
        expect(request?.originalText).toBe('!debug test message');
        expect(request?.strippedText).toBe('test message');
        expect(request?.userId).toBe('user123');
        expect(request?.channel).toBe('channel456');
      });

      it('should return null for non-debug messages', () => {
        const request = connector.detectDebugRequest('normal message', {
          user: 'user123',
          channel: 'channel456',
        });

        expect(request).toBeNull();
      });

      it('should handle case-insensitive trigger', () => {
        const request = connector.detectDebugRequest('!DEBUG test', {
          user: 'user123',
          channel: 'channel456',
        });

        expect(request).not.toBeNull();
        expect(request?.strippedText).toBe('test');
      });
    });

    describe('authorizeDebugUser', () => {
      it('should authorize users in allowlist', async () => {
        const result = await connector.authorizeDebugUser('authorized_user');

        expect(result.authorized).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should reject users not in allowlist', async () => {
        const result = await connector.authorizeDebugUser('unauthorized_user');

        expect(result.authorized).toBe(false);
        expect(result.reason).toBeDefined();
      });
    });

    describe('formatDebugUpdate', () => {
      it('should format activation update', () => {
        const update: DebugUpdate = {
          type: 'activation',
          correlationId: 'abc123',
          message: 'Debug mode ON',
          timestamp: new Date().toISOString(),
        };

        const formatted = connector.formatDebugUpdate(update);

        expect(formatted).toBeDefined();
        // Either string or object (platform-specific)
        expect(typeof formatted === 'string' || typeof formatted === 'object').toBe(true);
      });

      it('should include metadata in formatted output', () => {
        const update: DebugUpdate = {
          type: 'progress',
          correlationId: 'abc123',
          message: 'Processing',
          metadata: {
            stage: 'analysis',
            stepId: 'llm-bot',
          },
          timestamp: new Date().toISOString(),
        };

        const formatted = connector.formatDebugUpdate(update);
        const formattedStr = typeof formatted === 'string'
          ? formatted
          : JSON.stringify(formatted);

        // Metadata should be present in some form
        expect(formattedStr).toContain('analysis');
        expect(formattedStr).toContain('llm-bot');
      });
    });

    describe('sendDebugUpdate', () => {
      it('should not throw when sending update', async () => {
        const update: DebugUpdate = {
          type: 'progress',
          correlationId: 'abc123',
          message: 'Test update',
          timestamp: new Date().toISOString(),
        };

        await expect(
          connector.sendDebugUpdate(update, 'test-channel')
        ).resolves.not.toThrow();
      });
    });
  });
}
```

---

## 7. Migration Path

### 7.1. Phased Adoption

**Phase 1 (Sprint 371): Core Interface + Slack**
- [ ] Define `DebugCapableConnector` interface
- [ ] Create `BaseDebugConnector` abstract class
- [ ] Implement `SlackDebugMixin`
- [ ] Update `SlackIngressClient` to use mixin
- [ ] Update `ConnectorCapabilities` with `debug` field
- [ ] Create compliance test suite

**Phase 2 (Sprint 372): Base Server Integration**
- [ ] Add connector lookup to `Bit` base class
- [ ] Update `Bit.next()` to use `connector.sendDebugUpdate()`
- [ ] Update `Bit.complete()` to use connector formatting
- [ ] Add DLQ/retry debug notifications

**Phase 3 (Sprint 373+): Multi-Platform**
- [ ] Implement `TwitchDebugMixin`
- [ ] Implement `DiscordDebugMixin`
- [ ] Implement `TwilioDebugMixin`
- [ ] Migrate existing platforms to new interface

---

### 7.2. Backward Compatibility

**Existing connectors without debug support:**
- `getMetadata().capabilities.debug.supported = false`
- Base server checks `connector.capabilities.debug?.supported` before calling debug methods
- Graceful degradation: debug events work, but feedback is sent via generic egress (no rich formatting)

**Example:**

```typescript
// In Bit.next()
const connector = this.getDebugConnector(event.egress.connector);
const supportsDebug = connector?.getMetadata?.()?.capabilities?.debug?.supported;

if (isDebugMode && supportsDebug) {
  // Use connector-specific debug formatting
  await connector.sendDebugUpdate(update, channel);
} else if (isDebugMode) {
  // Fallback: generic plain text egress
  await this.sendGenericDebugFeedback(update, event.egress);
}
```

---

## 8. Benefits

### 8.1. For Platform Developers

**Before (Sprint 371 initial approach):**
```typescript
// Each platform manually implements debug logic
private async handleMessage(body: any): Promise<void> {
  const debugMatch = /^!debug\s+/i.exec(text);
  if (debugMatch) {
    const debugUsers = config.debugUsersSlack.split(',');
    if (!debugUsers.includes(userId)) {
      // Send "not authorized" somehow...
      return;
    }
    // Strip prefix, set flags, send confirmation...
  }
  // ... rest of handler
}
```

**After (connector interface approach):**
```typescript
// Platform extends BaseDebugConnector, implements 4 simple methods
class SlackDebugMixin extends BaseDebugConnector {
  getPlatformName() { return 'slack'; }
  getDebugUsers() { return this.config.debugUsersSlack.split(','); }
  extractUserId(meta) { return meta.user; }
  extractChannel(meta) { return meta.channel; }
  sendPlatformMessage(text, channel) { return this.webClient.chat.postMessage({ channel, text }); }

  // Optional: Override formatDebugUpdate() for rich formatting
}
```

---

### 8.2. For Platform Maintainers

- **Compliance tests:** `testDebugConnectorCompliance()` ensures all connectors behave consistently
- **Centralized logic:** Debug detection, authorization, formatting standardized in `BaseDebugConnector`
- **Platform-specific customization:** Override `formatDebugUpdate()` for rich formatting (Slack Blocks, Discord Embeds)

---

### 8.3. For Operators

- **Predictable behavior:** Debug mode works the same way across all platforms
- **Consistent configuration:** `DEBUG_USERS_<PLATFORM>` pattern for all platforms
- **Observability:** `connector.capabilities.debug` advertises debug support at runtime

---

## 9. Example: Adding Debug Support to New Platform

**Scenario:** Adding Telegram connector with debug support

**Step 1:** Implement `DebugCapableConnector`

```typescript
// src/services/ingress/telegram/telegram-debug-mixin.ts
export class TelegramDebugMixin extends BaseDebugConnector {
  // Override debug trigger (Telegram uses / commands)
  protected debugTrigger = /^\/debug\s+/i;

  getPlatformName() { return 'telegram'; }
  getDebugUsers() { return this.config.debugUsersTelegram.split(','); }

  extractUserId(meta) { return meta.from?.id?.toString() || null; }
  extractChannel(meta) { return meta.chat?.id?.toString() || null; }

  async sendPlatformMessage(text, channel) {
    await this.bot.telegram.sendMessage(channel, text, { parse_mode: 'HTML' });
  }

  // Telegram-specific: Use HTML formatting
  formatDebugUpdate(update: DebugUpdate): string {
    const icon = this.getUpdateIcon(update.type);
    return `<b>${icon} ${update.message}</b>\n<code>${update.correlationId}</code>`;
  }
}
```

**Step 2:** Integrate into connector adapter

```typescript
// src/services/ingress/telegram/connector-adapter.ts
export class TelegramConnectorAdapter implements IngressConnector, DebugCapableConnector {
  private debugMixin: TelegramDebugMixin;

  constructor(client, config) {
    this.client = client;
    this.debugMixin = new TelegramDebugMixin(config, client.bot);
  }

  // Delegate to mixin
  detectDebugRequest = this.debugMixin.detectDebugRequest.bind(this.debugMixin);
  authorizeDebugUser = this.debugMixin.authorizeDebugUser.bind(this.debugMixin);
  sendDebugUpdate = this.debugMixin.sendDebugUpdate.bind(this.debugMixin);
  formatDebugUpdate = this.debugMixin.formatDebugUpdate.bind(this.debugMixin);

  getMetadata() {
    return {
      platform: 'telegram',
      capabilities: {
        debug: {
          supported: true,
          trigger: '/debug',
          richFormatting: true,
          ephemeralMessages: false,
        },
        // ... other capabilities
      },
    };
  }
}
```

**Step 3:** Add compliance tests

```typescript
// src/services/ingress/telegram/__tests__/debug-compliance.test.ts
import { testDebugConnectorCompliance } from '../../core/__tests__/debug-connector-compliance.test';
import { TelegramConnectorAdapter } from '../connector-adapter';

testDebugConnectorCompliance('Telegram', () => {
  const mockClient = { /* ... */ };
  const mockConfig = { debugUsersTelegram: 'user1,user2' };
  return new TelegramConnectorAdapter(mockClient, mockConfig);
});
```

**Done!** Telegram connector now has full debug support with ~50 lines of code.

---

## 10. Open Questions

### 10.1. Connector Discovery

**Question:** How does `Bit.next()` discover which connector to use for debug feedback?

**Options:**
1. **ConnectorManager resource:** Add `connectorManager` to resource managers
2. **Singleton pattern:** Global registry of active connectors
3. **Event metadata:** Store connector instance reference in `event.metadata.debug.connector`

**Recommendation:** Use resource manager pattern (consistent with `publisher`, `firestore`, etc.)

---

### 10.2. Rich Formatting Fallback

**Question:** What happens when a connector supports rich formatting but the API call fails?

**Recommendation:** Automatic fallback to plain text:

```typescript
async sendDebugUpdate(update: DebugUpdate, channel: string) {
  try {
    const richFormatted = this.formatDebugUpdate(update);
    await this.sendRichMessage(richFormatted, channel);
  } catch (err) {
    // Fallback to plain text
    const plainText = typeof richFormatted === 'string'
      ? richFormatted
      : `${update.message} (${update.correlationId})`;
    await this.sendPlatformMessage(plainText, channel);
  }
}
```

---

## 11. Success Criteria

**Functional:**
- [ ] `DebugCapableConnector` interface defined and documented
- [ ] `BaseDebugConnector` provides 80% of debug logic
- [ ] Slack connector uses new interface with rich formatting
- [ ] Compliance test suite passes for all implementing connectors
- [ ] New connectors can add debug support with <100 lines of code

**Non-Functional:**
- [ ] Zero breaking changes to existing connector API
- [ ] Debug mode overhead <10ms per event (measurement via tracer)
- [ ] All debug methods have comprehensive JSDoc

**Documentation:**
- [ ] Connector developer guide: "Adding Debug Support to Your Connector"
- [ ] Architecture decision record (ADR): Why connector-based debug?
- [ ] Migration guide: Legacy debug → connector interface

---

**End of Connector Debug Interface Specification**

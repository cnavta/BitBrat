# Implementation Plan: Twitch Integration Refactoring

**Sprint**: sprint-10-ee8bxg
**Owner**: christophernavta
**Status**: Planning (Awaiting Approval)
**Created**: 2026-08-11

---

## Goal

Refactor the Twitch integration in `ingress-egress` to align with the standard connector architecture established in the Slack integration (Sprint 348), preparing for future per-platform Bit separation.

---

## Success Criteria

- [ ] `TwitchConnectorAdapter` implements `IngressConnector` interface
- [ ] Adapter registered with `ConnectorManager`
- [ ] `getMetadata()` returns accurate Twitch platform capabilities
- [ ] All existing functionality works identically (IRC, egress, debug mode, moderation)
- [ ] Zero regressions in Twitch message handling
- [ ] Test coverage maintained or improved
- [ ] Documentation updated with new pattern
- [ ] Build passes (`npm run build`)
- [ ] Tests pass (`npm test`)

---

## Implementation Tasks

### Task 1: Create TwitchConnectorAdapter Scaffold

**File**: `src/services/ingress/twitch/connector-adapter.ts`

**Description**: Create the adapter layer that implements `IngressConnector` interface and delegates to `TwitchIrcClient`.

**Implementation Details**:
```typescript
import type {
  IngressConnector,
  ConnectorSnapshot,
  ConnectorMetadata,
} from '../core';
import type { TwitchIrcClient } from './twitch-irc-client';
import type { IConfig } from '../../../types';

export class TwitchConnectorAdapter implements IngressConnector {
  constructor(
    private readonly client: TwitchIrcClient,
    private readonly config?: IConfig
  ) {}

  // IngressConnector interface
  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  getSnapshot(): ConnectorSnapshot {
    return this.client.getSnapshot();
  }

  // EgressConnector methods (inherited via IngressConnector)
  async sendText(text: string, target?: string): Promise<void> {
    await this.client.sendText(text, target);
  }

  // Optional: Extended Twitch-specific methods
  async sendWhisper(text: string, userId: string): Promise<void> {
    await this.client.sendWhisper(text, userId);
  }

  async banUser(platformUserId: string, reason?: string): Promise<void> {
    await this.client.banUser(platformUserId, reason);
  }

  // Capability metadata
  getMetadata(): ConnectorMetadata {
    return {
      platform: 'twitch',
      version: '1.0.0',
      authMethod: 'oauth2',
      capabilities: {
        ingress: {
          method: 'websocket', // IRC via Twurple Chat
          realtime: true,
          requiresWebhook: false,
          requiresPublicUrl: false,
        },
        egress: {
          chat: true,
          dm: true, // Whispers
          reactions: false,
          threads: false,
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

**Acceptance Criteria**:
- [ ] File created at `src/services/ingress/twitch/connector-adapter.ts`
- [ ] Implements `IngressConnector` interface
- [ ] All methods delegate to `TwitchIrcClient`
- [ ] `getMetadata()` returns accurate capabilities
- [ ] TypeScript compiles without errors
- [ ] No changes to `TwitchIrcClient` required

**Estimated Effort**: 1 hour

---

### Task 2: Update Twitch Module Exports

**File**: `src/services/ingress/twitch/index.ts`

**Description**: Export the new `TwitchConnectorAdapter` from the Twitch module.

**Implementation Details**:
```typescript
// Add to existing exports
export { TwitchConnectorAdapter } from './connector-adapter';
```

**Acceptance Criteria**:
- [ ] `TwitchConnectorAdapter` exported from `src/services/ingress/twitch/index.ts`
- [ ] No breaking changes to existing exports
- [ ] TypeScript compiles without errors

**Estimated Effort**: 5 minutes

---

### Task 3: Register Adapter with ConnectorManager

**File**: `src/apps/ingress-egress-service.ts`

**Description**: Update `IngressEgressServer` to create and register the `TwitchConnectorAdapter` with `ConnectorManager`.

**Implementation Details**:

**Current code**:
```typescript
this.twitchClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
  cfg,
  credentialsProvider: credsProvider,
  egressDestinationTopic: egressTopic,
  debugUsers: cfg.debugUsers,
});
await this.twitchClient.start();
```

**New code** (dual support during migration):
```typescript
import { TwitchConnectorAdapter } from '../services/ingress/twitch';

// Create client (unchanged)
this.twitchClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
  cfg,
  credentialsProvider: credsProvider,
  egressDestinationTopic: egressTopic,
  debugUsers: cfg.debugUsers,
});

// Create adapter
const twitchAdapter = new TwitchConnectorAdapter(this.twitchClient, cfg);

// Register with ConnectorManager
this.connectorManager!.register('twitch', twitchAdapter);

// Start via adapter (or keep direct start for dual support)
await twitchAdapter.start(); // or await this.twitchClient.start();
```

**Acceptance Criteria**:
- [ ] Import `TwitchConnectorAdapter` from Twitch module
- [ ] Create adapter instance wrapping `TwitchIrcClient`
- [ ] Register adapter with `ConnectorManager.register('twitch', adapter)`
- [ ] Client starts successfully (either via adapter or directly)
- [ ] No breaking changes to existing functionality
- [ ] TypeScript compiles without errors

**Estimated Effort**: 30 minutes

---

### Task 4: Verify Feature Parity - IRC Ingress

**Description**: Test that IRC message ingress works identically after adapter introduction.

**Test Cases**:
1. **Basic message ingress**:
   - Send message in Twitch chat
   - Verify envelope published to `internal.ingress.v1`
   - Verify envelope structure matches existing format
   - Verify user metadata (login, displayName, userId) preserved

2. **Self-message filtering**:
   - Verify bot messages are filtered (not published)
   - Verify deduplication works

3. **Debug mode** (`!debug` command):
   - Authorized user sends `!debug hello world`
   - Verify tracer flag set (`qos.tracer: true`)
   - Verify debug confirmation sent to chat
   - Verify correlation ID generated

**Acceptance Criteria**:
- [ ] All IRC ingress functionality works identically
- [ ] Message normalization unchanged
- [ ] Debug mode works (`!debug` command)
- [ ] Deduplication works (self-messages filtered)

**Estimated Effort**: 1 hour (manual testing)

---

### Task 5: Verify Feature Parity - Egress

**Description**: Test that egress (sending messages) works identically after adapter introduction.

**Test Cases**:
1. **sendText()**: Send message to channel via adapter
2. **sendWhisper()**: Send whisper (DM) to user via adapter
3. **banUser()**: Ban user via adapter

**Acceptance Criteria**:
- [ ] `sendText()` works via adapter
- [ ] `sendWhisper()` works via adapter
- [ ] `banUser()` works via adapter
- [ ] All egress methods work identically to direct client usage

**Estimated Effort**: 30 minutes (manual testing)

---

### Task 6: Verify Feature Parity - Broadcaster Client

**Description**: Verify that the separate broadcaster client (used for broadcaster-scoped operations) continues to work.

**Implementation Details**:

**Current code**:
```typescript
this.twitchBroadcasterClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
  cfg,
  credentialsProvider: broadcasterCredsProvider,
  egressDestinationTopic: egressTopic,
  disableIngress: true,
});
```

**New code** (optional adapter wrapping):
```typescript
this.twitchBroadcasterClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
  cfg,
  credentialsProvider: broadcasterCredsProvider,
  egressDestinationTopic: egressTopic,
  disableIngress: true,
});

// Optional: Create adapter for broadcaster client
const broadcasterAdapter = new TwitchConnectorAdapter(this.twitchBroadcasterClient, cfg);
this.connectorManager!.register('twitch-broadcaster', broadcasterAdapter);
```

**Acceptance Criteria**:
- [ ] Broadcaster client continues to work
- [ ] Broadcaster egress operations work (sendText with broadcaster identity)
- [ ] Optional: Broadcaster adapter registered separately

**Estimated Effort**: 30 minutes

---

### Task 7: Update Egress Handler to Use Adapter

**File**: `src/apps/ingress-egress-service.ts`

**Description**: Update egress message handler to retrieve connector via `ConnectorManager` instead of direct client reference.

**Current code**:
```typescript
// Egress handler (approximate location)
if (targetConnector === 'twitch' && this.twitchClient) {
  await this.twitchClient.sendText(text, channel);
}
```

**New code**:
```typescript
if (targetConnector === 'twitch') {
  const connector = this.connectorManager!.getConnector('twitch');
  if (connector) {
    await connector.sendText(text, channel);
  }
}
```

**Acceptance Criteria**:
- [ ] Egress handler uses `ConnectorManager.getConnector('twitch')`
- [ ] Egress messages routed to Twitch successfully
- [ ] No regressions in egress handling

**Estimated Effort**: 30 minutes

---

### Task 8: Add Unit Tests for TwitchConnectorAdapter

**File**: `src/services/ingress/twitch/__tests__/connector-adapter.test.ts` (new file)

**Description**: Add unit tests for the new `TwitchConnectorAdapter`.

**Test Cases**:
1. **start()**: Verify delegates to client.start()
2. **stop()**: Verify delegates to client.stop()
3. **getSnapshot()**: Verify delegates to client.getSnapshot()
4. **sendText()**: Verify delegates to client.sendText()
5. **sendWhisper()**: Verify delegates to client.sendWhisper()
6. **banUser()**: Verify delegates to client.banUser()
7. **getMetadata()**: Verify returns correct platform capabilities

**Example Test**:
```typescript
import { TwitchConnectorAdapter } from '../connector-adapter';
import type { TwitchIrcClient } from '../twitch-irc-client';

describe('TwitchConnectorAdapter', () => {
  let adapter: TwitchConnectorAdapter;
  let mockClient: jest.Mocked<TwitchIrcClient>;

  beforeEach(() => {
    mockClient = {
      start: jest.fn(),
      stop: jest.fn(),
      getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED', joinedChannels: [] }),
      sendText: jest.fn(),
      sendWhisper: jest.fn(),
      banUser: jest.fn(),
    } as any;

    adapter = new TwitchConnectorAdapter(mockClient);
  });

  it('should delegate start to client', async () => {
    await adapter.start();
    expect(mockClient.start).toHaveBeenCalled();
  });

  it('should delegate sendText to client', async () => {
    await adapter.sendText('Hello', '#channel');
    expect(mockClient.sendText).toHaveBeenCalledWith('Hello', '#channel');
  });

  it('should return correct metadata', () => {
    const metadata = adapter.getMetadata();
    expect(metadata.platform).toBe('twitch');
    expect(metadata.capabilities.egress.chat).toBe(true);
    expect(metadata.capabilities.moderation.ban).toBe(true);
  });
});
```

**Acceptance Criteria**:
- [ ] Unit tests created for all adapter methods
- [ ] Tests verify delegation to client
- [ ] Tests verify metadata correctness
- [ ] All tests pass

**Estimated Effort**: 1 hour

---

### Task 9: Update Documentation

**Files**:
- `CLAUDE.md`: Update Twitch integration example
- `documentation/guides/adding-ingress-platform.md`: Update with Twitch adapter example
- `src/services/ingress/twitch/README.md`: Create or update module documentation

**Description**: Update documentation to reflect the new adapter pattern for Twitch.

**CLAUDE.md Update** (Integrating Chat Platforms section):
```markdown
**Examples in Production:**

- **Twilio** (`src/services/ingress/twilio/connector-adapter.ts`): Hybrid mode (WebSocket + webhook)
- **Slack** (`src/services/ingress/slack/connector-adapter.ts`): Socket Mode + Events API
- **Twitch** (`src/services/ingress/twitch/connector-adapter.ts`): IRC (Twurple Chat)
```

**Acceptance Criteria**:
- [ ] `CLAUDE.md` updated with Twitch adapter example
- [ ] `documentation/guides/adding-ingress-platform.md` references Twitch
- [ ] Module documentation created/updated

**Estimated Effort**: 30 minutes

---

### Task 10: Build and Test

**Description**: Run full build and test suite to verify no regressions.

**Commands**:
```bash
npm run build       # Verify TypeScript compiles
npm test            # Run test suite
npm run lint        # Verify linting passes
```

**Acceptance Criteria**:
- [ ] `npm run build` passes
- [ ] `npm test` passes (all existing tests)
- [ ] `npm run lint` passes
- [ ] No TypeScript errors
- [ ] No test failures
- [ ] No linting errors

**Estimated Effort**: 15 minutes

---

## Out of Scope (Future Enhancements)

The following items are **NOT** included in this sprint but are documented for future work:

1. **EventSub Webhook Support**:
   - Create `webhook-utils.ts` for EventSub HMAC-SHA256 signature validation
   - Implement `WebhookConnector` interface in adapter
   - Add `handleWebhook()` for EventSub events (channel.follow, stream.online, etc.)
   - Update metadata to reflect webhook capabilities

2. **Per-Platform Bit Separation**:
   - Extract Twitch integration to standalone `twitch-ingress` Bit
   - Create separate service entry point
   - Independent deployment and scaling

3. **Advanced Moderation**:
   - Add `/timeout`, `/delete`, `/clear` IRC commands
   - Extend moderation capabilities metadata

4. **Remove Direct Client Usage**:
   - Remove `this.twitchClient` field from `IngressEgressServer`
   - Use `ConnectorManager` exclusively
   - Remove dual support code

---

## Risk Mitigation

### High-Risk Areas

1. **OAuth Token Refresh**:
   - Risk: Adapter might break RefreshingAuthProvider flow
   - Mitigation: Credentials provider unchanged, adapter is thin delegation layer
   - Verification: Test token refresh in staging

2. **Debug Mode (`!debug` command)**:
   - Risk: Adapter might break debug mode RBAC
   - Mitigation: Client handles debug mode, adapter just delegates
   - Verification: Test `!debug` command with authorized user

3. **Broadcaster Client**:
   - Risk: Separate broadcaster client might not work with adapter
   - Mitigation: Keep direct client usage for broadcaster (no adapter)
   - Verification: Test broadcaster egress operations

### Testing Strategy

1. **Unit Tests**: Test adapter delegation logic
2. **Integration Tests**: Test adapter with real `TwitchIrcClient` (mocked Twurple)
3. **Manual Tests**: Test IRC ingress, egress, debug mode in staging
4. **Regression Tests**: Verify all existing Twitch functionality works

---

## Timeline Estimate

| Task | Effort | Dependencies |
|------|--------|--------------|
| 1. Create TwitchConnectorAdapter | 1h | None |
| 2. Update module exports | 5m | Task 1 |
| 3. Register with ConnectorManager | 30m | Task 1, 2 |
| 4. Verify IRC ingress | 1h | Task 3 |
| 5. Verify egress | 30m | Task 3 |
| 6. Verify broadcaster client | 30m | Task 3 |
| 7. Update egress handler | 30m | Task 3 |
| 8. Add unit tests | 1h | Task 1 |
| 9. Update documentation | 30m | Task 1 |
| 10. Build and test | 15m | All |

**Total Estimated Effort**: ~6 hours

**Recommended Sprint Duration**: 1 day (allows for unforeseen issues and testing)

---

## Validation Checklist

Before marking this sprint complete:

- [ ] All implementation tasks completed
- [ ] All acceptance criteria met
- [ ] Build passes (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Manual testing in staging:
  - [ ] IRC ingress works
  - [ ] Egress works (sendText, sendWhisper, banUser)
  - [ ] Debug mode works (`!debug` command)
  - [ ] Broadcaster client works
  - [ ] Deduplication works
  - [ ] OAuth token refresh works
- [ ] Documentation updated
- [ ] Zero regressions identified
- [ ] Code reviewed (if applicable)
- [ ] PR created and merged

---

## Rollback Plan

If critical regressions are discovered:

1. **Phase 1 Rollback** (Adapter still registered but not used):
   - Keep adapter registered with `ConnectorManager`
   - Revert egress handler to use direct `this.twitchClient` reference
   - Investigation: Why did adapter introduce regression?

2. **Phase 2 Rollback** (Remove adapter completely):
   - Remove adapter registration from `ConnectorManager`
   - Remove adapter creation code
   - Keep `TwitchConnectorAdapter` file for future retry
   - Investigation: Fundamental design issue?

**Rollback Time**: < 15 minutes (adapter is non-destructive addition)

---

## Dependencies

- **No external dependencies**: This refactoring uses existing `TwitchIrcClient` and `ConnectorManager`
- **No schema changes**: No database or message format changes
- **No infrastructure changes**: No deployment or environment changes

---

## User Approval Required

**Approval Checklist**:
- [ ] User reviewed `technical-architecture.md`
- [ ] User reviewed `implementation-plan.md`
- [ ] User approved approach (create adapter, register, verify, migrate)
- [ ] User approved scope (adapter layer only, no EventSub webhooks)
- [ ] User approved timeline (1 day sprint)

**Next Steps After Approval**:
1. Update sprint status to `in-progress`
2. Begin Task 1: Create TwitchConnectorAdapter
3. Log all work in `request-log.md`
4. Create validation script in `validate_deliverable.sh`

---

**Sprint**: sprint-10-ee8bxg
**Status**: Awaiting User Approval
**Created**: 2026-08-11

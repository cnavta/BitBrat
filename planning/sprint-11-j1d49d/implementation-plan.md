# Implementation Plan: Discord Integration Modernization

**Sprint ID**: sprint-11-j1d49d
**Sprint Goal**: Migrate Discord connector to modern adapter pattern (Slack/Twitch alignment)
**Owner**: Lead Implementor
**Status**: Planning
**Created**: 2026-08-12

---

## Executive Summary

This sprint migrates the Discord integration from a monolithic client pattern to the modern connector adapter pattern established in Sprint 342+ (Slack) and Sprint 26+ (Twitch). The migration introduces architectural consistency, webhook support via Discord Interactions API, and runtime introspection capabilities.

### Business Value

- **Consistency**: Discord follows same architectural pattern as Slack and Twitch
- **Extensibility**: Enables Discord Interactions API (slash commands, buttons, modals)
- **Maintainability**: Separation of concerns between client and adapter layers
- **Observability**: Runtime introspection via `getMetadata()` for fleet management

### Effort Estimate

**Total**: 40-56 hours (5-7 working days)

### Risk Level

**Medium** - Requires careful refactoring of existing production code with hard cutover (no feature flags)

---

## Current State Analysis

### Existing Discord Implementation (Legacy Pattern)

**Location**: `src/services/ingress/discord/`

**Architecture**:
```
┌─────────────────────────────────────┐
│   DiscordIngressClient              │
│   (Monolithic - 370 lines)          │
│                                     │
│   - Implements IngressConnector     │
│   - Implements EgressConnector      │
│   - Connection management           │
│   - Message handling                │
│   - Egress logic                    │
│   - Token rotation                  │
└─────────────────────────────────────┘
```

**Key Files**:
- `discord-ingress-client.ts` - Monolithic client (370 lines)
- `envelope-builder.ts` - Class-based envelope builder
- `publisher.ts` - Publisher abstraction
- `index.ts` - Public exports

**Problems Identified**:
1. ❌ **No Connector Adapter** - Monolithic design mixes concerns
2. ❌ **No WebhookConnector Implementation** - Missing Discord Interactions API support
3. ❌ **No getMetadata()** - Missing runtime introspection
4. ❌ **Class-Based Envelope Builder** - Inconsistent with Slack/Twitch functional pattern
5. ❌ **No Debug Mode** - Missing `!debug` prefix support with RBAC
6. ❌ **No Deduplication** - Missing message ID-based cache

---

## Target State Architecture

### Modern Connector Pattern (Slack/Twitch Alignment)

```
┌─────────────────────────────────────┐
│   DiscordConnectorAdapter           │
│   (Implements IngressConnector +    │
│    WebhookConnector)                │
│                                     │
│   ┌─────────────────────────────┐   │
│   │  DiscordIngressClient       │   │
│   │  (Pure Discord.js wrapper)  │   │
│   │                             │   │
│   │  - Gateway connection       │   │
│   │  - Message handling         │   │
│   │  - Egress methods           │   │
│   └─────────────────────────────┘   │
│                                     │
│   ┌─────────────────────────────┐   │
│   │  Webhook Handler            │   │
│   │                             │   │
│   │  - Interactions API         │   │
│   │  - Signature verification   │   │
│   │  - SLA enforcement (<3s)    │   │
│   └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**New Files**:
- `connector-adapter.ts` - Adapter implementing IngressConnector + WebhookConnector
- `webhook-utils.ts` - Ed25519 signature verification helpers

**Modified Files**:
- `discord-ingress-client.ts` - Refactored to pure client (no interface implementations)
- `envelope-builder.ts` - Converted to functional pattern
- `index.ts` - Updated exports
- `src/apps/ingress-egress-service.ts` - Updated registration

---

## Implementation Phases

### Phase 1: Foundation (Low Risk, 1-2 days)

**Goal**: Set up infrastructure without touching production code

#### Stories:
- **DISC-001**: Refactor envelope builder to functional pattern
- **DISC-002**: Create webhook signature verification utilities
- **DISC-003**: Scaffold comprehensive test files

**Deliverables**:
- ✅ `envelope-builder.ts` - Functional `buildDiscordEnvelope()`
- ✅ `webhook-utils.ts` - Ed25519 signature verification
- ✅ Test scaffolds with comprehensive test cases

**Success Criteria**:
- Envelope builder is a pure function
- Signature verification follows Discord Ed25519 spec
- All test scaffolds compile without errors

---

### Phase 2: Core Migration (Medium Risk, 2-3 days)

**Goal**: Refactor existing client and introduce adapter layer

#### Stories:
- **DISC-004**: Extract DiscordIngressClient (pure client)
- **DISC-005**: Create DiscordConnectorAdapter
- **DISC-006**: Update service registration
- **DISC-007**: Implement getMetadata() with capabilities

**Deliverables**:
- ✅ Refactored `discord-ingress-client.ts` (pure client, no interface implementations)
- ✅ New `connector-adapter.ts` (adapter layer)
- ✅ Updated service registration in `ingress-egress-service.ts`
- ✅ Runtime introspection support via `getMetadata()`

**Success Criteria**:
- DiscordIngressClient is a pure Discord.js wrapper
- DiscordConnectorAdapter implements IngressConnector + WebhookConnector
- Service starts without errors
- Discord connector appears in manager.list()

---

### Phase 3: Enhancements (Low-Medium Risk, 1-2 days)

**Goal**: Add missing features from Slack/Twitch patterns

#### Stories:
- **DISC-008**: Add debug mode support (`!debug` prefix)
- **DISC-009**: Add message deduplication
- **DISC-010**: Implement Interactions API webhook handler
- **DISC-011**: Add webhook SLA enforcement

**Deliverables**:
- ✅ Debug mode with correlation ID tracking
- ✅ Deduplication cache with auto-cleanup
- ✅ Production-ready webhook handler
- ✅ SLA enforcement (<3 seconds response time)

**Success Criteria**:
- `!debug` prefix triggers debug mode with RBAC
- Duplicate messages are rejected
- Webhook handlers respond within 3 seconds
- Interactions API ping/command handling works

---

### Phase 4: Validation & Documentation (Zero Risk, 1 day)

**Goal**: Ensure quality and document changes

#### Stories:
- **DISC-012**: Complete test implementations
- **DISC-013**: Integration testing with live Discord bot
- **DISC-014**: Update CLAUDE.md documentation
- **DISC-015**: Create connector migration guide

**Deliverables**:
- ✅ Full test coverage (≥80%)
- ✅ Validated production deployment
- ✅ Updated documentation
- ✅ Migration guide for future connectors

**Success Criteria**:
- All tests pass (npm test)
- Live Discord bot integration successful
- Test coverage ≥ 80%
- Documentation approved

---

## Technical Implementation Details

### Story DISC-001: Refactor Envelope Builder

**Current (Class-based)**:
```typescript
export class DiscordEnvelopeBuilder implements EnvelopeBuilder<DiscordMessageMeta> {
  build(meta: DiscordMessageMeta, opts?): InternalEventV2 { ... }
}
```

**Target (Functional)**:
```typescript
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
  // Pure function implementation
}
```

**Changes**:
- Remove class wrapper
- Export pure function
- Support dependency injection (uuid, nowIso)
- Add debugMetadata support

**Files Modified**:
- `src/services/ingress/discord/envelope-builder.ts`

---

### Story DISC-002: Webhook Signature Verification

**Discord Signature Algorithm**: Ed25519 signature of `timestamp + body`

**Implementation**:
```typescript
export function validateDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: Buffer
): boolean {
  // Ed25519 verification using crypto.createVerify()
}
```

**Reference**: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization

**Files Created**:
- `src/services/ingress/discord/webhook-utils.ts`

---

### Story DISC-003: Test Scaffolding

**Test Files**:
1. `connector-adapter.test.ts` - IngressConnector interface tests
2. `connector-adapter-webhook.test.ts` - WebhookConnector interface tests
3. `webhook-utils.test.ts` - Signature verification tests

**Pattern**: Follow Slack test structure with comprehensive describe() blocks

---

### Story DISC-004: Extract DiscordIngressClient

**Refactoring Steps**:
1. Remove `implements IngressConnector, EgressConnector`
2. Keep public methods (start, stop, sendText, getSnapshot)
3. Update constructor to accept `buildDiscordEnvelope` function
4. Preserve token rotation logic
5. Preserve connection management

**Public API Preserved**:
- `start(): Promise<void>`
- `stop(): Promise<void>`
- `sendText(text: string, channelId?: string): Promise<void>`
- `banUser(platformUserId: string, reason?: string): Promise<void>`
- `getSnapshot(): ConnectorSnapshot`

**Files Modified**:
- `src/services/ingress/discord/discord-ingress-client.ts`

---

### Story DISC-005: Create DiscordConnectorAdapter

**Interface Implementation**:
```typescript
export class DiscordConnectorAdapter implements IngressConnector, WebhookConnector {
  constructor(
    private readonly client: DiscordIngressClient,
    private readonly config?: IConfig
  ) {}

  // IngressConnector (delegates to client)
  async start(): Promise<void> { await this.client.start(); }
  async stop(): Promise<void> { await this.client.stop(); }
  getSnapshot(): ConnectorSnapshot { return this.client.getSnapshot(); }
  async sendText(text: string, target?: string): Promise<void> { ... }

  // WebhookConnector
  verifySignature(req: WebhookRequest): boolean { ... }
  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> { ... }

  // Runtime introspection
  getMetadata(): ConnectorMetadata { ... }
}
```

**Files Created**:
- `src/services/ingress/discord/connector-adapter.ts`

---

### Story DISC-006: Update Service Registration

**Current**:
```typescript
const dClient = new DiscordIngressClient(dBuilder, dPublisher, cfg, { ... });
manager.register('discord', dClient);
```

**Target**:
```typescript
const dClient = new DiscordIngressClient(buildDiscordEnvelope, dPublisher, cfg, { ... });
manager.register('discord', new DiscordConnectorAdapter(dClient, cfg));
```

**Files Modified**:
- `src/apps/ingress-egress-service.ts`
- `src/services/ingress/discord/index.ts`

---

### Story DISC-007: Implement getMetadata()

**Capabilities Metadata**:
```typescript
getMetadata(): ConnectorMetadata {
  return {
    platform: 'discord',
    version: '1.0.0',
    authMethod: 'bot_token',
    capabilities: {
      ingress: {
        method: 'hybrid',  // Gateway (primary) + Interactions API (optional)
        realtime: true,
        requiresWebhook: false,
        requiresPublicUrl: false
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
```

**Files Modified**:
- `src/services/ingress/discord/connector-adapter.ts`

---

### Story DISC-008: Debug Mode Support

**Pattern**: Detect `!debug` prefix, perform RBAC check, attach metadata

**Implementation**:
```typescript
// In DiscordIngressClient.handleMessage()
let messageText = msg.content || '';
let debugAuthorized = false;
let debugCorrelationId: string | undefined;
const debugMatch = messageText.match(/^!debug\s+/i);

if (debugMatch) {
  messageText = messageText.slice(debugMatch[0].length);
  const userId = msg.author?.id || 'unknown';
  debugAuthorized = this.debugAuthorizedUsers.has(userId);

  if (debugAuthorized) {
    debugCorrelationId = crypto.randomUUID();

    await this.sendText(
      `🔍 *Debug mode ON*\n\`Correlation ID:\` \`${debugCorrelationId}\`\n_Watching event flow..._`,
      msg.channel?.id
    );
  }
}

const envelope = buildDiscordEnvelope(meta, {
  correlationId: debugCorrelationId,
  debugMetadata: debugAuthorized ? { enabled: true, initiatedBy: userId, ... } : undefined
});
```

**Files Modified**:
- `src/services/ingress/discord/discord-ingress-client.ts`

---

### Story DISC-009: Message Deduplication

**Pattern**: Cache message IDs in Set, auto-clear every 60 seconds

**Implementation**:
```typescript
private processedMessageIds: Set<string> = new Set();
private deduplicationCleanupInterval?: NodeJS.Timeout;

// In start():
this.deduplicationCleanupInterval = setInterval(() => {
  const size = this.processedMessageIds.size;
  this.processedMessageIds.clear();
  logger.debug('discord.client.dedup_cache_cleared', { previousSize: size });
}, 60000);

// In message handler:
if (this.processedMessageIds.has(msg.id)) {
  logger.warn('discord.client.message_deduplicated', { messageId: msg.id });
  this.counters.deduplicated++;
  return;
}
this.processedMessageIds.add(msg.id);
```

**Files Modified**:
- `src/services/ingress/discord/discord-ingress-client.ts`

---

### Story DISC-010: Interactions API Webhook Handler

**Discord Interaction Types**:
- **Type 1**: Ping (respond with `{ type: 1 }`)
- **Type 2**: Application Command (respond with `{ type: 4, data: { content } }`)

**Implementation**:
```typescript
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  const { type, data } = req.body;

  // Handle ping
  if (type === 1) {
    return { status: 200, body: { type: 1 } };
  }

  // Handle application command
  if (type === 2) {
    // IMPORTANT: Return 200 OK immediately (< 3-second SLA)
    setImmediate(async () => {
      const envelope = buildDiscordEnvelope({ ... });
      await this.publisher.publish(envelope);
    });

    return { status: 200, body: { type: 4, data: { content: 'Processing...' } } };
  }

  return { status: 400, body: { error: 'unsupported_interaction_type' } };
}
```

**Files Modified**:
- `src/services/ingress/discord/connector-adapter.ts`

---

### Story DISC-011: Webhook SLA Enforcement

**SLA**: Respond within 3 seconds (Discord/Slack/platform requirement)

**Pattern**:
```typescript
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  // Return 200 OK immediately
  setImmediate(async () => {
    // Heavy processing here (after response sent)
  });

  return { status: 200, body: { ... } };
}
```

**Files Modified**:
- `src/services/ingress/discord/connector-adapter.ts`

---

## Testing Strategy

### Unit Tests (80%+ Coverage)

**Files**:
- `connector-adapter.test.ts` - Adapter interface compliance
- `connector-adapter-webhook.test.ts` - Webhook handling
- `webhook-utils.test.ts` - Signature verification
- `discord-ingress-client.test.ts` - Client functionality

**Key Test Cases**:
- IngressConnector interface compliance
- WebhookConnector interface compliance
- Signature verification (valid/invalid)
- Debug mode RBAC enforcement
- Message deduplication
- Webhook SLA enforcement (<3s)
- getMetadata() accuracy

### Integration Tests

**Live Discord Bot Testing**:
1. ✅ Bot connects successfully
2. ✅ Messages processed correctly
3. ✅ Debug mode works (`!debug` prefix)
4. ✅ Egress responses delivered
5. ✅ No errors in production logs
6. ✅ Deduplication works (send same message twice)
7. ✅ Webhook ping handling (if webhook URL configured)

**Validation Checklist**:
- [ ] Start ingress-egress service locally
- [ ] Connect Discord bot to test server
- [ ] Send normal messages
- [ ] Send `!debug` messages (authorized user)
- [ ] Send `!debug` messages (unauthorized user)
- [ ] Verify envelope structure in logs
- [ ] Verify egress delivery
- [ ] Test webhook ping (if applicable)

---

## Risk Mitigation

### Hard Cutover Strategy

**No feature flags** - Clean transition in single PR

**Mitigation**:
1. **Backward Compatibility**: Maintain same public API surface
2. **Comprehensive Testing**: 80%+ coverage + live bot testing before merge
3. **Branch Isolation**: All changes in feature branch, validated before PR
4. **Monitoring**: Detailed logging for adapter and webhook operations

### Rollback Plan

If production issues arise after merge:
1. **Immediate**: Revert PR on main branch
2. **Investigation**: Analyze logs for failure mode
3. **Fix**: Address issue in feature branch
4. **Re-validate**: Full testing cycle before re-merge

---

## Success Criteria

### Functional Requirements

- ✅ Discord connector implements IngressConnector + WebhookConnector
- ✅ Webhook signature verification works (Ed25519)
- ✅ Debug mode (`!debug` prefix) with RBAC
- ✅ Message deduplication (ID-based)
- ✅ getMetadata() returns accurate capabilities
- ✅ Zero breaking changes for existing Discord functionality

### Non-Functional Requirements

- ✅ Webhook responses < 3 seconds (SLA enforcement)
- ✅ Test coverage ≥ 80% (unit + integration)
- ✅ Documentation updated (CLAUDE.md, migration guide)
- ✅ Production deployment validated

### Validation Criteria

- ✅ All tests pass (`npm test`)
- ✅ Live Discord bot integration successful
- ✅ Fleet introspection works (`brat fleet info discord`)
- ✅ PR review approved

---

## Dependencies

### External Dependencies

- **discord.js**: Current version (no changes required)
- **crypto**: Node.js built-in (Ed25519 signature verification)

### Internal Dependencies

- **IngressConnector interface**: `src/services/ingress/core/interfaces.ts`
- **WebhookConnector interface**: `src/services/ingress/core/interfaces.ts`
- **ConnectorMetadata interface**: `src/services/ingress/core/interfaces.ts`
- **Slack pattern reference**: `src/services/ingress/slack/`
- **Twitch pattern reference**: `src/services/ingress/twitch/`

---

## File Changes Summary

### Files to Create

1. `src/services/ingress/discord/connector-adapter.ts` - Adapter implementation
2. `src/services/ingress/discord/webhook-utils.ts` - Signature verification
3. `src/services/ingress/discord/__tests__/connector-adapter.test.ts` - Adapter tests
4. `src/services/ingress/discord/__tests__/connector-adapter-webhook.test.ts` - Webhook tests
5. `src/services/ingress/discord/__tests__/webhook-utils.test.ts` - Signature tests
6. `documentation/guides/connector-migration-pattern.md` - Migration guide

### Files to Modify

1. `src/services/ingress/discord/discord-ingress-client.ts` - Refactor to pure client
2. `src/services/ingress/discord/envelope-builder.ts` - Convert to functional
3. `src/services/ingress/discord/index.ts` - Update exports
4. `src/apps/ingress-egress-service.ts` - Update registration
5. `CLAUDE.md` - Add Discord pattern documentation

### Files to Delete

None (all existing files are refactored, not replaced)

---

## Execution Timeline

### Day 1-2: Phase 1 (Foundation)
- DISC-001: Envelope builder refactor
- DISC-002: Webhook utils
- DISC-003: Test scaffolding

### Day 3-5: Phase 2 (Core Migration)
- DISC-004: Extract client
- DISC-005: Create adapter
- DISC-006: Update registration
- DISC-007: getMetadata()

### Day 5-6: Phase 3 (Enhancements)
- DISC-008: Debug mode
- DISC-009: Deduplication
- DISC-010: Webhook handler
- DISC-011: SLA enforcement

### Day 7: Phase 4 (Validation)
- DISC-012: Complete tests
- DISC-013: Integration testing
- DISC-014: Update CLAUDE.md
- DISC-015: Migration guide

---

## References

- **Sprint 342**: Slack connector pattern (modern reference)
- **Sprint 26**: Twitch connector pattern (WebSocket-only reference)
- **Discord Docs**: https://discord.com/developers/docs/interactions/receiving-and-responding
- **CLAUDE.md**: Webhook pattern section
- **architecture.yaml**: Service definitions

---

## Approval Required

This implementation plan requires user approval before proceeding to execution phase.

**Plan Status**: ⏳ Awaiting Approval

Once approved, sprint status will transition to `in-progress`.

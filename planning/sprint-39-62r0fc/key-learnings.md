# Sprint 39 Key Learnings

**Sprint ID**: sprint-39-62r0fc
**Title**: Dev MCP Messaging Tools
**Date**: 2026-09-02

## Overview

This document captures architectural decisions, technical insights, and best practices discovered during Sprint 39 implementation. These learnings inform future development and serve as reference for similar features.

## Architectural Learnings

### 1. Permission-Gated Event Injection Pattern

**Context**: Needed to allow dev tools to inject events while preventing abuse.

**Solution**: Two-tier security model:
1. **Authentication**: WebSocket connection with Bearer token
2. **Authorization**: Permission check for `event:inject` before processing

**Key Insight**: Separating authentication from authorization enables fine-grained control. Dev tokens auto-granted permissions via pattern matching (`brat-dev-mcp:*`) provides developer convenience without compromising security.

**Implementation**:
```typescript
// src/services/api-gateway/ingress.ts:149-162
if (!permissions || !permissions.includes('event:inject')) {
  throw new Error('Permission denied: requires event:inject');
}

if (userId === 'anonymous') {
  throw new Error('Not available for anonymous connections');
}
```

**Future Applications**:
- Admin-only tools (deploy, config changes)
- Rate-limited operations (bulk message sending)
- Environment-specific features (staging-only debugging tools)

### 2. Dual Identity Audit Logging

**Context**: Event injection emulates other users/platforms. Need to track both real and emulated identity for security.

**Solution**: Audit logs capture both identities:
```typescript
// src/services/api-gateway/ingress.ts:261-269
this.logger.info('ingress.event_inject', {
  realUserId: 'brat-dev-mcp:chat',      // Who made the request
  emulatedIdentity: 'discord-user-123',  // Who they're pretending to be
  emulatedPlatform: 'discord',           // What platform they're emulating
  permissions: ['event:inject']
});
```

**Key Insight**: Security auditing for emulation requires tracking TWO identities. Single identity logging would lose attribution or emulation context.

**Future Applications**:
- Admin impersonation (support troubleshooting)
- Load testing (simulating many users)
- Replay attacks (reproducing user behavior for debugging)

### 3. Connector Whitelist Validation

**Context**: Prevent malicious users from forging connectors to bypass platform-specific logic.

**Solution**: Hardcoded whitelist of allowed connectors:
```typescript
// src/services/api-gateway/ingress.ts:191-203
const allowedConnectors = ['api', 'discord', 'twitch', 'twilio', 'slack'];
if (!allowedConnectors.includes(providedConnector)) {
  throw new Error(`Invalid connector: "${providedConnector}"`);
}
```

**Key Insight**: Connector validation is security-critical. Without it, users could forge `connector: 'admin'` or `connector: 'system'` to bypass authorization checks in downstream services.

**Trade-off**: Requires code change to add new platforms (not configurable). Acceptable because platforms are architectural decisions, not runtime configuration.

**Future Applications**:
- MCP tool visibility filtering (platform+domain vs platform-only)
- Rate limiting per platform
- Platform-specific feature flags

### 4. Routing Slip Immutability

**Context**: Event injection allows custom events. Must prevent routing slip manipulation to bypass agent flow stages.

**Solution**: Always overwrite routing slip, ignore user-provided value:
```typescript
// src/services/api-gateway/ingress.ts:252-257
routing: {
  stage: 'initial',
  slip: [],           // ALWAYS empty on ingress
  history: [],        // ALWAYS empty on ingress
}
```

**Key Insight**: Trust nothing from user input on security-critical metadata. Routing slip controls which services process the event—must be owned by event-router, not the client.

**Security Test**: ingress-security.test.ts:228-247 validates malicious routing slip rejected.

**Future Applications**:
- Any user-controlled metadata that affects authorization/routing
- Message priority manipulation
- Service targeting attacks

### 5. Platform Preset Abstraction

**Context**: Each platform (Discord, Twitch, Slack) has different metadata conventions.

**Solution**: Single function returns platform-specific defaults:
```typescript
// tools/brat/src/dev-mcp/tools/messaging.ts:68-158
export function buildPlatformPreset(platform: string, userId?: string): PlatformPreset {
  switch (platform.toLowerCase()) {
    case 'discord': return { connector: 'discord', source: 'ingress.discord', ... };
    case 'twitch': return { connector: 'twitch', source: 'ingress.twitch', ... };
    // ...
  }
}
```

**Key Insight**: Abstracting platform differences into presets makes:
- Adding platforms trivial (one new case statement)
- Testing comprehensive (test each preset independently)
- User experience consistent (same API for all platforms)

**Design Decision**: Chose switch statement over configuration file because:
- Type safety (TypeScript validates return type)
- Code completion (IDE suggests available platforms)
- Test coverage (dead code detection for missing platforms)

**Future Applications**:
- Email platform support
- Webhook platform support
- Custom platform definitions

## Technical Learnings

### 6. WebSocket Response Correlation Pattern

**Context**: Single WebSocket connection, multiple concurrent requests. Need to match responses to requests.

**Solution**: Map of pending requests by correlationId:
```typescript
// tools/brat/src/dev-mcp/api-gateway-client.ts:69-86
private pendingResponses: Map<string, {
  resolve: (event: InternalEventV2) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}>;

// When sending request
this.pendingResponses.set(correlationId, { resolve, reject, timeout });

// When receiving response
const pending = this.pendingResponses.get(correlationId);
pending.resolve(event);
```

**Key Insight**: Stateful correlation requires:
1. Unique request ID (correlationId)
2. Pending request tracking (Map)
3. Timeout mechanism (NodeJS.Timeout)
4. Cleanup on disconnect (prevent memory leaks)

**Learned the Hard Way**: Initial implementation forgot cleanup on disconnect → memory leak. Fixed with `cleanupPendingResponses()` in disconnect handler.

**Future Applications**:
- Any request/response over persistent connection
- GraphQL subscriptions
- gRPC streaming

### 7. Connection Caching with Health Checks

**Context**: Creating new WebSocket connections for every message is expensive.

**Solution**: Cache connection in connection object, reuse across calls:
```typescript
// tools/brat/src/dev-mcp/tools/messaging.ts:241-248
if (connection.gateway?.client) {
  if (connection.gateway.client.isClientConnected()) {
    return connection.gateway.client;  // Reuse
  }
  connection.gateway.client = undefined;  // Stale, clear cache
}
```

**Key Insight**: Caching requires health checking. Cached connection might be disconnected (server restart, network blip). Must verify `isConnected()` before reusing.

**Alternative Considered**: Auto-reconnect on send failure. Rejected because:
- Adds complexity (reconnection logic)
- Delays first message (timeout + reconnect)
- User loses transparency (are we connected or not?)

**Better Approach**: Health check + create new connection if stale.

**Future Applications**:
- Database connection pooling
- Redis connection caching
- HTTP client keep-alive

### 8. Fail-Open vs Fail-Closed for Non-Critical Features

**Context**: Snapshot publishing (claim check pattern) is useful but non-critical. Should failures block message delivery?

**Decision**: Fail-open (warn and continue):
```typescript
// src/services/api-gateway/ingress.ts:296-302
try {
  await publishPersistenceSnapshot(...);
} catch (snapshotErr: any) {
  // Fail-open: snapshot failures don't block ingress
  this.logger.warn('snapshot.publish_error', { error: snapshotErr.message });
}
```

**Key Insight**: Distinguish critical vs non-critical operations:
- **Critical** (fail-closed): Permission checks, connector validation, message delivery
- **Non-critical** (fail-open): Audit logging, metrics, snapshot publishing

**Trade-off**: Failing open for snapshots means some events won't be retrievable via claim check. Acceptable because claim check is debugging tool, not core functionality.

**Test**: ingress-security.test.ts:385-402 validates fail-open behavior.

**Future Applications**:
- Analytics collection
- Feature flags
- A/B testing

### 9. TypeScript Union Type Handling in Tests

**Context**: MCP protocol uses union types for content (TextContent | ImageContent | ResourceContent).

**Challenge**: TypeScript can't prove `content[0].text` exists without type guard.

**Solution**: Explicit type checking before access:
```typescript
// tools/brat/src/dev-mcp/__tests__/messaging-e2e.test.ts:68-70
const content = result.content[0];
if (content.type !== 'text') throw new Error('Expected text content');
const response = JSON.parse(content.text);  // Now TypeScript knows .text exists
```

**Key Insight**: Union types require explicit type narrowing. Options:
1. Type guards (`if (content.type === 'text')`)
2. Type assertions (`as TextContent`) - unsafe
3. Helper functions (`extractText(content)`) - best for reuse

**Learned**: Type assertions (`as`) bypass TypeScript safety. Only use when you KNOW the type (e.g., test fixtures).

**Future Applications**:
- Any union type handling
- Event type discrimination
- API response parsing

### 10. Environment Variable Precedence for Flexibility

**Context**: Token acquisition needs multiple sources (cache, env var, generated).

**Solution**: Cascading precedence:
```typescript
// tools/brat/src/dev-mcp/tools/messaging.ts:179-222
// 1. Check cache
if (connection.gateway?.authToken) return cached;

// 2. Check env vars
const envToken = process.env.DEV_MCP_AUTH_TOKEN || process.env.BITBRAT_AUTH_TOKEN;
if (envToken) return envToken;

// 3. Generate for agent-dev contexts
if (contextName.startsWith('agent-dev-')) return generated;

// 4. Error for production
throw new Error('Token required');
```

**Key Insight**: Precedence order matters:
- **Cache first** (fastest, avoids filesystem access)
- **Env vars second** (explicit user configuration)
- **Auto-generate third** (convenience for dev)
- **Error last** (fail-safe for production)

**Design Decision**: Auto-generate ONLY for agent-dev contexts. Production requires explicit token to prevent accidental misconfiguration.

**Future Applications**:
- Any multi-source configuration
- Database connection strings
- API endpoint URLs

## Testing Learnings

### 11. Security Testing Before Implementation

**Context**: Security vulnerabilities are expensive to fix post-deployment.

**Solution**: Write security tests before/during implementation:
1. Write test for permission check
2. Implement permission check to make test pass
3. Write test for bypass attempt
4. Verify test fails (bypass blocked)

**Key Insight**: Security tests should fail if security is broken. Writing tests first ensures you're testing the right thing.

**Example**: ingress-security.test.ts written concurrently with handleEventInject() implementation. Caught edge cases during development:
- Anonymous user rejection
- Empty permissions array
- Permission check order (must check permission before processing)

**Future Applications**:
- Authentication testing
- Authorization testing
- Input validation testing

### 12. Platform-Specific Test Data

**Context**: Different platforms have different ID formats (Discord: numeric, Slack: U-prefix, Twilio: phone number).

**Solution**: Platform tests use realistic test data:
```typescript
// tools/brat/src/dev-mcp/__tests__/platform-emulation-integration.test.ts:115-130
expect(presets.twitch.identity?.external?.id).toMatch(/^[a-z_]+$/);  // snake_case
expect(presets.slack.identity?.external?.id).toMatch(/^U[A-Z0-9]+$/);  // Slack format
expect(presets.twilio.identity?.external?.id).toMatch(/^\+1555/);  // Phone format
```

**Key Insight**: Test data should mirror production data format. Unrealistic test data might pass tests but fail in production.

**Caught Bug**: Twilio test revealed egress.destination not using userId parameter. Would have been missed with generic test data.

**Future Applications**:
- Platform integration testing
- Data migration validation
- Schema validation

### 13. Skippable Integration Tests Pattern

**Context**: E2E tests require running services. CI/CD might not have them.

**Solution**: Conditional test suites:
```typescript
// tools/brat/src/dev-mcp/__tests__/messaging-e2e.test.ts:28-32
const API_GATEWAY_URL = process.env.API_GATEWAY_URL;
const describeIf = API_GATEWAY_URL ? describe : describe.skip;

describeIf('Messaging Tools E2E', () => {
  // Tests only run if API_GATEWAY_URL set
});
```

**Key Insight**: Integration tests should:
- Skip gracefully when dependencies unavailable
- Print helpful instructions for running
- Not break CI/CD pipeline

**Trade-off**: Skipped tests don't provide coverage. Mitigation:
- Unit tests cover critical logic
- Developer runs E2E tests locally before merge
- Staging environment runs E2E tests post-deploy

**Future Applications**:
- Database integration tests
- External API integration tests
- Performance benchmarks

## Documentation Learnings

### 14. Quick Start First, Details Later

**Context**: Users want to get started quickly, not read 400 lines first.

**Solution**: 3-step quick start at top of user guide:
```markdown
## Quick Start

### 1. Deploy api-gateway
npm run brat -- bit deploy api-gateway

### 2. Send a test message
message.send({ text: 'Hello, world!' })

### 3. Verify in logs
npm run brat -- fleet logs api-gateway
```

**Key Insight**: Users learn best by doing. Quick start should:
- Get user to success in <5 minutes
- Show minimal example (no optional parameters)
- Provide immediate feedback (verify step)

**Future Applications**:
- All feature documentation
- README files
- Tutorial content

### 15. Troubleshooting Sections Reduce Support Burden

**Context**: Predictable issues will generate support requests.

**Solution**: Comprehensive troubleshooting section with:
- Error message verbatim (exact text users will see)
- Root causes (why it happens)
- Step-by-step solutions (how to fix)

**Example**:
```markdown
**Error**: `Invalid connector: "xxx"`

**Solution:** Use only supported connectors:
❌ Bad: { connector: 'custom-platform' }
✅ Good: { connector: 'discord' }
```

**Key Insight**: Good troubleshooting docs should be:
- Searchable (include exact error text)
- Actionable (specific steps, not vague advice)
- Visual (code examples showing wrong vs right)

**Measured Impact**: Unknown (sprint just completed), but industry best practice.

**Future Applications**:
- All feature documentation
- Error message design
- Support bot training data

## Process Learnings

### 16. Todo List for Sprint Tracking

**Context**: Sprint has 34 tasks across 4 phases. Need to track progress.

**Solution**: TodoWrite tool with status tracking:
```typescript
TodoWrite({
  todos: [
    { content: "Task 1", status: "completed" },
    { content: "Task 2", status: "in_progress" },
    { content: "Task 3", status: "pending" }
  ]
})
```

**Key Insight**: Visual progress tracking keeps sprint on track:
- Know what's done vs pending
- Identify blockers early
- Maintain momentum (visible progress motivates)

**Benefit**: Completed sprint in 1 day vs estimated 5 days. Todo list prevented task loss and maintained focus.

**Future Applications**:
- All future sprints
- Daily task planning
- Multi-day projects

### 17. Commit Early, Commit Often (With Good Messages)

**Context**: Sprint generated 20 file changes. Risk of losing work.

**Solution**: Single comprehensive commit at sprint completion with detailed message.

**Key Insight**: Commit message quality matters:
- **Good**: Explains what, why, and how
- **Bad**: "fixes", "updates", "wip"

**Pattern Used**:
```
feat(component): One-line summary

Multi-paragraph body explaining:
- What changed
- Why it changed
- How it works
- Testing done
- Breaking changes (if any)

🤖 Generated with Claude Code
Co-Authored-By: Claude
```

**Future Applications**:
- All commits
- Pull request descriptions
- Release notes

## Architectural Decisions Record

### ADR-1: WebSocket vs HTTP for Message Sending

**Decision**: Use WebSocket for persistent connection, not HTTP requests.

**Context**: Need to send messages to api-gateway and receive responses.

**Options**:
1. HTTP POST requests (stateless)
2. WebSocket connection (stateful)

**Decision**: WebSocket

**Rationale**:
- Bi-directional (server can push responses)
- Lower latency (no connection overhead per message)
- Matches api-gateway's existing architecture
- Supports future streaming (progress updates)

**Trade-offs**:
- More complex (connection management, timeouts)
- Stateful (must handle disconnect/reconnect)

**Status**: Implemented and working well

### ADR-2: Platform Presets vs User Configuration

**Decision**: Hardcoded platform presets in code, not configurable.

**Context**: Each platform has different metadata (connector, source, identity format).

**Options**:
1. Configuration file (YAML/JSON)
2. Hardcoded functions (switch statement)

**Decision**: Hardcoded functions

**Rationale**:
- Type safety (TypeScript validates structure)
- Code completion (IDE suggests platforms)
- Compile-time errors (missing fields caught early)
- Easier to test (unit tests per platform)

**Trade-offs**:
- Requires code change to add platforms
- Less flexible for end users

**Acceptable because**: Platforms are architectural decisions (not runtime config). Adding platforms should go through code review.

**Status**: Implemented, works excellently

### ADR-3: Auto-Grant event:inject for Dev Tokens

**Decision**: Pattern-based auto-grant for `brat-dev-mcp:*` and `dev-tools:*` users.

**Context**: Dev tools need event:inject permission. Requiring manual database insert creates friction.

**Options**:
1. Manual permission grant (INSERT into database)
2. Auto-grant for all authenticated users
3. Auto-grant for dev token patterns

**Decision**: Auto-grant for dev token patterns

**Rationale**:
- Developer convenience (zero-config setup)
- Security maintained (pattern is specific)
- Production safe (real users don't match pattern)
- Auditable (logs show permission source)

**Trade-offs**:
- "Magic" behavior (not explicit in database)
- Pattern could be guessed by attackers

**Mitigation**: Pattern is well-documented, logs show auto-grant, anonymous users blocked.

**Status**: Implemented and tested

## Future Work

Based on learnings from Sprint 39, consider for future sprints:

1. **E2E Test Environment in CI/CD** - Add GitHub Actions workflow to provision agent-dev and run E2E tests automatically.

2. **MCP Tool Usage Analytics** - Track which tools are used most, identify adoption patterns.

3. **More Platform Emulations** - Add Matrix, Telegram, WhatsApp presets using same pattern.

4. **Message Replay Tool** - Allow replaying messages from claim check for debugging.

5. **Bulk Message Sending** - Support sending multiple messages in one call for load testing.

6. **Response Streaming** - Support streaming responses for long-running operations (LLM inference).

7. **WebSocket Reconnection Logic** - Auto-reconnect with exponential backoff if connection lost.

8. **Token Rotation** - Support rotating auth tokens without reconnecting.

## Conclusion

Sprint 39 delivered high-quality, production-ready tooling with excellent test coverage and documentation. Key success factors:

1. **Clear architecture before coding**
2. **Security-first mindset**
3. **Comprehensive testing at all layers**
4. **Documentation as you go**
5. **Incremental validation**

These learnings inform future development and establish patterns for similar features.

---

**Document Author**: Claude (AI Coding Agent)
**Date**: 2026-09-02
**Sprint**: Sprint 39 (sprint-39-62r0fc)

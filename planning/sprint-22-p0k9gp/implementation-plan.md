# Implementation Plan: Agent Progress Update MCP Tool
## Sprint 22 (sprint-22-p0k9gp)

**Lead Implementor**: Claude Code
**Created**: 2026-08-21
**Status**: Planning → Ready for Execution

---

## Executive Summary

This implementation plan breaks down the agent progress update MCP tool into concrete, actionable tasks with clear dependencies, acceptance criteria, and risk mitigation strategies. The implementation follows a bottom-up approach: core infrastructure first, then integration, then testing and validation.

**Total Estimated Effort**: 1.5-2 days (12-16 hours)
**Critical Path**: Phase 1 → Phase 2 → Phase 5 → Phase 6
**Risk Level**: Low (leveraging existing infrastructure, additive changes only)
**Scope**: Core tool infrastructure only - no agent integration or egress enhancements

---

## Table of Contents

1. [Implementation Phases](#1-implementation-phases)
2. [Detailed Task Breakdown](#2-detailed-task-breakdown)
3. [Dependency Graph](#3-dependency-graph)
4. [Risk Assessment](#4-risk-assessment)
5. [Acceptance Criteria](#5-acceptance-criteria)
6. [Testing Strategy](#6-testing-strategy)
7. [Validation Checklist](#7-validation-checklist)

---

## 1. Implementation Phases

### Phase Overview

```
Phase 1: Core Tool Implementation (4.5 hours)
  ├─ Tool schema definition
  ├─ Handler implementation
  ├─ Session context extraction
  └─ Basic logging

Phase 2: Event Building & Routing (5 hours)
  ├─ Progress event builder
  ├─ Candidate pattern implementation
  ├─ Empty slip routing validation
  └─ Error handling

Phase 5: Testing & Documentation (5 hours)
  ├─ Unit test suite
  ├─ Integration tests
  ├─ Agent-dev validation (tool registration only)
  └─ Documentation updates

Phase 6: Sprint Completion (2.5 hours)
  ├─ Code review and cleanup
  ├─ Sprint artifacts
  └─ Pull request
```

**Total**: 12.5-16 hours (1.5-2 days)

### Out of Scope (Removed from Sprint)

```
Phase 3: Egress Enhancement
  - Annotation detection
  - Urgency-based delivery
  - Connector-specific testing

Phase 4: Agent Integration
  - llm-bot integration
  - Time estimation heuristics
  - Real-world user scenarios
```

**Rationale**: Focus on tool infrastructure; agents can integrate in future sprints

### Critical Path

```
Phase 1 (MUST) → Phase 2 (MUST) → Phase 5 (MUST) → Phase 6 (MUST)
```

---

## 2. Detailed Task Breakdown

### Phase 1: Core Tool Implementation

**Goal**: Establish platform-internal tool infrastructure on tool-gateway

**Duration**: 4-6 hours

#### Task 1.1: Create Tool Schema (30 min)

**File**: `src/apps/tool-gateway.ts`

**Implementation**:
```typescript
import { z } from 'zod';

const SendProgressUpdateSchema = z.object({
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(500, 'Message too long (max 500 chars)')
    .describe('Progress message to display to user'),

  context: z.record(z.any())
    .optional()
    .describe('Optional metadata for logging/observability'),

  emoji: z.string()
    .optional()
    .describe('Optional emoji override (default: 🔄)'),

  urgency: z.enum(['low', 'normal', 'high'])
    .optional()
    .default('normal')
    .describe('Message urgency level')
});

type SendProgressUpdateArgs = z.infer<typeof SendProgressUpdateSchema>;
```

**Acceptance Criteria**:
- [ ] Schema accepts valid messages (1-500 chars)
- [ ] Schema rejects empty messages
- [ ] Schema rejects messages >500 chars
- [ ] Optional fields work correctly (context, emoji, urgency)
- [ ] TypeScript types inferred correctly

**Testing**:
```bash
# Run schema validation tests
npm test -- tool-gateway-progress-tool.test.ts -t "Schema Validation"
```

---

#### Task 1.2: Implement registerPlatformTools() Method (1 hour)

**File**: `src/apps/tool-gateway.ts`

**Implementation**:
```typescript
export class ToolGatewayServer extends Bit {
  constructor() {
    super({ serviceName: 'tool-gateway', mcpExposure: 'platform+domain' });
    this.setupApp(this.getApp() as any);
  }

  async setup() {
    // Register platform-internal tools BEFORE registry watcher
    this.registerPlatformTools();

    // Initialize MCP Registry Watcher (existing)
    this.registryWatcher = new RegistryWatcher(this as any, { ... });

    // Rest of existing setup...
  }

  /**
   * Register platform-internal MCP tools (direct handlers, not proxied).
   *
   * Platform-internal tools provide agent orchestration capabilities like
   * progress updates, approval requests, escalation, etc. They are distinct
   * from domain tools which are proxied from other Bits.
   */
  private registerPlatformTools(): void {
    this.getLogger().info('tool_gateway.platform_tools.registering');

    // Platform tool: Progress updates
    this.registerTool(
      'agent.sendProgressUpdate',
      'Send progress update to user before long-running operation',
      SendProgressUpdateSchema,
      this.handleSendProgressUpdate.bind(this)
    );

    this.getLogger().info('tool_gateway.platform_tools.registered', {
      count: 1,
      tools: ['agent.sendProgressUpdate']
    });

    // Future platform tools:
    // - agent.requestApproval
    // - agent.escalateToHuman
    // - platform.rateLimit.check
  }
}
```

**Acceptance Criteria**:
- [ ] `registerPlatformTools()` called before registry watcher
- [ ] Tool registered with correct name: `agent.sendProgressUpdate`
- [ ] Tool appears in tool registry
- [ ] Logs show platform tool registration
- [ ] No breaking changes to existing tool-gateway behavior

**Testing**:
```bash
# Verify tool registration
npm run brat -- fleet info tool-gateway | grep "agent.sendProgressUpdate"
```

---

#### Task 1.3: Implement Tool Handler Stub (1 hour)

**File**: `src/apps/tool-gateway.ts`

**Implementation**:
```typescript
/**
 * Handle agent.sendProgressUpdate tool call.
 *
 * Extracts session context to get the original event, builds a progress
 * event with the message as a candidate, and routes via next() to respect
 * platform safeguards.
 *
 * @param args - Tool arguments (message, context, emoji, urgency)
 * @param extra - MCP session metadata (sessionId)
 * @returns Tool result indicating success or graceful failure
 */
private async handleSendProgressUpdate(
  args: SendProgressUpdateArgs,
  extra?: { sessionId?: string }
): Promise<CallToolResult> {
  const logger = this.getLogger();

  logger.info('agent.sendProgressUpdate.called', {
    message: args.message,
    contextKeys: Object.keys(args.context || {}),
    emoji: args.emoji,
    urgency: args.urgency,
    sessionId: extra?.sessionId
  });

  // STUB: Implementation in Phase 2
  return {
    content: [{
      type: 'text',
      text: `[STUB] Progress update would send: "${args.message}"`
    }]
  };
}
```

**Acceptance Criteria**:
- [ ] Handler accepts correct arguments
- [ ] Handler returns CallToolResult
- [ ] Logs show tool invocation
- [ ] Stub returns placeholder response
- [ ] No runtime errors when called

**Testing**:
```bash
# Test handler via MCP call (stub response expected)
# Will implement full test in Phase 2
```

---

#### Task 1.4: Add Session Context Extraction (2 hours)

**File**: `src/apps/tool-gateway.ts`

**Implementation**:
```typescript
private async handleSendProgressUpdate(
  args: SendProgressUpdateArgs,
  extra?: { sessionId?: string }
): Promise<CallToolResult> {
  const logger = this.getLogger();

  logger.info('agent.sendProgressUpdate.called', {
    message: args.message,
    sessionId: extra?.sessionId
  });

  // 1. Extract session context
  const sessionId = extra?.sessionId;
  if (!sessionId) {
    logger.warn('agent.sendProgressUpdate.missing_session_id', {
      message: args.message
    });
    return {
      content: [{
        type: 'text',
        text: 'Warning: No session ID provided. Progress update not sent.'
      }],
      isError: false // Graceful degradation
    };
  }

  const session = this.sessionContexts.get(sessionId);
  if (!session) {
    logger.warn('agent.sendProgressUpdate.session_not_found', {
      sessionId,
      message: args.message,
      availableSessions: this.sessionContexts.size
    });
    return {
      content: [{
        type: 'text',
        text: 'Warning: Session not found. Progress update not sent.'
      }],
      isError: false
    };
  }

  // 2. Extract original event from session
  const originalEvent = session.currentEvent;
  if (!originalEvent) {
    logger.warn('agent.sendProgressUpdate.missing_event', {
      sessionId,
      bitName: session.bitName,
      message: args.message
    });
    return {
      content: [{
        type: 'text',
        text: 'Warning: No event in session context. Progress update not sent.'
      }],
      isError: false
    };
  }

  // 3. Validate egress destination exists
  if (!originalEvent.egress?.destination) {
    logger.warn('agent.sendProgressUpdate.missing_egress', {
      correlationId: originalEvent.correlationId,
      sessionId,
      message: args.message
    });
    return {
      content: [{
        type: 'text',
        text: 'Warning: No egress destination. Progress update not sent.'
      }],
      isError: false
    };
  }

  logger.debug('agent.sendProgressUpdate.context_extracted', {
    sessionId,
    bitName: session.bitName,
    correlationId: originalEvent.correlationId,
    connector: originalEvent.egress.connector,
    destination: originalEvent.egress.destination
  });

  // STUB: Event building in Phase 2
  return {
    content: [{
      type: 'text',
      text: `Progress update ready for: ${originalEvent.egress.destination}`
    }]
  };
}
```

**Acceptance Criteria**:
- [ ] Validates sessionId presence
- [ ] Extracts session from `sessionContexts` map
- [ ] Validates event presence in session
- [ ] Validates egress destination
- [ ] Returns graceful warnings for all failure cases
- [ ] Logs at appropriate levels (info, warn, debug)
- [ ] Never throws exceptions

**Testing**:
```bash
# Unit test: Missing session ID
# Unit test: Session not found
# Unit test: Missing event
# Unit test: Missing egress
npm test -- tool-gateway-progress-tool.test.ts -t "Error Handling"
```

---

### Phase 2: Event Building & Routing

**Goal**: Build progress event and route through platform safeguards

**Duration**: 4-6 hours

#### Task 2.1: Implement Progress Event Builder (2 hours)

**File**: `src/apps/tool-gateway.ts`

**Implementation**:
```typescript
/**
 * Build progress event from original event and tool arguments.
 *
 * Creates InternalEventV2 with:
 * - Progress message as candidate (not message field)
 * - Empty routing slip (signals "route to egress")
 * - progress_update annotation for observability
 * - Preserved ingress/identity/egress from original
 *
 * @param originalEvent - Event that triggered the agent
 * @param args - Tool arguments
 * @returns Progress event ready for next()
 */
private buildProgressEvent(
  originalEvent: InternalEventV2,
  args: SendProgressUpdateArgs
): InternalEventV2 {
  // Build progress message text
  const emoji = args.emoji || '🔄';
  const progressText = `${emoji} ${args.message}`;

  // Create progress event
  const progressEvent: InternalEventV2 = {
    v: '2',
    correlationId: randomUUID(), // New correlation for progress
    type: 'chat.message.v1',

    // Preserve original ingress context
    ingress: {
      ...originalEvent.ingress,
      ingressAt: new Date().toISOString() // Progress event timestamp
    },

    // Preserve original identity
    identity: originalEvent.identity,

    // Preserve original egress destination
    egress: originalEvent.egress,

    // Routing: Empty slip = route to egress
    routing: {
      stage: 'response',
      slip: [],  // CRITICAL: Empty slip signals "route to egress"
      history: []
    },

    // Progress message as candidate (standard platform pattern)
    candidates: [
      {
        id: randomUUID(),
        kind: 'text',
        source: 'tool-gateway',
        createdAt: new Date().toISOString(),
        status: 'proposed', // Will be marked 'selected' by next()
        priority: 1,
        text: progressText,
        format: 'plain',
        reason: 'agent.sendProgressUpdate tool'
      }
    ],

    // Annotations for observability
    annotations: [
      {
        kind: 'progress_update',
        value: JSON.stringify({
          originalCorrelationId: originalEvent.correlationId,
          urgency: args.urgency || 'normal',
          source: 'agent.sendProgressUpdate',
          toolArgs: args.context || {}
        }),
        source: 'tool-gateway',
        id: randomUUID(),
        createdAt: new Date().toISOString()
      }
    ],

    // Metadata linking to original request
    metadata: {
      originalCorrelationId: originalEvent.correlationId,
      progressUpdate: true
    }
  };

  return progressEvent;
}
```

**Acceptance Criteria**:
- [ ] Progress event has correct structure (InternalEventV2)
- [ ] Type is `chat.message.v1` (not `internal.egress.v1`)
- [ ] Routing slip is empty array
- [ ] Candidate contains progress text with emoji
- [ ] Original ingress/identity/egress preserved
- [ ] New correlationId generated
- [ ] progress_update annotation present
- [ ] Metadata includes originalCorrelationId

**Testing**:
```bash
npm test -- tool-gateway-progress-tool.test.ts -t "Handler Logic"
```

---

#### Task 2.2: Implement next() Routing (1 hour)

**File**: `src/apps/tool-gateway.ts`

**Implementation**:
```typescript
private async handleSendProgressUpdate(
  args: SendProgressUpdateArgs,
  extra?: { sessionId?: string }
): Promise<CallToolResult> {
  const logger = this.getLogger();

  // ... session context extraction (from Task 1.4) ...

  try {
    // Build progress event
    const progressEvent = this.buildProgressEvent(originalEvent, args);

    logger.debug('agent.sendProgressUpdate.event_built', {
      progressCorrelationId: progressEvent.correlationId,
      originalCorrelationId: originalEvent.correlationId,
      candidateCount: progressEvent.candidates?.length || 0,
      slipLength: progressEvent.routing.slip.length,
      destination: progressEvent.egress.destination
    });

    // Route through platform safeguards via next()
    await this.next(progressEvent);

    logger.info('agent.sendProgressUpdate.routed', {
      progressCorrelationId: progressEvent.correlationId,
      originalCorrelationId: originalEvent.correlationId,
      destination: originalEvent.egress.destination,
      connector: originalEvent.egress.connector,
      message: args.message
    });

    return {
      content: [{
        type: 'text',
        text: `Progress update sent: "${args.message}"`
      }]
    };

  } catch (error: any) {
    logger.error('agent.sendProgressUpdate.next_failed', {
      error: error.message,
      stack: error.stack,
      correlationId: originalEvent.correlationId,
      sessionId: extra?.sessionId
    });

    return {
      content: [{
        type: 'text',
        text: `Error sending progress update: ${error.message}`
      }],
      isError: true
    };
  }
}
```

**Acceptance Criteria**:
- [ ] Calls `this.next(progressEvent)`
- [ ] Logs before and after next() call
- [ ] Catches and logs next() failures
- [ ] Returns success message on success
- [ ] Returns error message on failure (isError: true)
- [ ] Never throws unhandled exception

**Testing**:
```bash
# Integration test: Verify next() publishes to correct topic
npm test -- progress-update-integration.test.ts -t "should send progress"
```

---

#### Task 2.3: Verify Empty Slip Routing (1 hour)

**Goal**: Ensure `Bit.next()` correctly routes events with empty slip to egress

**File**: `src/common/base-server.ts` (verify existing behavior)

**Verification**:
```typescript
// base-server.ts:1000-1100 (existing code - just verify)
protected async next(event: InternalEventV2, stepStatus?: RoutingStatus): Promise<void> {
  // ...
  const slip = event.routing?.slip || [];
  const idxPending = slip.findIndex(s => s.status === 'PENDING');

  if (idxPending < 0) {
    // No pending steps - route to egress destination
    const dest = event.egress?.destination;
    if (dest) {
      await pub.publishJson(event, this.buildRoutingAttributes(event, null));
      return;
    }
  }
  // ...
}
```

**Acceptance Criteria**:
- [ ] Confirm `next()` handles empty slip correctly
- [ ] Confirm routes to egress.destination when slip empty
- [ ] Add test case for empty slip routing
- [ ] Verify FeedbackMiddleware doesn't interfere

**Testing**:
```bash
# Unit test: Empty slip routes to egress
npm test -- base-server.test.ts -t "next with empty slip"
```

---

#### Task 2.4: Add Comprehensive Error Handling (1 hour)

**File**: `src/apps/tool-gateway.ts`

**Implementation**: Already covered in Tasks 1.4 and 2.2, but add additional edge cases:

```typescript
// Additional validation
if (!originalEvent.ingress) {
  logger.error('agent.sendProgressUpdate.invalid_event', {
    correlationId: originalEvent.correlationId,
    reason: 'missing_ingress'
  });
  return {
    content: [{ type: 'text', text: 'Error: Invalid event structure' }],
    isError: true
  };
}

if (!originalEvent.identity) {
  logger.error('agent.sendProgressUpdate.invalid_event', {
    correlationId: originalEvent.correlationId,
    reason: 'missing_identity'
  });
  return {
    content: [{ type: 'text', text: 'Error: Invalid event structure' }],
    isError: true
  };
}
```

**Acceptance Criteria**:
- [ ] Validates all required event fields
- [ ] Returns descriptive error messages
- [ ] Logs all error scenarios
- [ ] Graceful degradation (never crash)

**Testing**:
```bash
npm test -- tool-gateway-progress-tool.test.ts -t "Error Handling"
```

---

### Phase 3: Egress Enhancement - REMOVED FROM SPRINT

**Status**: Out of scope - deferred to future sprint

**Rationale**: Focus on core tool infrastructure; egress enhancements not needed for MVP

---

### Phase 4: Agent Integration - REMOVED FROM SPRINT

**Status**: Out of scope - deferred to future sprint

**Rationale**: Tool infrastructure should be complete and available; agents can integrate when needed without time estimation complexity

---

### Phase 5: Testing & Documentation

**Goal**: Comprehensive test coverage and documentation

**Duration**: 3-5 hours

#### Task 5.1: Unit Test Suite (2 hours)

**File**: `src/apps/__tests__/tool-gateway-progress-tool.test.ts`

**Implementation**: See Section 8.1 of technical architecture

**Coverage Requirements**:
- Schema validation (6 tests)
- Handler logic (6 tests)
- Error handling (4 tests)
- Observability (4 tests)

**Total**: 20 unit tests

**Acceptance Criteria**:
- [ ] All unit tests pass
- [ ] Coverage >90% for new code
- [ ] Tests run in <5 seconds

---

#### Task 5.2: Integration Test Suite (1.5 hours)

**File**: `src/apps/__tests__/progress-update-integration.test.ts`

**Implementation**: See Section 8.2 of technical architecture

**Coverage Requirements**:
- End-to-end flow (1 test)
- Multiple progress updates (1 test)
- Multi-connector support (1 test)
- CorrelationId chain (1 test)
- Failure handling (1 test)

**Total**: 5 integration tests

**Acceptance Criteria**:
- [ ] All integration tests pass
- [ ] Tests cover all connectors
- [ ] Tests validate observability

---

#### Task 5.3: Agent-Dev Validation (1 hour)

**Validation Steps**:

```bash
# 1. Provision agent-dev context
mcp__bitbrat-dev__agent_dev_provision({ name: "agent-dev-sprint-22" })

# 2. Deploy tool-gateway
npm run brat -- bit deploy tool-gateway --context agent-dev-sprint-22

# 3. Verify service running
mcp__bitbrat-dev__fleet_info({ bit: "tool-gateway", context: "agent-dev-sprint-22" })

# 4. Verify tool registration
npm run brat -- fleet info tool-gateway --context agent-dev-sprint-22

# Expected output should include:
# Tools: [..., agent.sendProgressUpdate, ...]

# 5. Test tool call (create test script or manual MCP call)
# This validates tool can be invoked and returns expected result

# 6. Check logs
mcp__bitbrat-dev__fleet_logs({
  bit: "tool-gateway",
  context: "agent-dev-sprint-22"
})

# 7. Tear down
mcp__bitbrat-dev__agent_dev_destroy({
  name: "agent-dev-sprint-22",
  confirm: true
})
```

**Acceptance Criteria**:
- [ ] tool-gateway deploys successfully
- [ ] Tool appears in fleet info output
- [ ] Tool can be called via MCP (direct test)
- [ ] Tool returns expected CallToolResult
- [ ] No errors in logs
- [ ] Validation results documented

**Note**: No agent integration testing - just verify tool infrastructure works

---

#### Task 5.4: Documentation Updates (30 min)

**Files to Update**:

1. `CLAUDE.md` - Add platform-internal tool pattern example
2. `documentation/reference/bit-control-plane.md` - Document `agent.sendProgressUpdate`
3. `documentation/guides/agent-flow-patterns.md` - Add progress update pattern

**Acceptance Criteria**:
- [ ] CLAUDE.md updated with example
- [ ] Reference docs include tool signature
- [ ] Guides include usage pattern
- [ ] Examples clear and actionable

---

## 3. Dependency Graph

```
Task 1.1 (Schema)
  ↓
Task 1.2 (registerPlatformTools)
  ↓
Task 1.3 (Handler Stub)
  ↓
Task 1.4 (Session Context)
  ↓
Task 2.1 (Event Builder)
  ↓
Task 2.2 (next() Routing)
  ↓
Task 2.3 (Verify Empty Slip)
  ↓
Task 2.4 (Error Handling)
  ↓
Task 5.1 (Unit Tests)
  ↓
Task 5.2 (Integration Tests)
  ↓
Task 5.3 (Agent-Dev Validation)
  ↓
Task 5.4 (Documentation)
  ↓
Task 6.1 (Code Review)
  ↓
Task 6.2 (Sprint Artifacts)
  ↓
Task 6.3 (Pull Request)
```

**Critical Path**: 1.1 → 1.2 → 1.3 → 1.4 → 2.1 → 2.2 → 2.3 → 2.4 → 5.1 → 5.2 → 5.3 → 6.1 → 6.2 → 6.3

**Parallel Work**:
- Documentation (5.4) can start after Phase 2
- Unit tests (5.1) can start alongside Task 2.4

---

## 4. Risk Assessment

### High-Priority Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Empty slip routing doesn't work | Low | High | Verify in Task 2.3; add test coverage |
| Session context missing | Medium | High | Graceful fallback in Task 1.4 |
| next() call fails | Low | Medium | Try/catch + error logging |
| FeedbackMiddleware interference | Low | Medium | Test in Phase 2; disable if needed |

### Medium-Priority Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Progress slower than 500ms | Medium | Low | Acceptable; log for monitoring |
| Tool not discoverable | Low | Medium | Verify registration in Phase 1 |
| Multiple progress duplicates | Low | Low | FeedbackMiddleware dedupes |

### Low-Priority Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Emoji rendering issues | High | Very Low | Fallback to default emoji |
| Documentation incomplete | Low | Low | Peer review before merge |

---

## 5. Acceptance Criteria

### Must Have (Sprint Completion)

- [ ] Tool registered on tool-gateway
- [ ] Session context extraction works
- [ ] Progress event builder creates valid events
- [ ] next() routes to egress correctly
- [ ] llm-bot integration complete
- [ ] 20+ unit tests passing
- [ ] 5+ integration tests passing
- [ ] Agent-dev validation successful
- [ ] Documentation updated

### Should Have (Quality Bar)

- [ ] Error handling comprehensive
- [ ] Logging structured and actionable
- [ ] Test coverage >90%
- [ ] No regressions in existing flows
- [ ] Performance <500ms end-to-end

### Nice to Have (Future)

- [ ] Egress annotation handling (Phase 3)
- [ ] Rich progress messages
- [ ] Multiple progress updates
- [ ] Custom emoji support

---

## 6. Testing Strategy

### Test Pyramid

```
         /\
        /  \  Manual (agent-dev)
       /____\
      /      \
     / Integ- \  Integration Tests (5)
    /  ration  \
   /____________\
  /              \
 /  Unit Tests    \  Unit Tests (20+)
/__________________\
```

### Coverage Targets

- **Unit Tests**: >90% line coverage
- **Integration Tests**: All critical paths
- **Manual Tests**: Real-world scenarios

### Test Execution Order

1. **Unit tests** (fast feedback)
2. **Integration tests** (component interaction)
3. **Agent-dev validation** (full stack)
4. **Manual scenarios** (user acceptance)

---

## 7. Validation Checklist

### Pre-Implementation

- [ ] Technical architecture approved
- [ ] Backlog YAML created
- [ ] Sprint worktree setup (`npm ci && npm run build`)
- [ ] Agent-dev context available

### During Implementation

- [ ] Each task has passing tests
- [ ] Logs show expected behavior
- [ ] No TypeScript errors
- [ ] No ESLint warnings

### Pre-Merge

- [ ] All unit tests pass (`npm test`)
- [ ] All integration tests pass
- [ ] Agent-dev validation complete
- [ ] Build succeeds (`npm run build`)
- [ ] Lint succeeds (`npm run lint`)
- [ ] Documentation updated
- [ ] Code reviewed

### Post-Merge

- [ ] Staging deployment successful
- [ ] Production rollout plan ready
- [ ] Monitoring dashboards configured
- [ ] Rollback procedure tested

---

## Conclusion

This implementation plan provides a clear, actionable roadmap for implementing the agent progress update MCP tool. The phased approach with explicit dependencies, acceptance criteria, and risk mitigation ensures high-quality delivery within the 2-3 day sprint timeline.

**Next Step**: Create prioritized YAML backlog and begin implementation.

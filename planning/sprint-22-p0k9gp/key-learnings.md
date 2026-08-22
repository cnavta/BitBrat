# Sprint 22 Key Learnings

## 1. Egress Architecture Deep Dive

### What We Learned
The platform's egress routing has multiple layers:
- **Specific destinations**: `egress.slack.v1` → specific ingress-egress instance
- **Generic fallback**: `internal.egress.v1` → any egress handler
- **Invalid destinations**: Just connector name (e.g., `"slack"`) → routing failure

### Why It Matters
Progress messages must route to the exact same destination as the original user message to maintain context. Invalid destinations cause messages to be published to topics with no subscribers.

### Application
Always validate egress destinations contain a dot. If invalid, normalize to `internal.egress.v1` as safe fallback.

---

## 2. LLM Agent Tool Context Limitations

### What We Learned
llm-bot passes **minimal context** to tools via `toolContext`:
```typescript
const toolContext = {
  userRoles,      // ✅ Available
  userId,         // ✅ Available
  correlationId,  // ✅ Available
  signal,         // ✅ Available
  // ❌ NOT available:
  egress,         // Routing destination
  ingress,        // Source platform
  event           // Full InternalEventV2
};
```

The full `InternalEventV2` is available in processor.ts but not passed to tool execution handlers.

### Why It Matters
Tools that need routing information (like progress updates) cannot get accurate egress data from LLM agents. This forces fallback strategies and generic routing.

### Application
- **Phase 1**: Design tools with fallback strategies (userId → internal.egress.v1)
- **Phase 2**: Enhance llm-bot to pass full context
- **Documentation**: Clearly explain what context is/isn't available to tools

---

## 3. Logging Levels: TRACE vs DEBUG vs INFO

### What We Learned
High-frequency, low-urgency logs create noise at DEBUG/INFO levels:
- **PostgreSQL queries**: Every 5 seconds (polling)
- **MCP connections**: Every client connect/disconnect
- **Tool invocations**: Every tool call
- **Message acks**: Every message acknowledgment

### Why It Matters
These logs pollute DEBUG output, making it hard to find actual debugging information. Production systems generate gigabytes of DEBUG logs from high-frequency operations.

### Application
Use logging levels appropriately:
- **ERROR**: Always log, actionable issues
- **WARN**: Important but non-blocking issues
- **INFO**: Significant lifecycle events (startup, shutdown, new sessions)
- **DEBUG**: Development debugging, moderate frequency
- **TRACE**: High-frequency operations, detailed tracing

Always use optional chaining (`logger.trace?.()`) to support mock loggers in tests.

---

## 4. Test Isolation is Critical

### What We Learned
Tests that pass in isolation but fail in full suite indicate:
- Global state contamination
- Port conflicts
- Async cleanup issues
- Timing dependencies

Examples from this sprint:
- OAuth test: Expected 200, got 404 (only in full suite)
- API Gateway: "Parse Error: Expected HTTP/" (only in full suite)

### Why It Matters
Non-deterministic test failures erode confidence in the test suite and waste debugging time.

### Application
- Always test both in isolation AND full suite
- Clean up resources in afterEach/afterAll
- Use random ports (port 0) for test servers
- Add delays for server readiness when needed
- Wait for async operations to complete before resolving promises

---

## 5. Empty Routing Slip = Egress Fallback

### What We Learned
In platform's routing architecture:
```typescript
routing: {
  slip: [],  // Empty slip
  stage: 'response',
  history: []
}
```

When `slip` is empty, `this.next(event)` in Bit.ts falls back to routing via `event.egress.destination`.

### Why It Matters
This is how platform-internal tools can send messages directly to egress without going through the routing pipeline.

### Application
Progress updates set empty slip to bypass routing stages and go straight to egress. This is the correct pattern for synthetic events that don't need analysis/enrichment.

---

## 6. Platform-Internal Tools vs MCP-Proxied Tools

### What We Learned
Two patterns for tool registration:

**Platform-Internal Tools** (this sprint):
- Registered directly on tool-gateway
- Have access to platform internals (this.next(), session context)
- Zod schema validation
- Synchronous registration

**MCP-Proxied Tools**:
- Registered on external MCP servers
- Proxied through tool-gateway
- JSON schema from MCP server
- Async discovery via MCP client

### Why It Matters
Progress updates need platform internals, so must be platform-internal. Other tools (calculators, data fetchers) can be MCP-proxied.

### Application
Ask: "Does this tool need platform internals?"
- YES → Platform-internal (register on tool-gateway)
- NO → MCP-proxied (register on external MCP server)

---

## 7. Phase 1/Phase 2 Scoping Strategy

### What We Learned
When you discover architectural limitations mid-sprint:

**Phase 1**: Deliver working solution with documented limitations
- Implement validation/normalization workarounds
- Document what works and what doesn't
- Create clear fallback strategies

**Phase 2**: Address root cause in future sprint
- Enhance architecture to remove limitations
- Update documentation to reflect improvements

### Why It Matters
Balances immediate value delivery with long-term architectural improvement. Prevents scope creep while maintaining clear path forward.

### Application
- Always document limitations clearly
- Explain workarounds and why they're needed
- Provide concrete Phase 2 plan
- Get user approval for phase split

---

## 8. Validation > Trust

### What We Learned
Even when accepting structured data (like Egress objects), validate format:
```typescript
// Don't trust blindly
egressInfo = { ...args.egress };

// Validate and normalize
let destination = args.egress.destination;
if (!destination || !destination.includes('.')) {
  destination = 'internal.egress.v1';  // Safe fallback
}
```

### Why It Matters
LLMs may pass incomplete/incorrect data. Agents may have bugs. External integrations may change format. Validation prevents cascading failures.

### Application
Always validate:
- Format (e.g., destination contains dot)
- Required fields (e.g., connector present)
- Value ranges (e.g., urgency in enum)

Log warnings on normalization to help debug upstream issues.

---

## 9. Mock Logger Pattern

### What We Learned
Test mock loggers need to match production logger interface:
```typescript
// Mock logger
const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),  // ← Must include trace!
};
```

Optional chaining handles missing methods gracefully:
```typescript
logger.trace?.('message', context);  // Works even if trace undefined
```

### Why It Matters
New log levels (like trace) break tests if mocks don't include them. Optional chaining provides forward compatibility.

### Application
- Use optional chaining for all logger calls
- Include all log levels in mock loggers
- Document mock logger pattern in testing guidelines

---

## 10. Real-World Feedback is Invaluable

### What We Learned
Staging environment logs revealed issues not caught in development:
- Wrong egress destination being published
- Invalid destination format from agents
- Progress messages not reaching channels

### Why It Matters
Unit tests validate logic but may miss integration issues. Real user workflows expose edge cases and integration problems.

### Application
- Deploy early to staging
- Monitor logs for unexpected patterns
- Use correlation IDs to trace message flow
- Involve users in validation before marking sprint complete

---

## Summary

This sprint reinforced that **platform architecture understanding** is critical for tool development. The investigation into llm-bot's tool context revealed a fundamental limitation that shaped our entire approach. The Phase 1/Phase 2 strategy allowed us to deliver immediate value while planning for architectural enhancement.

Key takeaway: **When building platform tools, always investigate the full execution path** - from agent invocation through tool-gateway to platform internals. Understanding what context is available at each stage prevents late-sprint surprises.

# Platform-Internal MCP Tools Reference

Platform-internal tools are MCP tools hosted directly on platform services (rather than being proxied from other Bits). These tools provide core platform functionality to agents.

## Tool-Gateway Platform Tools

The `tool-gateway` service hosts platform-internal tools that are available to all connected agents.

### agent.sendProgressUpdate

**Service**: `tool-gateway`
**Sprint**: Sprint 22
**Purpose**: Send progress update messages to users before long-running operations.

**Description**: Allows agents to proactively inform users when an operation may take significant time. Creates a progress event that is routed through platform safeguards (FeedbackMiddleware, candidate selection) before delivery.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | Progress message to send to the user (1-200 characters) |
| `emoji` | string | No | Optional emoji to prepend to the message (default: 🔄) |
| `urgency` | enum | No | Message urgency level: `low`, `normal`, `high` (default: `normal`) |
| `egress` | Egress | No | Egress from the original `InternalEventV2` event. Ensures accurate routing to the correct channel. If omitted, will be constructed from `userId`. **Note**: Currently not available to LLM agents (see Limitations below). |

**Example Usage**:

```typescript
// Ideal: Pass egress from original event for accurate routing
// (Currently only available to platform-internal tools, not LLM agents)
await toolGateway.callTool('agent.sendProgressUpdate', {
  message: 'Searching through documentation, this may take a moment',
  emoji: '🔍',
  urgency: 'normal',
  egress: event.egress  // From InternalEventV2
});

// Current: Without egress (uses userId to construct egress)
// This is how LLM agents currently call the tool
await toolGateway.callTool('agent.sendProgressUpdate', {
  message: 'Analyzing data and generating report',
  emoji: '📊',
  urgency: 'high'
  // No egress parameter - will route via internal.egress.v1
});
```

**Returns**: Success confirmation message or warning/error message if delivery fails.

**Architecture**:

1. Tool validates and normalizes egress routing information
   - When `egress` parameter provided with valid destination: Preserves exact routing
   - When `egress` has invalid destination (e.g., just `"slack"`): Normalizes to `internal.egress.v1`
   - When `egress` omitted: Falls back to `internal.egress.v1` constructed from `userId`
   - Preserves ALL egress fields: `destination`, `connector`, `channel`, `type`, `metadata`
   - Validation: Destination must contain a dot (e.g., `egress.slack.v1` or `internal.egress.v1`)
2. Creates `InternalEventV2` with:
   - Type: `chat.message.v1`
   - Progress message in `candidates[]` array (not `message` field)
   - Empty `routing.slip` to signal egress routing
   - `progress_update` annotation with metadata
   - Exact egress from original event (or fallback)
3. Routes via `this.next(event)` to respect platform safeguards:
   - FeedbackMiddleware applies (may deduplicate/throttle)
   - Candidate selection marks message as selected
   - Routes to egress destination → appropriate egress handler → platform connector
4. Returns immediately to agent (fire-and-forget delivery)

**Graceful Degradation**:

- No session context → Returns warning, does not throw
- No egress destination → Returns warning, does not throw
- Publishing failure → Returns error message, does not throw
- Tool failures never block agent execution

**Session Context Requirements**:

The tool requires the agent's MCP session to have:
- Valid `sessionId` passed via extra parameters
- Current event stored in tool-gateway's `sessionContexts` map
- Egress destination in the current event

**Annotations**:

Progress events include a `progress_update` annotation with:

```json
{
  "kind": "progress_update",
  "value": {
    "originalCorrelationId": "<uuid>",
    "urgency": "normal|low|high",
    "toolInvocation": "agent.sendProgressUpdate"
  },
  "source": "tool-gateway",
  "id": "<uuid>",
  "createdAt": "<iso8601>"
}
```

**Comparison with FeedbackMiddleware**:

| Feature | agent.sendProgressUpdate | FeedbackMiddleware |
|---------|-------------------------|-------------------|
| **Trigger** | Explicit agent call | Automatic (time-based) |
| **Message** | Custom agent message | Template or LLM-generated |
| **Timing** | Agent-controlled | Fixed thresholds (2s, 5s, 30s) |
| **Use Case** | Known long operations | Unknown operation duration |
| **Control** | Full agent control | Platform automated |

**Best Practices**:

1. **Call before long operations**: Use immediately before starting work that may take >2 seconds
2. **Be specific**: Describe what you're doing ("Searching 1000 documents" vs "Working...")
3. **Set appropriate urgency**:
   - `low`: Nice-to-have updates (5-10s operations)
   - `normal`: Standard operations (10-30s operations)
   - `high`: Critical waits (30s+ operations)
4. **Choose relevant emojis**: Use emojis that match the operation type
5. **Don't overuse**: Only for genuinely long operations (avoid spam)

**Common Use Cases**:

- **Search operations**: Searching large document sets, codebases
- **API calls**: External API requests with unknown latency
- **File operations**: Reading/writing large files, directory traversals
- **Computation**: Complex calculations, data analysis
- **Database queries**: Heavy database operations, migrations

**Implementation Details**:

- **Location**: `src/apps/tool-gateway.ts` (handleSendProgressUpdate)
- **Registration**: `registerPlatformTools()` method in ToolGatewayServer constructor
- **Schema**: Zod schema `SendProgressUpdateSchema`
- **Tests**: `src/apps/tool-gateway.test.ts` (13 test cases)

**Limitations (Phase 1)**:

### Current Routing Behavior

The tool uses a **fallback routing strategy** when egress is not provided or is invalid:

1. **Valid egress provided**: Routes to exact destination (e.g., `egress.slack.v1`)
2. **Invalid egress** (e.g., `destination: "slack"`): Normalizes to `internal.egress.v1`
3. **No egress provided**: Constructs `internal.egress.v1` from `userId`

### LLM Agent Limitations

**LLM agents cannot currently provide accurate egress information** because llm-bot only passes minimal context to tools:

**What llm-bot passes to tools:**
- `userRoles` - User's roles
- `userId` - User ID (format: `platform:id`)
- `correlationId` - Event correlation ID
- `signal` - AbortSignal for timeouts

**What llm-bot does NOT pass:**
- `egress` - Routing destination information
- `ingress` - Source platform information
- `event` - Full InternalEventV2 object

**Result**: LLM agents use the userId fallback, which constructs a generic `internal.egress.v1` destination. This works but:
- Routes through generic egress handler (slower)
- May not preserve all channel metadata
- Cannot distinguish between DM and channel messages from routing alone

### Workaround (Current)

The tool includes **destination validation and normalization** to handle invalid egress:

```typescript
// If destination is invalid (e.g., just "slack" instead of "egress.slack.v1")
if (!destination || !destination.includes('.')) {
  destination = 'internal.egress.v1';  // Safe fallback
}
```

This ensures progress messages always route correctly, even with incomplete information.

### Future Enhancement (Phase 2)

A future sprint will modify llm-bot to pass the full event context to tools:

```typescript
// Future: llm-bot will pass egress
const toolContext = {
  userRoles,
  userId,
  correlationId,
  signal,
  egress: evt.egress,  // Full routing information
};
```

This will enable LLM agents to provide accurate egress information without manual intervention.

**Related**:

- [FeedbackMiddleware](../common/middleware/feedback-middleware.md): Automatic time-based progress
- [Event Flow](../concepts/platform-flow.md): How events route through the platform
- [Candidate Pattern](../concepts/candidates.md): How messages are selected for delivery
- [Platform Safeguards](../concepts/platform-safeguards.md): Middleware and filtering

**Version History**:

- **Sprint 22** (v0.34.0): Initial implementation as platform-internal tool on tool-gateway
  - Phase 1: Destination validation and normalization
  - Phase 2: (Planned) llm-bot context enhancement to pass egress

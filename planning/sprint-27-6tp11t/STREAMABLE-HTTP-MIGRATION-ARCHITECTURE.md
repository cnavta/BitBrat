# Technical Architecture: SSE → StreamableHTTP Transport Migration

**Sprint**: 27
**Date**: 2026-08-28
**Lead Implementor**: Claude Code
**Status**: DRAFT - Pending Approval

---

## Executive Summary

Migration from deprecated `SSEClientTransport` to `StreamableHTTPClientTransport` to resolve critical MCP timeout issue where tool calls hang indefinitely (60s timeout) because POST requests never reach target services.

**Critical Impact**: This issue blocks ALL MCP tool invocations between services, including Reflex counter operations and any cross-service MCP calls.

**Effort Estimate**: 3-5 days (Medium complexity)
**Risk Level**: MEDIUM-HIGH (requires client + server changes, thorough testing)

---

## Problem Statement

### Current Issue

**Symptom**: MCP tool calls from tool-gateway → utility timeout after 60 seconds

**Root Cause**: Deprecated `SSEClientTransport` fails to POST messages to `/message` endpoint
- ✅ SSE handshake works (server sends `event: endpoint`)
- ✅ Tool discovery works (`listTools()` receives SSE events)
- ❌ Tool calls fail (`callTool()` POST never reaches server)
- ❌ `/message` endpoint never receives requests (verified with debug logging)

**Evidence**:
```javascript
// From @modelcontextprotocol/sdk/dist/esm/client/sse.js:15
/**
 * @deprecated SSEClientTransport is deprecated. Prefer to use
 * StreamableHTTPClientTransport where possible instead.
 */
export class SSEClientTransport { ... }
```

### Impact Analysis

**Affected Components**:
1. **tool-gateway** → All platform services (utility, scheduler, llm-bot, etc.)
2. **llm-bot** → tool-gateway (MCP tool discovery/invocation)
3. Any future service-to-service MCP communication

**User Impact**:
- Reflex counter operations fail
- Progress messages fail
- Any MCP-based cross-service communication fails
- Degrades to "restart-only" discovery (no dynamic tool updates)

---

## Architecture Overview

### Current Architecture (SSE Transport)

```
Client Side (tool-gateway):
┌─────────────────────────────────────┐
│ McpClientManager                    │
│  ├─ SSEClientTransport (DEPRECATED) │ ❌ Broken
│  │   ├─ GET /sse  (EventSource)     │ ✅ Works
│  │   └─ POST /message (fetch)       │ ❌ FAILS - never sends
│  └─ Client.callTool()                │
└─────────────────────────────────────┘
                  ↓
Server Side (utility):
┌─────────────────────────────────────┐
│ BaseServer (Bit)                    │
│  ├─ SSEServerTransport              │
│  │   ├─ GET /sse (handshake)        │ ✅ Works
│  │   └─ POST /message (receive)     │ ❌ Never receives
│  └─ MCP Server                       │
└─────────────────────────────────────┘
```

### Target Architecture (StreamableHTTP Transport)

```
Client Side (tool-gateway):
┌──────────────────────────────────────────────────┐
│ McpClientManager                                 │
│  ├─ StreamableHTTPClientTransport (CURRENT)      │ ✅ Supported
│  │   ├─ GET / (SSE stream for server messages)   │
│  │   └─ POST / (send client requests)            │
│  └─ Client.callTool()                             │
└──────────────────────────────────────────────────┘
                  ↓
Server Side (utility):
┌──────────────────────────────────────────────────┐
│ BaseServer (Bit)                                 │
│  ├─ StreamableHTTPServerTransport (CURRENT)      │ ✅ Supported
│  │   ├─ GET / (SSE stream)                       │
│  │   └─ POST / (receive + optional SSE response) │
│  └─ MCP Server                                    │
└──────────────────────────────────────────────────┘
```

**Key Differences**:

| Feature | SSE Transport (Old) | StreamableHTTP Transport (New) |
|---------|---------------------|--------------------------------|
| **Client GET** | `/sse` → EventSource endpoint | `/` → SSE stream (optional) |
| **Client POST** | `/message?sessionId=xxx` | `/` → same endpoint |
| **Session ID** | Query parameter | `mcp-session-id` header |
| **POST Response** | JSON only | JSON **OR** SSE stream |
| **Reconnection** | Manual | Built-in exponential backoff |
| **Status** | DEPRECATED | CURRENT |

---

## Implementation Plan

### Phase 1: Server-Side Migration (Lower Risk)

**Objective**: Replace `SSEServerTransport` with `StreamableHTTPServerTransport` in BaseServer

**Files Modified**:
1. `src/common/base-server.ts` (lines 40, 124, 2120-2189)

**Changes Required**:

```typescript
// BEFORE (SSE):
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

protected readonly transports: Map<string, SSEServerTransport> = new Map();

this.onHTTPRequest("/sse", (req, res) => {
  const transport = new SSEServerTransport("/message", res);
  // ...
});

this.onHTTPRequest({ path: "/message", method: "POST" }, (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = this.transports.get(sessionId);
  await transport.handlePostMessage(req, res, req.body);
});
```

```typescript
// AFTER (StreamableHTTP):
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

protected readonly transports: Map<string, StreamableHTTPServerTransport> = new Map();

// Single endpoint handles both GET (SSE) and POST (requests)
this.onHTTPRequest("/", (req, res) => {
  authMiddleware(req, res, async () => {
    const sessionServer = await this.getMcpServerForConnection(req);

    // Create transport if not exists
    let transport = this.transports.get(sessionId);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        send: (message) => sessionServer.sendMessage(message)
      });
      this.transports.set(sessionId, transport);
      await sessionServer.connect(transport);
    }

    // Handle request (GET or POST)
    await transport.handleRequest(req, res, req.body);
  });
});
```

**Backward Compatibility**: Keep `/sse` and `/message` endpoints as **deprecated aliases** that redirect to `/` for 1-2 sprint migration period.

**Testing**:
- ✅ Existing SSE clients continue to work (backward compat)
- ✅ StreamableHTTP clients work
- ✅ Tool discovery succeeds
- ✅ Tool calls succeed

**Estimated Effort**: 1 day (implementation + testing)

---

### Phase 2: Client-Side Migration (Higher Risk)

**Objective**: Replace `SSEClientTransport` with `StreamableHTTPClientTransport` in McpClientManager

**Files Modified**:
1. `src/common/mcp/client-manager.ts` (lines 3, 236-244)

**Changes Required**:

```typescript
// BEFORE (SSE):
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

if (config.transport === 'sse') {
  transport = new SSEClientTransport(new URL(config.url), {
    requestInit: {
      headers: resolved.env
    }
  });
}
```

```typescript
// AFTER (StreamableHTTP):
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

if (config.transport === 'sse' || config.transport === 'streamable-http') {
  // Use StreamableHTTP for both (SSE is deprecated alias)
  transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers: resolved.env
    },
    sessionId: undefined, // Server generates session ID
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 3
    }
  });
}
```

**Key Considerations**:

1. **URL Mapping**:
   - Old: `http://utility:3020/sse`
   - New: `http://utility:3020/` (root endpoint)
   - **Migration**: Strip `/sse` suffix if present

2. **Session Management**:
   - StreamableHTTP auto-manages session IDs via `mcp-session-id` header
   - No query parameters needed

3. **Reconnection**:
   - Built-in exponential backoff (configurable)
   - Auto-resume with `last-event-id` header

**Testing**:
- ✅ Connection establishment
- ✅ Tool discovery (`listTools()`)
- ✅ Tool invocation (`callTool()`)
- ✅ Reconnection on network failure
- ✅ Concurrent requests
- ✅ Authorization headers preserved

**Estimated Effort**: 1-2 days (implementation + extensive testing)

---

### Phase 3: Configuration Migration

**Objective**: Update architecture.yaml and deployment configs

**Files Modified**:
1. `architecture.yaml` - Update MCP endpoint URLs
2. Environment configs (`.secure.*/`)

**Changes**:

```yaml
# BEFORE:
services:
  utility:
    mcp:
      url: http://utility.bitbrat.local:3020/sse
      exposure: platform-only

# AFTER:
services:
  utility:
    mcp:
      url: http://utility.bitbrat.local:3020
      transport: streamable-http  # Explicit (optional - default)
      exposure: platform-only
```

**Backward Compatibility**:
- Accept both `http://service:port/sse` and `http://service:port/`
- Auto-detect and strip `/sse` suffix
- Log deprecation warning when `/sse` detected

**Estimated Effort**: 0.5 days

---

### Phase 4: Testing & Validation

**Test Scenarios**:

1. **Unit Tests**:
   - [ ] StreamableHTTP client connection
   - [ ] StreamableHTTP server request handling
   - [ ] Session ID management
   - [ ] Error handling (401, 403, 404, 500)
   - [ ] Reconnection logic

2. **Integration Tests**:
   - [ ] tool-gateway ↔ utility (counter.increment)
   - [ ] tool-gateway ↔ scheduler (schedule creation)
   - [ ] tool-gateway ↔ llm-bot (tool discovery)
   - [ ] Concurrent tool calls
   - [ ] Network failure recovery

3. **Agent-Dev Validation**:
   ```bash
   agent_dev.provision({ name: "agent-dev-streamable-http-test" })
   bit deploy --all --context agent-dev-streamable-http-test

   # Test counter tool
   # Test progress messages
   # Test reconnection (kill/restart utility)
   # Verify no timeouts

   agent_dev.destroy({ name: "agent-dev-streamable-http-test", confirm: true })
   ```

4. **Staging Validation**:
   - [ ] Full deployment to staging
   - [ ] Reflex counter operations
   - [ ] Progress message delivery
   - [ ] 24-hour soak test (no timeouts)

**Estimated Effort**: 1-2 days

---

## Effort Breakdown

| Phase | Description | Effort (days) | Risk |
|-------|-------------|---------------|------|
| **Phase 1** | Server-side migration | 1.0 | LOW |
| **Phase 2** | Client-side migration | 1.5 | MEDIUM |
| **Phase 3** | Configuration updates | 0.5 | LOW |
| **Phase 4** | Testing & validation | 1.5 | MEDIUM |
| **Contingency** | Bug fixes, edge cases | 0.5 | - |
| **TOTAL** | | **5.0 days** | **MEDIUM** |

---

## Risk Assessment

### MEDIUM Risks

1. **Breaking Changes to MCP Protocol**
   - **Impact**: Existing clients fail to connect
   - **Mitigation**: Maintain `/sse` + `/message` backward compat for 1-2 sprints
   - **Rollback**: Feature flag to switch between transports

2. **Session Management Differences**
   - **Impact**: Session ID mismatch causes 404 errors
   - **Mitigation**: Thorough testing of session lifecycle
   - **Rollback**: Revert to SSE transport if critical issues

3. **Performance Regression**
   - **Impact**: Higher latency or resource usage
   - **Mitigation**: Benchmark before/after, monitor in staging
   - **Rollback**: Feature flag + rollback plan

### LOW Risks

4. **URL Configuration Errors**
   - **Impact**: Services can't discover each other
   - **Mitigation**: Auto-detect and strip `/sse`, extensive logging

5. **Authorization Header Changes**
   - **Impact**: 401 errors if headers not propagated correctly
   - **Mitigation**: Verify header handling in Phase 2 testing

---

## Rollback Strategy

### Feature Flag Approach

```yaml
# architecture.yaml
platform:
  features:
    streamableHttpTransport: true  # Toggle between SSE/StreamableHTTP
```

```typescript
// src/common/mcp/client-manager.ts
const useStreamableHttp = features.isEnabled('streamableHttpTransport');

if (config.transport === 'sse') {
  if (useStreamableHttp) {
    transport = new StreamableHTTPClientTransport(url, opts);
  } else {
    transport = new SSEClientTransport(url, opts);  // Fallback
  }
}
```

### Rollback Steps

1. Set `streamableHttpTransport: false` in architecture.yaml
2. Redeploy affected services (tool-gateway, utility, scheduler, llm-bot)
3. Verify SSE transport works
4. Investigate and fix StreamableHTTP issues

**Rollback Time**: 10-15 minutes (config change + redeploy)

---

## Dependencies

### External

- `@modelcontextprotocol/sdk` v1.25.1 (already installed)
  - StreamableHTTPClientTransport ✅
  - StreamableHTTPServerTransport ✅

### Internal

- No new dependencies
- Existing Express.js middleware compatible
- Existing auth middleware compatible

---

## Success Criteria

### Functional

- [ ] Tool calls complete successfully (no 60s timeouts)
- [ ] `/message` endpoint receives POST requests
- [ ] Reflex counter operations work
- [ ] Progress messages deliver correctly
- [ ] Tool discovery continues to work
- [ ] Reconnection handles network failures

### Non-Functional

- [ ] Latency ≤ SSE transport baseline
- [ ] No memory leaks (24h soak test)
- [ ] Backward compatibility maintained (1-2 sprints)
- [ ] Logging clearly identifies transport type

### Testing

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Agent-dev validation passes
- [ ] Staging 24h soak test passes
- [ ] Zero production incidents in first week

---

## Open Questions

1. **Q**: Should we maintain SSE transport support indefinitely?
   **A**: No - deprecate after 2 sprints, remove after 4 sprints

2. **Q**: Does StreamableHTTP require server-side state?
   **A**: Optional - supports both stateful (session IDs) and stateless modes

3. **Q**: What about stdio transport (for local MCP servers)?
   **A**: Unaffected - only HTTP-based transports change

4. **Q**: Impact on external MCP servers (image-gen-mcp, obs-mcp)?
   **A**: Server-side change automatically supports both transports

---

## References

### MCP SDK Documentation

- **Spec**: https://spec.modelcontextprotocol.io/specification/architecture/transports/
- **SDK Repo**: https://github.com/modelcontextprotocol/typescript-sdk
- **Deprecation Notice**: `@modelcontextprotocol/sdk/client/sse.js:15`

### BitBrat Documentation

- **Bit Model**: `documentation/concepts/bit-model.md`
- **MCP Integration**: `documentation/guides/extending-bitbrat.md`
- **Agent-Dev Contexts**: `documentation/guides/agent-dev-contexts.md`

### Investigation Artifacts

- **Sprint 27 Investigation**: `planning/sprint-27-6tp11t/MCP-TIMEOUT-INVESTIGATION.md`
- **Notification Crash Fix**: `planning/sprint-27-6tp11t/MCP-TIMEOUT-INVESTIGATION.md` (Phase 3)

---

## Appendix A: Code Diff Examples

### Server-Side (BaseServer)

**File**: `src/common/base-server.ts`

```diff
-import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
+import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

-protected readonly transports: Map<string, SSEServerTransport> = new Map();
+protected readonly transports: Map<string, StreamableHTTPServerTransport> = new Map();

-  this.onHTTPRequest("/sse", (req: Request, res: Response) => {
-    authMiddleware(req, res, async () => {
-      const transport = new SSEServerTransport("/message", res);
-      this.transports.set(transport.sessionId, transport);
-      // ...
-    });
-  });
-
-  this.onHTTPRequest({ path: "/message", method: "POST" }, (req: Request, res: Response) => {
-    authMiddleware(req, res, async () => {
-      const sessionId = req.query.sessionId as string;
-      const transport = this.transports.get(sessionId);
-      await transport.handlePostMessage(req, res, req.body);
-    });
-  });

+  this.onHTTPRequest(["/", "/sse"], (req: Request, res: Response) => {
+    authMiddleware(req, res, async () => {
+      const sessionId = this.extractSessionId(req);
+      let transport = this.transports.get(sessionId);
+
+      if (!transport) {
+        const sessionServer = await this.getMcpServerForConnection(req);
+        transport = new StreamableHTTPServerTransport({
+          sessionIdGenerator: () => sessionId
+        });
+        this.transports.set(sessionId, transport);
+        await sessionServer.connect(transport);
+      }
+
+      await transport.handleRequest(req, res, req.body);
+    });
+  });
```

### Client-Side (McpClientManager)

**File**: `src/common/mcp/client-manager.ts`

```diff
-import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
+import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

   if (config.transport === 'sse') {
     if (!config.url) {
       throw new Error(`SSE transport requires a URL for server ${config.name}`);
     }
-    transport = new SSEClientTransport(new URL(config.url), {
+
+    // Strip /sse suffix for StreamableHTTP (backward compat)
+    const url = config.url.endsWith('/sse')
+      ? config.url.slice(0, -4)
+      : config.url;
+
+    transport = new StreamableHTTPClientTransport(new URL(url), {
       requestInit: {
         headers: resolved.env
-      }
+      },
+      reconnectionOptions: {
+        initialReconnectionDelay: 1000,
+        maxReconnectionDelay: 30000,
+        reconnectionDelayGrowFactor: 1.5,
+        maxRetries: 3
+      }
     });
   }
```

---

**Document Version**: 1.0
**Last Updated**: 2026-08-28
**Next Review**: After Phase 1 completion

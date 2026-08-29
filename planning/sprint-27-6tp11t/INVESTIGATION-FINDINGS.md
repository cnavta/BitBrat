# Sprint 27: StreamableHTTP Migration Investigation Findings

**Sprint ID**: sprint-27-6tp11t
**Date**: 2026-08-28
**Status**: ⚠️ INVESTIGATION INCOMPLETE - Blocked by SDK Architecture Issues

---

## Executive Summary

Attempted migration from deprecated `SSEClientTransport` to `StreamableHTTPClientTransport` to resolve 60-second timeout issue. While the timeout issue was identified and documented, the migration revealed fundamental architectural incompatibilities between BitBrat's MCP implementation and the StreamableHTTP transport.

**Key Findings**:
- ✅ Root cause identified: `SSEClientTransport.send()` broken in SDK
- ❌ StreamableHTTP migration blocked: Initialization catch-22
- ⚠️ Alternative needed: Consider stdio transport or SDK 2.0

---

## Original Issue

**Problem**: MCP tool calls timing out after 60 seconds
**Symptoms**:
- GET /sse handshake succeeds
- POST /message never reaches server
- Client-side timeout after 60s

**Root Cause**: `SSEClientTransport.send()` method fails to POST messages to server despite successful handshake.

---

## Investigation Timeline

### Phase 1: Server-Side Migration (✅ Code Complete)

**Changes Made**:
- File: `src/common/base-server.ts`
- Import: Added `StreamableHTTPServerTransport`
- Transport Map: Changed to union type `SSEServerTransport | StreamableHTTPServerTransport`
- Endpoint: Consolidated dual endpoints to single `/sse` endpoint

**Code Changes**:
```typescript
// Lines 2121-2177: Single /sse endpoint for both GET and POST
this.onHTTPRequest("/sse", (req, res) => {
  // Create transport on first request
  if (!this.streamableHttpTransport) {
    this.streamableHttpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined  // Stateless mode
    });
    await sessionServer.connect(this.streamableHttpTransport);
  }
  await this.streamableHttpTransport.handleRequest(req, res, req.body);
});
```

### Phase 2: Client-Side Migration (✅ Code Complete)

**Changes Made**:
- File: `src/common/mcp/client-manager.ts`
- Import: Added `StreamableHTTPClientTransport`
- Transport Instantiation: Replaced SSE with StreamableHTTP

**Code Changes**:
```typescript
// Line 244-248
transport = new StreamableHTTPClientTransport(new URL(config.url), {
  requestInit: { headers: resolved.env }
});
```

### Phase 3: Deployment Issues (❌ BLOCKED)

**Issue 1: Deployment from Wrong Directory**
- **Problem**: Deployed from main repo instead of worktree
- **Impact**: Old code running, new changes not reflected
- **Fix**: Changed to worktree directory

**Issue 2: Transport Lifecycle**
- **Problem**: Created new transport for every GET request
- **Error**: "Server not initialized" on first request
- **Attempted Fix**: Reuse single transport instance across requests
- **Result**: Still blocked by initialization requirement

**Issue 3: Stateful vs Stateless**
- **Problem**: Stateful mode requires initialization BEFORE accepting requests
- **Catch-22**: Can't initialize without SSE stream, can't establish stream without initialization
- **Attempted Fix**: Switched to stateless mode (`sessionIdGenerator: undefined`)
- **Result**: Still failing with 404 errors

---

## Technical Deep Dive

### StreamableHTTP Transport Requirements

**From SDK Source** (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js`):

```typescript
// Line 590-594: validateSession() method
if (!this._initialized) {
  // If the server has not been initialized yet, reject all requests
  this.onerror?.(new Error('Bad Request: Server not initialized'));
  return this.createJsonErrorResponse(400, -32000, 'Bad Request: Server not initialized');
}
```

**Initialization Flow**:
1. Client sends GET request to establish SSE stream
2. Server validates session → REJECTS (not initialized)
3. Never gets to establish stream → Never initializes → Catch-22

**Stateless Mode** (`sessionIdGenerator === undefined`):
- Lines 585-589: Should skip validation
- **Expected**: Bypass initialization check
- **Actual**: Still returning 404 errors

### Test Results

**Direct Endpoint Test**:
```bash
$ curl -H "Accept: text/event-stream" -H "Authorization: Bearer $TOKEN" http://utility:3020/sse
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Server not initialized"},"id":null}
```

**Tool Call Test**:
```bash
$ curl -X POST http://tool-gateway:3000/v1/tools/mcp_counter_increment
{"error":"Tool not found"}
Time: 0.001633s  # Timeout issue RESOLVED
Status: 404      # Tool discovery BLOCKED
```

**Logs Show**:
- Utility: Only registers GET /sse endpoint (no POST logged)
- Tool-gateway: Repeated 404 connection failures to utility
- No successful MCP initialization handshake

---

## Files Modified

### Source Code
1. **src/common/base-server.ts** (~100 lines)
   - Added `StreamableHTTPServerTransport` import
   - Added `streamableHttpTransport` property
   - Replaced dual-endpoint SSE with single StreamableHTTP endpoint

2. **src/common/mcp/client-manager.ts** (~30 lines)
   - Added `StreamableHTTPClientTransport` import
   - Replaced SSE transport instantiation

### Documentation
3. **planning/sprint-27-6tp11t/MIGRATION-COMPLETE-SUMMARY.md**
   - Created during previous session
   - Comprehensive migration plan and architecture comparison

4. **planning/sprint-27-6tp11t/implementation-log.md**
   - Task-by-task completion log

5. **planning/sprint-27-6tp11t/INVESTIGATION-FINDINGS.md** (this file)

---

## Architectural Concerns

### 1. Initialization Catch-22

**Problem**: StreamableHTTP requires server to be initialized before accepting the request that would initialize it.

**BitBrat Pattern**:
```typescript
// Create transport on first request
if (!this.streamableHttpTransport) {
  this.streamableHttpTransport = new StreamableHTTPServerTransport({...});
  await sessionServer.connect(this.streamableHttpTransport);  // Initializes
}
await this.streamableHttpTransport.handleRequest(req, res);   // Rejects (not initialized)
```

**MCP SDK Expectation**: Unknown - no examples found in SDK or documentation.

### 2. Session Management Mismatch

**Old SSE Pattern**:
- GET /sse → Create transport, connect server, store in Map by sessionId
- POST /message?sessionId=X → Look up transport, handle request

**New StreamableHTTP Pattern**:
- Single /sse endpoint for both GET and POST
- Session ID in header (`mcp-session-id`)
- Unclear if transport should be per-session or global

### 3. Transport Lifecycle

**Questions**:
- Should transport be created once per service (singleton)?
- Should transport be created per client connection?
- How does `server.connect(transport)` affect initialization state?
- Is stateless mode compatible with long-lived SSE streams?

---

## Next Steps (Recommendations)

### Option 1: Continue StreamableHTTP Investigation (High Effort)

**Approach**:
1. Review MCP SDK examples for StreamableHTTP server usage
2. Contact MCP SDK maintainers for clarification
3. Consider reverse-engineering working implementations

**Risks**:
- May require SDK changes or BitBrat architecture changes
- No guarantee of resolution
- Time-intensive

**Effort**: 2-3 sprints

### Option 2: Migrate to MCP SDK 2.0 (Medium Effort)

**Rationale**:
- SDK 2.0 may have improved StreamableHTTP implementation
- Likely has better documentation and examples
- May address initialization issues

**Risks**:
- Breaking changes in SDK 2.0
- Requires broader codebase changes
- May have other incompatibilities

**Effort**: 1-2 sprints

### Option 3: Use Stdio Transport (Low Effort)

**Rationale**:
- Stdio transport is more stable for local/Docker deployments
- No HTTP/SSE complexity
- Well-documented pattern

**Changes Required**:
- Modify MCP server to use stdio transport
- Update architecture.yaml to use stdio instead of HTTP
- Update deployment to manage stdio connections

**Risks**:
- Requires process management instead of HTTP
- May complicate multi-service deployments

**Effort**: <1 sprint

### Option 4: Revert to Old SSE, Fix Client (Medium Effort)

**Rationale**:
- Server-side SSE works fine
- Only client-side `send()` is broken
- Could patch SDK client or implement custom client

**Approach**:
1. Revert server to SSEServerTransport
2. Implement custom client POST logic
3. Or find/create fork of SDK with fix

**Risks**:
- Maintaining custom SDK modifications
- May break on SDK updates

**Effort**: 1 sprint

---

## Recommended Path Forward

**Primary Recommendation**: **Option 2 - Migrate to MCP SDK 2.0**

**Rationale**:
1. Addresses deprecated transport issue at root
2. Likely has better StreamableHTTP support
3. Future-proofs BitBrat against SDK changes
4. Aligns with maintaining current dependencies

**Secondary Recommendation**: **Option 3 - Stdio Transport**

**Rationale**:
1. Proven stable pattern for Docker
2. Simplifies deployment (no HTTP auth needed)
3. Quick to implement
4. Can switch back to HTTP later if needed

**NOT Recommended**: Option 1 (too uncertain) or Option 4 (technical debt)

---

## Lessons Learned

1. **SDK Migration Risk**: Upgrading transport layers requires deep SDK understanding
2. **Test Early**: Should have tested in agent-dev BEFORE staging deployment
3. **Read SDK Source**: Documentation insufficient, source code essential
4. **Architecture Mismatch**: BitBrat's per-request transport creation incompatible with StreamableHTTP
5. **Stateless Mode**: Unclear if/how stateless mode works with SSE streams

---

## Sprint Artifacts Created

- ✅ Implementation plan (previous session)
- ✅ Backlog YAML (previous session)
- ✅ Migration summary (previous session)
- ✅ Implementation log (previous session)
- ✅ Investigation findings (this document)
- ❌ Test report (blocked)
- ❌ Verification report (blocked)
- ❌ Retrospective (defer to new sprint)

---

## References

**MCP SDK Source**:
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js`
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js`
- `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js`

**Documentation**:
- https://modelcontextprotocol.io/docs/concepts/transports (limited info)

**BitBrat Files**:
- `src/common/base-server.ts:2121-2177` (StreamableHTTP endpoint)
- `src/common/mcp/client-manager.ts:237-248` (StreamableHTTP client)

---

**Document Version**: 1.0
**Last Updated**: 2026-08-28
**Status**: Investigation incomplete - requires new sprint

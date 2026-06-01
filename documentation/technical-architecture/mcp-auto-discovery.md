# Technical Architecture: MCP Auto-Discovery

## Status
- **Date:** 2026-05-31
- **Author:** Lead Architect (@Junie)
- **Sprint:** sprint-314-a9b8c7
- **Status:** Proposed

## 1. Problem Statement
Currently, MCP servers must be manually added to the `mcp_servers` collection in Firestore for the `tool-gateway` to discover and connect to them. This creates manual overhead and potential for configuration drift as services are deployed or updated.

## 2. Proposed Goal
Introduce a decentralized auto-discovery mechanism where any service extending `McpServer` can announce its presence and connection details upon startup.

## 3. Analysis of Proposed Approach
The proposed approach involves:
1. `McpServer` services auto-publishing registration events to a specific topic.
2. `tool-gateway` listening to this topic and upserting the server configuration to Firestore.
3. `tool-gateway`'s existing `RegistryWatcher` (using Firestore `onSnapshot`) applying the changes and establishing connections.

**Viability:** HIGH. This approach leverages existing event-driven architecture and the proven `RegistryWatcher` mechanism. It ensures that Firestore remains the canonical source of truth for the fleet while allowing dynamic updates.

**Recommendation:** RECOMMENDED. It provides good decoupling and observability.

## 4. Implementation Architecture

### 4.1 Message Bus Topic
A new topic shall be introduced:
- **Topic:** `internal.mcp.registration.v1`
- **Schema:** `InternalEventV2`

### 4.2 Registration Event Payload
The `payload` field of the `InternalEventV2` shall contain:
```json
{
  "name": "service-name",
  "transport": "sse",
  "url": "https://service-name-hash-region.a.run.app/mcp/sse",
  "status": "active",
  "env": {
    "Authorization": "Bearer <MCP_AUTH_TOKEN>"
  }
}
```

### 4.3 Service Enhancements

#### McpServer (Common Library)
- **Startup Logic:** After the HTTP server starts listening (in `BaseServer.start()`), the `McpServer` class shall publish a registration event.
- **Environment Variables:** Each service will need to be aware of its own external URL. This is ideally provided via the `MCP_EXTERNAL_URL` environment variable. If missing, it defaults to `http://{{SERVICE_NAME}}.bitbrat.local:3000/sse`.
- **Payload Generation:**
  - `name`: Derived from `this.serviceName`.
  - `url`: Derived from `process.env.MCP_EXTERNAL_URL` or the default fallback.
  - `env`: Includes `MCP_AUTH_TOKEN` if present.

#### Tool-Gateway
- **Event Listener:** A new `onMessage` handler for `internal.mcp.registration.v1`.
- **Queue Grouping:** The subscription must use a queue group (e.g., `tool-gateway`) to ensure only one instance of the gateway processes a single registration event.
- **Persistence Logic:**
  - Validate the registration payload.
  - Upsert (Create or Update) the document in Firestore collection `mcp_servers`.
  - Use the service `name` as the document ID.

### 4.4 Sequencing Diagram
1. **Service A (McpServer)** starts up.
2. **Service A** publishes `internal.mcp.registration.v1` event.
3. **tool-gateway** receives the event.
4. **tool-gateway** upserts `Service A` config to Firestore `mcp_servers/service-a`.
5. **RegistryWatcher** in **tool-gateway** detects the Firestore change.
6. **tool-gateway** connects to **Service A** via SSE.

## 5. Security Considerations
- **Authentication:** Registration events should ideally be signed or include a secret to prevent unauthorized services from registering themselves. However, since the message bus is internal, we rely on the internal network security and the `MCP_AUTH_TOKEN` requirement for the actual SSE connection.
- **Validation:** `tool-gateway` must validate the incoming URL and ensure it matches expected patterns if possible.

## 6. Alternatives Considered
- **Direct Firestore Writes:** `McpServer` could write directly to Firestore. 
  - *Pros:* Simpler (no topic needed).
  - *Cons:* Tight coupling to Firestore; no event trail; hard to extend (e.g., other services wanting to know about new tools).
- **Service Discovery API:** A dedicated discovery service.
  - *Pros:* More robust.
  - *Cons:* Overkill for current platform size.

## 7. Definition of Done for Implementation
- `McpServer` publishes registration events.
- `tool-gateway` consumes registration events and updates Firestore.
- Integration test confirms that starting an `McpServer` results in its tools appearing in `tool-gateway`.

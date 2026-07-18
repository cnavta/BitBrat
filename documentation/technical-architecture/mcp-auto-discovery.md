# Technical Architecture: MCP Auto-Discovery

## Status
- **Date:** 2026-05-31
- **Author:** Lead Architect (@Junie)
- **Sprint:** sprint-314-a9b8c7
- **Status:** Implemented

> **Bit model update (sprint-324):** registry self-publish is no longer limited to services that
> `extend McpServer`. Under the [Bit model](../concepts/bit-model.md), **every
> MCP-enabled Bit** self-publishes its registration on `Bit.start()` (gated by `mcp.exposure`). Read
> "`McpServer`" below as "any MCP-enabled `Bit`". See the
> [Bit Control-Plane Reference](../reference/bit-control-plane.md).

## 1. Problem Statement
Currently, MCP servers must be manually added to the `mcp_servers` collection/table in the database for the `tool-gateway` to discover and connect to them. This creates manual overhead and potential for configuration drift as services are deployed or updated.

## 2. Goal
Provide a decentralized auto-discovery mechanism where any **MCP-enabled Bit** announces its presence and
connection details upon startup. (Originally scoped to services extending `McpServer`; under the Bit model
this applies to every MCP-enabled Bit.)

## 3. Analysis of Proposed Approach
The proposed approach involves:
1. `McpServer` services auto-publishing registration events to a specific topic.
2. `tool-gateway` listening to this topic and upserting the server configuration to the database.
3. `tool-gateway`'s existing `RegistryWatcher` (watching database changes) applying the changes and establishing connections.

**Viability:** HIGH. This approach leverages existing event-driven architecture and the proven `RegistryWatcher` mechanism. It ensures that the database remains the canonical source of truth for the fleet while allowing dynamic updates.

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

#### Bit (Common Library)
- **Startup Logic:** After the HTTP server starts listening, **`Bit.start()`** publishes a registration
  event for every MCP-enabled Bit (this logic was previously housed in `McpServer`; it now lives in the
  base `Bit` and runs whenever `mcp.exposure` is set).
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
  - Upsert (Create or Update) the record in database collection/table `mcp_servers`.
  - Use the service `name` as the document/record ID.

### 4.4 Sequencing Diagram
1. **Service A (McpServer)** starts up.
2. **Service A** publishes `internal.mcp.registration.v1` event.
3. **tool-gateway** receives the event.
4. **tool-gateway** upserts `Service A` config to database `mcp_servers/service-a`.
5. **RegistryWatcher** in **tool-gateway** detects the database change.
6. **tool-gateway** connects to **Service A** via SSE.

## 5. Security Considerations
- **Authentication:** Registration events should ideally be signed or include a secret to prevent unauthorized services from registering themselves. However, since the message bus is internal, we rely on the internal network security and the `MCP_AUTH_TOKEN` requirement for the actual SSE connection.
- **Validation:** `tool-gateway` must validate the incoming URL and ensure it matches expected patterns if possible.

## 6. Alternatives Considered
- **Direct Database Writes:** `McpServer` could write directly to the database.
  - *Pros:* Simpler (no topic needed).
  - *Cons:* Tight coupling to persistence backend; no event trail; hard to extend (e.g., other services wanting to know about new tools).
- **Service Discovery API:** A dedicated discovery service.
  - *Pros:* More robust.
  - *Cons:* Overkill for current platform size.

## 7. Definition of Done for Implementation
- `McpServer` publishes registration events.
- `tool-gateway` consumes registration events and updates the database.
- Integration test confirms that starting an `McpServer` results in its tools appearing in `tool-gateway`.

# Serving MCP from a Bit

> **Bit model (sprint-324):** the MCP control plane has been folded down into the base abstraction, now
> named **`Bit`** (see [The Bit Model](../concepts/bit-model.md) and the
> [design doc](../architecture/bit-model-technical-architecture.md)). There is **no longer a separate
> base class to choose**: new code **`extends Bit`** and declares `mcp.exposure` (per-Bit, in
> [`architecture.yaml`](../../architecture.yaml)) or passes `mcpExposure` to the constructor.
> `McpServer` remains only as a thin, **deprecated** compatibility shim over `Bit` (it simply selects
> `platform+domain` exposure); the `BaseServer` alias has been retired.

**Every Bit speaks MCP.** Regardless of `mcp.exposure`, an MCP-enabled Bit always serves the mandatory
universal `bit.*` control plane (the Platform Ring) — see the
[Bit Control-Plane Reference](../reference/bit-control-plane.md). This page covers the additional case of
exposing your **own domain tools** (`mcp.exposure: platform+domain`) over the Model Context Protocol
(MCP) via Server-Sent Events (SSE).

## Features

- **Standardized MCP over SSE**: Automatically provides `/sse` and `/message` endpoints.
- **Type-safe Tool Registration**: Use Zod to define tool input schemas.
- **Resource & Prompt Support**: Easily expose resources and system prompts.
- **Security**: Built-in authentication token validation.
- **Observability**: Automatic logging and OpenTelemetry tracing for MCP operations.
- **Lifecycle Management**: Integrated with `Bit` for graceful shutdown and resource management.

## Usage

### 1. Create a Bit that serves domain tools

```typescript
import { Bit } from './common/base-server';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

class MyService extends Bit {
  constructor() {
    // Opt into serving domain tools over MCP. Equivalently, declare
    // services.my-mcp-service.mcp.exposure: platform+domain in architecture.yaml.
    super({ serviceName: 'my-mcp-service', mcpExposure: 'platform+domain' });

    // Register a tool
    this.registerTool(
      'get_weather',
      'Get the weather for a location',
      z.object({
        location: z.string().describe('The city and state, e.g. San Francisco, CA'),
      }),
      async ({ location }) => {
        return {
          content: [{ type: 'text', text: `The weather in ${location} is sunny.` }],
        };
      }
    );
  }
}

const server = new MyService();
server.start(3000);
```

### 2. Connect as a client

MCP clients can connect to `http://localhost:3000/sse` to establish a session and use the `/message` endpoint for JSON-RPC communication. In practice, clients reach Bits through the `tool-gateway` fabric (discovery + RBAC chokepoint); see the [`brat fleet` guide](../guides/brat-fleet.md) for the operator path.

## Security

If the `MCP_AUTH_TOKEN` environment variable is set, the server will require an `x-mcp-token` header or a `token` query parameter with the matching value.

```bash
curl http://localhost:3000/sse?token=YOUR_SECRET_TOKEN
```

## Observability

All MCP calls are logged and traced. You can find spans under `mcp.tool:<name>`, `mcp.resource:<name>`, etc.

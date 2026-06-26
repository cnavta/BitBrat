# McpServer

> **Bit model (sprint-324, Phase 3):** the MCP control plane has been folded down into the base
> abstraction, now named **`Bit`** (see `documentation/architecture/bit-model-technical-architecture.md`).
> New code should **`extend Bit`** and declare `mcp.exposure` (per-Bit, in `architecture.yaml`) or pass
> `mcpExposure: 'platform+domain'` to the constructor — there is no longer a separate base class to
> choose. `McpServer` remains only as a thin, deprecated compatibility shim over `Bit` (it simply
> selects `platform+domain` exposure); the previous `BaseServer` alias has been retired. The guidance
> below is preserved for reference, with `Bit` as the base class.

Every MCP-enabled `Bit` provides built-in support for the Model Context Protocol (MCP) over
Server-Sent Events (SSE).

## Features

- **Standardized MCP over SSE**: Automatically provides `/sse` and `/message` endpoints.
- **Type-safe Tool Registration**: Use Zod to define tool input schemas.
- **Resource & Prompt Support**: Easily expose resources and system prompts.
- **Security**: Built-in authentication token validation.
- **Observability**: Automatic logging and OpenTelemetry tracing for MCP operations.
- **Lifecycle Management**: Integrated with `Bit` for graceful shutdown and resource management.

## Usage

### 1. Create a server

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

MCP clients can connect to `http://localhost:3000/sse` to establish a session and use the `/message` endpoint for JSON-RPC communication.

## Security

If the `MCP_AUTH_TOKEN` environment variable is set, the server will require an `x-mcp-token` header or a `token` query parameter with the matching value.

```bash
curl http://localhost:3000/sse?token=YOUR_SECRET_TOKEN
```

## Observability

All MCP calls are logged and traced. You can find spans under `mcp.tool:<name>`, `mcp.resource:<name>`, etc.

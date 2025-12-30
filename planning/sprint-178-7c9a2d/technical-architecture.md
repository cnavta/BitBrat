# Technical Architecture: McpServer Subclass

## 1. Objective
The primary goal is to provide a standardized, reusable subclass of `BaseServer` called `McpServer`. This class will enable any BitBrat service to expose its internal capabilities (tools, resources, and prompts) as an MCP (Model Context Protocol) server over SSE (Server-Sent Events), while maintaining full compatibility with the existing `BaseServer` lifecycle and features.

## 2. Background
Currently, the `llm-bot` service acts as an MCP client, connecting to external servers (like `obs-mcp`). By introducing `McpServer`, we allow BitBrat services to natively export their own functionality to the `llm-bot` or other MCP-compliant clients without needing separate adapter processes.

## 3. Class Design

### 3.1 Inheritance
`McpServer` will extend `BaseServer`.

```typescript
export class McpServer extends BaseServer {
  private mcpServer: Server;
  private transport?: SSEServerTransport;
  // ...
}
```

### 3.2 Core Dependencies
- `@modelcontextprotocol/sdk/server/index.js` (for the `Server` class)
- `@modelcontextprotocol/sdk/server/sse.js` (for `SSEServerTransport`)

## 4. MCP Integration

### 4.1 Automatic Route Setup
`McpServer` will automatically register the following Express routes during initialization:
- `GET /sse`: Establishes the SSE connection.
- `POST /message`: Receives MCP JSON-RPC messages from the client.

### 4.2 Registration APIs
The class will provide high-level methods to simplify MCP resource registration. It will leverage `zod` where possible for type-safe handlers:

- `registerTool<T extends z.ZodType>(name: string, description: string, schema: T, handler: (args: z.infer<T>) => Promise<CallToolResult>)`
- `registerResource(uri: string, name: string, description: string, handler: (uri: string) => Promise<ReadResourceResult>)`
- `registerPrompt(name: string, description: string, args: PromptArg[], handler: (name: string, args: any) => Promise<GetPromptResult>)`

### 4.3 Lifecycle Integration
- **Startup**: The MCP server instance will be created in the constructor or during `start()`. 
- **Shutdown**: The `close()` method will be overridden to ensure the MCP transport and server are gracefully disconnected.

## 5. Proposed Internal Structure

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { BaseServer, BaseServerOptions } from "./base-server";

export class McpServer extends BaseServer {
  protected readonly mcpServer: Server;

  constructor(opts: BaseServerOptions = {}) {
    super(opts);
    this.mcpServer = new Server({
      name: opts.serviceName || 'bitbrat-mcp-server',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      }
    });
    
    this.setupMcpRoutes();
  }

  private setupMcpRoutes() {
    this.onHTTPRequest('/sse', async (req, res) => {
      const transport = new SSEServerTransport("/message", res);
      this.transports.set(transport.sessionId, transport);
      
      transport.onclose = () => {
        this.transports.delete(transport.sessionId);
      };

      await this.mcpServer.connect(transport);
    });

    this.onHTTPRequest({ path: '/message', method: 'POST' }, async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = this.transports.get(sessionId);
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(404).send("Session not found");
      }
    });
  }

  // Helper methods for registration...
}
```

## 6. Security & Observability
- **Logging**: MCP requests and errors will be logged via `this.getLogger()`.
- **Auth**: If `MCP_AUTH_TOKEN` is present in environment variables, the `/sse` and `/message` endpoints should validate it.
- **Tracing**: Critical MCP operations (like tool execution) will be wrapped in OpenTelemetry spans.

## 7. Definition of Done for implementation
1. `McpServer` class implemented in `src/common/mcp-server.ts`.
2. Support for SSE transport.
3. Ability to register tools and have them called by a client.
4. Unit tests verifying the SSE connection and tool execution.
5. README/Documentation updated.

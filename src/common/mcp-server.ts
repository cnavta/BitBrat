import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolResult,
  GetPromptResult,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceResult,
  CallToolRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BaseServer, BaseServerOptions } from "./base-server";
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * McpServer
 * - Extends BaseServer to provide Model Context Protocol (MCP) capabilities.
 * - Supports tools, resources, and prompts registration.
 * - Provides SSE transport for MCP clients.
 */
export class McpServer extends BaseServer {
  protected readonly mcpServer: Server;
  protected readonly transports: Map<string, SSEServerTransport> = new Map();

  // Internal registries for discovery
  private readonly registeredTools: Map<string, { description: string; schema: any; handler: (args: any) => Promise<CallToolResult> }> = new Map();
  private readonly registeredResources: Map<string, { name: string; description: string; handler: (uri: string) => Promise<ReadResourceResult> }> = new Map();
  private readonly registeredPrompts: Map<string, { description: string; args: { name: string; description?: string; required?: boolean }[]; handler: (name: string, args: Record<string, string>) => Promise<GetPromptResult> }> = new Map();

  /**
   * Creates an instance of McpServer.
   * @param opts - Configuration options for the server.
   */
  constructor(opts: BaseServerOptions = {}) {
    super(opts);

    const arch = McpServer.loadArchitectureYaml();
    const svcNode = arch?.services?.[this.serviceName] || {};
    const description = svcNode.description || "BitBrat MCP Server";
    const version = arch?.project?.version || "1.0.0";

    this.mcpServer = new Server(
      {
        name: this.serviceName,
        version: version,
        description: description,
      } as any,
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.setupMcpRoutes();
    this.setupDiscoveryHandlers();
  }

  /**
   * Register a tool with type-safe Zod schema validation.
   */
  public registerTool<T extends z.ZodType>(
    name: string,
    description: string,
    schema: T,
    handler: (args: z.infer<T>) => Promise<CallToolResult>
  ) {
    this.registeredTools.set(name, { description, schema, handler });
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.registeredTools.get(request.params.name);
      if (!tool) throw new Error(`Tool not found: ${request.params.name}`);
      const args = tool.schema.parse(request.params.arguments);
      return await this.traceMcpOperation(`tool:${request.params.name}`, () => tool.handler(args));
    });
    this.getLogger().info("mcp_server.tool_registered", { name });
  }

  /**
   * Register a resource.
   */
  public registerResource(
    uri: string,
    name: string,
    description: string,
    handler: (uri: string) => Promise<ReadResourceResult>
  ) {
    this.registeredResources.set(uri, { name, description, handler });
    this.mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const resource = this.registeredResources.get(request.params.uri);
      if (!resource) throw new Error(`Resource not found: ${request.params.uri}`);
      return await this.traceMcpOperation(`resource:${resource.name}`, () => resource.handler(request.params.uri));
    });
    this.getLogger().info("mcp_server.resource_registered", { name, uri });
  }

  /**
   * Register a prompt.
   */
  public registerPrompt(
    name: string,
    description: string,
    args: { name: string; description?: string; required?: boolean }[],
    handler: (
      name: string,
      args: Record<string, string>
    ) => Promise<GetPromptResult>
  ) {
    this.registeredPrompts.set(name, { description, args, handler });
    this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = this.registeredPrompts.get(request.params.name);
      if (!prompt) throw new Error(`Prompt not found: ${request.params.name}`);
      return await this.traceMcpOperation(`prompt:${request.params.name}`, () => 
        prompt.handler(request.params.name, (request.params.arguments as Record<string, string>) || {})
      );
    });
    this.getLogger().info("mcp_server.prompt_registered", { name });
  }

  private setupDiscoveryHandlers() {
    // tools/list
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Array.from(this.registeredTools.entries()).map(([name, { description, schema }]) => {
        const jsonSchema = zodToJsonSchema(schema);
        return {
          name,
          description,
          inputSchema: jsonSchema as any,
        };
      });
      return { tools };
    });

    // resources/list
    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Array.from(this.registeredResources.entries()).map(([uri, { name, description }]) => ({
        uri,
        name,
        description,
      }));
      return { resources };
    });

    // prompts/list
    this.mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = Array.from(this.registeredPrompts.entries()).map(([name, { description, args }]) => ({
        name,
        description,
        arguments: args,
      }));
      return { prompts };
    });
  }

  /**
   * Helper to wrap MCP operations in OpenTelemetry spans if available.
   */
  private async traceMcpOperation<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const tracer = (this as any).getTracer?.();
    if (tracer && typeof tracer.startActiveSpan === "function") {
      return await tracer.startActiveSpan(
        `mcp.${operation}`,
        async (span: any) => {
          try {
            const result = await fn();
            return result;
          } catch (error) {
            span.recordException(error as Error);
            throw error;
          } finally {
            span.end();
          }
        }
      );
    }
    return await fn();
  }

  /**
   * Execute a registered tool by name with arguments.
   * Useful for internal calls and testing without going through SSE.
   */
  public async executeTool(name: string, args: any): Promise<CallToolResult> {
    const tool = this.registeredTools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    const validatedArgs = tool.schema.parse(args);
    return await this.traceMcpOperation(`tool:${name}`, () => tool.handler(validatedArgs));
  }

  private setupMcpRoutes() {
    const authMiddleware = (
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      const authToken = process.env.MCP_AUTH_TOKEN;
      if (authToken) {
        const providedToken = req.headers["x-mcp-token"] || req.query.token;
        if (providedToken !== authToken) {
          this.getLogger().warn("mcp_server.auth_failed", {
            path: req.path,
            ip: req.ip,
          });
          res.status(401).send("Unauthorized");
          return;
        }
      }
      next();
    };

    this.onHTTPRequest("/sse", (req: Request, res: Response) => {
      authMiddleware(req, res, async () => {
        this.getLogger().info("mcp_server.sse_connection_attempt", {
          sessionId: req.query.sessionId,
        });

        const transport = new SSEServerTransport("/message", res);
        this.transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          this.getLogger().info("mcp_server.transport_closed", {
            sessionId: transport.sessionId,
          });
          this.transports.delete(transport.sessionId);
        };

        try {
          await this.mcpServer.connect(transport);
          this.getLogger().info("mcp_server.connected", {
            sessionId: transport.sessionId,
          });
        } catch (error) {
          this.getLogger().error("mcp_server.connect_error", {
            error,
            sessionId: transport.sessionId,
          });
          this.transports.delete(transport.sessionId);
          if (!res.headersSent) {
            res.status(500).send("Connection error");
          }
        }
      });
    });

    this.onHTTPRequest(
      { path: "/message", method: "POST" },
      (req: Request, res: Response) => {
        authMiddleware(req, res, async () => {
          const sessionId = req.query.sessionId as string;
          if (!sessionId) {
            if (!res.headersSent) {
              res.status(400).send("sessionId is required");
            }
            return;
          }

          const transport = this.transports.get(sessionId);
          if (transport) {
            try {
              await transport.handlePostMessage(req, res);
            } catch (error) {
              this.getLogger().error("mcp_server.message_handle_error", {
                error,
                sessionId,
              });
              if (!res.headersSent) {
                res.status(500).send("Error handling message");
              }
            }
          } else {
            this.getLogger().warn("mcp_server.session_not_found", { sessionId });
            if (!res.headersSent) {
              res.status(404).send("Session not found");
            }
          }
        });
      }
    );
  }

  /**
   * Override close to ensure all MCP transports are closed.
   */
  public async close(reason: string = "manual"): Promise<void> {
    this.getLogger().info("mcp_server.closing", { reason, activeTransports: this.transports.size });
    
    // SSEServerTransport doesn't have an explicit close(), 
    // but we should probably tell the Server to shut down if needed.
    // However, usually we just let the connection close naturally or via onclose.
    
    for (const transport of this.transports.values()) {
      // In some versions of the SDK, we might need to send a close event or similar.
      // For now, the BaseServer close will close the HTTP server which will terminate SSE.
    }
    
    await super.close(reason);
  }
}

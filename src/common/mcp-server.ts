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

export class McpServer extends BaseServer {
  protected readonly mcpServer: Server;
  protected readonly transports: Map<string, SSEServerTransport> = new Map();

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

    // MCP ServerInfo doesn't natively support description in the constructor, 
    // but some clients might expect it or we can add it to instructions/capabilities if needed.
    // For now, we align with the spec's InitializeResult which returns name and version.
    // If the user meant for the LLM to see the description, it's already in architecture.yaml 
    // which the LLM reads.

    this.setupMcpRoutes();
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
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== name) {
        throw new Error(`Tool not found: ${request.params.name}`);
      }
      return await this.traceMcpOperation(`tool:${name}`, async () => {
        const args = schema.parse(request.params.arguments);
        return await handler(args);
      });
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
    this.mcpServer.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        if (request.params.uri !== uri) {
          throw new Error(`Resource not found: ${request.params.uri}`);
        }
        return await this.traceMcpOperation(`resource:${name}`, async () => {
          return await handler(request.params.uri);
        });
      }
    );
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
    this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name !== name) {
        throw new Error(`Prompt not found: ${request.params.name}`);
      }
      return await this.traceMcpOperation(`prompt:${name}`, async () => {
        return await handler(
          request.params.name,
          (request.params.arguments as Record<string, string>) || {}
        );
      });
    });
    this.getLogger().info("mcp_server.prompt_registered", { name });
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
        }
      });
    });

    this.onHTTPRequest(
      { path: "/message", method: "POST" },
      (req: Request, res: Response) => {
        authMiddleware(req, res, async () => {
          const sessionId = req.query.sessionId as string;
          if (!sessionId) {
            res.status(400).send("sessionId is required");
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
            res.status(404).send("Session not found");
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

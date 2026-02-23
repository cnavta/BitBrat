import { McpServer } from '../common/mcp-server';
import { Express, Request, Response } from 'express';

const SERVICE_NAME = process.env.SERVICE_NAME || 'tool-gateway';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

class ToolGatewayServer extends McpServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any);
  }

  private setupApp(app: Express) {
    // Health endpoint
    this.onHTTPRequest('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', service: SERVICE_NAME, ts: new Date().toISOString() });
    });

    // MCP SSE endpoints are registered by McpServer constructor (/sse and /message)
  }
}

export function createApp() {
  const server = new ToolGatewayServer();
  return server.getApp();
}

if (require.main === module) {
  const server = new ToolGatewayServer();
  void server.start(PORT);
}

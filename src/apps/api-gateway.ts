import { Request, Response } from 'express';
import { McpServer } from '../common/mcp-server';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { Firestore } from 'firebase-admin/firestore';
import { AuthService } from '../services/api-gateway/auth';
import { IngressManager } from '../services/api-gateway/ingress';
import { EgressManager } from '../services/api-gateway/egress';
import { PublisherResource } from '../common/resources/publisher-manager';
import { InternalEventV2 } from '../types/events';

/**
 * ApiGatewayServer
 * WebSocket gateway for the BitBrat Platform.
 */
export class ApiGatewayServer extends McpServer {
  private wss: WebSocketServer | undefined;
  private httpServer: http.Server | undefined;
  private authService: AuthService | undefined;
  private ingressManager: IngressManager | undefined;
  private egressManager: EgressManager | undefined;

  // Track connections by user_id for egress routing
  private userConnections: Map<string, Set<WebSocket>> = new Map();

  constructor() {
    super();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.onHTTPRequest('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
    });
  }

  /**
   * Overrides start to also initialize WebSocket server
   */
  public async start(port: number, host = '0.0.0.0'): Promise<void> {
    // initializeResources is private in BaseServer, but called by constructor if not overridden.
    // However, BaseServer constructor calls this.initializeResources().
    // Let's check McpServer constructor.
    
    // In our case, we want to ensure resources are ready.
    // BaseServer.start doesn't call initializeResources, it assumes they are ready from constructor.
    // But BaseServer constructor calls it.
    
    const firestore = this.getResource<Firestore>('firestore');
    if (!firestore) {
      this.getLogger().error('api_gateway.firestore_not_found');
      throw new Error('Firestore resource required');
    }

    const publishers = this.getResource<PublisherResource>('publishers');
    if (!publishers) {
      this.getLogger().error('api_gateway.publishers_not_found');
      throw new Error('Publisher resource required');
    }

    this.authService = new AuthService(firestore, this.getLogger());
    this.ingressManager = new IngressManager(publishers, this.getLogger());
    this.egressManager = new EgressManager(this.userConnections, this.getLogger());

    this.httpServer = http.createServer(this.getApp());
    
    this.wss = new WebSocketServer({ 
      noServer: true, // We will handle upgrade manually for auth
      path: '/ws/v1'
    });

    // Subscribe to instance-specific egress topic
    const instanceId = process.env.K_REVISION || process.env.EGRESS_INSTANCE_ID || process.env.HOSTNAME || 'local';
    const egressTopic = `internal.api.egress.v1.${instanceId}`;
    await this.onMessage<InternalEventV2>(egressTopic, async (evt) => {
      await this.egressManager?.handleEgressEvent(evt);
    });

    this.httpServer.on('upgrade', async (request, socket, head) => {
      const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

      if (pathname === '/ws/v1') {
        const authHeader = request.headers['authorization'];
        let token: string | undefined;

        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7);
        }

        if (!token) {
          this.getLogger().warn('api_gateway.auth.missing_token', { remoteAddress: request.socket.remoteAddress });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const userId = await this.authService?.validateToken(token);
        if (!userId) {
          this.getLogger().warn('api_gateway.auth.invalid_token', { remoteAddress: request.socket.remoteAddress });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss?.handleUpgrade(request, socket, head, (ws) => {
          this.wss?.emit('connection', ws, request, userId);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, userId: string) => {
      this.getLogger().info('api_gateway.ws.connected', { userId });
      
      // Register connection
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)?.add(ws);

      // Send connection ready
      ws.send(JSON.stringify({
        type: 'connection.ready',
        payload: { user_id: userId },
        metadata: { timestamp: new Date().toISOString() }
      }));

      ws.on('message', async (data) => {
        try {
          await this.ingressManager?.handleMessage(userId, data.toString());
        } catch (err: any) {
          ws.send(JSON.stringify({
            type: 'chat.error',
            payload: { message: err.message },
            metadata: { timestamp: new Date().toISOString() }
          }));
        }
      });

      ws.on('close', () => {
        this.getLogger().info('api_gateway.ws.disconnected', { userId });
        const userConns = this.userConnections.get(userId);
        if (userConns) {
          userConns.delete(ws);
          if (userConns.size === 0) {
            this.userConnections.delete(userId);
          }
        }
      });

      ws.on('error', (err) => {
        this.getLogger().error('api_gateway.ws.error', { userId, error: err.message });
      });
    });

    return new Promise((resolve) => {
      this.httpServer?.listen(port, host, () => {
        this.getLogger().info('api_gateway.started', { port, host, path: '/ws/v1', egressTopic });
        resolve();
      });
    });
  }

  public async close(reason: string = 'manual'): Promise<void> {
    this.getLogger().info('api_gateway.closing', { reason });
    
    if (this.wss) {
      this.wss.close();
    }
    
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => resolve());
      });
    }

    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new ApiGatewayServer();
  const port = parseInt(process.env.PORT || '8080', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start api-gateway:', err);
    process.exit(1);
  });
}

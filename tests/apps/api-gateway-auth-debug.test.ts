import { ApiGatewayServer } from '../../src/apps/api-gateway';
import { WebSocket } from 'ws';

// Mock dependencies
jest.mock('../../src/services/api-gateway/auth');
jest.mock('../../src/services/api-gateway/ingress');
jest.mock('../../src/services/api-gateway/egress');
jest.mock('../../src/services/message-bus', () => ({
  createMessageSubscriber: jest.fn().mockReturnValue({
    subscribe: jest.fn().mockResolvedValue(jest.fn())
  }),
  createMessagePublisher: jest.fn().mockReturnValue({
    publishJson: jest.fn().mockResolvedValue({ messageId: '123' })
  })
}));

describe('ApiGatewayServer - Auth Debug', () => {
  let server: ApiGatewayServer;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.API_GATEWAY_ALLOW_ANONYMOUS_WS;
    server = new ApiGatewayServer();
    (server as any).getResource = jest.fn().mockImplementation((name: string) => {
      if (name === 'firestore') return {};
      if (name === 'publisher') return { create: jest.fn().mockReturnValue({ publishJson: jest.fn() }) };
      return undefined;
    });
  });

  afterEach(async () => {
    await server.close('test');
  });

  it('should allow anonymous connection when API_GATEWAY_ALLOW_ANONYMOUS_WS is true', async () => {
    process.env.API_GATEWAY_ALLOW_ANONYMOUS_WS = 'true';
    await server.start(0);
    const address = (server as any).httpServer.address();
    const port = address.port;

    const ws = new WebSocket(`ws://localhost:${port}/ws/v1`);
    
    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.close();
        resolve(true);
      });
      ws.on('error', (err) => {
        reject(err);
      });
      ws.on('unexpected-response', (req, res) => {
        if (res.statusCode === 401) {
          reject(new Error('Unauthorized'));
        } else {
          reject(new Error(`Unexpected response: ${res.statusCode}`));
        }
      });
    });
  });

  it('should deny anonymous connection when API_GATEWAY_ALLOW_ANONYMOUS_WS is false', async () => {
    process.env.API_GATEWAY_ALLOW_ANONYMOUS_WS = 'false';
    await server.start(0);
    const address = (server as any).httpServer.address();
    const port = address.port;

    const ws = new WebSocket(`ws://localhost:${port}/ws/v1`);
    
    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.close();
        reject(new Error('Should not have opened'));
      });
      ws.on('unexpected-response', (req, res) => {
        if (res.statusCode === 401) {
          resolve(true);
        } else {
          reject(new Error(`Unexpected response: ${res.statusCode}`));
        }
      });
      ws.on('error', (err) => {
         // Some versions of WS might emit error on 401
         resolve(true);
      });
      // Timeout if neither happens
      setTimeout(() => reject(new Error('Timeout')), 2000);
    });
  });

  it('should still allow authenticated connection when API_GATEWAY_ALLOW_ANONYMOUS_WS is false', async () => {
    process.env.API_GATEWAY_ALLOW_ANONYMOUS_WS = 'false';
    await server.start(0);
    
    const authServiceMock = (server as any).authService;
    authServiceMock.validateToken.mockResolvedValue('user-123');

    const address = (server as any).httpServer.address();
    const port = address.port;

    const ws = new WebSocket(`ws://localhost:${port}/ws/v1`, {
      headers: {
        'authorization': 'Bearer valid-token'
      }
    });
    
    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.close();
        resolve(true);
      });
      ws.on('error', (err) => {
        reject(err);
      });
      ws.on('unexpected-response', (req, res) => {
        reject(new Error(`Unexpected response: ${res.statusCode}`));
      });
    });
  });
});

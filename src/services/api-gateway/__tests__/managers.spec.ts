import { IngressManager } from '../ingress';
import { EgressManager, EgressResult } from '../egress';
import { WebSocket } from 'ws';

describe('Ingress and Egress Managers', () => {
  let mockPublisher: any;
  let mockPublishers: any;
  let mockLogger: any;
  let userConnections: Map<string, Set<WebSocket>>;

  beforeEach(() => {
    mockPublisher = {
      publishJson: jest.fn().mockResolvedValue({ messageId: '123' })
    };
    mockPublishers = {
      create: jest.fn().mockReturnValue(mockPublisher)
    };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    userConnections = new Map();
  });

  describe('IngressManager', () => {
    it('should publish valid chat message frames', async () => {
      const ingress = new IngressManager(mockPublishers, mockLogger);
      const userId = 'user-123';
      const payload = { text: 'hello', channel: '#general' };
      const frame = JSON.stringify({
        type: 'chat.message.send',
        payload
      });

      await ingress.handleMessage(userId, frame);

      expect(mockPublishers.create).toHaveBeenCalledWith('internal.ingress.v1');
      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat.message.v1',
          identity: expect.objectContaining({
            external: expect.objectContaining({ id: userId })
          }),
          ingress: expect.objectContaining({
            source: 'api-gateway',
            channel: '#general'
          }),
          payload
        }),
        expect.anything()
      );
    });

    it('should throw error for invalid frames', async () => {
      const ingress = new IngressManager(mockPublishers, mockLogger);
      await expect(ingress.handleMessage('u', 'invalid json')).rejects.toThrow();
      await expect(ingress.handleMessage('u', JSON.stringify({ payload: {} }))).rejects.toThrow();
    });
  });

  describe('EgressManager', () => {
    it('should forward messages to all user connections', async () => {
      const mockWs1 = { send: jest.fn(), readyState: WebSocket.OPEN } as any;
      const mockWs2 = { send: jest.fn(), readyState: WebSocket.OPEN } as any;
      userConnections.set('user-123', new Set([mockWs1, mockWs2]));

      const egress = new EgressManager(userConnections, mockLogger);
      const event = {
        v: '2',
        type: 'chat.message.v1',
        identity: { external: { id: 'user-123', platform: 'test' } },
        correlationId: 'c-1',
        ingress: { source: 'api-gateway', ingressAt: new Date().toISOString() },
        payload: { text: 'reply' }
      } as any;

      const result = await egress.handleEgressEvent(event);

      expect(result).toBe(EgressResult.DELIVERED);
      expect(mockWs1.send).toHaveBeenCalledWith(expect.stringContaining('chat.message.received'));
      expect(mockWs2.send).toHaveBeenCalledWith(expect.stringContaining('chat.message.received'));
      expect(mockWs1.send).toHaveBeenCalledWith(expect.stringContaining('reply'));
    });

    it('should treat dm.message.v1 the same as chat.message.v1', async () => {
      const mockWs = { send: jest.fn(), readyState: WebSocket.OPEN } as any;
      userConnections.set('user-123', new Set([mockWs]));

      const egress = new EgressManager(userConnections, mockLogger);
      const event = {
        v: '2',
        type: 'dm.message.v1',
        identity: { external: { id: 'user-123', platform: 'test' } },
        correlationId: 'c-dm',
        ingress: { source: 'llm-bot', ingressAt: new Date().toISOString() },
        payload: { text: 'private reply' }
      } as any;

      const result = await egress.handleEgressEvent(event);

      expect(result).toBe(EgressResult.DELIVERED);
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('chat.message.received'));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('private reply'));
    });

    it('should return NOT_FOUND if no active connections', async () => {
      const egress = new EgressManager(userConnections, mockLogger);
      const event = { 
        identity: { external: { id: 'user-456', platform: 'test' } }, 
        ingress: { source: 'api-gateway', ingressAt: new Date().toISOString() } 
      } as any;
      const result = await egress.handleEgressEvent(event);
      expect(result).toBe(EgressResult.NOT_FOUND);
      expect(mockLogger.debug).toHaveBeenCalledWith('egress.no_active_connections', expect.anything());
    });

    it('should return IGNORED if destination is not api-gateway', async () => {
      const egress = new EgressManager(userConnections, mockLogger);
      const event = { 
        identity: { external: { id: 'user-123', platform: 'twitch' } }, 
        egress: { destination: 'twitch' },
        ingress: { source: 'ingress.twitch', ingressAt: new Date().toISOString() }
      } as any;
      const result = await egress.handleEgressEvent(event);
      expect(result).toBe(EgressResult.IGNORED);
    });
  });
});

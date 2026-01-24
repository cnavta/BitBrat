import { AuthServer } from '../../src/apps/auth-service';
import { BaseServer } from '../../src/common/base-server';

// Mock message bus
const publishJsonMock = jest.fn(async () => {});
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: () => ({
    publishJson: publishJsonMock,
  }),
  createMessageSubscriber: () => ({
    subscribe: jest.fn(async () => () => {}),
  }),
}));

describe('AuthServer Admin Tools', () => {
  let server: AuthServer;
  let dbMock: any;
  let pubResMock: any;

  beforeEach(() => {
    jest.clearAllMocks();

    dbMock = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };

    pubResMock = {
      create: jest.fn().mockReturnValue({
        publishJson: publishJsonMock,
      }),
    };

    jest.spyOn(BaseServer.prototype as any, 'getResource').mockImplementation((...args: any[]) => {
      const name = args[0];
      if (name === 'firestore') return dbMock;
      if (name === 'publisher') return pubResMock;
      return undefined;
    });

    server = new AuthServer();
  });

  describe('create_api_token', () => {
    it('generates a token, stores it in Firestore, and publishes an event', async () => {
      const userId = 'twitch:123';
      const userDoc = { id: userId, displayName: 'TestUser', roles: [] };

      // Mock user lookup in userRepo.getById
      dbMock.get.mockResolvedValueOnce({
        exists: true,
        id: userId,
        data: () => userDoc,
      });

      // Get the tool handler
      const tools = (server as any).registeredTools;
      const tool = tools.get('create_api_token');
      expect(tool).toBeDefined();

      const result = await tool.handler({ userId });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('API token created');
      expect(result.content[0].text).toContain('Raw Token:');

      // Verify Firestore storage
      expect(dbMock.collection).toHaveBeenCalledWith('gateways/api/tokens');
      const hash = dbMock.doc.mock.calls[1][0]; // call 0 was for users collection, call 1 for tokens
      expect(hash).toHaveLength(64); // SHA-256 hex
      
      expect(dbMock.set).toHaveBeenCalledWith(expect.objectContaining({
        user_id: userId,
        created_at: expect.any(Date),
        token_hash: hash,
      }));

      // Verify Event publishing
      expect(publishJsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'token.created.v1',
          userId: userId,
          payload: expect.objectContaining({
            user_id: userId,
            raw_token: expect.any(String),
            token_hash: hash,
          }),
        }),
        expect.objectContaining({
          type: 'token.created.v1',
        })
      );
      
      const publishedEvent = (publishJsonMock.mock.calls as any)[0][0];
      expect(publishedEvent.payload.raw_token).toHaveLength(64); // 32 bytes hex
    });

    it('resolves userId by displayName if userId is missing', async () => {
      const userId = 'twitch:456';
      const displayName = 'Seeker';

      // searchUsers lookup (mocking the collection('users').where(...).get() chain)
      dbMock.get.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: userId, data: () => ({ displayName, roles: [] }) }],
      });
      // getById lookup (mocking the collection('users').doc(userId).get() chain)
      dbMock.get.mockResolvedValueOnce({
        exists: true,
        id: userId,
        data: () => ({ id: userId, displayName, roles: [] }),
      });

      const tool = (server as any).registeredTools.get('create_api_token');
      const result = await tool.handler({ displayName });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain(`API token created for Seeker`);
      expect(dbMock.set).toHaveBeenCalledWith(expect.objectContaining({
        user_id: userId
      }));
    });

    it('returns error if user not found', async () => {
      dbMock.get.mockResolvedValueOnce({ exists: false });

      const tool = (server as any).registeredTools.get('create_api_token');
      const result = await tool.handler({ userId: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('User not found.');
    });
  });
});

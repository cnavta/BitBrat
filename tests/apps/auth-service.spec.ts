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

      // Mock user lookup in userRepo.getById (called twice now: remediation check + final user load)
      dbMock.get.mockResolvedValue({
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

      // Verify Firestore storage
      expect(dbMock.collection).toHaveBeenCalledWith('gateways/api/tokens');
      // Look for the call where the doc name is a 64-char hex string
      const hashCall = dbMock.doc.mock.calls.find((call: any[]) => call[0].length === 64);
      expect(hashCall).toBeDefined();
      const hash = hashCall[0];
      
      expect(dbMock.set).toHaveBeenCalledWith(expect.objectContaining({
        user_id: userId,
        created_at: expect.any(Date),
        token_hash: hash,
      }));

      // Verify Event publishing
      expect(publishJsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'token.created.v1',
          v: '2',
          identity: expect.objectContaining({
            external: expect.objectContaining({ id: '123', platform: 'twitch' })
          }),
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

    it('resolves userId if provided as platform:displayName (repro)', async () => {
      const userId = 'twitch:123';
      const displayNameInput = 'twitch:Gonj_The_Unjust';
      const displayName = 'Gonj_The_Unjust';

      // 1. Initial getById fails for 'twitch:Gonj_The_Unjust'
      dbMock.get.mockResolvedValueOnce({ exists: false });

      // 2. searchUsers lookup for 'Gonj_The_Unjust'
      dbMock.get.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: userId, data: () => ({ displayName, roles: [] }) }],
      });

      // 3. getById lookup for 'twitch:123'
      dbMock.get.mockResolvedValueOnce({
        exists: true,
        id: userId,
        data: () => ({ id: userId, displayName, roles: [] }),
      });

      const tool = (server as any).registeredTools.get('create_api_token');
      const result = await tool.handler({ userId: displayNameInput });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain(`API token created for ${displayName}`);
      expect(dbMock.set).toHaveBeenCalledWith(expect.objectContaining({
        user_id: userId
      }));
    });
  });
});

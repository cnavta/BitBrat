import { DocumentStoreUserRepo, AuthUserDoc } from '../user-repo';
import type { IDocumentStore, QueryOptions } from '../../../common/persistence/interfaces';

describe('DocumentStoreUserRepo', () => {
  let mockStore: jest.Mocked<IDocumentStore>;
  let repo: DocumentStoreUserRepo;

  beforeEach(() => {
    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      query: jest.fn(),
      getAll: jest.fn(),
      batch: jest.fn(),
      watch: jest.fn(),
      health: jest.fn(),
      close: jest.fn(),
    } as jest.Mocked<IDocumentStore>;

    repo = new DocumentStoreUserRepo(mockStore, 'auth_users');
  });

  describe('getById', () => {
    it('should return null for empty id', async () => {
      const result = await repo.getById('');
      expect(result).toBeNull();
      expect(mockStore.get).not.toHaveBeenCalled();
    });

    it('should return null when user not found', async () => {
      mockStore.get.mockResolvedValue(null);
      const result = await repo.getById('user-123');
      expect(result).toBeNull();
      expect(mockStore.get).toHaveBeenCalledWith('auth_users', 'user-123');
    });

    it('should return user document when found', async () => {
      const mockUser: AuthUserDoc = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['user'],
        provider: 'twitch',
      };

      mockStore.get.mockResolvedValue(mockUser);

      const result = await repo.getById('user-123');

      expect(result).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['user'],
        provider: 'twitch',
        notes: undefined,
        profile: undefined,
        rolesMeta: undefined,
        status: undefined,
        firstSeenAt: undefined,
        lastSeenAt: undefined,
        lastMessageAt: undefined,
        messageCountAllTime: undefined,
        lastSessionId: undefined,
        lastSessionStartedAt: undefined,
        lastSessionActivityAt: undefined,
        sessionCount: undefined,
        tags: undefined,
      });
    });
  });

  describe('getByEmail', () => {
    it('should return null for empty email', async () => {
      const result = await repo.getByEmail('');
      expect(result).toBeNull();
      expect(mockStore.query).not.toHaveBeenCalled();
    });

    it('should return null when no user found', async () => {
      mockStore.query.mockResolvedValue([]);
      const result = await repo.getByEmail('test@example.com');
      expect(result).toBeNull();
      expect(mockStore.query).toHaveBeenCalledWith('auth_users', {
        filters: [{ field: 'email', operator: '==', value: 'test@example.com' }],
        limit: 1,
      });
    });

    it('should return user when found by email', async () => {
      const mockUser: AuthUserDoc = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['user'],
      };

      mockStore.query.mockResolvedValue([mockUser]);

      const result = await repo.getByEmail('test@example.com');

      expect(result?.id).toBe('user-123');
      expect(result?.email).toBe('test@example.com');
    });
  });

  describe('searchUsers', () => {
    it('should query by email filter', async () => {
      mockStore.query.mockResolvedValue([]);
      await repo.searchUsers({ email: 'test@example.com' });

      expect(mockStore.query).toHaveBeenCalledWith('auth_users', {
        filters: [{ field: 'email', operator: '==', value: 'test@example.com' }],
      });
    });

    it('should query by multiple filters', async () => {
      mockStore.query.mockResolvedValue([]);
      await repo.searchUsers({
        email: 'test@example.com',
        provider: 'twitch',
      });

      expect(mockStore.query).toHaveBeenCalledWith('auth_users', {
        filters: [
          { field: 'email', operator: '==', value: 'test@example.com' },
          { field: 'provider', operator: '==', value: 'twitch' },
        ],
      });
    });

    it('should return mapped results', async () => {
      const mockUsers: AuthUserDoc[] = [
        { id: 'user-1', email: 'user1@example.com', displayName: 'User 1', roles: [] },
        { id: 'user-2', email: 'user2@example.com', displayName: 'User 2', roles: [] },
      ];

      mockStore.query.mockResolvedValue(mockUsers);

      const results = await repo.searchUsers({ provider: 'twitch' });

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('user-1');
      expect(results[1].id).toBe('user-2');
    });
  });

  describe('updateUser', () => {
    it('should return null for empty id', async () => {
      const result = await repo.updateUser('', { displayName: 'New Name' });
      expect(result).toBeNull();
    });

    it('should return null when user not found', async () => {
      mockStore.get.mockResolvedValue(null);
      const result = await repo.updateUser('user-123', { displayName: 'New Name' });
      expect(result).toBeNull();
    });

    it('should update user and return updated document', async () => {
      const existingUser: AuthUserDoc = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Old Name',
        roles: ['user'],
      };

      const updatedUser: AuthUserDoc = {
        ...existingUser,
        displayName: 'New Name',
      };

      mockStore.get
        .mockResolvedValueOnce(existingUser) // First call in updateUser
        .mockResolvedValueOnce(updatedUser); // Second call in getById

      mockStore.set.mockResolvedValue(undefined);

      const result = await repo.updateUser('user-123', { displayName: 'New Name' });

      expect(mockStore.set).toHaveBeenCalledWith('auth_users', 'user-123', expect.objectContaining({
        displayName: 'New Name',
      }));
      expect(result?.displayName).toBe('New Name');
    });

    it('should remove id from update payload', async () => {
      const existingUser: AuthUserDoc = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test',
        roles: [],
      };

      mockStore.get.mockResolvedValue(existingUser);
      mockStore.set.mockResolvedValue(undefined);

      await repo.updateUser('user-123', { id: 'different-id', displayName: 'New Name' } as any);

      expect(mockStore.set).toHaveBeenCalledWith('auth_users', 'user-123', expect.objectContaining({
        id: 'user-123', // Original ID preserved
        displayName: 'New Name',
      }));
    });
  });

  describe('ensureUserOnMessage', () => {
    const nowIso = '2026-07-16T10:00:00.000Z';

    it('should create new user when not found', async () => {
      mockStore.get.mockResolvedValue(null);
      mockStore.set.mockResolvedValue(undefined);

      const result = await repo.ensureUserOnMessage(
        'user-123',
        {
          provider: 'twitch',
          providerUserId: 'twitch-123',
          displayName: 'Test User',
          email: 'test@example.com',
          roles: ['user'],
        },
        nowIso
      );

      expect(result.created).toBe(true);
      expect(result.isFirstMessage).toBe(true);
      expect(result.isNewSession).toBe(true);
      expect(result.doc.id).toBe('user-123');
      expect(result.doc.messageCountAllTime).toBe(1);
      expect(result.doc.sessionCount).toBe(1);
      expect(result.doc.tags).toContain('PROVIDER_TWITCH');

      expect(mockStore.set).toHaveBeenCalledWith('auth_users', 'user-123', expect.objectContaining({
        id: 'user-123',
        displayName: 'Test User',
        messageCountAllTime: 1,
        sessionCount: 1,
      }));
    });

    it('should update existing user and increment counters', async () => {
      const existingUser: AuthUserDoc = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['user'],
        messageCountAllTime: 5,
        sessionCount: 2,
        lastSessionActivityAt: '2026-07-16T09:00:00.000Z', // 1 hour ago (same session)
      };

      mockStore.get.mockResolvedValue(existingUser);
      mockStore.set.mockResolvedValue(undefined);

      const result = await repo.ensureUserOnMessage('user-123', {}, nowIso);

      expect(result.created).toBe(false);
      expect(result.isFirstMessage).toBe(false);
      expect(result.isNewSession).toBe(false); // Less than 24h
      expect(result.doc.messageCountAllTime).toBe(6);
      expect(result.doc.sessionCount).toBe(2); // Not incremented (same session)
    });

    it('should detect new session after 24h inactivity', async () => {
      const existingUser: AuthUserDoc = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['user'],
        messageCountAllTime: 10,
        sessionCount: 3,
        lastSessionActivityAt: '2026-07-15T09:00:00.000Z', // 25 hours ago
      };

      mockStore.get.mockResolvedValue(existingUser);
      mockStore.set.mockResolvedValue(undefined);

      const result = await repo.ensureUserOnMessage('user-123', {}, nowIso);

      expect(result.isNewSession).toBe(true);
      expect(result.doc.sessionCount).toBe(4); // Incremented
      expect(result.doc.lastSessionId).toMatch(/^sess_user-123_/);
      expect(result.doc.lastSessionStartedAt).toBe(nowIso);
    });

    it('should merge roles from existing and new data', async () => {
      const existingUser: AuthUserDoc = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['user', 'subscriber'],
        messageCountAllTime: 5,
        sessionCount: 1,
      };

      mockStore.get.mockResolvedValue(existingUser);
      mockStore.set.mockResolvedValue(undefined);

      const result = await repo.ensureUserOnMessage(
        'user-123',
        { roles: ['moderator'] },
        nowIso
      );

      expect(result.doc.roles).toContain('user');
      expect(result.doc.roles).toContain('subscriber');
      expect(result.doc.roles).toContain('moderator');
      expect(result.doc.roles).toHaveLength(3);
    });
  });
});

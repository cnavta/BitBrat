import { FirestoreUserRepo } from '../user-repo';

describe('FirestoreUserRepo administrative methods', () => {
  let mockDb: any;
  let mockCollection: any;
  let mockDoc: any;

  beforeEach(() => {
    mockDoc = {
      get: jest.fn(),
      set: jest.fn(),
    };
    mockCollection = {
      doc: jest.fn().mockReturnValue(mockDoc),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn(),
    };
    mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection),
    };
  });

  describe('searchUsers', () => {
    it('searches by displayName and email', async () => {
      const repo = new FirestoreUserRepo('users', mockDb);
      const mockSnap = {
        docs: [
          {
            id: 'u1',
            data: () => ({ displayName: 'User One', email: 'one@example.com', roles: ['user'] }),
          }
        ],
      };
      mockCollection.get.mockResolvedValue(mockSnap);

      const results = await repo.searchUsers({ displayName: 'User One', email: 'one@example.com' });

      expect(mockDb.collection).toHaveBeenCalledWith('users');
      expect(mockCollection.where).toHaveBeenCalledWith('displayName', '==', 'User One');
      expect(mockCollection.where).toHaveBeenCalledWith('email', '==', 'one@example.com');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('u1');
    });

    it('searches by provider and username', async () => {
      const repo = new FirestoreUserRepo('users', mockDb);
      mockCollection.get.mockResolvedValue({ docs: [] });

      await repo.searchUsers({ provider: 'twitch', username: 'testuser' });

      expect(mockCollection.where).toHaveBeenCalledWith('provider', '==', 'twitch');
      expect(mockCollection.where).toHaveBeenCalledWith('profile.username', '==', 'testuser');
    });

    it('searches only by displayName', async () => {
      const repo = new FirestoreUserRepo('users', mockDb);
      mockCollection.get.mockResolvedValue({ docs: [] });

      await repo.searchUsers({ displayName: 'User One' });

      expect(mockCollection.where).toHaveBeenCalledWith('displayName', '==', 'User One');
      expect(mockCollection.where).not.toHaveBeenCalledWith('email', expect.any(String));
    });
  });

  describe('updateUser', () => {
    it('updates user partially', async () => {
      const repo = new FirestoreUserRepo('users', mockDb);
      mockDoc.get.mockResolvedValue({ exists: true });
      
      // Mock getById (which uses doc().get())
      mockDoc.get
        .mockResolvedValueOnce({ exists: true }) // First call in updateUser (check exists)
        .mockResolvedValueOnce({ // Second call via getById
          exists: true,
          id: 'u1',
          data: () => ({ displayName: 'User One', status: 'banned', roles: ['user'] })
        });

      const updated = await repo.updateUser('u1', { status: 'banned' });

      expect(mockDoc.set).toHaveBeenCalledWith({ status: 'banned' }, { merge: true });
      expect(updated?.status).toBe('banned');
    });

    it('updates user notes', async () => {
      const repo = new FirestoreUserRepo('users', mockDb);
      mockDoc.get.mockResolvedValue({ exists: true });
      
      mockDoc.get
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({
          exists: true,
          id: 'u1',
          data: () => ({ displayName: 'User One', notes: 'Top contributor', roles: ['user'] })
        });

      const updated = await repo.updateUser('u1', { notes: 'Top contributor' });

      expect(mockDoc.set).toHaveBeenCalledWith({ notes: 'Top contributor' }, { merge: true });
      expect(updated?.notes).toBe('Top contributor');
    });

    it('returns null if user does not exist', async () => {
      const repo = new FirestoreUserRepo('users', mockDb);
      mockDoc.get.mockResolvedValue({ exists: false });

      const result = await repo.updateUser('nonexistent', { status: 'banned' });

      expect(result).toBeNull();
      expect(mockDoc.set).not.toHaveBeenCalled();
    });
  });
});

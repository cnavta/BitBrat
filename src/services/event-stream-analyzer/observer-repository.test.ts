import { ObserverRepository } from './observer-repository';
import type { IDocumentStore } from '../../common/persistence/interfaces';
import type { StreamObserver } from '../../types/sessi';

// Mock document store
const createMockDocumentStore = (): jest.Mocked<IDocumentStore> => ({
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  query: jest.fn(),
  getAll: jest.fn(),
  watch: jest.fn(),
  batch: jest.fn(),
  health: jest.fn()
});

// Mock logger
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

describe('ObserverRepository', () => {
  let repo: ObserverRepository;
  let mockStore: jest.Mocked<IDocumentStore>;

  beforeEach(() => {
    mockStore = createMockDocumentStore();
    repo = new ObserverRepository(mockStore, mockLogger);
    jest.clearAllMocks();
  });

  const createTestObserver = (id: string, overrides?: Partial<StreamObserver>): StreamObserver => ({
    id,
    active: true,
    mcpEnabled: true,
    source: {
      mode: 'stream',
      topics: ['internal.contextualization.v1'],
      filters: { platforms: ['twitch'] }
    },
    window: {
      type: 'sliding',
      sizeMs: 300000,
      slideMs: 60000
    },
    trigger: {
      type: 'time'
    },
    analysis: {
      promptId: 'stream-analyst-v1',
      inspectionEnabled: false,
      outputFormat: 'markdown'
    },
    delivery: {
      egressTopic: 'internal.egress.v1',
      destination: {
        type: 'chat',
        target: 'default'
      }
    },
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides
  });

  describe('create', () => {
    it('should create an observer with timestamps', async () => {
      const observer = createTestObserver('test-observer-1');
      mockStore.set.mockResolvedValue();

      const result = await repo.create(observer);

      expect(mockStore.set).toHaveBeenCalledWith(
        'stream_observers',
        'test-observer-1',
        expect.objectContaining({
          id: 'test-observer-1',
          active: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String)
        })
      );

      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
    });

    it('should preserve existing createdAt if provided', async () => {
      const existingCreatedAt = '2026-01-01T00:00:00.000Z';
      const observer = createTestObserver('test-observer-2', {
        createdAt: existingCreatedAt
      });
      mockStore.set.mockResolvedValue();

      const result = await repo.create(observer);

      expect(result.createdAt).toBe(existingCreatedAt);
    });

    it('should throw error if document store fails', async () => {
      const observer = createTestObserver('test-observer-3');
      mockStore.set.mockRejectedValue(new Error('Database connection failed'));

      await expect(repo.create(observer)).rejects.toThrow('Database connection failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'observer_repository.create.error',
        expect.objectContaining({
          observerId: 'test-observer-3',
          error: 'Database connection failed'
        })
      );
    });
  });

  describe('get', () => {
    it('should retrieve an existing observer', async () => {
      const observer = createTestObserver('test-observer-4');
      mockStore.get.mockResolvedValue(observer);

      const result = await repo.get('test-observer-4');

      expect(mockStore.get).toHaveBeenCalledWith('stream_observers', 'test-observer-4');
      expect(result).toEqual(observer);
    });

    it('should return null for non-existent observer', async () => {
      mockStore.get.mockResolvedValue(null);

      const result = await repo.get('non-existent');

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'observer_repository.get.not_found',
        { observerId: 'non-existent' }
      );
    });

    it('should throw error if document store fails', async () => {
      mockStore.get.mockRejectedValue(new Error('Query failed'));

      await expect(repo.get('test-observer-5')).rejects.toThrow('Query failed');
    });
  });

  describe('list', () => {
    it('should list all observers when no filters provided', async () => {
      const observers = [
        createTestObserver('obs-1'),
        createTestObserver('obs-2')
      ];
      mockStore.getAll.mockResolvedValue(observers);

      const result = await repo.list();

      expect(mockStore.getAll).toHaveBeenCalledWith('stream_observers');
      expect(result).toEqual(observers);
      expect(result).toHaveLength(2);
    });

    it('should filter by active status', async () => {
      const activeObservers = [
        createTestObserver('obs-active-1', { active: true }),
        createTestObserver('obs-active-2', { active: true })
      ];
      mockStore.query.mockResolvedValue(activeObservers);

      const result = await repo.list({ active: true });

      expect(mockStore.query).toHaveBeenCalledWith(
        'stream_observers',
        {
          filters: [{ field: 'active', operator: '==', value: true }],
          orderBy: { field: 'created_at', direction: 'desc' }
        }
      );
      expect(result).toHaveLength(2);
      expect(result.every(o => o.active === true)).toBe(true);
    });

    it('should filter inactive observers', async () => {
      const inactiveObservers = [
        createTestObserver('obs-inactive-1', { active: false })
      ];
      mockStore.query.mockResolvedValue(inactiveObservers);

      const result = await repo.list({ active: false });

      expect(mockStore.query).toHaveBeenCalledWith(
        'stream_observers',
        expect.objectContaining({
          filters: [{ field: 'active', operator: '==', value: false }]
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].active).toBe(false);
    });

    it('should return empty array when no observers found', async () => {
      mockStore.getAll.mockResolvedValue([]);

      const result = await repo.list();

      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update existing observer', async () => {
      const existing = createTestObserver('obs-update-1');
      mockStore.get.mockResolvedValue(existing);
      mockStore.set.mockResolvedValue();

      const changes: Partial<StreamObserver> = {
        active: false,
        window: {
          type: 'tumbling',
          sizeMs: 600000
        }
      };

      await repo.update('obs-update-1', changes);

      expect(mockStore.set).toHaveBeenCalledWith(
        'stream_observers',
        'obs-update-1',
        expect.objectContaining({
          id: 'obs-update-1',
          active: false,
          window: changes.window,
          updatedAt: expect.any(String)
        })
      );
    });

    it('should throw error if observer not found', async () => {
      mockStore.get.mockResolvedValue(null);

      await expect(repo.update('non-existent', { active: false }))
        .rejects.toThrow('Observer not found: non-existent');
    });

    it('should prevent ID change', async () => {
      const existing = createTestObserver('obs-update-2');
      mockStore.get.mockResolvedValue(existing);
      mockStore.set.mockResolvedValue();

      // Attempt to change ID (should be ignored)
      await repo.update('obs-update-2', { id: 'different-id' } as any);

      expect(mockStore.set).toHaveBeenCalledWith(
        'stream_observers',
        'obs-update-2',
        expect.objectContaining({
          id: 'obs-update-2' // Original ID preserved
        })
      );
    });
  });

  describe('delete', () => {
    it('should delete an observer', async () => {
      mockStore.delete.mockResolvedValue();

      await repo.delete('obs-delete-1');

      expect(mockStore.delete).toHaveBeenCalledWith('stream_observers', 'obs-delete-1');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'observer_repository.delete.success',
        { observerId: 'obs-delete-1' }
      );
    });

    it('should throw error if deletion fails', async () => {
      mockStore.delete.mockRejectedValue(new Error('Deletion failed'));

      await expect(repo.delete('obs-delete-2')).rejects.toThrow('Deletion failed');
    });
  });

  describe('getActiveCount', () => {
    it('should return count of active observers', async () => {
      const activeObservers = [
        createTestObserver('obs-1', { active: true }),
        createTestObserver('obs-2', { active: true }),
        createTestObserver('obs-3', { active: true })
      ];
      mockStore.query.mockResolvedValue(activeObservers);

      const count = await repo.getActiveCount();

      expect(count).toBe(3);
      expect(mockStore.query).toHaveBeenCalledWith(
        'stream_observers',
        expect.objectContaining({
          filters: [{ field: 'active', operator: '==', value: true }]
        })
      );
    });

    it('should return 0 when no active observers', async () => {
      mockStore.query.mockResolvedValue([]);

      const count = await repo.getActiveCount();

      expect(count).toBe(0);
    });
  });

  describe('exists', () => {
    it('should return true if observer exists', async () => {
      const observer = createTestObserver('exists-1');
      mockStore.get.mockResolvedValue(observer);

      const exists = await repo.exists('exists-1');

      expect(exists).toBe(true);
    });

    it('should return false if observer does not exist', async () => {
      mockStore.get.mockResolvedValue(null);

      const exists = await repo.exists('non-existent');

      expect(exists).toBe(false);
    });
  });
});

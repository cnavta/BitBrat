/**
 * Unit tests for reflex-repository.ts
 *
 * Tests CRUD operations, real-time subscription, and error handling with mocked Firestore.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Timestamp } from 'firebase-admin/firestore';
import {
  ReflexRepository,
  ReflexRepositoryError,
  ReflexNotFoundError,
} from '../reflex-repository.js';
import type { Reflex } from '../../../types/reflex.js';

// Mock Firestore SDK
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockOnSnapshot = jest.fn();
const mockDoc = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockCollection = jest.fn();

const mockFirestore = {
  collection: mockCollection,
} as any;

// Mock Firestore module
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => mockFirestore),
  Timestamp: {
    now: jest.fn(() => ({ toDate: () => new Date('2026-07-04T12:00:00Z') })),
    fromDate: (date: Date) => ({ toDate: () => date }),
  },
}));

describe('ReflexRepository', () => {
  let repository: ReflexRepository;

  const mockReflex: Reflex = {
    id: 'reflex-123',
    name: 'Test Reflex',
    active: true,
    priority: 1,
    match: {
      type: 'exact',
      pattern: '!fail',
      field: 'message.text',
    },
    action: {
      tool: 'obs.set_source_visibility',
      parameters: {
        sourceName: 'FailOverlay',
        visible: true,
      },
    },
    createdAt: '2026-07-04T12:00:00.000Z',
    updatedAt: '2026-07-04T12:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default mock chain
    mockCollection.mockReturnValue({
      where: mockWhere,
      doc: mockDoc,
    });

    mockWhere.mockReturnValue({
      orderBy: mockOrderBy,
    });

    mockOrderBy.mockReturnValue({
      get: mockGet,
      onSnapshot: mockOnSnapshot,
    });

    mockDoc.mockReturnValue({
      get: mockGet,
      set: mockSet,
      update: mockUpdate,
      id: 'generated-id-123',
    });

    repository = new ReflexRepository(mockFirestore);
  });

  describe('getAll', () => {
    it('should fetch all active reflexes sorted by priority', async () => {
      const mockDocs = [
        {
          id: 'reflex-1',
          data: () => ({
            ...mockReflex,
            id: 'reflex-1',
            priority: 1,
            createdAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
            updatedAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
          }),
        },
        {
          id: 'reflex-2',
          data: () => ({
            ...mockReflex,
            id: 'reflex-2',
            priority: 2,
            createdAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
            updatedAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
          }),
        },
      ];

      (mockGet as any).mockResolvedValue({ docs: mockDocs });

      const result = await repository.getAll();

      expect(mockCollection).toHaveBeenCalledWith('reflexes');
      expect(mockWhere).toHaveBeenCalledWith('active', '==', true);
      expect(mockOrderBy).toHaveBeenCalledWith('priority', 'asc');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('reflex-1');
      expect(result[1].id).toBe('reflex-2');
      expect(result[0].createdAt).toBe('2026-07-04T12:00:00.000Z');
    });

    it('should return empty array when no reflexes found', async () => {
      (mockGet as any).mockResolvedValue({ docs: [] });

      const result = await repository.getAll();

      expect(result).toEqual([]);
    });

    it('should convert Timestamp to ISO string', async () => {
      const timestamp = Timestamp.fromDate(new Date('2026-07-04T12:30:00Z'));
      const mockDocs = [
        {
          id: 'reflex-1',
          data: () => ({
            ...mockReflex,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        },
      ];

      (mockGet as any).mockResolvedValue({ docs: mockDocs });

      const result = await repository.getAll();

      expect(result[0].createdAt).toBe('2026-07-04T12:30:00.000Z');
      expect(result[0].updatedAt).toBe('2026-07-04T12:30:00.000Z');
    });

    it('should throw ReflexRepositoryError on Firestore failure', async () => {
      mockGet.mockRejectedValue(new Error('Firestore error'));

      await expect(repository.getAll()).rejects.toThrow(ReflexRepositoryError);
      await expect(repository.getAll()).rejects.toThrow('Failed to fetch reflexes');
    });
  });

  describe('getById', () => {
    it('should fetch reflex by ID', async () => {
      const mockDocData = {
        ...mockReflex,
        createdAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
      };

      mockGet.mockResolvedValue({
        exists: true,
        id: 'reflex-123',
        data: () => mockDocData,
      });

      const result = await repository.getById('reflex-123');

      expect(mockCollection).toHaveBeenCalledWith('reflexes');
      expect(mockDoc).toHaveBeenCalledWith('reflex-123');
      expect(result).toBeDefined();
      expect(result!.id).toBe('reflex-123');
      expect(result!.name).toBe('Test Reflex');
    });

    it('should return undefined when reflex not found', async () => {
      (mockGet as any).mockResolvedValue({ exists: false });

      const result = await repository.getById('missing-id');

      expect(result).toBeUndefined();
    });

    it('should convert Timestamp to ISO string', async () => {
      const timestamp = Timestamp.fromDate(new Date('2026-07-04T12:30:00Z'));
      mockGet.mockResolvedValue({
        exists: true,
        id: 'reflex-123',
        data: () => ({
          ...mockReflex,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      });

      const result = await repository.getById('reflex-123');

      expect(result!.createdAt).toBe('2026-07-04T12:30:00.000Z');
      expect(result!.updatedAt).toBe('2026-07-04T12:30:00.000Z');
    });

    it('should throw ReflexRepositoryError on Firestore failure', async () => {
      mockGet.mockRejectedValue(new Error('Firestore error'));

      await expect(repository.getById('reflex-123')).rejects.toThrow(ReflexRepositoryError);
      await expect(repository.getById('reflex-123')).rejects.toThrow('Failed to fetch reflex: reflex-123');
    });
  });

  describe('create', () => {
    it('should create new reflex with generated ID and timestamps', async () => {
      const newReflex = {
        name: 'New Reflex',
        active: true,
        priority: 5,
        match: {
          type: 'exact' as const,
          pattern: '!test',
          field: 'message.text',
        },
        action: {
          tool: 'test.tool',
          parameters: {},
        },
      };

      mockSet.mockResolvedValue(undefined);

      const result = await repository.create(newReflex);

      expect(mockCollection).toHaveBeenCalledWith('reflexes');
      expect(mockDoc).toHaveBeenCalledWith();
      expect(mockSet).toHaveBeenCalled();

      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.id).toBe('generated-id-123');
      expect(setCall.name).toBe('New Reflex');
      expect(setCall.createdAt).toBeDefined();
      expect(setCall.updatedAt).toBeDefined();

      expect(result.id).toBe('generated-id-123');
      expect(result.name).toBe('New Reflex');
      expect(result.createdAt).toBe('2026-07-04T12:00:00.000Z');
      expect(result.updatedAt).toBe('2026-07-04T12:00:00.000Z');
    });

    it('should preserve all fields from input', async () => {
      const newReflex = {
        name: 'Complex Reflex',
        active: true,
        priority: 10,
        match: {
          type: 'regex' as const,
          pattern: '^!command',
          field: 'message.text',
        },
        action: {
          tool: 'complex.tool',
          parameters: {
            param1: 'value1',
            param2: 'value2',
          },
          timeout: 3000,
        },
        conditions: {
          eventTypes: ['twitch.chat.message'],
          platforms: ['twitch'],
        },
        candidateTemplate: '{{event.identity.user.displayName}} used command',
      };

      mockSet.mockResolvedValue(undefined);

      const result = await repository.create(newReflex);

      expect(result.match.type).toBe('regex');
      expect(result.action.timeout).toBe(3000);
      expect(result.conditions).toEqual(newReflex.conditions);
      expect(result.candidateTemplate).toBe(newReflex.candidateTemplate);
    });

    it('should throw ReflexRepositoryError on Firestore failure', async () => {
      mockSet.mockRejectedValue(new Error('Firestore error'));

      await expect(repository.create({} as any)).rejects.toThrow(ReflexRepositoryError);
      await expect(repository.create({} as any)).rejects.toThrow('Failed to create reflex');
    });
  });

  describe('update', () => {
    it('should update existing reflex with new timestamp', async () => {
      // First get() to check existence
      mockGet
        .mockResolvedValueOnce({
          exists: true,
          id: 'reflex-123',
          data: () => ({ ...mockReflex }),
        })
        // Second get() to fetch updated document
        .mockResolvedValueOnce({
          exists: true,
          id: 'reflex-123',
          data: () => ({
            ...mockReflex,
            active: false,
            priority: 100,
            updatedAt: Timestamp.fromDate(new Date('2026-07-04T13:00:00Z')),
          }),
        });

      mockUpdate.mockResolvedValue(undefined);

      const result = await repository.update('reflex-123', {
        active: false,
        priority: 100,
      });

      expect(mockDoc).toHaveBeenCalledWith('reflex-123');
      expect(mockUpdate).toHaveBeenCalled();

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.active).toBe(false);
      expect(updateCall.priority).toBe(100);
      expect(updateCall.updatedAt).toBeDefined();

      expect(result.id).toBe('reflex-123');
      expect(result.active).toBe(false);
      expect(result.priority).toBe(100);
    });

    it('should throw ReflexNotFoundError when reflex does not exist', async () => {
      (mockGet as any).mockResolvedValue({ exists: false });

      await expect(repository.update('missing-id', { active: false })).rejects.toThrow(ReflexNotFoundError);
      await expect(repository.update('missing-id', { active: false })).rejects.toThrow('Reflex not found: missing-id');
    });

    it('should allow partial updates', async () => {
      mockGet
        .mockResolvedValueOnce({ exists: true, data: () => ({ ...mockReflex }) })
        .mockResolvedValueOnce({
          exists: true,
          id: 'reflex-123',
          data: () => ({
            ...mockReflex,
            name: 'Updated Name',
            updatedAt: Timestamp.fromDate(new Date('2026-07-04T13:00:00Z')),
          }),
        });

      mockUpdate.mockResolvedValue(undefined);

      const result = await repository.update('reflex-123', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      // Other fields should be preserved
      expect(result.active).toBe(true);
      expect(result.priority).toBe(1);
    });

    it('should throw ReflexRepositoryError on Firestore failure', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({ ...mockReflex }) });
      mockUpdate.mockRejectedValue(new Error('Firestore error'));

      await expect(repository.update('reflex-123', { active: false })).rejects.toThrow(ReflexRepositoryError);
    });
  });

  describe('delete', () => {
    it('should soft delete reflex by setting active=false', async () => {
      mockGet
        .mockResolvedValueOnce({ exists: true, data: () => ({ ...mockReflex }) })
        .mockResolvedValueOnce({
          exists: true,
          id: 'reflex-123',
          data: () => ({
            ...mockReflex,
            active: false,
            updatedAt: Timestamp.fromDate(new Date('2026-07-04T13:00:00Z')),
          }),
        });

      mockUpdate.mockResolvedValue(undefined);

      const result = await repository.delete('reflex-123');

      expect(mockUpdate).toHaveBeenCalled();
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.active).toBe(false);

      expect(result.id).toBe('reflex-123');
      expect(result.active).toBe(false);
    });

    it('should throw ReflexNotFoundError when reflex does not exist', async () => {
      (mockGet as any).mockResolvedValue({ exists: false });

      await expect(repository.delete('missing-id')).rejects.toThrow(ReflexNotFoundError);
    });

    it('should preserve all other fields when deleting', async () => {
      mockGet
        .mockResolvedValueOnce({ exists: true, data: () => ({ ...mockReflex }) })
        .mockResolvedValueOnce({
          exists: true,
          id: 'reflex-123',
          data: () => ({
            ...mockReflex,
            active: false,
            updatedAt: Timestamp.fromDate(new Date('2026-07-04T13:00:00Z')),
          }),
        });

      mockUpdate.mockResolvedValue(undefined);

      const result = await repository.delete('reflex-123');

      expect(result.name).toBe('Test Reflex');
      expect(result.priority).toBe(1);
      expect(result.match).toEqual(mockReflex.match);
      expect(result.action).toEqual(mockReflex.action);
    });
  });

  describe('subscribe', () => {
    it('should set up real-time subscription with onSnapshot', () => {
      const callback = jest.fn();
      const unsubscribe = jest.fn();

      mockOnSnapshot.mockReturnValue(unsubscribe);

      const result = repository.subscribe(callback);

      expect(mockCollection).toHaveBeenCalledWith('reflexes');
      expect(mockWhere).toHaveBeenCalledWith('active', '==', true);
      expect(mockOrderBy).toHaveBeenCalledWith('priority', 'asc');
      expect(mockOnSnapshot).toHaveBeenCalled();
      expect(result).toBe(unsubscribe);
    });

    it('should call callback with reflexes when snapshot received', () => {
      const callback = jest.fn();
      let snapshotCallback: any;

      mockOnSnapshot.mockImplementation((onNext: any) => {
        snapshotCallback = onNext;
        return jest.fn();
      });

      repository.subscribe(callback);

      const mockSnapshot = {
        size: 2,
        docChanges: () => [],
        docs: [
          {
            id: 'reflex-1',
            data: () => ({
              ...mockReflex,
              id: 'reflex-1',
              createdAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
              updatedAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
            }),
          },
          {
            id: 'reflex-2',
            data: () => ({
              ...mockReflex,
              id: 'reflex-2',
              createdAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
              updatedAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
            }),
          },
        ],
      };

      snapshotCallback(mockSnapshot);

      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'reflex-1' }),
          expect.objectContaining({ id: 'reflex-2' }),
        ])
      );
      expect(callback.mock.calls[0][0]).toHaveLength(2);
    });

    it('should handle snapshot errors gracefully', () => {
      let errorCallback: any;

      mockOnSnapshot.mockImplementation((onNext: any, onError: any) => {
        errorCallback = onError;
        return jest.fn();
      });

      const callback = jest.fn();
      repository.subscribe(callback);

      // Should not throw
      expect(() => errorCallback(new Error('Snapshot error'))).not.toThrow();
    });

    it('should return working unsubscribe function', () => {
      const callback = jest.fn();
      const mockUnsubscribe = jest.fn();

      mockOnSnapshot.mockReturnValue(mockUnsubscribe);

      const unsubscribe = repository.subscribe(callback);
      unsubscribe();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should convert Timestamps in snapshot data', () => {
      const callback = jest.fn();
      let snapshotCallback: any;

      mockOnSnapshot.mockImplementation((onNext: any) => {
        snapshotCallback = onNext;
        return jest.fn();
      });

      repository.subscribe(callback);

      const timestamp = Timestamp.fromDate(new Date('2026-07-04T12:30:00Z'));
      const mockSnapshot = {
        size: 1,
        docChanges: () => [],
        docs: [
          {
            id: 'reflex-1',
            data: () => ({
              ...mockReflex,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          },
        ],
      };

      snapshotCallback(mockSnapshot);

      const receivedReflexes = callback.mock.calls[0][0];
      expect(receivedReflexes[0].createdAt).toBe('2026-07-04T12:30:00.000Z');
      expect(receivedReflexes[0].updatedAt).toBe('2026-07-04T12:30:00.000Z');
    });
  });

  describe('Error classes', () => {
    it('should create ReflexRepositoryError with message and cause', () => {
      const cause = new Error('Original error');
      const error = new ReflexRepositoryError('Failed operation', cause);

      expect(error.name).toBe('ReflexRepositoryError');
      expect(error.message).toBe('Failed operation');
      expect(error.cause).toBe(cause);
    });

    it('should create ReflexRepositoryError without cause', () => {
      const error = new ReflexRepositoryError('Failed operation');

      expect(error.name).toBe('ReflexRepositoryError');
      expect(error.message).toBe('Failed operation');
      expect(error.cause).toBeUndefined();
    });

    it('should create ReflexNotFoundError with reflexId', () => {
      const error = new ReflexNotFoundError('reflex-123');

      expect(error.name).toBe('ReflexNotFoundError');
      expect(error.message).toBe('Reflex not found: reflex-123');
      expect(error.reflexId).toBe('reflex-123');
    });
  });

  describe('documentToReflex conversion', () => {
    it('should preserve ISO string timestamps', async () => {
      const mockDocData = {
        ...mockReflex,
        createdAt: '2026-07-04T12:00:00.000Z',
        updatedAt: '2026-07-04T12:00:00.000Z',
      };

      mockGet.mockResolvedValue({
        exists: true,
        id: 'reflex-123',
        data: () => mockDocData,
      });

      const result = await repository.getById('reflex-123');

      expect(result!.createdAt).toBe('2026-07-04T12:00:00.000Z');
      expect(result!.updatedAt).toBe('2026-07-04T12:00:00.000Z');
    });

    it('should convert Firestore Timestamp to ISO string', async () => {
      const timestamp = Timestamp.fromDate(new Date('2026-07-04T14:30:45.123Z'));
      const mockDocData = {
        ...mockReflex,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      mockGet.mockResolvedValue({
        exists: true,
        id: 'reflex-123',
        data: () => mockDocData,
      });

      const result = await repository.getById('reflex-123');

      expect(result!.createdAt).toBe('2026-07-04T14:30:45.123Z');
      expect(result!.updatedAt).toBe('2026-07-04T14:30:45.123Z');
    });

    it('should preserve all other fields during conversion', async () => {
      const mockDocData = {
        ...mockReflex,
        createdAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-07-04T12:00:00Z')),
      };

      mockGet.mockResolvedValue({
        exists: true,
        id: 'reflex-123',
        data: () => mockDocData,
      });

      const result = await repository.getById('reflex-123');

      expect(result!.name).toBe(mockReflex.name);
      expect(result!.active).toBe(mockReflex.active);
      expect(result!.priority).toBe(mockReflex.priority);
      expect(result!.match).toEqual(mockReflex.match);
      expect(result!.action).toEqual(mockReflex.action);
    });
  });
});

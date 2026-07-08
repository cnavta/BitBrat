/**
 * Tests for persistence tools
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  dbCollectionsTool,
  dbGetTool,
  dbQueryTool,
} from '../../tools/persistence.js';
import { createMockConnection } from '../../test-utils/mocks.js';
import { parseJsonContent } from '../../test-utils/helpers.js';

describe('Persistence Tools', () => {
  let mockConnection: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  describe('db.collections', () => {
    it('should list all Firestore collections', async () => {
      // Mock listCollections
      const mockCollections = [
        { id: 'commands' },
        { id: 'packs' },
        { id: 'events' },
      ];
      // @ts-ignore - Mock type inference issue
      mockConnection.firestore.db.listCollections = jest.fn().mockResolvedValue(mockCollections);

      const result = await dbCollectionsTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      expect(json).toBeDefined();
      expect(json.collections).toEqual(['commands', 'packs', 'events']);
      expect(json.count).toBe(3);
      expect(json.projectId).toBe('test-project');
    });

    it('should handle empty collections list', async () => {
      // @ts-ignore - Mock type inference issue
      mockConnection.firestore.db.listCollections = jest.fn().mockResolvedValue([]);

      const result = await dbCollectionsTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      expect(json.collections).toEqual([]);
      expect(json.count).toBe(0);
    });

    it('should handle Firestore errors', async () => {
      // @ts-ignore - Mock type inference issue
      mockConnection.firestore.db.listCollections = jest.fn().mockRejectedValue(
        // @ts-ignore
        new Error('Permission denied')
      );

      const result = await dbCollectionsTool.handler({}, mockConnection);

      expect(result.isError).toBe(true);
    });
  });

  describe('db.get', () => {
    it('should get an existing document', async () => {
      const mockData = { name: 'test-command', pattern: 'hello' };
      const mockDoc = {
        exists: true,
        data: () => mockData,
      };

      const mockDocRef = {
        // @ts-ignore - Mock type inference issue
        get: jest.fn().mockResolvedValue(mockDoc),
      };

      const mockCollection = {
        doc: jest.fn().mockReturnValue(mockDocRef),
      };

      mockConnection.firestore.db.collection = jest.fn().mockReturnValue(mockCollection) as any;

      const result = await dbGetTool.handler(
        { collection: 'commands', id: 'cmd-1' },
        mockConnection
      );

      const json = parseJsonContent(result);
      expect(json.found).toBe(true);
      expect(json.collection).toBe('commands');
      expect(json.id).toBe('cmd-1');
      expect(json.data).toEqual(mockData);
    });

    it('should handle non-existent document', async () => {
      const mockDoc = {
        exists: false,
      };

      const mockDocRef = {
        // @ts-ignore - Mock type inference issue
        get: jest.fn().mockResolvedValue(mockDoc),
      };

      const mockCollection = {
        doc: jest.fn().mockReturnValue(mockDocRef),
      };

      mockConnection.firestore.db.collection = jest.fn().mockReturnValue(mockCollection) as any;

      const result = await dbGetTool.handler(
        { collection: 'commands', id: 'nonexistent' },
        mockConnection
      );

      const json = parseJsonContent(result);
      expect(json.found).toBe(false);
      expect(json.collection).toBe('commands');
      expect(json.id).toBe('nonexistent');
    });
  });

  describe('db.query', () => {
    it('should query collection without filters', async () => {
      const mockDocs = [
        { id: 'doc1', data: () => ({ name: 'Item 1' }) },
        { id: 'doc2', data: () => ({ name: 'Item 2' }) },
      ];

      const mockSnapshot = {
        docs: mockDocs,
      };

      const mockQuery = {
        // @ts-ignore - Mock type inference issue
        get: jest.fn().mockResolvedValue(mockSnapshot),
      } as any;

      mockConnection.firestore.db.collection = jest.fn().mockReturnValue(mockQuery) as any;

      const result = await dbQueryTool.handler({ collection: 'commands' }, mockConnection);

      const json = parseJsonContent(result);
      expect(json.collection).toBe('commands');
      expect(json.count).toBe(2);
      expect(json.documents).toHaveLength(2);
      expect(json.documents[0].id).toBe('doc1');
    });

    it('should apply filters', async () => {
      const mockSnapshot: any = {
        docs: [],
      };

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        // @ts-ignore - Mock type inference issue
        get: jest.fn().mockResolvedValue(mockSnapshot),
      } as any;

      mockConnection.firestore.db.collection = jest.fn().mockReturnValue(mockQuery) as any;

      const result = await dbQueryTool.handler(
        {
          collection: 'commands',
          filters: [
            { field: 'active', op: '==', value: true },
            { field: 'name', op: '!=', value: 'test' },
          ],
        },
        mockConnection
      );

      expect(mockQuery.where).toHaveBeenCalledTimes(2);
      expect(mockQuery.where).toHaveBeenCalledWith('active', '==', true);
      expect(mockQuery.where).toHaveBeenCalledWith('name', '!=', 'test');
    });

    it('should apply ordering', async () => {
      const mockSnapshot: any = {
        docs: [],
      };

      const mockQuery = {
        orderBy: jest.fn().mockReturnThis(),
        // @ts-ignore - Mock type inference issue
        get: jest.fn().mockResolvedValue(mockSnapshot),
      } as any;

      mockConnection.firestore.db.collection = jest.fn().mockReturnValue(mockQuery) as any;

      const result = await dbQueryTool.handler(
        {
          collection: 'commands',
          orderBy: { field: 'createdAt', direction: 'desc' },
        },
        mockConnection
      );

      expect(mockQuery.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('should apply pagination', async () => {
      const mockSnapshot: any = {
        docs: [],
      };

      const mockQuery = {
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        // @ts-ignore - Mock type inference issue
        get: jest.fn().mockResolvedValue(mockSnapshot),
      } as any;

      mockConnection.firestore.db.collection = jest.fn().mockReturnValue(mockQuery) as any;

      const result = await dbQueryTool.handler(
        {
          collection: 'commands',
          limit: 10,
          offset: 20,
        },
        mockConnection
      );

      expect(mockQuery.limit).toHaveBeenCalledWith(10);
      expect(mockQuery.offset).toHaveBeenCalledWith(20);
    });

    it('should apply combined filters, ordering, and pagination', async () => {
      const mockSnapshot: any = {
        docs: [],
      };

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        // @ts-ignore - Mock type inference issue
        get: jest.fn().mockResolvedValue(mockSnapshot),
      } as any;

      mockConnection.firestore.db.collection = jest.fn().mockReturnValue(mockQuery) as any;

      const result = await dbQueryTool.handler(
        {
          collection: 'events',
          filters: [{ field: 'type', op: '==', value: 'chat' }],
          orderBy: { field: 'timestamp', direction: 'desc' },
          limit: 5,
          offset: 10,
        },
        mockConnection
      );

      expect(mockQuery.where).toHaveBeenCalled();
      expect(mockQuery.orderBy).toHaveBeenCalled();
      expect(mockQuery.limit).toHaveBeenCalledWith(5);
      expect(mockQuery.offset).toHaveBeenCalledWith(10);
    });
  });
});

/**
 * PostgresDocumentStore Unit Tests
 *
 * Tests connection pooling, CRUD operations, queries, transactions, and watch mechanism.
 */

import { PostgresDocumentStore } from '../postgres-store';
import { IDocumentStore, QueryOptions } from '../interfaces';

// Mock pg module
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const mockConnect = jest.fn();
  const mockRelease = jest.fn();
  const mockEnd = jest.fn();

  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
      connect: mockConnect.mockResolvedValue({
        query: mockQuery,
        release: mockRelease,
      }),
      end: mockEnd,
    })),
    __mocks: {
      query: mockQuery,
      connect: mockConnect,
      release: mockRelease,
      end: mockEnd,
    },
  };
});

describe('PostgresDocumentStore', () => {
  let store: PostgresDocumentStore;
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    store = new PostgresDocumentStore({
      connectionString: 'postgresql://test:test@localhost:5432/test',
      poolSize: 5,
    });
    store.setLogger(mockLogger);
  });

  describe('get()', () => {
    it('should retrieve a document by ID', async () => {
      const mockData = { id: 'doc1', name: 'Test Document', value: 42 };
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({
        rows: [{ data: mockData }],
      });

      const result = await store.get('test_collection', 'doc1');

      expect(result).toEqual(mockData);
      expect(poolInstance.query).toHaveBeenCalledWith(
        'SELECT data FROM test_collection WHERE id = $1',
        ['doc1']
      );
    });

    it('should return null if document not found', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({ rows: [] });

      const result = await store.get('test_collection', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on invalid collection name', async () => {
      await expect(store.get('invalid!collection', 'doc1')).rejects.toThrow(
        'Invalid collection name'
      );
    });
  });

  describe('set()', () => {
    it('should insert a new document', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({});

      const data = { id: 'doc1', name: 'New Doc' };
      await store.set('test_collection', 'doc1', data);

      expect(poolInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO test_collection'),
        ['doc1', JSON.stringify(data)]
      );
    });

    it('should update an existing document (upsert)', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({});

      const data = { id: 'doc1', name: 'Updated Doc' };
      await store.set('test_collection', 'doc1', data);

      expect(poolInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (id) DO UPDATE'),
        expect.any(Array)
      );
    });
  });

  describe('delete()', () => {
    it('should delete a document by ID', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({});

      await store.delete('test_collection', 'doc1');

      expect(poolInstance.query).toHaveBeenCalledWith(
        'DELETE FROM test_collection WHERE id = $1',
        ['doc1']
      );
    });
  });

  describe('query()', () => {
    it('should query documents without filters', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      const mockDocs = [
        { data: { id: 'doc1', name: 'Doc 1' } },
        { data: { id: 'doc2', name: 'Doc 2' } },
      ];
      poolInstance.query.mockResolvedValueOnce({ rows: mockDocs });

      const result = await store.query('test_collection', {});

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'doc1', name: 'Doc 1' });
      expect(poolInstance.query).toHaveBeenCalledWith(
        'SELECT data FROM test_collection',
        []
      );
    });

    it('should query with equality filter', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({ rows: [] });

      const options: QueryOptions = {
        filters: [{ field: 'status', operator: '==', value: 'active' }],
      };

      await store.query('test_collection', options);

      expect(poolInstance.query).toHaveBeenCalledWith(
        expect.stringContaining("data->>'status' = $1"),
        ['active']
      );
    });

    it('should query with ordering', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({ rows: [] });

      const options: QueryOptions = {
        orderBy: { field: 'createdAt', direction: 'desc' },
      };

      await store.query('test_collection', options);

      expect(poolInstance.query).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY data->>'createdAt' DESC"),
        []
      );
    });

    it('should query with limit and offset', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({ rows: [] });

      const options: QueryOptions = {
        limit: 10,
        offset: 20,
      };

      await store.query('test_collection', options);

      expect(poolInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 10 OFFSET 20'),
        []
      );
    });
  });

  describe('getAll()', () => {
    it('should retrieve all documents in a collection', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      const mockDocs = [
        { data: { id: 'doc1' } },
        { data: { id: 'doc2' } },
        { data: { id: 'doc3' } },
      ];
      poolInstance.query.mockResolvedValueOnce({ rows: mockDocs });

      const result = await store.getAll('test_collection');

      expect(result).toHaveLength(3);
      expect(poolInstance.query).toHaveBeenCalledWith(
        'SELECT data FROM test_collection',
        []
      );
    });
  });

  describe('batch()', () => {
    it('should execute batch operations in a transaction', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      poolInstance.connect.mockResolvedValueOnce(mockClient);

      const operations = [
        { type: 'set' as const, collection: 'test', id: 'doc1', data: { name: 'Doc 1' } },
        { type: 'set' as const, collection: 'test', id: 'doc2', data: { name: 'Doc 2' } },
        { type: 'delete' as const, collection: 'test', id: 'doc3' },
      ];

      await store.batch(operations);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.query).toHaveBeenCalledTimes(5); // BEGIN + 3 ops + COMMIT
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      poolInstance.connect.mockResolvedValueOnce(mockClient);

      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql === 'ROLLBACK') return Promise.resolve();
        throw new Error('Database error');
      });

      const operations = [
        { type: 'set' as const, collection: 'test', id: 'doc1', data: { name: 'Doc 1' } },
      ];

      await expect(store.batch(operations)).rejects.toThrow('Database error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('health()', () => {
    it('should return healthy status on successful connection', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValueOnce({});

      const result = await store.health();

      expect(result.healthy).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(poolInstance.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return unhealthy status on connection error', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await store.health();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('watch()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should poll for changes at specified interval', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      const mockDocs = [{ data: { id: 'doc1', version: 1 } }];
      poolInstance.query.mockResolvedValue({ rows: mockDocs });

      const callback = jest.fn();
      const unsubscribe = store.watch('test_collection', callback, 1000);

      // Initial call
      await jest.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);

      // Second poll
      await jest.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1); // No change, so no callback

      // Change data
      poolInstance.query.mockResolvedValue({
        rows: [{ data: { id: 'doc1', version: 2 } }],
      });

      await jest.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(2); // Change detected

      unsubscribe();
    });

    it('should stop polling when unsubscribe is called', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();
      poolInstance.query.mockResolvedValue({ rows: [] });

      const callback = jest.fn();
      const unsubscribe = store.watch('test_collection', callback, 1000);

      await jest.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      await jest.advanceTimersByTimeAsync(5000);
      expect(callback).toHaveBeenCalledTimes(1); // No more calls after unsubscribe
    });
  });

  describe('close()', () => {
    it('should close the connection pool', async () => {
      const { Pool } = require('pg');
      const poolInstance = new Pool();

      await store.close();

      expect(poolInstance.end).toHaveBeenCalled();
    });
  });
});

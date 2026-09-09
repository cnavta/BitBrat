/**
 * BidManager Unit Tests
 * Sprint 29: Bidding System for Utility Service
 *
 * Tests all bidding operations with mocked dependencies
 */

import { BidManager } from './bid-manager';
import { ScopeResolver } from './scope-resolver';
import type { IDocumentStore } from '../../common/persistence/interfaces';
import type { RedisClientType } from 'redis';
import type { InternalEventV2 } from '../../types';
import type { BidSession, BidResult } from './types';

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

// Mock DocumentStore
const createMockDocStore = (): jest.Mocked<IDocumentStore> => ({
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  query: jest.fn(),
  getAll: jest.fn(),
  watch: jest.fn(),
  batch: jest.fn(),
  health: jest.fn(),
});

// Mock Redis client
const createMockRedis = (): jest.Mocked<RedisClientType> => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  hSet: jest.fn(),
  hGet: jest.fn(),
  hGetAll: jest.fn(),
  ping: jest.fn(),
  isReady: true,
} as any);

describe('BidManager', () => {
  let manager: BidManager;
  let mockDocStore: jest.Mocked<IDocumentStore>;
  let mockRedis: jest.Mocked<RedisClientType>;
  let scopeResolver: ScopeResolver;

  beforeEach(() => {
    mockDocStore = createMockDocStore();
    mockRedis = createMockRedis();
    scopeResolver = new ScopeResolver(mockLogger);
    manager = new BidManager(mockDocStore, mockRedis, scopeResolver, mockLogger);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create bid session with explicit scope', async () => {
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.hSet.mockResolvedValue(1 as any);

      const result = await manager.create({
        name: 'price-guess',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
        targetValue: 100,
        ttlSeconds: 300,
      });

      expect(result).toMatchObject({
        success: true,
        sessionId: 'stream:bitbrat:price-guess',
        sessionKey: 'bid:session:stream:bitbrat:price-guess',
      });
      expect(result.expiresAt).toBeDefined();

      // Verify DocumentStore.set called with correct session
      expect(mockDocStore.set).toHaveBeenCalledWith(
        'bid_sessions',
        'stream:bitbrat:price-guess',
        expect.objectContaining({
          id: 'stream:bitbrat:price-guess',
          name: 'price-guess',
          scopeType: 'stream',
          scopeValue: 'bitbrat',
          targetValue: 100,
          ttlSeconds: 300,
          status: 'active',
          createdBy: 'system',
        })
      );

      // Verify Redis hash initialized with metadata
      expect(mockRedis.hSet).toHaveBeenCalledWith(
        'bid:session:stream:bitbrat:price-guess',
        '_metadata',
        expect.stringContaining('"targetValue":100')
      );
    });

    it('should create bid session without TTL', async () => {
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.hSet.mockResolvedValue(1 as any);

      const result = await manager.create({
        name: 'unlimited-session',
        scopeType: 'global',
        scopeValue: 'global',
      });

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeUndefined();

      // Verify no TTL set on Redis
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('should set TTL on Redis hash when specified', async () => {
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.hSet.mockResolvedValue(1 as any);
      mockRedis.expire.mockResolvedValue(true as any);

      await manager.create({
        name: 'timed-session',
        scopeType: 'stream',
        scopeValue: 'test',
        ttlSeconds: 600,
      });

      expect(mockRedis.expire).toHaveBeenCalledWith(
        'bid:session:stream:test:timed-session',
        600
      );
    });

    it('should auto-infer scope from event', async () => {
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.hSet.mockResolvedValue(1 as any);

      const event = {
        ingress: { channel: 'test-channel' },
      } as InternalEventV2;

      const result = await manager.create({
        name: 'guess-game',
        event,
      });

      expect(result.sessionId).toBe('stream:test-channel:guess-game');
      expect(result.sessionKey).toBe('bid:session:stream:test-channel:guess-game');
    });

    it('should include custom metadata', async () => {
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.hSet.mockResolvedValue(1 as any);

      await manager.create({
        name: 'auction',
        scopeType: 'global',
        scopeValue: 'global',
        metadata: {
          description: 'Charity auction',
          prize: '$100 gift card',
          icon: '💰',
        },
      });

      const session = mockDocStore.set.mock.calls[0][2] as BidSession;
      expect(session.metadata).toEqual({
        description: 'Charity auction',
        prize: '$100 gift card',
        icon: '💰',
      });
    });

    it('should handle errors gracefully', async () => {
      mockDocStore.set.mockRejectedValue(new Error('Database error'));

      const result = await manager.create({
        name: 'failing-session',
        scopeType: 'global',
        scopeValue: 'global',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    it('should submit new bid', async () => {
      mockRedis.hGet.mockResolvedValue(null); // No previous bid
      mockRedis.hSet.mockResolvedValue(1 as any);

      const result = await manager.submit({
        session: 'stream:bitbrat:price-guess',
        user: 'user123',
        value: 95,
      });

      expect(result).toMatchObject({
        success: true,
        entryId: 'stream:bitbrat:price-guess:user123',
        previousValue: undefined,
        newValue: 95,
      });

      expect(mockRedis.hSet).toHaveBeenCalledWith(
        'bid:session:stream:bitbrat:price-guess',
        'user:user123',
        '95'
      );
    });

    it('should update existing bid (upsert)', async () => {
      mockRedis.hGet.mockResolvedValue('85'); // Previous bid
      mockRedis.hSet.mockResolvedValue(0 as any); // Field updated (not created)

      const result = await manager.submit({
        session: 'stream:bitbrat:price-guess',
        user: 'user123',
        value: 105,
      });

      expect(result).toMatchObject({
        success: true,
        entryId: 'stream:bitbrat:price-guess:user123',
        previousValue: 85,
        newValue: 105,
      });

      expect(mockRedis.hSet).toHaveBeenCalledWith(
        'bid:session:stream:bitbrat:price-guess',
        'user:user123',
        '105'
      );
    });

    it('should handle errors gracefully', async () => {
      mockRedis.hGet.mockRejectedValue(new Error('Redis connection failed'));

      const result = await manager.submit({
        session: 'stream:bitbrat:test',
        user: 'user456',
        value: 50,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Redis connection failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getMax', () => {
    it('should return highest bid', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
        'user:alice': '95',
        'user:bob': '120',
        'user:charlie': '88',
      });

      const result = await manager.getMax({
        session: 'stream:bitbrat:price-guess',
      });

      expect(result).toMatchObject({
        sessionId: 'stream:bitbrat:price-guess',
        userId: 'bob',
        value: 120,
      });
    });

    it('should throw error if no bids found', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
      });

      await expect(
        manager.getMax({ session: 'stream:bitbrat:empty' })
      ).rejects.toThrow('No bids found');
    });
  });

  describe('getMin', () => {
    it('should return lowest bid', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
        'user:alice': '95',
        'user:bob': '120',
        'user:charlie': '88',
      });

      const result = await manager.getMin({
        session: 'stream:bitbrat:price-guess',
      });

      expect(result).toMatchObject({
        sessionId: 'stream:bitbrat:price-guess',
        userId: 'charlie',
        value: 88,
      });
    });

    it('should throw error if no bids found', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
      });

      await expect(
        manager.getMin({ session: 'stream:bitbrat:empty' })
      ).rejects.toThrow('No bids found');
    });
  });

  describe('getClosest', () => {
    it('should return bid closest to session target value', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
        'user:alice': '95',
        'user:bob': '120',
        'user:charlie': '88',
      });

      const result = await manager.getClosest({
        session: 'stream:bitbrat:price-guess',
      });

      expect(result).toMatchObject({
        sessionId: 'stream:bitbrat:price-guess',
        userId: 'alice',
        value: 95,
        difference: 5,
      });
    });

    it('should use explicit target value if provided', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
        'user:alice': '95',
        'user:bob': '120',
        'user:charlie': '88',
      });

      const result = await manager.getClosest({
        session: 'stream:bitbrat:price-guess',
        target: 90, // Override session target
      });

      expect(result).toMatchObject({
        userId: 'charlie',
        value: 88,
        difference: 2,
      });
    });

    it('should throw error if no target value specified', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({}), // No targetValue
        'user:alice': '95',
      });

      await expect(
        manager.getClosest({ session: 'stream:bitbrat:no-target' })
      ).rejects.toThrow('No target value specified');
    });

    it('should throw error if no bids found', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
      });

      await expect(
        manager.getClosest({ session: 'stream:bitbrat:empty' })
      ).rejects.toThrow('No bids found');
    });
  });

  describe('close', () => {
    const mockBids = {
      '_metadata': JSON.stringify({ targetValue: 100, createdAt: '2026-08-29T00:00:00Z' }),
      'user:alice': '95',
      'user:bob': '120',
      'user:charlie': '88',
    };

    it('should close session and compute statistics', async () => {
      mockRedis.hGetAll.mockResolvedValue(mockBids);
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.close({
        session: 'stream:bitbrat:price-guess',
      });

      expect(result).toMatchObject({
        success: true,
        sessionId: 'stream:bitbrat:price-guess',
        finalCount: 3,
        statistics: {
          max: 120,
          min: 88,
          mean: expect.closeTo(101, 1),
          median: 95,
        },
      });

      expect(result.closedAt).toBeDefined();
    });

    it('should determine winner (closest to target)', async () => {
      mockRedis.hGetAll.mockResolvedValue(mockBids);
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.close({
        session: 'stream:bitbrat:price-guess',
        computeWinner: true,
      });

      expect(result.winner).toMatchObject({
        userId: 'alice',
        value: 95,
        difference: 5,
      });
    });

    it('should skip winner computation if requested', async () => {
      mockRedis.hGetAll.mockResolvedValue(mockBids);
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.close({
        session: 'stream:bitbrat:price-guess',
        computeWinner: false,
      });

      expect(result.winner).toBeUndefined();
    });

    it('should snapshot results to DocumentStore', async () => {
      mockRedis.hGetAll.mockResolvedValue(mockBids);
      mockDocStore.set.mockResolvedValue(undefined);

      await manager.close({
        session: 'stream:bitbrat:price-guess',
      });

      // Verify session updated with closed status
      expect(mockDocStore.set).toHaveBeenCalledWith(
        'bid_sessions',
        'stream:bitbrat:price-guess',
        expect.objectContaining({
          closedAt: expect.any(String),
          status: 'closed',
        }),
        true // merge
      );

      // Verify results snapshot stored
      expect(mockDocStore.set).toHaveBeenCalledWith(
        'bid_results',
        expect.stringMatching(/^stream:bitbrat:price-guess:\d+$/),
        expect.objectContaining({
          sessionId: 'stream:bitbrat:price-guess',
          totalEntries: 3,
          closedAt: expect.any(String),
          statistics: expect.objectContaining({
            max: 120,
            min: 88,
            mean: expect.any(Number),
            median: 95,
          }),
          allEntries: expect.arrayContaining([
            expect.objectContaining({ userId: 'alice', value: 95 }),
            expect.objectContaining({ userId: 'bob', value: 120 }),
            expect.objectContaining({ userId: 'charlie', value: 88 }),
          ]),
        })
      );
    });

    it('should delete Redis hash if requested', async () => {
      mockRedis.hGetAll.mockResolvedValue(mockBids);
      mockRedis.del.mockResolvedValue(1 as any);
      mockDocStore.set.mockResolvedValue(undefined);

      await manager.close({
        session: 'stream:bitbrat:price-guess',
        deleteRedisHash: true,
      });

      expect(mockRedis.del).toHaveBeenCalledWith(
        'bid:session:stream:bitbrat:price-guess'
      );
    });

    it('should not delete Redis hash by default', async () => {
      mockRedis.hGetAll.mockResolvedValue(mockBids);
      mockDocStore.set.mockResolvedValue(undefined);

      await manager.close({
        session: 'stream:bitbrat:price-guess',
      });

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should compute median correctly for odd number of entries', async () => {
      mockRedis.hGetAll.mockResolvedValue(mockBids);
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.close({
        session: 'stream:bitbrat:price-guess',
      });

      // Sorted: [88, 95, 120], median = 95
      expect(result.statistics?.median).toBe(95);
    });

    it('should compute median correctly for even number of entries', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
        'user:alice': '95',
        'user:bob': '120',
        'user:charlie': '88',
        'user:david': '105',
      });
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.close({
        session: 'stream:bitbrat:price-guess',
      });

      // Sorted: [88, 95, 105, 120], median = (95 + 105) / 2 = 100
      expect(result.statistics?.median).toBe(100);
    });
  });

  describe('list', () => {
    it('should list all bid sessions without filters', async () => {
      const mockSessions = [
        { id: 'stream:bitbrat:game1', name: 'game1', status: 'active' },
        { id: 'stream:bitbrat:game2', name: 'game2', status: 'closed' },
      ] as BidSession[];

      mockDocStore.query.mockResolvedValue(mockSessions);

      const result = await manager.list({});

      expect(result).toEqual(mockSessions);
      expect(mockDocStore.query).toHaveBeenCalledWith('bid_sessions', {
        filters: [],
        limit: 50,
      });
    });

    it('should filter by scope type', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({ scopeType: 'stream' });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_sessions', {
        filters: [{ field: 'scopeType', operator: '==', value: 'stream' }],
        limit: 50,
      });
    });

    it('should filter by scope type and value', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_sessions', {
        filters: [
          { field: 'scopeType', operator: '==', value: 'stream' },
          { field: 'scopeValue', operator: '==', value: 'bitbrat' },
        ],
        limit: 50,
      });
    });

    it('should filter by status', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({ status: 'active' });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_sessions', {
        filters: [{ field: 'status', operator: '==', value: 'active' }],
        limit: 50,
      });
    });

    it('should respect limit parameter', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({ limit: 10 });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_sessions', {
        filters: [],
        limit: 10,
      });
    });
  });

  describe('getResults', () => {
    it('should query results by session ID', async () => {
      const mockResults = [
        { id: 'session1:123', sessionId: 'session1', totalEntries: 5 },
      ] as BidResult[];

      mockDocStore.query.mockResolvedValue(mockResults);

      const result = await manager.getResults({
        sessionId: 'session1',
      });

      expect(result).toEqual(mockResults);
      expect(mockDocStore.query).toHaveBeenCalledWith('bid_results', {
        filters: [{ field: 'sessionId', operator: '==', value: 'session1' }],
        limit: 50,
        orderBy: { field: 'closedAt', direction: 'desc' },
      });
    });

    it('should filter by scope type and value', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.getResults({
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_results', {
        filters: [
          { field: 'metadata.scopeType', operator: '==', value: 'stream' },
          { field: 'metadata.scopeValue', operator: '==', value: 'bitbrat' },
        ],
        limit: 50,
        orderBy: { field: 'closedAt', direction: 'desc' },
      });
    });

    it('should support custom ordering', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.getResults({
        orderBy: 'totalEntries',
      });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_results', {
        filters: [],
        limit: 50,
        orderBy: { field: 'totalEntries', direction: 'desc' },
      });
    });

    it('should default to closedAt ordering', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.getResults({});

      const call = mockDocStore.query.mock.calls[0][1];
      expect(call.orderBy).toEqual({ field: 'closedAt', direction: 'desc' });
    });

    it('should respect limit parameter', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.getResults({ limit: 25 });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_results', {
        filters: [],
        limit: 25,
        orderBy: { field: 'closedAt', direction: 'desc' },
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty hash (no bids) in aggregation', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
      });

      await expect(manager.getMax({ session: 'test' })).rejects.toThrow('No bids found');
      await expect(manager.getMin({ session: 'test' })).rejects.toThrow('No bids found');
      await expect(manager.getClosest({ session: 'test' })).rejects.toThrow('No bids found');
    });

    it('should handle single bid correctly', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
        'user:solo': '99',
      });
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.close({ session: 'test' });

      expect(result.finalCount).toBe(1);
      expect(result.statistics).toMatchObject({
        max: 99,
        min: 99,
        mean: 99,
        median: 99,
      });
      expect(result.winner).toMatchObject({
        userId: 'solo',
        value: 99,
        difference: 1,
      });
    });

    it('should filter out _metadata field from bid entries', async () => {
      mockRedis.hGetAll.mockResolvedValue({
        '_metadata': JSON.stringify({ targetValue: 100 }),
        'user:alice': '95',
        'user:bob': '120',
      });
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.close({ session: 'test' });

      expect(result.finalCount).toBe(2); // Not 3
      expect(result.statistics?.mean).toBeCloseTo(107.5, 1);
    });
  });
});

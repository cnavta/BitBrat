/**
 * Firestore → PostgreSQL Migration Business Logic Tests
 * Sprint 361: BIZ-003
 *
 * Comprehensive tests for all migration functions
 */

import {
  migrateCollection,
  migrateAll,
  migrateOAuthTokens,
  migrateApiTokens,
  COLLECTION_MAPPING,
  NESTED_COLLECTION_PATHS,
  DEFAULT_COLLECTIONS,
  OAUTH_TOKEN_PATHS,
  type MigrationOptions,
} from './migration';
import type { Logger } from '../orchestration/logger';
import type { PostgresDocumentStore } from '../../../../src/common/persistence/postgres-store';

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(),
} as any;

// Mock Firestore
const mockFirestore = {
  collection: jest.fn(),
  doc: jest.fn(),
} as any;

// Mock PostgresDocumentStore
const mockPostgres: jest.Mocked<PostgresDocumentStore> = {
  getAll: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
  close: jest.fn(),
  health: jest.fn(),
  setLogger: jest.fn(),
} as any;

describe('Migration Business Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Constants', () => {
    it('should include expected collections in DEFAULT_COLLECTIONS', () => {
      expect(DEFAULT_COLLECTIONS).toContain('events');
      expect(DEFAULT_COLLECTIONS).toContain('configs');
      expect(DEFAULT_COLLECTIONS).toContain('context_packs');
      expect(DEFAULT_COLLECTIONS).toContain('users');
      expect(DEFAULT_COLLECTIONS.length).toBeGreaterThan(10);
    });

    it('should include expected mappings in COLLECTION_MAPPING', () => {
      expect(COLLECTION_MAPPING['configs']).toBe('routing_rules');
      expect(COLLECTION_MAPPING['users']).toBe('auth_users');
      expect(COLLECTION_MAPPING['oauth']).toBe('auth_scopes');
      expect(COLLECTION_MAPPING['state']).toBe('user_state');
      expect(COLLECTION_MAPPING['services']).toBe('service_registry');
    });

    it('should include expected paths in NESTED_COLLECTION_PATHS', () => {
      expect(NESTED_COLLECTION_PATHS['configs']).toBe('configs/routingRules/rules');
    });

    it('should include expected OAuth token paths', () => {
      expect(OAUTH_TOKEN_PATHS).toContainEqual(
        expect.objectContaining({ provider: 'twitch', pg: 'twitch:bot' })
      );
      expect(OAUTH_TOKEN_PATHS).toContainEqual(
        expect.objectContaining({ provider: 'twitch', pg: 'twitch:broadcaster' })
      );
      expect(OAUTH_TOKEN_PATHS).toContainEqual(
        expect.objectContaining({ provider: 'discord', pg: 'discord:broadcaster' })
      );
    });
  });

  describe('migrateCollection()', () => {
    it('should migrate collection without mapping', async () => {
      // Mock Firestore data
      const firestoreDocs = [
        { id: '1', data: () => ({ id: '1', name: 'event1' }) },
        { id: '2', data: () => ({ id: '2', name: 'event2' }) },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: firestoreDocs,
          size: 2,
        }),
      });

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await migrateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockFirestore.collection).toHaveBeenCalledWith('events');
      expect(mockPostgres.set).toHaveBeenCalledTimes(2);
      expect(mockPostgres.set).toHaveBeenCalledWith('events', '1', { id: '1', name: 'event1' });
      expect(mockPostgres.set).toHaveBeenCalledWith('events', '2', { id: '2', name: 'event2' });

      expect(result.collection).toBe('events');
      expect(result.postgresTable).toBe('events');
      expect(result.migrated).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('should use collection name mapping', async () => {
      const firestoreDocs = [{ id: '1', data: () => ({ id: '1', name: 'user1' }) }];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: firestoreDocs, size: 1 }),
      });

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await migrateCollection('users', mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockFirestore.collection).toHaveBeenCalledWith('users');
      expect(mockPostgres.set).toHaveBeenCalledWith('auth_users', '1', { id: '1', name: 'user1' });
      expect(result.postgresTable).toBe('auth_users');
    });

    it('should use nested collection path', async () => {
      const firestoreDocs = [{ id: '1', data: () => ({ id: '1', rule: 'test' }) }];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: firestoreDocs, size: 1 }),
      });

      mockPostgres.set.mockResolvedValue(undefined);

      await migrateCollection('configs', mockFirestore, mockPostgres, {}, mockLogger);

      // Should use nested path from NESTED_COLLECTION_PATHS
      expect(mockFirestore.collection).toHaveBeenCalledWith('configs/routingRules/rules');
      expect(mockPostgres.set).toHaveBeenCalledWith('routing_rules', '1', { id: '1', rule: 'test' });
    });

    it('should handle dry-run mode without writing', async () => {
      const firestoreDocs = [{ id: '1', data: () => ({ id: '1' }) }];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: firestoreDocs, size: 1 }),
      });

      const result = await migrateCollection('events', mockFirestore, mockPostgres, { dryRun: true }, mockLogger);

      expect(mockPostgres.set).not.toHaveBeenCalled();
      expect(result.migrated).toBe(1);
    });

    it('should call progress callback', async () => {
      const firestoreDocs = [
        { id: '1', data: () => ({ id: '1' }) },
        { id: '2', data: () => ({ id: '2' }) },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: firestoreDocs, size: 2 }),
      });

      mockPostgres.set.mockResolvedValue(undefined);

      const onProgress = jest.fn();
      await migrateCollection('events', mockFirestore, mockPostgres, { onProgress }, mockLogger);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(1, 2);
      expect(onProgress).toHaveBeenCalledWith(2, 2);
    });

    it('should handle migration errors gracefully', async () => {
      const firestoreDocs = [
        { id: '1', data: () => ({ id: '1' }) },
        { id: '2', data: () => ({ id: '2' }) },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: firestoreDocs, size: 2 }),
      });

      mockPostgres.set.mockResolvedValueOnce(undefined);
      mockPostgres.set.mockRejectedValueOnce(new Error('Database error'));

      const result = await migrateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'migrate.document.error' }),
        expect.stringContaining('Failed to migrate document')
      );
    });

    it('should handle empty collection', async () => {
      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      });

      const result = await migrateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(0);
    });
  });

  describe('migrateAll()', () => {
    it('should migrate multiple collections', async () => {
      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: [{ id: '1', data: () => ({ id: '1' }) }],
          size: 1,
        }),
      });

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await migrateAll(['events', 'context_packs'], mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockFirestore.collection).toHaveBeenCalledTimes(2);
      expect(result.collections['events']).toEqual({ migrated: 1, skipped: 0, errors: 0 });
      expect(result.collections['context_packs']).toEqual({ migrated: 1, skipped: 0, errors: 0 });
      expect(result.totalMigrated).toBe(2);
      expect(result.totalErrors).toBe(0);
    });

    it('should aggregate errors across collections', async () => {
      let callCount = 0;

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First collection: successful
            return Promise.resolve({
              docs: [{ id: '1', data: () => ({ id: '1' }) }],
              size: 1,
            });
          } else {
            // Second collection: has error
            return Promise.resolve({
              docs: [{ id: '2', data: () => ({ id: '2' }) }],
              size: 1,
            });
          }
        }),
      });

      mockPostgres.set.mockResolvedValueOnce(undefined);
      mockPostgres.set.mockRejectedValueOnce(new Error('Database error'));

      const result = await migrateAll(['events', 'context_packs'], mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.totalMigrated).toBe(1);
      expect(result.totalErrors).toBe(1);
    });
  });

  describe('migrateOAuthTokens()', () => {
    it('should migrate all OAuth tokens when no provider specified', async () => {
      mockFirestore.doc.mockImplementation((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            accessToken: 'token123',
            refreshToken: 'refresh123',
            scope: ['read', 'write'],
          }),
        }),
      }));

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await migrateOAuthTokens(undefined, mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockFirestore.doc).toHaveBeenCalledTimes(3); // Twitch bot, broadcaster, Discord broadcaster
      expect(mockPostgres.set).toHaveBeenCalledTimes(3);
      expect(result.migrated).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should migrate only specified provider tokens', async () => {
      mockFirestore.doc.mockImplementation((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ accessToken: 'token123' }),
        }),
      }));

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await migrateOAuthTokens('twitch', mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockFirestore.doc).toHaveBeenCalledTimes(2); // Only Twitch bot and broadcaster
      expect(result.migrated).toBe(2);
    });

    it('should skip missing tokens', async () => {
      mockFirestore.doc.mockImplementation((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: false,
        }),
      }));

      const result = await migrateOAuthTokens('twitch', mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockPostgres.set).not.toHaveBeenCalled();
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(2);
    });

    it('should skip tokens without accessToken', async () => {
      mockFirestore.doc.mockImplementation((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ refreshToken: 'refresh123' }), // Missing accessToken
        }),
      }));

      const result = await migrateOAuthTokens('twitch', mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockPostgres.set).not.toHaveBeenCalled();
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(2);
    });

    it('should handle dry-run mode', async () => {
      mockFirestore.doc.mockImplementation((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ accessToken: 'token123' }),
        }),
      }));

      const result = await migrateOAuthTokens('twitch', mockFirestore, mockPostgres, { dryRun: true }, mockLogger);

      expect(mockPostgres.set).not.toHaveBeenCalled();
      expect(result.migrated).toBe(2);
    });

    it('should handle migration errors', async () => {
      mockFirestore.doc.mockImplementation((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ accessToken: 'token123' }),
        }),
      }));

      mockPostgres.set.mockResolvedValueOnce(undefined);
      mockPostgres.set.mockRejectedValueOnce(new Error('Database error'));

      const result = await migrateOAuthTokens('twitch', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(1);
    });

    it('should throw error for unknown provider', async () => {
      await expect(
        migrateOAuthTokens('invalid-provider', mockFirestore, mockPostgres, {}, mockLogger)
      ).rejects.toThrow('Unknown provider: invalid-provider');
    });
  });

  describe('migrateApiTokens()', () => {
    it('should migrate API tokens', async () => {
      const tokens = [
        { id: 'token1', data: () => ({ user_id: 'user1', token_hash: 'hash1' }) },
        { id: 'token2', data: () => ({ user_id: 'user2', token_hash: 'hash2' }) },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: tokens, size: 2 }),
      });

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await migrateApiTokens(mockFirestore, mockPostgres, {}, mockLogger);

      expect(mockFirestore.collection).toHaveBeenCalledWith('gateways/api/tokens');
      expect(mockPostgres.set).toHaveBeenCalledTimes(2);
      expect(mockPostgres.set).toHaveBeenCalledWith('api_tokens', 'token1', expect.objectContaining({
        user_id: 'user1',
        token_hash: 'hash1',
      }));

      expect(result.migrated).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('should handle empty token collection', async () => {
      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      });

      const result = await migrateApiTokens(mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should handle dry-run mode', async () => {
      const tokens = [{ id: 'token1', data: () => ({ user_id: 'user1', token_hash: 'hash1' }) }];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: tokens, size: 1 }),
      });

      const result = await migrateApiTokens(mockFirestore, mockPostgres, { dryRun: true }, mockLogger);

      expect(mockPostgres.set).not.toHaveBeenCalled();
      expect(result.migrated).toBe(1);
    });

    it('should call progress callback', async () => {
      const tokens = [
        { id: 'token1', data: () => ({ user_id: 'user1', token_hash: 'hash1' }) },
        { id: 'token2', data: () => ({ user_id: 'user2', token_hash: 'hash2' }) },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: tokens, size: 2 }),
      });

      mockPostgres.set.mockResolvedValue(undefined);

      const onProgress = jest.fn();
      await migrateApiTokens(mockFirestore, mockPostgres, { onProgress }, mockLogger);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(1, 2);
      expect(onProgress).toHaveBeenCalledWith(2, 2);
    });

    it('should handle migration errors', async () => {
      const tokens = [
        { id: 'token1', data: () => ({ user_id: 'user1', token_hash: 'hash1' }) },
        { id: 'token2', data: () => ({ user_id: 'user2', token_hash: 'hash2' }) },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: tokens, size: 2 }),
      });

      mockPostgres.set.mockResolvedValueOnce(undefined);
      mockPostgres.set.mockRejectedValueOnce(new Error('Database error'));

      const result = await migrateApiTokens(mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'migrate.api_tokens.error' }),
        expect.stringContaining('Failed to migrate API token')
      );
    });
  });
});

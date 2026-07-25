/**
 * PostgreSQL Backup/Restore Business Logic Tests
 * Sprint 361: BIZ-002
 *
 * Comprehensive tests for all backup/restore functions
 */

import {
  backupToJson,
  restoreFromJson,
  backupToSql,
  restoreFromSql,
  detectFormat,
  compressData,
  decompressData,
  DEFAULT_COLLECTIONS,
  type BackupOptions,
  type RestoreOptions,
} from './pg-backup';
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

// Mock execCmd
jest.mock('../orchestration/exec', () => ({
  execCmd: jest.fn(),
}));

const { execCmd } = require('../orchestration/exec');

describe('PostgreSQL Backup Business Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DEFAULT_COLLECTIONS', () => {
    it('should include expected collections', () => {
      expect(DEFAULT_COLLECTIONS).toContain('events');
      expect(DEFAULT_COLLECTIONS).toContain('routing_rules');
      expect(DEFAULT_COLLECTIONS).toContain('context_packs');
      expect(DEFAULT_COLLECTIONS).toContain('auth_users');
      expect(DEFAULT_COLLECTIONS.length).toBeGreaterThan(10);
    });
  });

  describe('backupToJson()', () => {
    it('should backup all default collections', async () => {
      // Mock data
      mockPostgres.getAll.mockResolvedValueOnce([{ id: '1', data: 'event1' }]);
      mockPostgres.getAll.mockResolvedValueOnce([{ id: '2', data: 'rule1' }]);

      const result = await backupToJson(
        mockPostgres,
        { collections: ['events', 'routing_rules'] },
        mockLogger
      );

      expect(mockPostgres.getAll).toHaveBeenCalledTimes(2);
      expect(mockPostgres.getAll).toHaveBeenCalledWith('events');
      expect(mockPostgres.getAll).toHaveBeenCalledWith('routing_rules');

      expect(result.data).toEqual({
        events: [{ id: '1', data: 'event1' }],
        routing_rules: [{ id: '2', data: 'rule1' }],
      });

      expect(result.metadata.collections).toBe(2);
      expect(result.metadata.totalDocuments).toBe(2);
      expect(result.metadata.format).toBe('json');
    });

    it('should use default collections when not specified', async () => {
      mockPostgres.getAll.mockResolvedValue([]);

      const result = await backupToJson(mockPostgres, {}, mockLogger);

      expect(mockPostgres.getAll).toHaveBeenCalledTimes(DEFAULT_COLLECTIONS.length);
      expect(result.metadata.collections).toBe(DEFAULT_COLLECTIONS.length);
    });

    it('should handle empty collections', async () => {
      mockPostgres.getAll.mockResolvedValue([]);

      const result = await backupToJson(
        mockPostgres,
        { collections: ['empty_collection'] },
        mockLogger
      );

      expect(result.data.empty_collection).toEqual([]);
      expect(result.metadata.totalDocuments).toBe(0);
    });

    it('should set compress flag in metadata', async () => {
      mockPostgres.getAll.mockResolvedValue([]);

      const result = await backupToJson(
        mockPostgres,
        { collections: ['events'], compress: true },
        mockLogger
      );

      expect(result.metadata.compressed).toBe(true);
    });

    it('should log progress for each collection', async () => {
      mockPostgres.getAll.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);

      await backupToJson(mockPostgres, { collections: ['events'] }, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { action: 'backup.collection.start', collection: 'events' },
        'Backing up events...'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        { action: 'backup.collection.complete', collection: 'events', count: 2 },
        'Backed up 2 documents from events'
      );
    });
  });

  describe('restoreFromJson()', () => {
    it('should restore documents in merge mode', async () => {
      const data = {
        events: [
          { id: '1', data: 'event1' },
          { id: '2', data: 'event2' },
        ],
      };

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await restoreFromJson(mockPostgres, data, { mode: 'merge' }, mockLogger);

      expect(mockPostgres.set).toHaveBeenCalledTimes(2);
      expect(mockPostgres.set).toHaveBeenCalledWith('events', '1', { id: '1', data: 'event1' });
      expect(mockPostgres.set).toHaveBeenCalledWith('events', '2', { id: '2', data: 'event2' });

      expect(result.restored).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('should handle dry-run mode without writing', async () => {
      const data = {
        events: [{ id: '1', data: 'event1' }],
      };

      const result = await restoreFromJson(mockPostgres, data, { dryRun: true }, mockLogger);

      expect(mockPostgres.set).not.toHaveBeenCalled();
      expect(result.restored).toBe(1);
      expect(result.errors).toBe(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { action: 'restore.collection.dryrun', collection: 'events' },
        '[DRY RUN] Would restore documents'
      );
    });

    it('should handle documents with _id field', async () => {
      const data = {
        events: [{ _id: 'custom-id', data: 'event1' }],
      };

      mockPostgres.set.mockResolvedValue(undefined);

      await restoreFromJson(mockPostgres, data, {}, mockLogger);

      expect(mockPostgres.set).toHaveBeenCalledWith('events', 'custom-id', {
        _id: 'custom-id',
        data: 'event1',
      });
    });

    it('should generate random ID if no id or _id field', async () => {
      const data = {
        events: [{ data: 'event1' }],
      };

      mockPostgres.set.mockResolvedValue(undefined);

      await restoreFromJson(mockPostgres, data, {}, mockLogger);

      const setCall = (mockPostgres.set as jest.Mock).mock.calls[0];
      expect(setCall[0]).toBe('events');
      expect(setCall[1]).toMatch(/^[a-z0-9]+$/); // Random ID
      expect(setCall[2]).toEqual({ data: 'event1' });
    });

    it('should handle restore errors gracefully', async () => {
      const data = {
        events: [
          { id: '1', data: 'event1' },
          { id: '2', data: 'event2' },
        ],
      };

      mockPostgres.set.mockResolvedValueOnce(undefined);
      mockPostgres.set.mockRejectedValueOnce(new Error('Database error'));

      const result = await restoreFromJson(mockPostgres, data, {}, mockLogger);

      expect(result.restored).toBe(1);
      expect(result.errors).toBe(1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'restore.document.error' }),
        'Failed to restore document'
      );
    });

    it('should restore multiple collections', async () => {
      const data = {
        events: [{ id: '1' }],
        routing_rules: [{ id: '2' }],
      };

      mockPostgres.set.mockResolvedValue(undefined);

      const result = await restoreFromJson(mockPostgres, data, {}, mockLogger);

      expect(mockPostgres.set).toHaveBeenCalledTimes(2);
      expect(result.restored).toBe(2);
    });
  });

  describe('backupToSql()', () => {
    it('should call pg_dump with correct arguments', async () => {
      execCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

      // Mock fs.statSync
      jest.spyOn(require('fs'), 'statSync').mockReturnValue({ size: 12345 });

      const result = await backupToSql(
        '/tmp/backup.pgdump',
        'postgresql://user:pass@localhost:5432/db',
        { compress: false },
        mockLogger
      );

      expect(execCmd).toHaveBeenCalledWith('pg_dump', [
        'postgresql://user:pass@localhost:5432/db',
        '--file',
        '/tmp/backup.pgdump',
        '--format',
        'custom',
        '--compress',
        '0',
        '--verbose',
      ]);

      expect(result.success).toBe(true);
      expect(result.path).toBe('/tmp/backup.pgdump');
      expect(result.size).toBe(12345);
    });

    it('should use compression level 9 when compress=true', async () => {
      execCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
      jest.spyOn(require('fs'), 'statSync').mockReturnValue({ size: 5000 });

      await backupToSql('/tmp/backup.pgdump', 'postgresql://localhost/db', { compress: true }, mockLogger);

      expect(execCmd).toHaveBeenCalledWith(
        'pg_dump',
        expect.arrayContaining(['--compress', '9'])
      );
    });

    it('should throw error if pg_dump fails', async () => {
      execCmd.mockResolvedValue({ code: 1, stdout: '', stderr: 'pg_dump: error: connection failed' });

      await expect(
        backupToSql('/tmp/backup.pgdump', 'postgresql://localhost/db', {}, mockLogger)
      ).rejects.toThrow('pg_dump failed: pg_dump: error: connection failed');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('restoreFromSql()', () => {
    it('should call pg_restore with correct arguments', async () => {
      execCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

      const result = await restoreFromSql(
        '/tmp/backup.pgdump',
        'postgresql://user:pass@localhost:5432/db',
        {},
        mockLogger
      );

      expect(execCmd).toHaveBeenCalledWith('pg_restore', [
        '--dbname',
        'postgresql://user:pass@localhost:5432/db',
        '--clean',
        '--if-exists',
        '--verbose',
        '/tmp/backup.pgdump',
      ]);

      expect(result.success).toBe(true);
    });

    it('should handle dry-run mode without calling pg_restore', async () => {
      const result = await restoreFromSql(
        '/tmp/backup.pgdump',
        'postgresql://localhost/db',
        { dryRun: true },
        mockLogger
      );

      expect(execCmd).not.toHaveBeenCalled();
      expect(result.success).toBe(true);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { action: 'restore.sql.dryrun', inputPath: '/tmp/backup.pgdump' },
        '[DRY RUN] Would restore from SQL backup'
      );
    });

    it('should throw error if pg_restore fails', async () => {
      execCmd.mockResolvedValue({ code: 1, stdout: '', stderr: 'pg_restore: error: invalid format' });

      await expect(
        restoreFromSql('/tmp/backup.pgdump', 'postgresql://localhost/db', {}, mockLogger)
      ).rejects.toThrow('pg_restore failed: pg_restore: error: invalid format');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('detectFormat()', () => {
    it('should detect SQL format from .pgdump extension', () => {
      expect(detectFormat('/path/to/backup.pgdump')).toBe('sql');
    });

    it('should detect JSON format from .json extension', () => {
      expect(detectFormat('/path/to/backup.json')).toBe('json');
    });

    it('should detect JSON format from .json.gz extension', () => {
      expect(detectFormat('/path/to/backup.json.gz')).toBe('json');
    });

    it('should throw error for unknown format', () => {
      expect(() => detectFormat('/path/to/backup.txt')).toThrow(
        'Unknown backup format: /path/to/backup.txt'
      );
    });

    it('should throw error for files without extension', () => {
      expect(() => detectFormat('/path/to/backup')).toThrow('Unknown backup format');
    });
  });

  describe('compressData() and decompressData()', () => {
    it('should compress and decompress data', async () => {
      // Use larger data to ensure compression actually reduces size
      const originalData = Buffer.from('Hello, World! '.repeat(100));

      const compressed = await compressData(originalData);
      expect(compressed).not.toEqual(originalData);
      expect(compressed.length).toBeLessThan(originalData.length);

      const decompressed = await decompressData(compressed);
      expect(decompressed).toEqual(originalData);
      expect(decompressed.toString()).toBe('Hello, World! '.repeat(100));
    });

    it('should handle empty data', async () => {
      const emptyData = Buffer.from('');

      const compressed = await compressData(emptyData);
      const decompressed = await decompressData(compressed);

      expect(decompressed).toEqual(emptyData);
    });

    it('should throw error when decompressing invalid data', async () => {
      const invalidData = Buffer.from('not gzip data');

      await expect(decompressData(invalidData)).rejects.toThrow();
    });
  });
});

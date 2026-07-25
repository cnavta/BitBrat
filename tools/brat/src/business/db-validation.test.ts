/**
 * Database Validation Business Logic Tests
 * Sprint 361: BIZ-004
 *
 * Comprehensive tests for Firestore ↔ PostgreSQL validation
 */

import {
  calculateChecksum,
  validateCollection,
  validateAll,
  formatValidationResult,
  formatValidationSummary,
  DEFAULT_COLLECTIONS,
  type ValidationOptions,
  type ValidationResult,
} from './db-validation';
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

describe('Database Validation Business Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DEFAULT_COLLECTIONS', () => {
    it('should include expected collections', () => {
      expect(DEFAULT_COLLECTIONS).toContain('events');
      expect(DEFAULT_COLLECTIONS).toContain('commands');
      expect(DEFAULT_COLLECTIONS).toContain('context_packs');
      expect(DEFAULT_COLLECTIONS).toContain('auth_users');
      expect(DEFAULT_COLLECTIONS.length).toBeGreaterThan(10);
    });
  });

  describe('calculateChecksum()', () => {
    it('should return consistent checksum for same document', () => {
      const doc = { id: '1', name: 'test', value: 42 };

      const checksum1 = calculateChecksum(doc);
      const checksum2 = calculateChecksum(doc);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    it('should return same checksum regardless of property order', () => {
      const doc1 = { id: '1', name: 'test', value: 42 };
      const doc2 = { value: 42, id: '1', name: 'test' };

      const checksum1 = calculateChecksum(doc1);
      const checksum2 = calculateChecksum(doc2);

      expect(checksum1).toBe(checksum2);
    });

    it('should return different checksum for different documents', () => {
      const doc1 = { id: '1', name: 'test' };
      const doc2 = { id: '2', name: 'test' };

      const checksum1 = calculateChecksum(doc1);
      const checksum2 = calculateChecksum(doc2);

      expect(checksum1).not.toBe(checksum2);
    });

    it('should handle nested objects', () => {
      const doc = { id: '1', nested: { foo: 'bar', baz: 123 } };

      const checksum = calculateChecksum(doc);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle arrays', () => {
      const doc = { id: '1', items: [1, 2, 3] };

      const checksum = calculateChecksum(doc);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('validateCollection()', () => {
    it('should validate collection with matching data', async () => {
      // Mock Firestore data
      const firestoreDocs = [
        { id: '1', data: 'doc1' },
        { id: '2', data: 'doc2' },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: firestoreDocs.map(d => ({
            id: d.id,
            data: () => d,
          })),
        }),
      });

      // Mock PostgreSQL data (same as Firestore)
      mockPostgres.getAll.mockResolvedValue(firestoreDocs);

      const result = await validateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.collection).toBe('events');
      expect(result.firestoreCount).toBe(2);
      expect(result.postgresCount).toBe(2);
      expect(result.countMatch).toBe(true);
      expect(result.checksumMatches).toBe(2);
      expect(result.checksumMismatches).toBe(0);
      expect(result.missingInPostgres).toBe(0);
      expect(result.missingInFirestore).toBe(0);
      expect(result.differences.length).toBe(0);
    });

    it('should detect missing documents in PostgreSQL', async () => {
      // Mock Firestore data
      const firestoreDocs = [
        { id: '1', data: 'doc1' },
        { id: '2', data: 'doc2' },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: firestoreDocs.map(d => ({
            id: d.id,
            data: () => d,
          })),
        }),
      });

      // Mock PostgreSQL data (missing doc2)
      mockPostgres.getAll.mockResolvedValue([{ id: '1', data: 'doc1' }]);

      const result = await validateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.countMatch).toBe(false);
      expect(result.firestoreCount).toBe(2);
      expect(result.postgresCount).toBe(1);
      expect(result.missingInPostgres).toBe(1);
      expect(result.differences).toContainEqual({ id: '2', issue: 'missing_in_postgres' });
    });

    it('should detect missing documents in Firestore', async () => {
      // Mock Firestore data
      const firestoreDocs = [{ id: '1', data: 'doc1' }];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: firestoreDocs.map(d => ({
            id: d.id,
            data: () => d,
          })),
        }),
      });

      // Mock PostgreSQL data (has extra doc2)
      mockPostgres.getAll.mockResolvedValue([
        { id: '1', data: 'doc1' },
        { id: '2', data: 'doc2' },
      ]);

      const result = await validateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.countMatch).toBe(false);
      expect(result.firestoreCount).toBe(1);
      expect(result.postgresCount).toBe(2);
      expect(result.missingInFirestore).toBe(1);
      expect(result.differences).toContainEqual({ id: '2', issue: 'missing_in_firestore' });
    });

    it('should detect checksum mismatches', async () => {
      // Mock Firestore data
      const firestoreDocs = [
        { id: '1', data: 'doc1', version: 1 },
        { id: '2', data: 'doc2', version: 1 },
      ];

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: firestoreDocs.map(d => ({
            id: d.id,
            data: () => d,
          })),
        }),
      });

      // Mock PostgreSQL data (doc2 has different version)
      mockPostgres.getAll.mockResolvedValue([
        { id: '1', data: 'doc1', version: 1 },
        { id: '2', data: 'doc2', version: 2 }, // Different!
      ]);

      const result = await validateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.checksumMatches).toBe(1);
      expect(result.checksumMismatches).toBe(1);
      expect(result.differences).toContainEqual({ id: '2', issue: 'checksum_mismatch' });
    });

    it('should use custom sample size', async () => {
      // Mock Firestore data with 100 docs
      const firestoreDocs = Array.from({ length: 100 }, (_, i) => ({ id: String(i), data: `doc${i}` }));

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: firestoreDocs.map(d => ({
            id: d.id,
            data: () => d,
          })),
        }),
      });

      mockPostgres.getAll.mockResolvedValue(firestoreDocs);

      const result = await validateCollection('events', mockFirestore, mockPostgres, { sampleSize: 50 }, mockLogger);

      expect(result.sampled).toBe(50);
    });

    it('should default to 1000 sample size', async () => {
      // Mock Firestore data with 2000 docs
      const firestoreDocs = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), data: `doc${i}` }));

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: firestoreDocs.map(d => ({
            id: d.id,
            data: () => d,
          })),
        }),
      });

      mockPostgres.getAll.mockResolvedValue(firestoreDocs);

      const result = await validateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.sampled).toBe(1000);
    });

    it('should handle empty collections', async () => {
      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: [] }),
      });

      mockPostgres.getAll.mockResolvedValue([]);

      const result = await validateCollection('events', mockFirestore, mockPostgres, {}, mockLogger);

      expect(result.firestoreCount).toBe(0);
      expect(result.postgresCount).toBe(0);
      expect(result.countMatch).toBe(true);
      expect(result.sampled).toBe(0);
    });
  });

  describe('validateAll()', () => {
    it('should validate multiple collections', async () => {
      // Mock Firestore
      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: [{ id: '1', data: () => ({ id: '1', data: 'doc1' }) }],
        }),
      });

      // Mock PostgreSQL
      mockPostgres.getAll.mockResolvedValue([{ id: '1', data: 'doc1' }]);

      const summary = await validateAll(['events', 'commands'], mockFirestore, mockPostgres, {}, mockLogger);

      expect(summary.collections.length).toBe(2);
      expect(summary.totalIssues).toBe(0);
      expect(summary.success).toBe(true);
    });

    it('should aggregate issues across collections', async () => {
      let callCount = 0;

      mockFirestore.collection.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // events: has mismatch
            return Promise.resolve({
              docs: [
                { id: '1', data: () => ({ id: '1', data: 'doc1', version: 1 }) },
              ],
            });
          } else {
            // commands: all good
            return Promise.resolve({
              docs: [{ id: '2', data: () => ({ id: '2', data: 'doc2' }) }],
            });
          }
        }),
      });

      mockPostgres.getAll.mockImplementation((collection) => {
        if (collection === 'events') {
          return Promise.resolve([{ id: '1', data: 'doc1', version: 2 }]); // Different version
        } else {
          return Promise.resolve([{ id: '2', data: 'doc2' }]);
        }
      });

      const summary = await validateAll(['events', 'commands'], mockFirestore, mockPostgres, {}, mockLogger);

      expect(summary.collections.length).toBe(2);
      expect(summary.totalIssues).toBe(1);
      expect(summary.success).toBe(false);
    });
  });

  describe('formatValidationResult()', () => {
    it('should format result with no issues', () => {
      const result: ValidationResult = {
        collection: 'events',
        firestoreCount: 10,
        postgresCount: 10,
        countMatch: true,
        sampled: 10,
        checksumMatches: 10,
        checksumMismatches: 0,
        missingInPostgres: 0,
        missingInFirestore: 0,
        differences: [],
      };

      const formatted = formatValidationResult(result);

      expect(formatted).toContain('Validation Results: events');
      expect(formatted).toContain('Firestore count: 10');
      expect(formatted).toContain('PostgreSQL count: 10');
      expect(formatted).toContain('Count match: ✓');
      expect(formatted).toContain('Checksum matches: 10');
      expect(formatted).toContain('Checksum mismatches: 0');
    });

    it('should format result with differences', () => {
      const result: ValidationResult = {
        collection: 'events',
        firestoreCount: 10,
        postgresCount: 8,
        countMatch: false,
        sampled: 8,
        checksumMatches: 6,
        checksumMismatches: 1,
        missingInPostgres: 2,
        missingInFirestore: 0,
        differences: [
          { id: 'doc1', issue: 'missing_in_postgres' },
          { id: 'doc2', issue: 'checksum_mismatch' },
        ],
      };

      const formatted = formatValidationResult(result);

      expect(formatted).toContain('Count match: ✗');
      expect(formatted).toContain('Missing in PostgreSQL: 2');
      expect(formatted).toContain('Differences (first 10):');
      expect(formatted).toContain('doc1: missing_in_postgres');
      expect(formatted).toContain('doc2: checksum_mismatch');
    });
  });

  describe('formatValidationSummary()', () => {
    it('should format summary with all collections valid', () => {
      const summary = {
        collections: [
          {
            collection: 'events',
            firestoreCount: 10,
            postgresCount: 10,
            countMatch: true,
            sampled: 10,
            checksumMatches: 10,
            checksumMismatches: 0,
            missingInPostgres: 0,
            missingInFirestore: 0,
            differences: [],
          },
        ],
        totalIssues: 0,
        success: true,
      };

      const formatted = formatValidationSummary(summary);

      expect(formatted).toContain('Validation Summary (all collections)');
      expect(formatted).toContain('✓ events');
      expect(formatted).toContain('Total issues: 0');
      expect(formatted).toContain('✓ All collections validated successfully');
    });

    it('should format summary with validation failures', () => {
      const summary = {
        collections: [
          {
            collection: 'events',
            firestoreCount: 10,
            postgresCount: 8,
            countMatch: false,
            sampled: 8,
            checksumMatches: 7,
            checksumMismatches: 1,
            missingInPostgres: 2,
            missingInFirestore: 0,
            differences: [],
          },
        ],
        totalIssues: 3,
        success: false,
      };

      const formatted = formatValidationSummary(summary);

      expect(formatted).toContain('✗ events');
      expect(formatted).toContain('Total issues: 3');
      expect(formatted).toContain('✗ Validation failed - 3 issues found');
    });
  });
});

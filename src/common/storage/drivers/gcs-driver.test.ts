/**
 * GCS Storage Driver Tests - Sprint 373
 *
 * Comprehensive test suite for GcsStorageDriver.
 * Uses mocked GCS client to avoid actual cloud API calls.
 */

import { GcsStorageDriver } from './gcs-driver';
import type { StorageFileMetadata } from '../types';

// Mock the @google-cloud/storage module
jest.mock('@google-cloud/storage');
jest.mock('../../resources/storage-manager', () => ({
  buildResilientStorageOptions: (opts: any) => opts,
}));

import { Storage } from '@google-cloud/storage';

describe('GcsStorageDriver', () => {
  let driver: GcsStorageDriver;
  let mockStorage: any;
  let mockBucket: any;
  let mockFile: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock file
    mockFile = {
      save: jest.fn().mockResolvedValue(undefined),
      download: jest.fn().mockResolvedValue([Buffer.from('test content')]),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue([true]),
      getMetadata: jest.fn().mockResolvedValue([{
        contentType: 'text/plain',
        size: 12,
        timeCreated: '2026-07-29T12:00:00.000Z',
        metadata: {
          size: '12',
          createdAt: '2026-07-29T12:00:00.000Z',
        },
      }]),
      name: 'test.txt',
    };

    // Create mock bucket
    mockBucket = {
      exists: jest.fn().mockResolvedValue([true]),
      file: jest.fn().mockReturnValue(mockFile),
      getFiles: jest.fn().mockResolvedValue([[mockFile]]),
    };

    // Create mock storage
    mockStorage = {
      bucket: jest.fn().mockReturnValue(mockBucket),
    };

    // Mock Storage constructor
    (Storage as jest.MockedClass<typeof Storage>).mockImplementation(() => mockStorage);

    driver = new GcsStorageDriver({
      bucketName: 'test-bucket',
    });
  });

  describe('initialize()', () => {
    it('creates Storage client and verifies bucket exists', async () => {
      await driver.initialize();

      expect(Storage).toHaveBeenCalledWith(expect.objectContaining({}));
      expect(mockStorage.bucket).toHaveBeenCalledWith('test-bucket');
      expect(mockBucket.exists).toHaveBeenCalled();
    });

    it('is idempotent - can be called multiple times', async () => {
      await driver.initialize();
      await driver.initialize();
      await driver.initialize();

      // Should only create Storage client once
      expect(Storage).toHaveBeenCalledTimes(1);
    });

    it('throws if bucket name is empty', async () => {
      const invalidDriver = new GcsStorageDriver({
        bucketName: '',
      });

      await expect(invalidDriver.initialize()).rejects.toThrow('bucket name is required');
    });

    it('throws if bucket does not exist', async () => {
      mockBucket.exists.mockResolvedValue([false]);

      await expect(driver.initialize()).rejects.toThrow('bucket does not exist');
    });

    it('uses keyFilename if provided', async () => {
      const driverWithKey = new GcsStorageDriver({
        bucketName: 'test-bucket',
        keyFilename: '/path/to/key.json',
      });

      await driverWithKey.initialize();

      expect(Storage).toHaveBeenCalledWith(
        expect.objectContaining({
          keyFilename: '/path/to/key.json',
        })
      );
    });

    it('uses projectId if provided', async () => {
      const driverWithProject = new GcsStorageDriver({
        bucketName: 'test-bucket',
        projectId: 'my-project',
      });

      await driverWithProject.initialize();

      expect(Storage).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'my-project',
        })
      );
    });
  });

  describe('upload()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('uploads file with metadata', async () => {
      const buffer = Buffer.from('Hello World');
      const fileName = 'test.txt';
      const metadata: StorageFileMetadata = {
        contentType: 'text/plain',
        size: buffer.length,
        createdAt: '2026-07-29T12:00:00.000Z',
      };

      mockFile.getMetadata.mockResolvedValue([{
        timeCreated: '2026-07-29T12:00:00.000Z',
      }]);

      const result = await driver.upload(buffer, fileName, metadata);

      expect(mockBucket.file).toHaveBeenCalledWith(fileName);
      expect(mockFile.save).toHaveBeenCalledWith(
        buffer,
        expect.objectContaining({
          resumable: false,
          metadata: expect.objectContaining({
            contentType: 'text/plain',
            metadata: expect.objectContaining({
              size: '11',
              createdAt: '2026-07-29T12:00:00.000Z',
            }),
          }),
        })
      );

      expect(result.fileName).toBe(fileName);
      expect(result.publicUrl).toBe('https://storage.googleapis.com/test-bucket/test.txt');
      expect(result.size).toBe(buffer.length);
    });

    it('uploads binary files', async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const fileName = 'image.png';
      const metadata: StorageFileMetadata = {
        contentType: 'image/png',
        size: buffer.length,
        createdAt: new Date().toISOString(),
      };

      mockFile.getMetadata.mockResolvedValue([{
        timeCreated: new Date().toISOString(),
      }]);

      await driver.upload(buffer, fileName, metadata);

      expect(mockFile.save).toHaveBeenCalledWith(
        buffer,
        expect.objectContaining({
          metadata: expect.objectContaining({
            contentType: 'image/png',
          }),
        })
      );
    });

    it('stores custom metadata', async () => {
      const buffer = Buffer.from('test');
      const fileName = 'file.txt';
      const metadata: StorageFileMetadata = {
        contentType: 'text/plain',
        size: buffer.length,
        createdAt: new Date().toISOString(),
        customMetadata: {
          correlationId: 'abc-123',
          userId: 'u1',
        },
      };

      mockFile.getMetadata.mockResolvedValue([{
        timeCreated: new Date().toISOString(),
      }]);

      await driver.upload(buffer, fileName, metadata);

      expect(mockFile.save).toHaveBeenCalledWith(
        buffer,
        expect.objectContaining({
          metadata: expect.objectContaining({
            metadata: expect.objectContaining({
              correlationId: 'abc-123',
              userId: 'u1',
            }),
          }),
        })
      );
    });

    it('retries on transient errors (5xx)', async () => {
      const buffer = Buffer.from('test');
      const error500 = Object.assign(new Error('Internal Server Error'), { code: 500 });

      // Fail twice, succeed on third attempt
      mockFile.save
        .mockRejectedValueOnce(error500)
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce(undefined);

      mockFile.getMetadata.mockResolvedValue([{
        timeCreated: new Date().toISOString(),
      }]);

      const result = await driver.upload(buffer, 'test.txt', {
        contentType: 'text/plain',
        size: buffer.length,
        createdAt: new Date().toISOString(),
      });

      expect(mockFile.save).toHaveBeenCalledTimes(3);
      expect(result.fileName).toBe('test.txt');
    });

    it('throws after max retries on transient errors', async () => {
      const buffer = Buffer.from('test');
      const error503 = Object.assign(new Error('Service Unavailable'), { code: 503 });

      mockFile.save.mockRejectedValue(error503);

      await expect(
        driver.upload(buffer, 'test.txt', {
          contentType: 'text/plain',
          size: buffer.length,
          createdAt: new Date().toISOString(),
        })
      ).rejects.toThrow('after 3 attempts');

      expect(mockFile.save).toHaveBeenCalledTimes(3);
    });

    it('throws immediately on non-transient errors', async () => {
      const buffer = Buffer.from('test');
      const error403 = Object.assign(new Error('Forbidden'), { code: 403 });

      mockFile.save.mockRejectedValue(error403);

      await expect(
        driver.upload(buffer, 'test.txt', {
          contentType: 'text/plain',
          size: buffer.length,
          createdAt: new Date().toISOString(),
        })
      ).rejects.toThrow('after 3 attempts');

      // Should not retry on 403
      expect(mockFile.save).toHaveBeenCalledTimes(1);
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new GcsStorageDriver({
        bucketName: 'test-bucket',
      });

      await expect(
        uninitializedDriver.upload(Buffer.from('test'), 'file.txt', {
          contentType: 'text/plain',
          size: 4,
          createdAt: new Date().toISOString(),
        })
      ).rejects.toThrow('not initialized');
    });
  });

  describe('download()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('downloads existing file', async () => {
      const expectedContent = Buffer.from('test content');
      mockFile.download.mockResolvedValue([expectedContent]);

      const buffer = await driver.download('test.txt');

      expect(mockBucket.file).toHaveBeenCalledWith('test.txt');
      expect(mockFile.download).toHaveBeenCalled();
      expect(buffer).toEqual(expectedContent);
    });

    it('throws if file does not exist', async () => {
      const error404 = Object.assign(new Error('Not Found'), { code: 404 });
      mockFile.download.mockRejectedValue(error404);

      await expect(driver.download('nonexistent.txt')).rejects.toThrow('File not found');
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new GcsStorageDriver({
        bucketName: 'test-bucket',
      });

      await expect(uninitializedDriver.download('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('delete()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('deletes file', async () => {
      await driver.delete('test.txt');

      expect(mockBucket.file).toHaveBeenCalledWith('test.txt');
      expect(mockFile.delete).toHaveBeenCalled();
    });

    it('is idempotent - deleting non-existent file does not throw', async () => {
      const error404 = Object.assign(new Error('Not Found'), { code: 404 });
      mockFile.delete.mockRejectedValue(error404);

      await driver.delete('nonexistent.txt');

      // Should not throw
      expect(true).toBe(true);
    });

    it('throws on non-404 errors', async () => {
      const error500 = Object.assign(new Error('Internal Server Error'), { code: 500 });
      mockFile.delete.mockRejectedValue(error500);

      await expect(driver.delete('test.txt')).rejects.toThrow('Internal Server Error');
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new GcsStorageDriver({
        bucketName: 'test-bucket',
      });

      await expect(uninitializedDriver.delete('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('exists()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('returns true for existing file', async () => {
      mockFile.exists.mockResolvedValue([true]);

      const result = await driver.exists('test.txt');

      expect(mockBucket.file).toHaveBeenCalledWith('test.txt');
      expect(result).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      mockFile.exists.mockResolvedValue([false]);

      const result = await driver.exists('nonexistent.txt');

      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockFile.exists.mockRejectedValue(new Error('Network error'));

      const result = await driver.exists('test.txt');

      expect(result).toBe(false);
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new GcsStorageDriver({
        bucketName: 'test-bucket',
      });

      await expect(uninitializedDriver.exists('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('getMetadata()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('returns metadata for existing file', async () => {
      mockFile.getMetadata.mockResolvedValue([{
        contentType: 'image/png',
        size: 2048,
        timeCreated: '2026-07-29T14:00:00.000Z',
        metadata: {
          size: '2048',
          createdAt: '2026-07-29T14:00:00.000Z',
          correlationId: 'xyz-789',
        },
      }]);

      const metadata = await driver.getMetadata('image.png');

      expect(metadata.contentType).toBe('image/png');
      expect(metadata.size).toBe(2048);
      expect(metadata.createdAt).toBe('2026-07-29T14:00:00.000Z');
      expect(metadata.customMetadata?.correlationId).toBe('xyz-789');
    });

    it('uses default contentType if not set', async () => {
      mockFile.getMetadata.mockResolvedValue([{
        size: 100,
        timeCreated: '2026-07-29T14:00:00.000Z',
        metadata: {},
      }]);

      const metadata = await driver.getMetadata('file.bin');

      expect(metadata.contentType).toBe('application/octet-stream');
    });

    it('throws if file does not exist', async () => {
      const error404 = Object.assign(new Error('Not Found'), { code: 404 });
      mockFile.getMetadata.mockRejectedValue(error404);

      await expect(driver.getMetadata('nonexistent.txt')).rejects.toThrow('File not found');
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new GcsStorageDriver({
        bucketName: 'test-bucket',
      });

      await expect(uninitializedDriver.getMetadata('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('list()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('lists all files in bucket', async () => {
      const mockFiles = [
        { name: 'file1.txt' },
        { name: 'file2.txt' },
        { name: 'file3.txt' },
      ];

      mockBucket.getFiles.mockResolvedValue([mockFiles]);

      const files = await driver.list();

      expect(mockBucket.getFiles).toHaveBeenCalledWith({});
      expect(files).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
    });

    it('filters by prefix', async () => {
      const mockFiles = [
        { name: 'user-1/avatar.jpg' },
      ];

      mockBucket.getFiles.mockResolvedValue([mockFiles]);

      const files = await driver.list('user-1/');

      expect(mockBucket.getFiles).toHaveBeenCalledWith({ prefix: 'user-1/' });
      expect(files).toEqual(['user-1/avatar.jpg']);
    });

    it('returns empty array if bucket is empty', async () => {
      mockBucket.getFiles.mockResolvedValue([[]]);

      const files = await driver.list();

      expect(files).toEqual([]);
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new GcsStorageDriver({
        bucketName: 'test-bucket',
      });

      await expect(uninitializedDriver.list()).rejects.toThrow('not initialized');
    });
  });

  describe('shutdown()', () => {
    it('can be called without initialization', async () => {
      await driver.shutdown();
      expect(true).toBe(true);
    });

    it('is idempotent', async () => {
      await driver.initialize();
      await driver.shutdown();
      await driver.shutdown();
      await driver.shutdown();
      expect(true).toBe(true);
    });

    it('marks driver as uninitialized', async () => {
      await driver.initialize();
      await driver.shutdown();

      // Operations should throw after shutdown
      await expect(driver.upload(Buffer.from('test'), 'file.txt', {
        contentType: 'text/plain',
        size: 4,
        createdAt: new Date().toISOString(),
      })).rejects.toThrow('not initialized');
    });
  });
});

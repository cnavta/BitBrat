/**
 * Filesystem Storage Driver Tests - Sprint 373
 *
 * Comprehensive test suite for FilesystemStorageDriver.
 * Tests all operations, error cases, and edge cases.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { FilesystemStorageDriver } from './filesystem-driver';
import type { StorageFileMetadata } from '../types';

describe('FilesystemStorageDriver', () => {
  let driver: FilesystemStorageDriver;
  let testDir: string;

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = join('/tmp', `storage-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);

    driver = new FilesystemStorageDriver({
      basePath: testDir,
      publicUrlBase: 'http://localhost:3100/storage',
    });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('initialize()', () => {
    it('creates base directory if it does not exist', async () => {
      await driver.initialize();

      const stat = await fs.stat(testDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('is idempotent - can be called multiple times', async () => {
      await driver.initialize();
      await driver.initialize();
      await driver.initialize();

      // Should not throw
      expect(true).toBe(true);
    });

    it('throws if base path is not absolute', async () => {
      const relativeDriver = new FilesystemStorageDriver({
        basePath: 'relative/path',
        publicUrlBase: 'http://localhost',
      });

      await expect(relativeDriver.initialize()).rejects.toThrow('must be absolute');
    });

    it('verifies write permissions', async () => {
      await driver.initialize();

      // Should be able to write to directory
      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('test');
    });
  });

  describe('upload()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('uploads file and creates metadata sidecar', async () => {
      const buffer = Buffer.from('Hello World');
      const fileName = 'test.txt';
      const metadata: StorageFileMetadata = {
        contentType: 'text/plain',
        size: buffer.length,
        createdAt: new Date().toISOString(),
      };

      const result = await driver.upload(buffer, fileName, metadata);

      // Verify result
      expect(result.fileName).toBe(fileName);
      expect(result.publicUrl).toBe('http://localhost:3100/storage/test.txt');
      expect(result.size).toBe(buffer.length);
      expect(result.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Verify file content
      const content = await fs.readFile(join(testDir, fileName), 'utf-8');
      expect(content).toBe('Hello World');

      // Verify metadata sidecar
      const metaContent = await fs.readFile(join(testDir, `${fileName}.meta.json`), 'utf-8');
      const savedMeta = JSON.parse(metaContent);
      expect(savedMeta.contentType).toBe('text/plain');
      expect(savedMeta.size).toBe(buffer.length);
    });

    it('uploads binary files', async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
      const fileName = 'image.png';
      const metadata: StorageFileMetadata = {
        contentType: 'image/png',
        size: buffer.length,
        createdAt: new Date().toISOString(),
      };

      await driver.upload(buffer, fileName, metadata);

      const content = await fs.readFile(join(testDir, fileName));
      expect(content).toEqual(buffer);
    });

    it('creates subdirectories for paths with slashes', async () => {
      const buffer = Buffer.from('test');
      const fileName = 'user-123/avatars/profile.jpg';
      const metadata: StorageFileMetadata = {
        contentType: 'image/jpeg',
        size: buffer.length,
        createdAt: new Date().toISOString(),
      };

      await driver.upload(buffer, fileName, metadata);

      // Verify subdirectories were created
      const stat = await fs.stat(join(testDir, 'user-123'));
      expect(stat.isDirectory()).toBe(true);

      const stat2 = await fs.stat(join(testDir, 'user-123', 'avatars'));
      expect(stat2.isDirectory()).toBe(true);

      // Verify file exists
      const content = await fs.readFile(join(testDir, fileName));
      expect(content.toString()).toBe('test');
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
          environment: 'test',
        },
      };

      await driver.upload(buffer, fileName, metadata);

      const metaContent = await fs.readFile(join(testDir, `${fileName}.meta.json`), 'utf-8');
      const savedMeta = JSON.parse(metaContent);
      expect(savedMeta.customMetadata.correlationId).toBe('abc-123');
      expect(savedMeta.customMetadata.userId).toBe('u1');
      expect(savedMeta.customMetadata.environment).toBe('test');
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new FilesystemStorageDriver({
        basePath: testDir,
        publicUrlBase: 'http://localhost',
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
      const content = 'Hello World';
      const fileName = 'test.txt';

      // Upload first
      await driver.upload(Buffer.from(content), fileName, {
        contentType: 'text/plain',
        size: content.length,
        createdAt: new Date().toISOString(),
      });

      // Download
      const buffer = await driver.download(fileName);
      expect(buffer.toString()).toBe(content);
    });

    it('downloads binary files', async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const fileName = 'binary.png';

      await driver.upload(buffer, fileName, {
        contentType: 'image/png',
        size: buffer.length,
        createdAt: new Date().toISOString(),
      });

      const downloaded = await driver.download(fileName);
      expect(downloaded).toEqual(buffer);
    });

    it('throws if file does not exist', async () => {
      await expect(driver.download('nonexistent.txt')).rejects.toThrow('File not found');
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new FilesystemStorageDriver({
        basePath: testDir,
        publicUrlBase: 'http://localhost',
      });

      await expect(uninitializedDriver.download('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('delete()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('deletes file and metadata sidecar', async () => {
      const fileName = 'test.txt';

      // Upload first
      await driver.upload(Buffer.from('test'), fileName, {
        contentType: 'text/plain',
        size: 4,
        createdAt: new Date().toISOString(),
      });

      // Verify file exists
      expect(await driver.exists(fileName)).toBe(true);

      // Delete
      await driver.delete(fileName);

      // Verify file and metadata are gone
      expect(await driver.exists(fileName)).toBe(false);

      await expect(fs.access(join(testDir, `${fileName}.meta.json`))).rejects.toThrow();
    });

    it('is idempotent - deleting non-existent file does not throw', async () => {
      await driver.delete('nonexistent.txt');
      await driver.delete('nonexistent.txt');

      // Should not throw
      expect(true).toBe(true);
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new FilesystemStorageDriver({
        basePath: testDir,
        publicUrlBase: 'http://localhost',
      });

      await expect(uninitializedDriver.delete('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('exists()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('returns true for existing file', async () => {
      const fileName = 'test.txt';

      await driver.upload(Buffer.from('test'), fileName, {
        contentType: 'text/plain',
        size: 4,
        createdAt: new Date().toISOString(),
      });

      expect(await driver.exists(fileName)).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      expect(await driver.exists('nonexistent.txt')).toBe(false);
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new FilesystemStorageDriver({
        basePath: testDir,
        publicUrlBase: 'http://localhost',
      });

      await expect(uninitializedDriver.exists('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('getMetadata()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('returns metadata for existing file', async () => {
      const fileName = 'test.txt';
      const originalMeta: StorageFileMetadata = {
        contentType: 'text/plain',
        size: 4,
        createdAt: '2026-07-29T12:00:00.000Z',
        customMetadata: {
          correlationId: 'abc-123',
        },
      };

      await driver.upload(Buffer.from('test'), fileName, originalMeta);

      const metadata = await driver.getMetadata(fileName);
      expect(metadata.contentType).toBe('text/plain');
      expect(metadata.size).toBe(4);
      expect(metadata.createdAt).toBe('2026-07-29T12:00:00.000Z');
      expect(metadata.customMetadata?.correlationId).toBe('abc-123');
    });

    it('throws if file does not exist', async () => {
      await expect(driver.getMetadata('nonexistent.txt')).rejects.toThrow('File not found');
    });

    it('throws if metadata file is missing', async () => {
      const fileName = 'orphan.txt';

      // Create file without metadata
      await fs.writeFile(join(testDir, fileName), 'test');

      await expect(driver.getMetadata(fileName)).rejects.toThrow('Metadata not found');
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new FilesystemStorageDriver({
        basePath: testDir,
        publicUrlBase: 'http://localhost',
      });

      await expect(uninitializedDriver.getMetadata('file.txt')).rejects.toThrow('not initialized');
    });
  });

  describe('list()', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('lists all files in storage', async () => {
      // Upload multiple files
      await driver.upload(Buffer.from('1'), 'file1.txt', {
        contentType: 'text/plain',
        size: 1,
        createdAt: new Date().toISOString(),
      });

      await driver.upload(Buffer.from('2'), 'file2.txt', {
        contentType: 'text/plain',
        size: 1,
        createdAt: new Date().toISOString(),
      });

      await driver.upload(Buffer.from('3'), 'file3.txt', {
        contentType: 'text/plain',
        size: 1,
        createdAt: new Date().toISOString(),
      });

      const files = await driver.list();
      expect(files).toHaveLength(3);
      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
      expect(files).toContain('file3.txt');
    });

    it('excludes .meta.json sidecar files from listing', async () => {
      await driver.upload(Buffer.from('test'), 'test.txt', {
        contentType: 'text/plain',
        size: 4,
        createdAt: new Date().toISOString(),
      });

      const files = await driver.list();
      expect(files).toHaveLength(1);
      expect(files).toContain('test.txt');
      expect(files).not.toContain('test.txt.meta.json');
    });

    it('lists files in subdirectories', async () => {
      await driver.upload(Buffer.from('1'), 'user-1/file.txt', {
        contentType: 'text/plain',
        size: 1,
        createdAt: new Date().toISOString(),
      });

      await driver.upload(Buffer.from('2'), 'user-2/file.txt', {
        contentType: 'text/plain',
        size: 1,
        createdAt: new Date().toISOString(),
      });

      const files = await driver.list();
      expect(files).toHaveLength(2);
      expect(files).toContain('user-1/file.txt');
      expect(files).toContain('user-2/file.txt');
    });

    it('filters by prefix', async () => {
      await driver.upload(Buffer.from('1'), 'user-1/avatar.jpg', {
        contentType: 'image/jpeg',
        size: 1,
        createdAt: new Date().toISOString(),
      });

      await driver.upload(Buffer.from('2'), 'user-2/avatar.jpg', {
        contentType: 'image/jpeg',
        size: 1,
        createdAt: new Date().toISOString(),
      });

      const files = await driver.list('user-1/');
      expect(files).toHaveLength(1);
      expect(files).toContain('user-1/avatar.jpg');
    });

    it('returns empty array if no files exist', async () => {
      const files = await driver.list();
      expect(files).toEqual([]);
    });

    it('returns empty array for non-existent prefix', async () => {
      const files = await driver.list('nonexistent/');
      expect(files).toEqual([]);
    });

    it('throws if driver not initialized', async () => {
      const uninitializedDriver = new FilesystemStorageDriver({
        basePath: testDir,
        publicUrlBase: 'http://localhost',
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

  describe('integration scenarios', () => {
    beforeEach(async () => {
      await driver.initialize();
    });

    it('handles complete upload/download/delete lifecycle', async () => {
      const fileName = 'lifecycle.txt';
      const content = 'Test Content';
      const buffer = Buffer.from(content);

      // Upload
      const uploadResult = await driver.upload(buffer, fileName, {
        contentType: 'text/plain',
        size: buffer.length,
        createdAt: new Date().toISOString(),
      });

      expect(uploadResult.fileName).toBe(fileName);

      // Verify exists
      expect(await driver.exists(fileName)).toBe(true);

      // Download
      const downloaded = await driver.download(fileName);
      expect(downloaded.toString()).toBe(content);

      // Get metadata
      const metadata = await driver.getMetadata(fileName);
      expect(metadata.contentType).toBe('text/plain');

      // List
      const files = await driver.list();
      expect(files).toContain(fileName);

      // Delete
      await driver.delete(fileName);

      // Verify deleted
      expect(await driver.exists(fileName)).toBe(false);
      const filesAfterDelete = await driver.list();
      expect(filesAfterDelete).not.toContain(fileName);
    });

    it('handles multiple concurrent uploads', async () => {
      const uploads = Array.from({ length: 10 }, (_, i) =>
        driver.upload(Buffer.from(`Content ${i}`), `file${i}.txt`, {
          contentType: 'text/plain',
          size: `Content ${i}`.length,
          createdAt: new Date().toISOString(),
        })
      );

      const results = await Promise.all(uploads);
      expect(results).toHaveLength(10);

      const files = await driver.list();
      expect(files).toHaveLength(10);
    });
  });
});

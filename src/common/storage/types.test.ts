/**
 * Types Test - Sprint 373
 *
 * Tests for storage abstraction type definitions.
 * These tests verify TypeScript type correctness and interface contracts.
 */

import type {
  IStorageDriver,
  StorageFileMetadata,
  StorageUploadResult,
  FilesystemStorageConfig,
  GcsStorageConfig,
} from './types';

describe('Storage Types', () => {
  describe('StorageFileMetadata', () => {
    it('accepts valid metadata object', () => {
      const metadata: StorageFileMetadata = {
        contentType: 'image/png',
        size: 1024,
        createdAt: new Date().toISOString(),
      };

      expect(metadata.contentType).toBe('image/png');
      expect(metadata.size).toBe(1024);
      expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('accepts metadata with custom fields', () => {
      const metadata: StorageFileMetadata = {
        contentType: 'application/json',
        size: 512,
        createdAt: new Date().toISOString(),
        customMetadata: {
          correlationId: 'abc-123',
          userId: 'u1',
          environment: 'production',
        },
      };

      expect(metadata.customMetadata?.correlationId).toBe('abc-123');
      expect(metadata.customMetadata?.userId).toBe('u1');
    });
  });

  describe('StorageUploadResult', () => {
    it('accepts valid upload result', () => {
      const result: StorageUploadResult = {
        fileName: '550e8400-e29b-41d4-a716-446655440000.png',
        publicUrl: 'http://api-gateway:3100/storage/550e8400-e29b-41d4-a716-446655440000.png',
        size: 2048,
        uploadedAt: new Date().toISOString(),
      };

      expect(result.fileName).toMatch(/\.png$/);
      expect(result.publicUrl).toContain('http');
      expect(result.size).toBe(2048);
    });
  });

  describe('FilesystemStorageConfig', () => {
    it('accepts valid filesystem config', () => {
      const config: FilesystemStorageConfig = {
        basePath: '/var/storage',
        publicUrlBase: 'http://api-gateway:3100/storage',
      };

      expect(config.basePath).toBe('/var/storage');
      expect(config.publicUrlBase).toContain('http');
    });
  });

  describe('GcsStorageConfig', () => {
    it('accepts minimal GCS config', () => {
      const config: GcsStorageConfig = {
        bucketName: 'bitbrat-media-gen',
      };

      expect(config.bucketName).toBe('bitbrat-media-gen');
      expect(config.keyFilename).toBeUndefined();
    });

    it('accepts full GCS config', () => {
      const config: GcsStorageConfig = {
        bucketName: 'bitbrat-media-gen',
        keyFilename: '/path/to/key.json',
        projectId: 'my-project',
      };

      expect(config.bucketName).toBe('bitbrat-media-gen');
      expect(config.keyFilename).toBe('/path/to/key.json');
      expect(config.projectId).toBe('my-project');
    });
  });

  describe('IStorageDriver interface', () => {
    it('defines correct method signatures', () => {
      // This test verifies the interface shape at compile time
      // If this compiles, the interface is correctly defined

      const mockDriver: IStorageDriver = {
        name: 'mock',
        initialize: async () => {},
        upload: async (buffer: Buffer, fileName: string, metadata: StorageFileMetadata) => ({
          fileName,
          publicUrl: `http://mock/${fileName}`,
          size: buffer.length,
          uploadedAt: new Date().toISOString(),
        }),
        download: async (fileName: string) => Buffer.from('mock'),
        delete: async (fileName: string) => {},
        exists: async (fileName: string) => true,
        getMetadata: async (fileName: string) => ({
          contentType: 'application/octet-stream',
          size: 0,
          createdAt: new Date().toISOString(),
        }),
        list: async (prefix?: string) => [],
        shutdown: async () => {},
      };

      expect(mockDriver.name).toBe('mock');
    });

    it('requires all methods to return Promises', async () => {
      const mockDriver: IStorageDriver = {
        name: 'promise-test',
        initialize: async () => {},
        upload: async (buffer: Buffer, fileName: string, metadata: StorageFileMetadata) => ({
          fileName,
          publicUrl: '',
          size: 0,
          uploadedAt: '',
        }),
        download: async (fileName: string) => Buffer.from(''),
        delete: async (fileName: string) => {},
        exists: async (fileName: string) => false,
        getMetadata: async (fileName: string) => ({
          contentType: '',
          size: 0,
          createdAt: '',
        }),
        list: async (prefix?: string) => [],
        shutdown: async () => {},
      };

      // All methods should return promises
      expect(mockDriver.initialize()).toBeInstanceOf(Promise);
      expect(mockDriver.upload(Buffer.from(''), '', { contentType: '', size: 0, createdAt: '' })).toBeInstanceOf(Promise);
      expect(mockDriver.download('')).toBeInstanceOf(Promise);
      expect(mockDriver.delete('')).toBeInstanceOf(Promise);
      expect(mockDriver.exists('')).toBeInstanceOf(Promise);
      expect(mockDriver.getMetadata('')).toBeInstanceOf(Promise);
      expect(mockDriver.list()).toBeInstanceOf(Promise);
      expect(mockDriver.shutdown()).toBeInstanceOf(Promise);
    });
  });
});

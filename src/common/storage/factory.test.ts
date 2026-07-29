/**
 * Storage Factory Tests - Sprint 373
 *
 * Tests for storage driver factory and auto-detection logic.
 */

import { createStorageDriver, getStorageConfigDescription } from './factory';
import { FilesystemStorageDriver } from './drivers/filesystem-driver';
import { GcsStorageDriver } from './drivers/gcs-driver';

// Mock the drivers to avoid actual initialization
jest.mock('./drivers/filesystem-driver');
jest.mock('./drivers/gcs-driver');

describe('Storage Factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock driver initialize methods
    (FilesystemStorageDriver as jest.MockedClass<typeof FilesystemStorageDriver>).mockImplementation(
      (config: any) => ({
        name: 'filesystem',
        initialize: jest.fn().mockResolvedValue(undefined),
        upload: jest.fn(),
        download: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        getMetadata: jest.fn(),
        list: jest.fn(),
        shutdown: jest.fn(),
      } as any)
    );

    (GcsStorageDriver as jest.MockedClass<typeof GcsStorageDriver>).mockImplementation(
      (config: any) => ({
        name: 'gcs',
        initialize: jest.fn().mockResolvedValue(undefined),
        upload: jest.fn(),
        download: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        getMetadata: jest.fn(),
        list: jest.fn(),
        shutdown: jest.fn(),
      } as any)
    );
  });

  describe('createStorageDriver()', () => {
    describe('explicit driver selection', () => {
      it('creates filesystem driver when STORAGE_DRIVER=filesystem', async () => {
        const env = {
          STORAGE_DRIVER: 'filesystem',
          STORAGE_FILESYSTEM_PATH: '/var/storage',
          STORAGE_FILESYSTEM_PUBLIC_URL_BASE: 'http://localhost:3100/storage',
        };

        const driver = await createStorageDriver(env);

        expect(FilesystemStorageDriver).toHaveBeenCalledWith({
          basePath: '/var/storage',
          publicUrlBase: 'http://localhost:3100/storage',
        });
        expect(driver.name).toBe('filesystem');
        expect(driver.initialize).toHaveBeenCalled();
      });

      it('creates GCS driver when STORAGE_DRIVER=gcs', async () => {
        const env = {
          STORAGE_DRIVER: 'gcs',
          STORAGE_GCS_BUCKET_NAME: 'test-bucket',
        };

        const driver = await createStorageDriver(env);

        expect(GcsStorageDriver).toHaveBeenCalledWith({
          bucketName: 'test-bucket',
        });
        expect(driver.name).toBe('gcs');
        expect(driver.initialize).toHaveBeenCalled();
      });

      it('is case-insensitive for STORAGE_DRIVER', async () => {
        const env = {
          STORAGE_DRIVER: 'FILESYSTEM',
          STORAGE_FILESYSTEM_PATH: '/var/storage',
          STORAGE_FILESYSTEM_PUBLIC_URL_BASE: 'http://localhost:3100/storage',
        };

        const driver = await createStorageDriver(env);

        expect(driver.name).toBe('filesystem');
      });

      it('throws for invalid STORAGE_DRIVER value', async () => {
        const env = {
          STORAGE_DRIVER: 'invalid',
        };

        await expect(createStorageDriver(env)).rejects.toThrow('Invalid STORAGE_DRIVER');
      });

      it('throws for unimplemented S3 driver', async () => {
        const env = {
          STORAGE_DRIVER: 's3',
        };

        await expect(createStorageDriver(env)).rejects.toThrow('S3 storage driver not yet implemented');
      });

      it('throws for unimplemented Azure Blob driver', async () => {
        const env = {
          STORAGE_DRIVER: 'azure-blob',
        };

        await expect(createStorageDriver(env)).rejects.toThrow('Azure Blob storage driver not yet implemented');
      });
    });

    describe('legacy GCS auto-detection', () => {
      it('auto-selects GCS driver when GCS_BUCKET_NAME is set', async () => {
        const env = {
          GCS_BUCKET_NAME: 'legacy-bucket',
        };

        const driver = await createStorageDriver(env);

        expect(GcsStorageDriver).toHaveBeenCalledWith({
          bucketName: 'legacy-bucket',
        });
        expect(driver.name).toBe('gcs');
      });

      it('uses new STORAGE_GCS_BUCKET_NAME over legacy GCS_BUCKET_NAME', async () => {
        const env = {
          STORAGE_DRIVER: 'gcs',
          STORAGE_GCS_BUCKET_NAME: 'new-bucket',
          GCS_BUCKET_NAME: 'old-bucket',
        };

        await createStorageDriver(env);

        expect(GcsStorageDriver).toHaveBeenCalledWith(
          expect.objectContaining({
            bucketName: 'new-bucket',
          })
        );
      });

      it('falls back to GCS_BUCKET_NAME if STORAGE_GCS_BUCKET_NAME not set', async () => {
        const env = {
          GCS_BUCKET_NAME: 'fallback-bucket',
        };

        await createStorageDriver(env);

        expect(GcsStorageDriver).toHaveBeenCalledWith(
          expect.objectContaining({
            bucketName: 'fallback-bucket',
          })
        );
      });
    });

    describe('default filesystem driver', () => {
      it('defaults to filesystem when no env vars set', async () => {
        const env = {
          STORAGE_FILESYSTEM_PATH: '/tmp/default-storage',
          STORAGE_FILESYSTEM_PUBLIC_URL_BASE: 'http://localhost:3100/storage',
        };

        const driver = await createStorageDriver(env);

        expect(driver.name).toBe('filesystem');
      });
    });

    describe('filesystem configuration validation', () => {
      it('throws if STORAGE_FILESYSTEM_PATH is missing', async () => {
        const env = {
          STORAGE_DRIVER: 'filesystem',
          STORAGE_FILESYSTEM_PUBLIC_URL_BASE: 'http://localhost:3100/storage',
        };

        await expect(createStorageDriver(env)).rejects.toThrow('STORAGE_FILESYSTEM_PATH is required');
      });

      it('throws if STORAGE_FILESYSTEM_PUBLIC_URL_BASE is missing', async () => {
        const env = {
          STORAGE_DRIVER: 'filesystem',
          STORAGE_FILESYSTEM_PATH: '/var/storage',
        };

        await expect(createStorageDriver(env)).rejects.toThrow('STORAGE_FILESYSTEM_PUBLIC_URL_BASE is required');
      });
    });

    describe('GCS configuration', () => {
      it('includes keyFilename when STORAGE_GCS_KEY_FILENAME is set', async () => {
        const env = {
          STORAGE_DRIVER: 'gcs',
          STORAGE_GCS_BUCKET_NAME: 'test-bucket',
          STORAGE_GCS_KEY_FILENAME: '/path/to/key.json',
        };

        await createStorageDriver(env);

        expect(GcsStorageDriver).toHaveBeenCalledWith({
          bucketName: 'test-bucket',
          keyFilename: '/path/to/key.json',
        });
      });

      it('falls back to GOOGLE_APPLICATION_CREDENTIALS for keyFilename', async () => {
        const env = {
          STORAGE_DRIVER: 'gcs',
          STORAGE_GCS_BUCKET_NAME: 'test-bucket',
          GOOGLE_APPLICATION_CREDENTIALS: '/path/to/legacy-key.json',
        };

        await createStorageDriver(env);

        expect(GcsStorageDriver).toHaveBeenCalledWith({
          bucketName: 'test-bucket',
          keyFilename: '/path/to/legacy-key.json',
        });
      });

      it('includes projectId when STORAGE_GCS_PROJECT_ID is set', async () => {
        const env = {
          STORAGE_DRIVER: 'gcs',
          STORAGE_GCS_BUCKET_NAME: 'test-bucket',
          STORAGE_GCS_PROJECT_ID: 'my-project',
        };

        await createStorageDriver(env);

        expect(GcsStorageDriver).toHaveBeenCalledWith({
          bucketName: 'test-bucket',
          projectId: 'my-project',
        });
      });

      it('throws if bucket name is missing', async () => {
        const env = {
          STORAGE_DRIVER: 'gcs',
        };

        await expect(createStorageDriver(env)).rejects.toThrow('STORAGE_GCS_BUCKET_NAME');
      });
    });
  });

  describe('getStorageConfigDescription()', () => {
    it('describes filesystem configuration', () => {
      const env = {
        STORAGE_DRIVER: 'filesystem',
        STORAGE_FILESYSTEM_PATH: '/var/storage',
        STORAGE_FILESYSTEM_PUBLIC_URL_BASE: 'http://localhost:3100/storage',
      };

      const desc = getStorageConfigDescription(env);

      expect(desc).toContain('Filesystem storage');
      expect(desc).toContain('/var/storage');
      expect(desc).toContain('http://localhost:3100/storage');
    });

    it('describes GCS configuration with key file', () => {
      const env = {
        STORAGE_DRIVER: 'gcs',
        STORAGE_GCS_BUCKET_NAME: 'my-bucket',
        STORAGE_GCS_KEY_FILENAME: '/key.json',
      };

      const desc = getStorageConfigDescription(env);

      expect(desc).toContain('GCS storage');
      expect(desc).toContain('my-bucket');
      expect(desc).toContain('using key file');
    });

    it('describes GCS configuration with ADC', () => {
      const env = {
        STORAGE_DRIVER: 'gcs',
        STORAGE_GCS_BUCKET_NAME: 'my-bucket',
      };

      const desc = getStorageConfigDescription(env);

      expect(desc).toContain('GCS storage');
      expect(desc).toContain('my-bucket');
      expect(desc).toContain('using ADC');
    });

    it('describes legacy GCS configuration', () => {
      const env = {
        GCS_BUCKET_NAME: 'legacy-bucket',
      };

      const desc = getStorageConfigDescription(env);

      expect(desc).toContain('GCS storage');
      expect(desc).toContain('legacy-bucket');
    });

    it('describes unimplemented drivers', () => {
      const s3Desc = getStorageConfigDescription({ STORAGE_DRIVER: 's3' });
      expect(s3Desc).toContain('S3 storage (not yet implemented)');

      const azureDesc = getStorageConfigDescription({ STORAGE_DRIVER: 'azure-blob' });
      expect(azureDesc).toContain('Azure Blob storage (not yet implemented)');
    });
  });
});

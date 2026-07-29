/**
 * Storage Driver Factory - Sprint 373
 *
 * Creates storage drivers based on environment configuration.
 * Implements auto-detection for backward compatibility with existing deployments.
 *
 * Driver Selection Priority:
 * 1. STORAGE_DRIVER environment variable (explicit)
 * 2. GCS_BUCKET_NAME environment variable (legacy, implies GCS)
 * 3. Default: filesystem
 *
 * @module storage/factory
 */

import { FilesystemStorageDriver } from './drivers/filesystem-driver';
import { GcsStorageDriver } from './drivers/gcs-driver';
import type {
  IStorageDriver,
  FilesystemStorageConfig,
  GcsStorageConfig,
} from './types';
import type { Logger } from '../logging';

/**
 * Storage driver type identifier.
 */
export type StorageDriverType = 'filesystem' | 'gcs' | 's3' | 'azure-blob';

/**
 * Environment variable configuration for storage driver selection.
 */
export interface StorageEnvironment {
  // Driver selection
  STORAGE_DRIVER?: string;

  // Filesystem driver config
  STORAGE_FILESYSTEM_PATH?: string;
  STORAGE_FILESYSTEM_PUBLIC_URL_BASE?: string;

  // GCS driver config
  STORAGE_GCS_BUCKET_NAME?: string;
  GCS_BUCKET_NAME?: string; // Legacy (backward compatibility)
  STORAGE_GCS_KEY_FILENAME?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string; // Legacy
  STORAGE_GCS_PROJECT_ID?: string;

  // Future: S3, Azure Blob, etc.
}

/**
 * Create a storage driver based on environment configuration.
 *
 * Auto-detection logic:
 * - If STORAGE_DRIVER is set, use it explicitly
 * - If GCS_BUCKET_NAME is set (legacy), auto-select GCS driver
 * - Otherwise, use filesystem driver (default)
 *
 * @param env - Environment variables (defaults to process.env)
 * @param logger - Optional logger for diagnostics
 * @returns Initialized storage driver
 *
 * @throws {Error} If driver type is invalid
 * @throws {Error} If required configuration is missing
 *
 * @example
 * ```typescript
 * // Explicit filesystem driver
 * const driver = await createStorageDriver({
 *   STORAGE_DRIVER: 'filesystem',
 *   STORAGE_FILESYSTEM_PATH: '/var/storage',
 *   STORAGE_FILESYSTEM_PUBLIC_URL_BASE: 'http://localhost:3100/storage',
 * });
 *
 * // Legacy GCS auto-detection
 * const driver = await createStorageDriver({
 *   GCS_BUCKET_NAME: 'my-bucket', // Auto-selects GCS driver
 * });
 *
 * // Default (filesystem)
 * const driver = await createStorageDriver({});
 * ```
 */
export async function createStorageDriver(
  env: StorageEnvironment | NodeJS.ProcessEnv = process.env,
  logger?: Logger
): Promise<IStorageDriver> {
  // Step 1: Determine driver type
  const driverType = detectDriverType(env, logger);

  logger?.info('storage.factory.create', {
    driverType,
    explicit: !!env.STORAGE_DRIVER,
    legacy: !!env.GCS_BUCKET_NAME && !env.STORAGE_DRIVER,
  });

  // Step 2: Create driver based on type
  let driver: IStorageDriver;

  switch (driverType) {
    case 'filesystem':
      driver = createFilesystemDriver(env, logger);
      break;

    case 'gcs':
      driver = createGcsDriver(env, logger);
      break;

    case 's3':
      throw new Error('S3 storage driver not yet implemented (Sprint 374)');

    case 'azure-blob':
      throw new Error('Azure Blob storage driver not yet implemented (Sprint 375)');

    default:
      throw new Error(`Unknown storage driver type: ${driverType}`);
  }

  // Step 3: Initialize driver
  await driver.initialize();

  logger?.info('storage.factory.initialized', {
    driver: driver.name,
  });

  return driver;
}

/**
 * Detect which storage driver to use based on environment variables.
 *
 * Priority order:
 * 1. STORAGE_DRIVER (explicit)
 * 2. GCS_BUCKET_NAME (legacy, implies GCS)
 * 3. Default: filesystem
 *
 * @private
 * @param env - Environment variables
 * @param logger - Optional logger
 * @returns Storage driver type
 */
function detectDriverType(env: StorageEnvironment | NodeJS.ProcessEnv, logger?: Logger): StorageDriverType {
  // Priority 1: Explicit STORAGE_DRIVER
  if (env.STORAGE_DRIVER) {
    const normalized = env.STORAGE_DRIVER.toLowerCase().trim();

    if (!['filesystem', 'gcs', 's3', 'azure-blob'].includes(normalized)) {
      throw new Error(
        `Invalid STORAGE_DRIVER: ${env.STORAGE_DRIVER}. Must be one of: filesystem, gcs, s3, azure-blob`
      );
    }

    return normalized as StorageDriverType;
  }

  // Priority 2: Legacy GCS_BUCKET_NAME (backward compatibility)
  if (env.GCS_BUCKET_NAME) {
    logger?.info('storage.factory.legacy_detection', {
      reason: 'GCS_BUCKET_NAME detected, auto-selecting GCS driver',
      recommendation: 'Set STORAGE_DRIVER=gcs explicitly for clarity',
    });
    return 'gcs';
  }

  // Priority 3: Default to filesystem
  logger?.debug('storage.factory.default', {
    driver: 'filesystem',
    reason: 'No STORAGE_DRIVER or GCS_BUCKET_NAME found',
  });
  return 'filesystem';
}

/**
 * Create filesystem storage driver from environment config.
 *
 * @private
 * @param env - Environment variables
 * @param logger - Optional logger
 * @returns Filesystem storage driver
 *
 * @throws {Error} If required config is missing
 */
function createFilesystemDriver(env: StorageEnvironment | NodeJS.ProcessEnv, logger?: Logger): FilesystemStorageDriver {
  const basePath = env.STORAGE_FILESYSTEM_PATH;
  const publicUrlBase = env.STORAGE_FILESYSTEM_PUBLIC_URL_BASE;

  if (!basePath) {
    throw new Error(
      'STORAGE_FILESYSTEM_PATH is required when using filesystem storage driver. ' +
      'Example: /var/storage or /opt/BitBratPlatform/storage'
    );
  }

  if (!publicUrlBase) {
    throw new Error(
      'STORAGE_FILESYSTEM_PUBLIC_URL_BASE is required when using filesystem storage driver. ' +
      'Example: http://api-gateway:3100/storage or https://cdn.example.com/files'
    );
  }

  logger?.debug('storage.factory.filesystem.config', {
    basePath,
    publicUrlBase,
  });

  const config: FilesystemStorageConfig = {
    basePath,
    publicUrlBase,
  };

  return new FilesystemStorageDriver(config);
}

/**
 * Create GCS storage driver from environment config.
 *
 * Supports both new (STORAGE_GCS_*) and legacy (GCS_BUCKET_NAME) variables.
 *
 * @private
 * @param env - Environment variables
 * @param logger - Optional logger
 * @returns GCS storage driver
 *
 * @throws {Error} If required config is missing
 */
function createGcsDriver(env: StorageEnvironment | NodeJS.ProcessEnv, logger?: Logger): GcsStorageDriver {
  // Support both new and legacy bucket name variables
  const bucketName = env.STORAGE_GCS_BUCKET_NAME || env.GCS_BUCKET_NAME;

  if (!bucketName) {
    throw new Error(
      'STORAGE_GCS_BUCKET_NAME (or legacy GCS_BUCKET_NAME) is required when using GCS storage driver. ' +
      'Example: bitbrat-media-gen'
    );
  }

  // Support both new and legacy key filename variables
  const keyFilename = env.STORAGE_GCS_KEY_FILENAME || env.GOOGLE_APPLICATION_CREDENTIALS;

  const projectId = env.STORAGE_GCS_PROJECT_ID;

  logger?.debug('storage.factory.gcs.config', {
    bucketName,
    hasKeyFilename: !!keyFilename,
    hasProjectId: !!projectId,
    usingLegacyBucketVar: !!env.GCS_BUCKET_NAME && !env.STORAGE_GCS_BUCKET_NAME,
    usingLegacyKeyVar: !!env.GOOGLE_APPLICATION_CREDENTIALS && !env.STORAGE_GCS_KEY_FILENAME,
  });

  const config: GcsStorageConfig = {
    bucketName,
    ...(keyFilename && { keyFilename }),
    ...(projectId && { projectId }),
  };

  return new GcsStorageDriver(config);
}

/**
 * Get a human-readable description of the current storage configuration.
 *
 * Useful for diagnostics and logging.
 *
 * @param env - Environment variables (defaults to process.env)
 * @returns Configuration description
 *
 * @example
 * ```typescript
 * const desc = getStorageConfigDescription();
 * console.log(desc);
 * // "Filesystem storage: /var/storage → http://localhost:3100/storage"
 * // or
 * // "GCS storage: bucket=bitbrat-media-gen, using ADC"
 * ```
 */
export function getStorageConfigDescription(env: StorageEnvironment | NodeJS.ProcessEnv = process.env): string {
  const driverType = detectDriverType(env);

  switch (driverType) {
    case 'filesystem':
      return `Filesystem storage: ${env.STORAGE_FILESYSTEM_PATH} → ${env.STORAGE_FILESYSTEM_PUBLIC_URL_BASE}`;

    case 'gcs': {
      const bucket = env.STORAGE_GCS_BUCKET_NAME || env.GCS_BUCKET_NAME;
      const hasKey = !!(env.STORAGE_GCS_KEY_FILENAME || env.GOOGLE_APPLICATION_CREDENTIALS);
      const auth = hasKey ? 'using key file' : 'using ADC';
      return `GCS storage: bucket=${bucket}, ${auth}`;
    }

    case 's3':
      return 'S3 storage (not yet implemented)';

    case 'azure-blob':
      return 'Azure Blob storage (not yet implemented)';

    default:
      return `Unknown storage driver: ${driverType}`;
  }
}

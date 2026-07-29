/**
 * Storage Abstraction Layer - Type Definitions
 *
 * Sprint 373: Storage Abstraction Layer
 *
 * This module defines the core storage abstraction types that enable
 * platform-agnostic file storage across different backends (filesystem,
 * Google Cloud Storage, S3, Azure Blob, etc.).
 *
 * @module storage/types
 */

/**
 * Metadata associated with a stored file.
 *
 * Drivers must persist this metadata alongside the file content.
 * - Filesystem driver: Uses sidecar .meta.json files
 * - Cloud drivers: Use native metadata capabilities (GCS custom metadata, S3 tags, etc.)
 */
export interface StorageFileMetadata {
  /**
   * MIME content type (e.g., 'image/png', 'application/json')
   */
  contentType: string;

  /**
   * File size in bytes
   */
  size: number;

  /**
   * ISO 8601 timestamp when the file was created
   */
  createdAt: string;

  /**
   * Optional custom metadata key-value pairs
   *
   * Use for application-specific metadata like correlationId, userId, etc.
   */
  customMetadata?: Record<string, string>;
}

/**
 * Result returned after successful file upload.
 */
export interface StorageUploadResult {
  /**
   * Unique identifier for the uploaded file (typically UUID-based filename)
   */
  fileName: string;

  /**
   * Public URL where the file can be accessed
   *
   * Format varies by driver:
   * - Filesystem: http://api-gateway:3100/storage/{fileName}
   * - GCS: https://storage.googleapis.com/{bucket}/{fileName}
   * - S3: https://{bucket}.s3.{region}.amazonaws.com/{fileName}
   */
  publicUrl: string;

  /**
   * File size in bytes
   */
  size: number;

  /**
   * ISO 8601 timestamp when the upload completed
   */
  uploadedAt: string;
}

/**
 * Storage driver interface - common abstraction for all storage backends.
 *
 * All storage operations are asynchronous and return Promises.
 * Drivers must handle errors gracefully and provide meaningful error messages.
 *
 * Lifecycle:
 * 1. Construct driver with configuration
 * 2. Call initialize() to set up connections/verify access
 * 3. Perform storage operations (upload, download, delete, etc.)
 * 4. Call shutdown() during graceful shutdown
 *
 * @example
 * ```typescript
 * const driver = new FilesystemStorageDriver({ basePath: '/var/storage' });
 * await driver.initialize();
 *
 * const result = await driver.upload(
 *   buffer,
 *   'image.png',
 *   { contentType: 'image/png', size: buffer.length, createdAt: new Date().toISOString() }
 * );
 *
 * console.log(`Uploaded to: ${result.publicUrl}`);
 *
 * await driver.shutdown();
 * ```
 */
export interface IStorageDriver {
  /**
   * Human-readable name of the storage driver (e.g., 'filesystem', 'gcs', 's3')
   */
  readonly name: string;

  /**
   * Initialize the storage driver.
   *
   * This method is called once during service startup to:
   * - Verify credentials/configuration
   * - Test connectivity (for cloud drivers)
   * - Create base directories (for filesystem driver)
   * - Validate bucket/container access (for cloud drivers)
   *
   * Must be idempotent (safe to call multiple times).
   *
   * @throws {Error} If initialization fails (invalid config, no access, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Upload a file to storage.
   *
   * @param buffer - File content as Buffer
   * @param fileName - Destination filename (typically UUID-based, e.g., '550e8400-e29b-41d4-a716-446655440000.png')
   * @param metadata - File metadata to persist alongside content
   * @returns Upload result with publicUrl and metadata
   *
   * @throws {Error} If upload fails (no space, permission denied, network error, etc.)
   *
   * @example
   * ```typescript
   * const buffer = await sharp(input).png().toBuffer();
   * const result = await driver.upload(buffer, `${uuid()}.png`, {
   *   contentType: 'image/png',
   *   size: buffer.length,
   *   createdAt: new Date().toISOString(),
   *   customMetadata: { correlationId: 'abc-123', userId: 'u1' }
   * });
   * ```
   */
  upload(buffer: Buffer, fileName: string, metadata: StorageFileMetadata): Promise<StorageUploadResult>;

  /**
   * Download a file from storage.
   *
   * @param fileName - Filename to download
   * @returns File content as Buffer
   *
   * @throws {Error} If file does not exist or download fails
   *
   * @example
   * ```typescript
   * const buffer = await driver.download('image.png');
   * await fs.promises.writeFile('/tmp/image.png', buffer);
   * ```
   */
  download(fileName: string): Promise<Buffer>;

  /**
   * Delete a file from storage.
   *
   * Must be idempotent (deleting a non-existent file should not throw).
   *
   * @param fileName - Filename to delete
   *
   * @throws {Error} Only if the deletion operation itself fails (permission denied, network error)
   *                 NOT if the file doesn't exist (that's a successful no-op)
   *
   * @example
   * ```typescript
   * await driver.delete('old-image.png'); // Removes file and metadata
   * await driver.delete('old-image.png'); // Safe to call again (no-op)
   * ```
   */
  delete(fileName: string): Promise<void>;

  /**
   * Check if a file exists in storage.
   *
   * @param fileName - Filename to check
   * @returns true if file exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await driver.exists('image.png')) {
   *   console.log('File exists');
   * }
   * ```
   */
  exists(fileName: string): Promise<boolean>;

  /**
   * Get metadata for a stored file.
   *
   * @param fileName - Filename to get metadata for
   * @returns File metadata
   *
   * @throws {Error} If file does not exist
   *
   * @example
   * ```typescript
   * const metadata = await driver.getMetadata('image.png');
   * console.log(`Content-Type: ${metadata.contentType}`);
   * console.log(`Size: ${metadata.size} bytes`);
   * console.log(`User: ${metadata.customMetadata?.userId}`);
   * ```
   */
  getMetadata(fileName: string): Promise<StorageFileMetadata>;

  /**
   * List files in storage, optionally filtered by prefix.
   *
   * @param prefix - Optional filename prefix to filter by (e.g., 'user-123/')
   * @returns Array of filenames (not full paths, just names)
   *
   * @example
   * ```typescript
   * const allFiles = await driver.list();
   * // ['image1.png', 'image2.png', 'user-123/avatar.jpg']
   *
   * const userFiles = await driver.list('user-123/');
   * // ['user-123/avatar.jpg']
   * ```
   */
  list(prefix?: string): Promise<string[]>;

  /**
   * Gracefully shut down the storage driver.
   *
   * This method is called during service shutdown to:
   * - Close open connections
   * - Flush pending writes
   * - Release resources
   *
   * Must be idempotent (safe to call multiple times).
   */
  shutdown(): Promise<void>;
}

/**
 * Configuration for filesystem storage driver.
 */
export interface FilesystemStorageConfig {
  /**
   * Base path for file storage (absolute path)
   *
   * Example: '/var/storage' or '/opt/BitBratPlatform/storage'
   */
  basePath: string;

  /**
   * Base URL for public file access (used to construct publicUrl)
   *
   * Example: 'http://api-gateway:3100/storage' or 'https://cdn.example.com/files'
   */
  publicUrlBase: string;
}

/**
 * Configuration for Google Cloud Storage driver.
 */
export interface GcsStorageConfig {
  /**
   * GCS bucket name (without gs:// prefix)
   *
   * Example: 'bitbrat-media-gen'
   */
  bucketName: string;

  /**
   * Optional path to service account key file
   *
   * If not provided, uses Application Default Credentials (ADC)
   */
  keyFilename?: string;

  /**
   * Optional GCP project ID
   *
   * If not provided, inferred from credentials
   */
  projectId?: string;
}

/**
 * Union type for all storage driver configurations.
 */
export type StorageDriverConfig = FilesystemStorageConfig | GcsStorageConfig;

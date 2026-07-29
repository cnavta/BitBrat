/**
 * Google Cloud Storage Driver - Sprint 373
 *
 * Cloud storage driver using Google Cloud Storage.
 * Refactored from existing GCS code in storage-manager.ts and image-gen-mcp.
 *
 * Features:
 * - Uses buildResilientStorageOptions for undici fetch compatibility
 * - Automatic retry with exponential backoff for transient errors
 * - Metadata stored as GCS custom metadata (native support)
 * - Public URLs via storage.googleapis.com
 * - Support for Application Default Credentials (ADC) and explicit keys
 *
 * @module storage/drivers/gcs
 */

import { Storage, type StorageOptions, type Bucket, type File } from '@google-cloud/storage';
import { buildResilientStorageOptions } from '../../resources/storage-manager';
import type {
  IStorageDriver,
  StorageFileMetadata,
  StorageUploadResult,
  GcsStorageConfig,
} from '../types';

/**
 * Google Cloud Storage driver implementation.
 *
 * Stores files in a GCS bucket with metadata as custom metadata.
 *
 * Authentication:
 * - Explicit key file: Provide `keyFilename` in config
 * - Application Default Credentials: Omit `keyFilename` (uses ADC or metadata server)
 *
 * Metadata Storage:
 * GCS supports custom metadata natively, so no sidecar files are needed.
 * Custom metadata is stored in the file's metadata.metadata field.
 *
 * @example
 * ```typescript
 * const driver = new GcsStorageDriver({
 *   bucketName: 'bitbrat-media-gen',
 *   keyFilename: '/path/to/key.json', // Optional
 * });
 *
 * await driver.initialize();
 *
 * const buffer = Buffer.from('Hello World');
 * const result = await driver.upload(buffer, 'test.txt', {
 *   contentType: 'text/plain',
 *   size: buffer.length,
 *   createdAt: new Date().toISOString()
 * });
 *
 * console.log(`File uploaded: ${result.publicUrl}`);
 * // File uploaded: https://storage.googleapis.com/bitbrat-media-gen/test.txt
 * ```
 */
export class GcsStorageDriver implements IStorageDriver {
  readonly name = 'gcs';

  private storage: Storage | null = null;
  private bucket: Bucket | null = null;
  private bucketName: string;
  private config: GcsStorageConfig;
  private initialized = false;

  constructor(config: GcsStorageConfig) {
    this.config = config;
    this.bucketName = config.bucketName;
  }

  /**
   * Initialize the GCS driver.
   *
   * Creates the Storage client and verifies bucket access.
   * Uses buildResilientStorageOptions to ensure undici compatibility.
   *
   * @throws {Error} If bucket name is invalid
   * @throws {Error} If authentication fails
   * @throws {Error} If bucket does not exist or is not accessible
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return; // Idempotent
    }

    // Validate bucket name
    if (!this.bucketName || typeof this.bucketName !== 'string' || this.bucketName.trim() === '') {
      throw new Error('GCS bucket name is required and cannot be empty');
    }

    // Build storage options with resilient fetch
    const baseOptions: StorageOptions = {};

    if (this.config.keyFilename) {
      baseOptions.keyFilename = this.config.keyFilename;
    }

    if (this.config.projectId) {
      baseOptions.projectId = this.config.projectId;
    }

    try {
      // Create storage client with resilient options
      this.storage = new Storage(buildResilientStorageOptions(baseOptions));

      // Get bucket reference
      this.bucket = this.storage.bucket(this.bucketName);

      // Verify bucket exists and is accessible
      const [exists] = await this.bucket.exists();
      if (!exists) {
        throw new Error(`GCS bucket does not exist: ${this.bucketName}`);
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize GCS storage driver: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Upload a file to GCS.
   *
   * Uses simple (non-resumable) upload for reliability.
   * Metadata stored as GCS custom metadata.
   *
   * Implements retry logic for transient errors (500, 502, 503, 504).
   *
   * @param buffer - File content
   * @param fileName - Destination filename (e.g., 'image.png')
   * @param metadata - File metadata
   * @returns Upload result with publicUrl
   *
   * @throws {Error} If driver not initialized
   * @throws {Error} If upload fails after retries
   */
  async upload(buffer: Buffer, fileName: string, metadata: StorageFileMetadata): Promise<StorageUploadResult> {
    this.ensureInitialized();

    const file = this.bucket!.file(fileName);

    // Convert our metadata to GCS custom metadata format
    const gcsMetadata = {
      contentType: metadata.contentType,
      metadata: {
        size: metadata.size.toString(),
        createdAt: metadata.createdAt,
        ...metadata.customMetadata,
      },
    };

    // Retry configuration for transient errors
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Use simple (non-resumable) upload for reliability
        // resumable: false avoids abort-controller issues with undici
        await file.save(buffer, {
          resumable: false,
          metadata: gcsMetadata,
        });

        // Get file metadata to confirm upload
        const [gcsFile] = await file.getMetadata();

        return {
          fileName,
          publicUrl: `https://storage.googleapis.com/${this.bucketName}/${fileName}`,
          size: buffer.length,
          uploadedAt: gcsFile.timeCreated || new Date().toISOString(),
        };
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Retry on transient errors (5xx status codes)
        const isTransient = error.code >= 500 && error.code < 600;
        if (isTransient && attempt < maxRetries - 1) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const backoffMs = 100 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue; // Retry
        }

        // Non-transient error or max retries exceeded
        break;
      }
    }

    throw new Error(
      `Failed to upload file ${fileName} to GCS after ${maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Download a file from GCS.
   *
   * @param fileName - Filename to download
   * @returns File content as Buffer
   *
   * @throws {Error} If driver not initialized
   * @throws {Error} If file does not exist
   * @throws {Error} If download fails
   */
  async download(fileName: string): Promise<Buffer> {
    this.ensureInitialized();

    const file = this.bucket!.file(fileName);

    try {
      const [buffer] = await file.download();
      return buffer;
    } catch (error: any) {
      if (error.code === 404) {
        throw new Error(`File not found: ${fileName}`);
      }
      throw new Error(
        `Failed to download file ${fileName} from GCS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete a file from GCS.
   *
   * Idempotent - does not throw if file doesn't exist.
   *
   * @param fileName - Filename to delete
   *
   * @throws {Error} If driver not initialized
   * @throws {Error} Only if deletion fails for reasons other than file not existing
   */
  async delete(fileName: string): Promise<void> {
    this.ensureInitialized();

    const file = this.bucket!.file(fileName);

    try {
      await file.delete();
    } catch (error: any) {
      // Ignore 404 - file already deleted (idempotent)
      if (error.code === 404) {
        return;
      }
      throw new Error(
        `Failed to delete file ${fileName} from GCS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a file exists in GCS.
   *
   * @param fileName - Filename to check
   * @returns true if file exists, false otherwise
   *
   * @throws {Error} If driver not initialized
   */
  async exists(fileName: string): Promise<boolean> {
    this.ensureInitialized();

    const file = this.bucket!.file(fileName);

    try {
      const [exists] = await file.exists();
      return exists;
    } catch {
      return false;
    }
  }

  /**
   * Get metadata for a stored file.
   *
   * Reads GCS custom metadata.
   *
   * @param fileName - Filename to get metadata for
   * @returns File metadata
   *
   * @throws {Error} If driver not initialized
   * @throws {Error} If file does not exist
   */
  async getMetadata(fileName: string): Promise<StorageFileMetadata> {
    this.ensureInitialized();

    const file = this.bucket!.file(fileName);

    try {
      const [gcsFile] = await file.getMetadata();

      // Extract our metadata from GCS custom metadata
      const customMetadata = gcsFile.metadata || {};
      const { size, createdAt, ...otherMetadata } = customMetadata;

      // Parse size - it may be stored as string in custom metadata
      let parsedSize: number;
      if (typeof size === 'string') {
        parsedSize = parseInt(size, 10);
      } else if (typeof size === 'number') {
        parsedSize = size;
      } else {
        // Fall back to gcsFile.size
        parsedSize = typeof gcsFile.size === 'number' ? gcsFile.size : 0;
      }

      // Parse createdAt - ensure it's a string
      let parsedCreatedAt: string;
      if (typeof createdAt === 'string') {
        parsedCreatedAt = createdAt;
      } else if (typeof gcsFile.timeCreated === 'string') {
        parsedCreatedAt = gcsFile.timeCreated;
      } else {
        parsedCreatedAt = new Date().toISOString();
      }

      // Convert other metadata to string-only record
      const stringMetadata: Record<string, string> = {};
      for (const [key, value] of Object.entries(otherMetadata)) {
        if (value !== null && value !== undefined) {
          stringMetadata[key] = String(value);
        }
      }

      return {
        contentType: gcsFile.contentType || 'application/octet-stream',
        size: parsedSize,
        createdAt: parsedCreatedAt,
        customMetadata: Object.keys(stringMetadata).length > 0 ? stringMetadata : undefined,
      };
    } catch (error: any) {
      if (error.code === 404) {
        throw new Error(`File not found: ${fileName}`);
      }
      throw new Error(
        `Failed to get metadata for ${fileName} from GCS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List files in GCS bucket.
   *
   * @param prefix - Optional filename prefix to filter by
   * @returns Array of filenames
   *
   * @throws {Error} If driver not initialized
   */
  async list(prefix?: string): Promise<string[]> {
    this.ensureInitialized();

    try {
      const options = prefix ? { prefix } : {};
      const [files] = await this.bucket!.getFiles(options);

      return files.map(file => file.name);
    } catch (error) {
      throw new Error(
        `Failed to list files in GCS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Gracefully shutdown the GCS driver.
   *
   * No-op for GCS (client doesn't require explicit shutdown).
   * Included for interface compliance.
   */
  async shutdown(): Promise<void> {
    // GCS Storage client doesn't require explicit shutdown
    this.initialized = false;
    this.storage = null;
    this.bucket = null;
  }

  /**
   * Ensure driver is initialized before operations.
   *
   * @private
   * @throws {Error} If driver not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.bucket) {
      throw new Error('GCS storage driver not initialized. Call initialize() first.');
    }
  }
}

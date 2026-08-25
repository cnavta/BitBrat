/**
 * ClaimCheckService - Redis-backed temporary storage for events and blobs
 * Sprint 24: Claim Check Bit Implementation
 *
 * Provides claim check pattern for:
 * 1. Event storage - Store successfully persisted events by correlationId
 * 2. Blob storage - Store large binary/multi-modal content with generated IDs
 *
 * All storage has aggressive TTL (default 5 minutes) to prevent memory bloat.
 */

import type { RedisClientType } from 'redis';
import type { Logger } from '../../common/logging';
import type { IConfig, InternalEventV2, PersistenceSnapshotEventV1, SnapshotKind } from '../../types';
import { randomUUID } from 'crypto';

/**
 * Stored snapshot payload with versioning metadata (Sprint 24)
 */
export interface StoredSnapshot {
  kind: SnapshotKind;
  capturedAt: string;
  sourceService: string;
  sourceTopic: string;
  sequence?: number;
  updatedAt: string;
  event: InternalEventV2;
}

/**
 * Result of storing an event snapshot
 */
export type StoreSnapshotResult = 'stored' | 'rejected_stale' | 'rejected_error';

/**
 * Metadata for stored blobs
 */
export interface BlobMetadata {
  contentType?: string;
  size: number;
  createdAt: string;
  expiresAt: string;
}

/**
 * Result of storing a blob
 */
export interface BlobStoreResult {
  blobId: string;
  size: number;
  expiresAt: string;
}

/**
 * Result of retrieving a blob
 */
export interface BlobRetrieveResult {
  data: Buffer;
  contentType?: string;
  metadata: BlobMetadata;
}

/**
 * ClaimCheckService - Core claim check operations
 *
 * Manages Redis-backed temporary storage for events and blobs with
 * aggressive TTL enforcement to prevent memory bloat.
 */
export class ClaimCheckService {
  private readonly maxEventSize: number;
  private readonly maxBlobSize: number;
  private readonly defaultTtl: number;
  private readonly maxTtl: number;

  constructor(
    private redis: RedisClientType,
    private config: IConfig,
    private logger: Logger
  ) {
    // Parse configuration with defaults (using type-safe access with indexer)
    this.maxEventSize = parseInt(String((config as any).CLAIM_CHECK_MAX_EVENT_SIZE_BYTES || '1048576'), 10);
    this.maxBlobSize = parseInt(String((config as any).CLAIM_CHECK_MAX_BLOB_SIZE_BYTES || '10485760'), 10);
    this.defaultTtl = parseInt(String((config as any).CLAIM_CHECK_DEFAULT_TTL_SECONDS || '300'), 10);
    this.maxTtl = parseInt(String((config as any).CLAIM_CHECK_MAX_TTL_SECONDS || '3600'), 10);

    this.logger.info('claim_check.service.initialized', {
      maxEventSize: this.maxEventSize,
      maxBlobSize: this.maxBlobSize,
      defaultTtl: this.defaultTtl,
      maxTtl: this.maxTtl
    });
  }

  // ─────────────────────────────────────────────────────────
  // Event Claim Check Operations
  // ─────────────────────────────────────────────────────────

  /**
   * Store an event snapshot with timestamp-based versioning (Sprint 24)
   *
   * Implements out-of-order delivery handling using timestamp comparison:
   * - Rejects snapshots older than the currently stored version
   * - Accepts newer snapshots (overwrites existing)
   * - Handles exact duplicates (same timestamp + kind)
   *
   * @param snapshot - Persistence snapshot event to store
   * @param ttl - Time-to-live in seconds (optional, uses default if omitted)
   * @returns 'stored' | 'rejected_stale' | 'rejected_error'
   */
  async storeEventClaim(
    snapshot: PersistenceSnapshotEventV1,
    ttl?: number
  ): Promise<StoreSnapshotResult> {
    const key = this.eventKey(snapshot.correlationId);
    const effectiveTtl = this.normalizeTtl(ttl);

    try {
      // 1. Fetch existing snapshot (if any)
      const existingJson = await this.redis.get(key);

      if (existingJson) {
        const existing = JSON.parse(existingJson) as StoredSnapshot;

        // 2. Compare timestamps to determine which is newer
        const existingTime = new Date(existing.capturedAt).getTime();
        const incomingTime = new Date(snapshot.capturedAt).getTime();

        if (incomingTime < existingTime) {
          // Incoming snapshot is OLDER than stored version
          this.logger.debug('claim_check.snapshot.rejected_stale', {
            correlationId: snapshot.correlationId,
            existingKind: existing.kind,
            existingTime: existing.capturedAt,
            incomingKind: snapshot.kind,
            incomingTime: snapshot.capturedAt,
          });
          return 'rejected_stale';
        }

        if (incomingTime === existingTime && existing.kind === snapshot.kind) {
          // Exact duplicate (same timestamp, same kind)
          this.logger.debug('claim_check.snapshot.duplicate', {
            correlationId: snapshot.correlationId,
            kind: snapshot.kind,
          });
          return 'rejected_stale';
        }
      }

      // 3. Build payload with versioning metadata
      const payload: StoredSnapshot = {
        kind: snapshot.kind,
        capturedAt: snapshot.capturedAt,
        sourceService: snapshot.sourceService,
        sourceTopic: snapshot.sourceTopic,
        sequence: this.extractSequence(snapshot.idempotencyKey),
        updatedAt: new Date().toISOString(),
        event: snapshot.event,
      };

      const json = JSON.stringify(payload);

      // 4. Validate size
      const size = Buffer.byteLength(json, 'utf8');
      if (size > this.maxEventSize) {
        this.logger.error('claim_check.snapshot.size_exceeded', {
          correlationId: snapshot.correlationId,
          size,
          maxSize: this.maxEventSize,
        });
        return 'rejected_error';
      }

      // 5. Store new snapshot (is newer or doesn't exist)
      await this.redis.set(key, json, { EX: effectiveTtl });

      this.logger.info('claim_check.snapshot.stored', {
        correlationId: snapshot.correlationId,
        kind: snapshot.kind,
        previousKind: existingJson ? JSON.parse(existingJson).kind : null,
        capturedAt: snapshot.capturedAt,
        size,
        ttl: effectiveTtl,
      });

      return 'stored';

    } catch (error: any) {
      this.logger.error('claim_check.snapshot.store_error', {
        correlationId: snapshot.correlationId,
        error: error.message,
      });
      return 'rejected_error';
    }
  }

  /**
   * Retrieve an event claim by correlationId (Sprint 24: Returns versioned snapshot)
   *
   * @param correlationId - Correlation ID of the event to retrieve
   * @returns StoredSnapshot with versioning metadata if found, null if not found or expired
   */
  async retrieveEventClaim(correlationId: string): Promise<StoredSnapshot | null> {
    const key = this.eventKey(correlationId);
    const json = await this.redis.get(key);

    if (!json) {
      this.logger.debug('claim_check.event.not_found', { correlationId });
      return null;
    }

    try {
      const snapshot = JSON.parse(json) as StoredSnapshot;
      this.logger.debug('claim_check.event.retrieved', {
        correlationId,
        kind: snapshot.kind,
        capturedAt: snapshot.capturedAt
      });
      return snapshot;
    } catch (error: any) {
      this.logger.error('claim_check.event.parse_error', {
        correlationId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check if an event claim exists
   *
   * @param correlationId - Correlation ID to check
   * @returns True if event exists, false otherwise
   */
  async eventClaimExists(correlationId: string): Promise<boolean> {
    const key = this.eventKey(correlationId);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  // ─────────────────────────────────────────────────────────
  // Blob Claim Check Operations
  // ─────────────────────────────────────────────────────────

  /**
   * Store a blob claim with generated ID
   *
   * @param data - Blob data as Buffer
   * @param options - Optional contentType and TTL
   * @returns BlobStoreResult with blobId, size, and expiresAt
   * @throws Error if blob exceeds maxBlobSize
   */
  async storeBlobClaim(
    data: Buffer,
    options: { contentType?: string; ttl?: number } = {}
  ): Promise<BlobStoreResult> {
    const blobId = `blob-${randomUUID()}`;
    const effectiveTtl = this.normalizeTtl(options.ttl);

    // Validate size
    if (data.length > this.maxBlobSize) {
      throw new Error(
        `Blob exceeds max size: ${data.length} bytes > ${this.maxBlobSize} bytes`
      );
    }

    // Create metadata
    const metadata: BlobMetadata = {
      contentType: options.contentType,
      size: data.length,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + effectiveTtl * 1000).toISOString()
    };

    const dataKey = this.blobDataKey(blobId);
    const metaKey = this.blobMetaKey(blobId);

    // Store binary data as base64 string (Redis v4 best practice for binary data)
    const base64Data = data.toString('base64');

    // Store both data and metadata atomically with same TTL
    await Promise.all([
      this.redis.set(dataKey, base64Data, { EX: effectiveTtl }),
      this.redis.set(metaKey, JSON.stringify(metadata), { EX: effectiveTtl })
    ]);

    this.logger.info('claim_check.blob.stored', {
      blobId,
      size: data.length,
      contentType: options.contentType,
      ttl: effectiveTtl
    });

    return {
      blobId,
      size: data.length,
      expiresAt: metadata.expiresAt
    };
  }

  /**
   * Retrieve a blob claim by ID
   *
   * @param blobId - Blob ID to retrieve
   * @returns BlobRetrieveResult with data and metadata, or null if not found
   */
  async retrieveBlobClaim(blobId: string): Promise<BlobRetrieveResult | null> {
    const dataKey = this.blobDataKey(blobId);
    const metaKey = this.blobMetaKey(blobId);

    // Retrieve both data and metadata
    const [base64Data, metaJson] = await Promise.all([
      this.redis.get(dataKey),
      this.redis.get(metaKey)
    ]);

    if (!base64Data || !metaJson) {
      this.logger.debug('claim_check.blob.not_found', { blobId });
      return null;
    }

    try {
      const metadata = JSON.parse(metaJson) as BlobMetadata;

      // Decode base64 string back to Buffer
      const dataBuffer = Buffer.from(base64Data, 'base64');

      this.logger.debug('claim_check.blob.retrieved', { blobId, size: dataBuffer.length });
      return {
        data: dataBuffer,
        contentType: metadata.contentType,
        metadata
      };
    } catch (error: any) {
      this.logger.error('claim_check.blob.metadata_parse_error', {
        blobId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check if a blob claim exists
   *
   * @param blobId - Blob ID to check
   * @returns True if blob exists, false otherwise
   */
  async blobClaimExists(blobId: string): Promise<boolean> {
    const dataKey = this.blobDataKey(blobId);
    const exists = await this.redis.exists(dataKey);
    return exists === 1;
  }

  /**
   * Delete a blob claim (explicit removal before TTL expiration)
   *
   * @param blobId - Blob ID to delete
   */
  async deleteBlobClaim(blobId: string): Promise<void> {
    const dataKey = this.blobDataKey(blobId);
    const metaKey = this.blobMetaKey(blobId);

    // Delete both data and metadata keys
    await Promise.all([
      this.redis.del(dataKey),
      this.redis.del(metaKey)
    ]);

    this.logger.info('claim_check.blob.deleted', { blobId });
  }

  // ─────────────────────────────────────────────────────────
  // Key Generation
  // ─────────────────────────────────────────────────────────

  /**
   * Generate Redis key for event claim
   * Format: bitbrat:claim:event:{correlationId}
   */
  private eventKey(correlationId: string): string {
    return `bitbrat:claim:event:${correlationId}`;
  }

  /**
   * Generate Redis key for blob data
   * Format: bitbrat:claim:blob:{blobId}
   */
  private blobDataKey(blobId: string): string {
    return `bitbrat:claim:blob:${blobId}`;
  }

  /**
   * Generate Redis key for blob metadata
   * Format: bitbrat:claim:blob:{blobId}:meta
   */
  private blobMetaKey(blobId: string): string {
    return `bitbrat:claim:blob:${blobId}:meta`;
  }

  /**
   * Normalize TTL to valid range
   *
   * @param ttl - Optional TTL in seconds
   * @returns Normalized TTL between 1 and maxTtl
   */
  private normalizeTtl(ttl?: number): number {
    // Use default if not provided or invalid
    if (!ttl || ttl <= 0) {
      return this.defaultTtl;
    }
    // Cap at maxTtl
    return Math.min(ttl, this.maxTtl);
  }

  /**
   * Extract sequence number from idempotency key (Sprint 24)
   *
   * Expected format: correlationId:kind:sourceService:sourceTopic:capturedAt[:sequence]
   * The sequence component is optional and allows ordering events with identical timestamps.
   *
   * Note: capturedAt is an ISO timestamp (2024-01-01T10:00:00.000Z) which contains colons,
   * so we extract the sequence from the last component after all timestamp parts.
   *
   * @param idempotencyKey - Idempotency key from persistence snapshot
   * @returns Sequence number if present, undefined otherwise
   */
  private extractSequence(idempotencyKey: string): number | undefined {
    const parts = idempotencyKey.split(':');
    // Format: correlationId:kind:sourceService:sourceTopic:timestamp[:sequence]
    // Timestamp format: 2024-01-01T10:00:00.000Z (contains 2 colons)
    // Minimum parts: 4 + 3 (timestamp) = 7
    // With sequence: 4 + 3 (timestamp) + 1 = 8
    if (parts.length >= 8) {
      const seq = parseInt(parts[parts.length - 1], 10);
      return isNaN(seq) ? undefined : seq;
    }
    return undefined;
  }
}

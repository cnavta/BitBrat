/**
 * PostgreSQL Backup/Restore Business Logic
 * Sprint 361: BIZ-002
 *
 * Extracted from cli/pg-backup.ts (375 lines) → business module pattern
 *
 * Supports:
 * - JSON export/import (via PostgresDocumentStore)
 * - SQL export/import (via pg_dump/pg_restore)
 * - Compression (gzip)
 * - Format detection
 * - Dry-run mode
 */

import type { Logger } from '../orchestration/logger';
import type { PostgresDocumentStore } from '../../../../src/common/persistence/postgres-store';
import { execCmd } from '../orchestration/exec';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Default collections to backup
export const DEFAULT_COLLECTIONS = [
  'events',
  'routing_rules',
  'snapshots',
  'sources',
  'state',
  'mutation_log',
  'context_packs',
  'service_registry',
  'auth_users',
  'auth_scopes',
  'user_state',
  'global_state',
  'sessions',
  'conversation_history',
  'llm_responses',
  'integration_configs',
  'metrics',
];

// ============================================================================
// Types
// ============================================================================

export interface BackupOptions {
  collections?: string[];
  compress?: boolean;
}

export interface BackupToJsonResult {
  data: Record<string, any[]>;
  metadata: {
    timestamp: string;
    collections: number;
    totalDocuments: number;
    format: 'json';
    compressed: boolean;
  };
}

export interface BackupToSqlResult {
  success: boolean;
  path: string;
  size: number;
}

export interface RestoreOptions {
  dryRun?: boolean;
  mode?: 'merge' | 'overwrite';
}

export interface RestoreFromJsonResult {
  restored: number;
  errors: number;
}

export interface RestoreFromSqlResult {
  success: boolean;
}

// ============================================================================
// JSON Backup/Restore
// ============================================================================

/**
 * Backup PostgreSQL database to JSON format
 *
 * Reads all documents from specified collections and returns structured data.
 *
 * @param postgres - PostgreSQL document store instance
 * @param options - Backup options
 * @param logger - Logger instance
 * @returns Backup data and metadata
 */
export async function backupToJson(
  postgres: PostgresDocumentStore,
  options: BackupOptions,
  logger: Logger
): Promise<BackupToJsonResult> {
  const collections = options.collections || DEFAULT_COLLECTIONS;
  const data: Record<string, any[]> = {};
  let totalDocuments = 0;

  for (const collection of collections) {
    logger.info({ action: 'backup.collection.start', collection }, `Backing up ${collection}...`);

    const docs = await postgres.getAll(collection);
    data[collection] = docs;
    totalDocuments += docs.length;

    logger.info(
      { action: 'backup.collection.complete', collection, count: docs.length },
      `Backed up ${docs.length} documents from ${collection}`
    );
  }

  const metadata = {
    timestamp: new Date().toISOString(),
    collections: collections.length,
    totalDocuments,
    format: 'json' as const,
    compressed: options.compress || false,
  };

  return { data, metadata };
}

/**
 * Restore PostgreSQL database from JSON format
 *
 * Writes documents to PostgreSQL collections. Supports merge and overwrite modes.
 *
 * @param postgres - PostgreSQL document store instance
 * @param data - Backup data (collection → documents)
 * @param options - Restore options
 * @param logger - Logger instance
 * @returns Restore statistics (restored count, error count)
 */
export async function restoreFromJson(
  postgres: PostgresDocumentStore,
  data: Record<string, any[]>,
  options: RestoreOptions,
  logger: Logger
): Promise<RestoreFromJsonResult> {
  let restored = 0;
  let errors = 0;

  for (const [collection, docs] of Object.entries(data)) {
    logger.info(
      { action: 'restore.collection.start', collection, count: docs.length },
      `Restoring ${docs.length} documents to ${collection}...`
    );

    if (options.dryRun) {
      logger.info({ action: 'restore.collection.dryrun', collection }, '[DRY RUN] Would restore documents');
      restored += docs.length;
      continue;
    }

    // Note: Overwrite mode would require implementing a clear() method on PostgresDocumentStore
    if (options.mode === 'overwrite') {
      logger.info({ action: 'restore.collection.clear', collection }, 'Clearing collection (overwrite mode)');
      // TODO: Implement clear() on PostgresDocumentStore if needed
    }

    for (const doc of docs) {
      try {
        // Extract ID from document (support various ID fields)
        const id = (doc as any).id || (doc as any)._id || Math.random().toString(36).substring(7);
        await postgres.set(collection, id, doc);
        restored++;
      } catch (error: any) {
        errors++;
        logger.error(
          { action: 'restore.document.error', collection, error: error.message },
          `Failed to restore document`
        );
      }
    }

    logger.info(
      { action: 'restore.collection.complete', collection, restored: docs.length - errors, errors },
      `Restored ${docs.length - errors} documents to ${collection}`
    );
  }

  return { restored, errors };
}

// ============================================================================
// SQL Backup/Restore (pg_dump/pg_restore wrappers)
// ============================================================================

/**
 * Backup PostgreSQL database using pg_dump (SQL format)
 *
 * Creates a custom-format backup using pg_dump. Requires DATABASE_URL environment variable.
 *
 * @param outputPath - Path to write backup file
 * @param connectionString - PostgreSQL connection string
 * @param options - Backup options
 * @param logger - Logger instance
 * @returns Backup result with path and size
 */
export async function backupToSql(
  outputPath: string,
  connectionString: string,
  options: BackupOptions,
  logger: Logger
): Promise<BackupToSqlResult> {
  logger.info({ action: 'backup.sql.start', outputPath }, 'Creating SQL backup with pg_dump...');

  const args = [
    connectionString,
    '--file', outputPath,
    '--format', 'custom', // Custom format for pg_restore
    '--compress', options.compress ? '9' : '0',
    '--verbose',
  ];

  const result = await execCmd('pg_dump', args);

  if (result.code !== 0) {
    logger.error({ action: 'backup.sql.error', stderr: result.stderr }, 'pg_dump failed');
    throw new Error(`pg_dump failed: ${result.stderr}`);
  }

  const fs = await import('fs');
  const stats = fs.statSync(outputPath);
  logger.info({ action: 'backup.sql.complete', path: outputPath, size: stats.size }, 'SQL backup complete');

  return { success: true, path: outputPath, size: stats.size };
}

/**
 * Restore PostgreSQL database using pg_restore (SQL format)
 *
 * Restores from a pg_dump custom-format backup. Requires DATABASE_URL environment variable.
 *
 * @param inputPath - Path to backup file
 * @param connectionString - PostgreSQL connection string
 * @param options - Restore options
 * @param logger - Logger instance
 * @returns Restore result
 */
export async function restoreFromSql(
  inputPath: string,
  connectionString: string,
  options: RestoreOptions,
  logger: Logger
): Promise<RestoreFromSqlResult> {
  if (options.dryRun) {
    logger.info({ action: 'restore.sql.dryrun', inputPath }, '[DRY RUN] Would restore from SQL backup');
    return { success: true };
  }

  logger.info({ action: 'restore.sql.start', inputPath }, 'Restoring from SQL backup with pg_restore...');

  const args = [
    '--dbname', connectionString,
    '--clean', // Drop existing objects before restore
    '--if-exists', // Don't error if objects don't exist
    '--verbose',
    inputPath,
  ];

  const result = await execCmd('pg_restore', args);

  if (result.code !== 0) {
    logger.error({ action: 'restore.sql.error', stderr: result.stderr }, 'pg_restore failed');
    throw new Error(`pg_restore failed: ${result.stderr}`);
  }

  logger.info({ action: 'restore.sql.complete' }, 'SQL restore complete');

  return { success: true };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Detect backup format from file extension
 *
 * @param filePath - Path to backup file
 * @returns Detected format ('json' or 'sql')
 * @throws Error if format cannot be detected
 */
export function detectFormat(filePath: string): 'json' | 'sql' {
  if (filePath.endsWith('.pgdump')) return 'sql';
  if (filePath.endsWith('.json') || filePath.endsWith('.json.gz')) return 'json';

  throw new Error(`Unknown backup format: ${filePath}. Expected .json, .json.gz, or .pgdump`);
}

/**
 * Compress data with gzip
 *
 * @param data - Data to compress
 * @returns Compressed buffer
 */
export async function compressData(data: Buffer): Promise<Buffer> {
  return await gzip(data);
}

/**
 * Decompress gzip data
 *
 * @param data - Compressed data
 * @returns Decompressed buffer
 */
export async function decompressData(data: Buffer): Promise<Buffer> {
  return await gunzip(data);
}

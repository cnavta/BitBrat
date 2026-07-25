/**
 * Database Validation Business Logic
 * Sprint 361: BIZ-004
 *
 * Extracted from cli/db-validate.ts (264 lines) → business module pattern
 *
 * Validates data consistency between Firestore and PostgreSQL.
 * Useful for verifying migration success and detecting data drift.
 *
 * Features:
 * - Count comparison
 * - Checksum-based document comparison
 * - Sample-based validation
 * - Detailed mismatch reporting
 */

import type { Logger } from '../orchestration/logger';
import type { PostgresDocumentStore } from '../../../../src/common/persistence/postgres-store';
import * as crypto from 'crypto';

// Default collections to validate
export const DEFAULT_COLLECTIONS = [
  'events',
  'commands',
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

export interface ValidationOptions {
  sampleSize?: number;
}

export interface ValidationResult {
  collection: string;
  firestoreCount: number;
  postgresCount: number;
  countMatch: boolean;
  sampled: number;
  checksumMatches: number;
  checksumMismatches: number;
  missingInPostgres: number;
  missingInFirestore: number;
  differences: Array<{ id: string; issue: string }>;
}

export interface ValidationSummary {
  collections: ValidationResult[];
  totalIssues: number;
  success: boolean;
}

// ============================================================================
// Core Validation Functions
// ============================================================================

/**
 * Calculate normalized checksum for a document
 *
 * Uses SHA-256 hash of sorted JSON to ensure consistent comparison.
 *
 * @param doc - Document to checksum
 * @returns Hex-encoded SHA-256 hash
 */
export function calculateChecksum(doc: any): string {
  // Sort keys to ensure consistent JSON serialization
  const normalized = JSON.stringify(doc, Object.keys(doc).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Validate a single collection between Firestore and PostgreSQL
 *
 * Compares document counts and checksums to detect inconsistencies.
 *
 * @param collectionName - Collection to validate
 * @param firestore - Firestore instance
 * @param postgres - PostgreSQL document store
 * @param options - Validation options
 * @param logger - Logger instance
 * @returns Validation result with detailed statistics
 */
export async function validateCollection(
  collectionName: string,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: ValidationOptions,
  logger: Logger
): Promise<ValidationResult> {
  logger.info({ action: 'validate.collection.start', collection: collectionName }, `Validating ${collectionName}...`);

  // Get all documents from both stores
  const firestoreSnapshot = await firestore.collection(collectionName).get();
  const firestoreDocs = new Map(firestoreSnapshot.docs.map(doc => [doc.id, doc.data()]));

  const postgresDocs = await postgres.getAll(collectionName);
  const postgresMap = new Map(postgresDocs.map((doc: any) => [doc.id, doc]));

  const firestoreCount = firestoreDocs.size;
  const postgresCount = postgresMap.size;
  const countMatch = firestoreCount === postgresCount;

  const differences: Array<{ id: string; issue: string }> = [];
  let checksumMatches = 0;
  let checksumMismatches = 0;
  let missingInPostgres = 0;
  let missingInFirestore = 0;

  // Sample validation (check all docs or a sample)
  const sampleSize = options.sampleSize || Math.min(1000, firestoreCount);
  const firestoreIds = Array.from(firestoreDocs.keys());
  const sampled = Math.min(sampleSize, firestoreIds.length);

  // Validate sampled documents
  for (let i = 0; i < sampled; i++) {
    const id = firestoreIds[i];
    const firestoreDoc = firestoreDocs.get(id);
    const postgresDoc = postgresMap.get(id);

    if (!postgresDoc) {
      missingInPostgres++;
      differences.push({ id, issue: 'missing_in_postgres' });
      continue;
    }

    const firestoreChecksum = calculateChecksum(firestoreDoc);
    const postgresChecksum = calculateChecksum(postgresDoc);

    if (firestoreChecksum === postgresChecksum) {
      checksumMatches++;
    } else {
      checksumMismatches++;
      differences.push({ id, issue: 'checksum_mismatch' });
    }
  }

  // Check for docs in Postgres but not in Firestore
  for (const id of Array.from(postgresMap.keys())) {
    if (!firestoreDocs.has(id)) {
      missingInFirestore++;
      differences.push({ id: String(id), issue: 'missing_in_firestore' });
    }
  }

  logger.info(
    {
      action: 'validate.collection.complete',
      collection: collectionName,
      firestoreCount,
      postgresCount,
      countMatch,
      checksumMatches,
      checksumMismatches,
    },
    `Validated ${collectionName}: ${checksumMatches}/${sampled} checksums match`
  );

  return {
    collection: collectionName,
    firestoreCount,
    postgresCount,
    countMatch,
    sampled,
    checksumMatches,
    checksumMismatches,
    missingInPostgres,
    missingInFirestore,
    differences,
  };
}

/**
 * Validate all collections between Firestore and PostgreSQL
 *
 * Iterates through all collections and aggregates results.
 *
 * @param collections - Collections to validate
 * @param firestore - Firestore instance
 * @param postgres - PostgreSQL document store
 * @param options - Validation options
 * @param logger - Logger instance
 * @returns Aggregated validation summary
 */
export async function validateAll(
  collections: string[],
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: ValidationOptions,
  logger: Logger
): Promise<ValidationSummary> {
  const results: ValidationResult[] = [];
  let totalIssues = 0;

  for (const collection of collections) {
    const result = await validateCollection(collection, firestore, postgres, options, logger);
    results.push(result);

    const issues = result.checksumMismatches + result.missingInPostgres + result.missingInFirestore;
    totalIssues += issues;
  }

  return {
    collections: results,
    totalIssues,
    success: totalIssues === 0,
  };
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format validation result for single collection (human-readable)
 *
 * @param result - Validation result
 * @returns Formatted text output
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push(`\nValidation Results: ${result.collection}`);
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Firestore count: ${result.firestoreCount}`);
  lines.push(`PostgreSQL count: ${result.postgresCount}`);
  lines.push(`Count match: ${result.countMatch ? '✓' : '✗'}`);
  lines.push(`\nSampled: ${result.sampled} documents`);
  lines.push(`Checksum matches: ${result.checksumMatches}`);
  lines.push(`Checksum mismatches: ${result.checksumMismatches}`);
  lines.push(`Missing in PostgreSQL: ${result.missingInPostgres}`);
  lines.push(`Missing in Firestore: ${result.missingInFirestore}`);

  if (result.differences.length > 0) {
    lines.push(`\nDifferences (first 10):`);
    result.differences.slice(0, 10).forEach(diff => {
      lines.push(`  - ${diff.id}: ${diff.issue}`);
    });
  }

  return lines.join('\n');
}

/**
 * Format validation summary for all collections (human-readable)
 *
 * @param summary - Validation summary
 * @returns Formatted text output
 */
export function formatValidationSummary(summary: ValidationSummary): string {
  const lines: string[] = [];

  lines.push(`\n${'='.repeat(60)}`);
  lines.push(`Validation Summary (all collections)`);
  lines.push(`${'='.repeat(60)}`);
  lines.push('');

  for (const result of summary.collections) {
    const status = result.countMatch && result.checksumMismatches === 0 ? '✓' : '✗';
    lines.push(
      `${status} ${result.collection.padEnd(25)} Firestore: ${result.firestoreCount}, PostgreSQL: ${result.postgresCount}, Mismatches: ${result.checksumMismatches}`
    );
  }

  lines.push('');
  lines.push(`Total issues: ${summary.totalIssues}`);
  lines.push('');

  if (summary.totalIssues === 0) {
    lines.push(`✓ All collections validated successfully - data is consistent`);
  } else {
    lines.push(`✗ Validation failed - ${summary.totalIssues} issues found`);
  }

  return lines.join('\n');
}

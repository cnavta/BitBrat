/**
 * Database Validation Command
 *
 * Validates data consistency between Firestore and PostgreSQL.
 * Useful for verifying migration success.
 */

import { getFirestore } from '../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../src/common/persistence/postgres-store';
import type { Logger } from '../orchestration/logger';
import * as crypto from 'crypto';

export interface ValidateCliFlags {
  json?: boolean;
}

const COLLECTIONS = [
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

/**
 * Parse key-value flags from rest array
 */
function parseFlagMap(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    out[key] = v !== undefined ? v : 'true';
  }
  return out;
}

/**
 * Calculate checksum for a document
 */
function calculateChecksum(doc: any): string {
  const normalized = JSON.stringify(doc, Object.keys(doc).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Validate a single collection
 */
async function validateCollection(
  collectionName: string,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: { sampleSize?: number },
  logger: Logger
): Promise<{
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
}> {
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
  for (const id of postgresMap.keys()) {
    if (!firestoreDocs.has(id)) {
      missingInFirestore++;
      differences.push({ id, issue: 'missing_in_firestore' });
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
 * brat db:validate command
 */
export async function cmdDbValidate(
  cmd: string[],
  flags: ValidateCliFlags,
  rest: string[],
  logger: Logger
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const m = parseFlagMap(rest);
  const collection = m['collection'];
  const all = m['all'] === 'true' || !collection;
  const sampleSize = m['sample'] ? parseInt(m['sample'], 10) : undefined;

  // Get database connections
  const firestore = getFirestore();
  const postgres = new PostgresDocumentStore({
    connectionString: process.env.DATABASE_URL,
    poolSize: 10,
  });
  postgres.setLogger(logger);

  // Check PostgreSQL connection
  const health = await postgres.health();
  if (!health.healthy) {
    logger.error({ action: 'validate.preflight.error', error: health.error }, 'PostgreSQL not healthy');
    console.error(`PostgreSQL connection failed: ${health.error}`);
    await postgres.close();
    process.exit(1);
  }

  const collections = all ? COLLECTIONS : [collection];
  const results: Array<any> = [];
  let totalIssues = 0;

  for (const coll of collections) {
    if (!COLLECTIONS.includes(coll)) {
      console.error(`Unknown collection: ${coll}`);
      console.error(`Valid collections: ${COLLECTIONS.join(', ')}`);
      await postgres.close();
      process.exit(2);
    }

    const result = await validateCollection(coll, firestore, postgres, { sampleSize }, logger);
    results.push(result);

    const issues = result.checksumMismatches + result.missingInPostgres + result.missingInFirestore;
    totalIssues += issues;

    if (!flags.json && !all) {
      // Print detailed results for single collection
      console.log(`\nValidation Results: ${coll}`);
      console.log(`${'='.repeat(60)}`);
      console.log(`Firestore count: ${result.firestoreCount}`);
      console.log(`PostgreSQL count: ${result.postgresCount}`);
      console.log(`Count match: ${result.countMatch ? '✓' : '✗'}`);
      console.log(`\nSampled: ${result.sampled} documents`);
      console.log(`Checksum matches: ${result.checksumMatches}`);
      console.log(`Checksum mismatches: ${result.checksumMismatches}`);
      console.log(`Missing in PostgreSQL: ${result.missingInPostgres}`);
      console.log(`Missing in Firestore: ${result.missingInFirestore}`);

      if (result.differences.length > 0) {
        console.log(`\nDifferences (first 10):`);
        result.differences.slice(0, 10).forEach(diff => {
          console.log(`  - ${diff.id}: ${diff.issue}`);
        });
      }
    }
  }

  await postgres.close();

  if (flags.json) {
    console.log(JSON.stringify({ collections: results, totalIssues }, null, 2));
  } else if (all) {
    // Summary for all collections
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Validation Summary (all collections)`);
    console.log(`${'='.repeat(60)}`);

    for (const result of results) {
      const status = result.countMatch && result.checksumMismatches === 0 ? '✓' : '✗';
      console.log(
        `${status} ${result.collection.padEnd(25)} Firestore: ${result.firestoreCount}, PostgreSQL: ${result.postgresCount}, Mismatches: ${result.checksumMismatches}`
      );
    }

    console.log(`\nTotal issues: ${totalIssues}`);

    if (totalIssues === 0) {
      console.log(`\n✓ All collections validated successfully - data is consistent`);
    } else {
      console.log(`\n✗ Validation failed - ${totalIssues} issues found`);
    }
  }

  // Exit with code 1 if there are any issues
  if (totalIssues > 0) {
    process.exit(1);
  }
}

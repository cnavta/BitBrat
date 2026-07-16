/**
 * Migration command: Firestore → PostgreSQL
 *
 * Supports:
 * - Individual collection migration
 * - Bulk migration (all collections)
 * - Dry-run mode
 * - Progress tracking
 * - Validation
 */

import * as cliProgress from 'cli-progress';
import { getFirestore } from '../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../src/common/persistence/postgres-store';
import type { Logger } from '../orchestration/logger';

export interface MigrateCliFlags {
  dryRun?: boolean;
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
 * Migrate a single collection from Firestore to PostgreSQL
 */
async function migrateCollection(
  collectionName: string,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: { dryRun?: boolean; showProgress?: boolean },
  logger: Logger
): Promise<{ migrated: number; skipped: number; errors: number }> {
  const startTime = Date.now();
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Get all documents from Firestore collection
    const snapshot = await firestore.collection(collectionName).get();
    const total = snapshot.size;

    logger.info(
      { action: 'migrate.collection.start', collection: collectionName, total },
      `Migrating ${collectionName}: ${total} documents`
    );

    // Create progress bar if requested
    let progressBar: cliProgress.SingleBar | null = null;
    if (options.showProgress && total > 0) {
      progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      progressBar.start(total, 0);
    }

    // Migrate each document
    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();

        if (!options.dryRun) {
          await postgres.set(collectionName, doc.id, data);
        }

        migrated++;
        if (progressBar) {
          progressBar.update(migrated);
        }
      } catch (error: any) {
        errors++;
        logger.error(
          { action: 'migrate.document.error', collection: collectionName, docId: doc.id, error: error.message },
          `Failed to migrate document ${doc.id}`
        );
      }
    }

    if (progressBar) {
      progressBar.stop();
    }

    const duration = Date.now() - startTime;
    logger.info(
      { action: 'migrate.collection.complete', collection: collectionName, migrated, errors, duration },
      `Migrated ${collectionName}: ${migrated}/${total} documents in ${duration}ms`
    );

    return { migrated, skipped, errors };
  } catch (error: any) {
    logger.error(
      { action: 'migrate.collection.error', collection: collectionName, error: error.message },
      `Failed to migrate collection ${collectionName}`
    );
    throw error;
  }
}

/**
 * brat migrate collection <name>
 */
async function cmdMigrateCollection(
  collectionName: string,
  flags: MigrateCliFlags,
  m: Record<string, string>,
  logger: Logger
): Promise<void> {
  if (!COLLECTIONS.includes(collectionName)) {
    console.error(`Unknown collection: ${collectionName}`);
    console.error(`Valid collections: ${COLLECTIONS.join(', ')}`);
    process.exit(2);
  }

  // Get database connections
  const firestore = getFirestore();
  const postgres = new PostgresDocumentStore({
    connectionString: process.env.DATABASE_URL!,
    poolSize: 10,
  });
  postgres.setLogger(logger);

  // Check PostgreSQL connection
  const health = await postgres.health();
  if (!health.healthy) {
    logger.error({ action: 'migrate.preflight.error', error: health.error }, 'PostgreSQL not healthy');
    console.error(`PostgreSQL connection failed: ${health.error}`);
    process.exit(1);
  }

  logger.info({ action: 'migrate.preflight.ok', latency: health.latency }, 'PostgreSQL connection healthy');

  if (flags.dryRun) {
    console.log(`[DRY RUN] Would migrate collection: ${collectionName}`);
  }

  const result = await migrateCollection(collectionName, firestore, postgres, {
    dryRun: flags.dryRun,
    showProgress: !flags.json,
  }, logger);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nMigration complete:`);
    console.log(`  Migrated: ${result.migrated}`);
    console.log(`  Errors: ${result.errors}`);
  }

  await postgres.close();
}

/**
 * brat migrate all
 */
async function cmdMigrateAll(
  flags: MigrateCliFlags,
  m: Record<string, string>,
  logger: Logger
): Promise<void> {
  // Get database connections
  const firestore = getFirestore();
  const postgres = new PostgresDocumentStore({
    connectionString: process.env.DATABASE_URL!,
    poolSize: 10,
  });
  postgres.setLogger(logger);

  // Check PostgreSQL connection
  const health = await postgres.health();
  if (!health.healthy) {
    logger.error({ action: 'migrate.preflight.error', error: health.error }, 'PostgreSQL not healthy');
    console.error(`PostgreSQL connection failed: ${health.error}`);
    process.exit(1);
  }

  logger.info({ action: 'migrate.all.start', collections: COLLECTIONS.length }, 'Starting full migration');

  if (flags.dryRun) {
    console.log(`[DRY RUN] Would migrate all ${COLLECTIONS.length} collections`);
  }

  const results: Record<string, { migrated: number; errors: number }> = {};
  let totalMigrated = 0;
  let totalErrors = 0;

  for (const collectionName of COLLECTIONS) {
    console.log(`\n[${COLLECTIONS.indexOf(collectionName) + 1}/${COLLECTIONS.length}] Migrating ${collectionName}...`);

    const result = await migrateCollection(collectionName, firestore, postgres, {
      dryRun: flags.dryRun,
      showProgress: !flags.json,
    }, logger);

    results[collectionName] = { migrated: result.migrated, errors: result.errors };
    totalMigrated += result.migrated;
    totalErrors += result.errors;
  }

  logger.info(
    { action: 'migrate.all.complete', totalMigrated, totalErrors },
    `Migration complete: ${totalMigrated} documents migrated, ${totalErrors} errors`
  );

  if (flags.json) {
    console.log(JSON.stringify({ collections: results, totalMigrated, totalErrors }, null, 2));
  } else {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Migration Summary:`);
    console.log(`${'='.repeat(60)}`);
    for (const [collection, result] of Object.entries(results)) {
      console.log(`  ${collection.padEnd(25)} ${result.migrated} docs (${result.errors} errors)`);
    }
    console.log(`${'='.repeat(60)}`);
    console.log(`Total: ${totalMigrated} documents migrated`);
    if (totalErrors > 0) {
      console.log(`Errors: ${totalErrors}`);
    }
  }

  await postgres.close();
}

/**
 * Main entry point for migrate command
 */
export async function cmdMigrate(
  cmd: string[],
  flags: MigrateCliFlags,
  rest: string[],
  logger: Logger
): Promise<void> {
  // Validate DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('Set it to your PostgreSQL connection string, e.g.:');
    console.error('  export DATABASE_URL="postgresql://bitbrat:password@localhost:5432/bitbrat"');
    process.exit(1);
  }

  const m = parseFlagMap(rest);
  const subcommand = cmd[1]; // 'collection' or 'all'

  if (!subcommand) {
    console.log(`Usage:
  brat migrate collection <name> [--dry-run] [--json]
  brat migrate all [--dry-run] [--json]

Collections:
  ${COLLECTIONS.join(', ')}

Options:
  --dry-run   Simulate migration without writing to PostgreSQL
  --json      Output results as JSON

Examples:
  brat migrate collection events --dry-run
  brat migrate all
`);
    return;
  }

  if (subcommand === 'all') {
    await cmdMigrateAll(flags, m, logger);
  } else if (subcommand === 'collection') {
    const collectionName = cmd[2];
    if (!collectionName) {
      console.error('Usage: brat migrate collection <name> [--dry-run]');
      process.exit(2);
    }
    await cmdMigrateCollection(collectionName, flags, m, logger);
  } else {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Valid subcommands: collection, all');
    process.exit(2);
  }
}

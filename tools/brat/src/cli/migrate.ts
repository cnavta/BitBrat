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
import { getFirestore } from '../../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../../src/common/persistence/postgres-store';
import type { Logger } from '../orchestration/logger';

export interface MigrateCliFlags {
  dryRun?: boolean;
  json?: boolean;
}

// Firestore collection → PostgreSQL table mapping
const COLLECTION_MAPPING: Record<string, string> = {
  'configs': 'routing_rules',     // Firestore configs → PostgreSQL routing_rules
  'users': 'auth_users',          // Firestore users → PostgreSQL auth_users
  'oauth': 'auth_scopes',         // Firestore oauth → PostgreSQL auth_scopes
  'state': 'user_state',          // Firestore state → PostgreSQL user_state
  'services': 'service_registry', // Firestore services → PostgreSQL service_registry
};

const COLLECTIONS = [
  'events',
  'configs',              // Will map to routing_rules in PostgreSQL
  'context_packs',
  'services',             // Will map to service_registry in PostgreSQL
  'users',                // Will map to auth_users in PostgreSQL
  'oauth',                // Will map to auth_scopes in PostgreSQL
  'state',                // Will map to user_state in PostgreSQL
  'global_state',
  'sessions',
  'conversation_history',
  'llm_responses',
  'integration_configs',
  'metrics',
  'tool_usage',           // MCP tool usage analytics
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
    // Map Firestore collection name to PostgreSQL table name
    const postgresTable = COLLECTION_MAPPING[collectionName] || collectionName;

    // Get all documents from Firestore collection
    const snapshot = await firestore.collection(collectionName).get();
    const total = snapshot.size;

    logger.info(
      { action: 'migrate.collection.start', collection: collectionName, postgresTable, total },
      `Migrating ${collectionName} → ${postgresTable}: ${total} documents`
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
          await postgres.set(postgresTable, doc.id, data);
        }

        migrated++;
        if (progressBar) {
          progressBar.update(migrated);
        }
      } catch (error: any) {
        errors++;
        logger.error(
          { action: 'migrate.document.error', collection: collectionName, postgresTable, docId: doc.id, error: error.message },
          `Failed to migrate document ${doc.id}`
        );
      }
    }

    if (progressBar) {
      progressBar.stop();
    }

    const duration = Date.now() - startTime;
    logger.info(
      { action: 'migrate.collection.complete', collection: collectionName, postgresTable, migrated, errors, duration },
      `Migrated ${collectionName} → ${postgresTable}: ${migrated}/${total} documents in ${duration}ms`
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
 * brat migrate tokens [provider]
 */
async function cmdMigrateTokens(
  provider: string | undefined,
  flags: MigrateCliFlags,
  m: Record<string, string>,
  logger: Logger
): Promise<void> {
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

  // Define token paths
  const tokenPaths = [
    { provider: 'twitch', fs: 'oauth/twitch/bot/token', pg: 'twitch:bot', name: 'Twitch Bot' },
    { provider: 'twitch', fs: 'oauth/twitch/broadcaster/token', pg: 'twitch:broadcaster', name: 'Twitch Broadcaster' },
    { provider: 'discord', fs: 'oauth/discord/broadcaster/token', pg: 'discord:broadcaster', name: 'Discord Broadcaster' },
  ];

  // Filter by provider if specified
  const pathsToMigrate = provider
    ? tokenPaths.filter(p => p.provider === provider)
    : tokenPaths;

  if (pathsToMigrate.length === 0) {
    console.error(`Unknown provider: ${provider}`);
    console.error('Valid providers: twitch, discord');
    process.exit(2);
  }

  logger.info(
    { action: 'migrate.tokens.start', provider, count: pathsToMigrate.length },
    `Migrating ${pathsToMigrate.length} OAuth tokens`
  );

  if (flags.dryRun) {
    console.log(`[DRY RUN] Would migrate ${pathsToMigrate.length} OAuth tokens`);
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const { fs, pg, name } of pathsToMigrate) {
    try {
      console.log(`\nMigrating ${name} (${fs} → twitch_tokens:${pg})...`);

      const docSnap = await firestore.doc(fs).get();
      if (!docSnap.exists) {
        console.log(`  ⚠️  No token found, skipping`);
        skipped++;
        continue;
      }

      const tokenData = docSnap.data();
      if (!tokenData || !tokenData.accessToken) {
        console.log(`  ⚠️  Token missing accessToken, skipping`);
        skipped++;
        continue;
      }

      if (!flags.dryRun) {
        await postgres.set('twitch_tokens', pg, {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken || null,
          scope: tokenData.scope || [],
          expiresIn: tokenData.expiresIn || null,
          obtainmentTimestamp: tokenData.obtainmentTimestamp || null,
          userId: tokenData.userId || null,
          updatedAt: tokenData.updatedAt || Date.now(),
        });
      }

      console.log(`  ✅ Migrated successfully`);
      migrated++;
    } catch (error: any) {
      console.error(`  ❌ Failed: ${error.message}`);
      errors++;
      logger.error(
        { action: 'migrate.tokens.error', path: fs, error: error.message },
        `Failed to migrate token ${name}`
      );
    }
  }

  const duration = Date.now();
  logger.info(
    { action: 'migrate.tokens.complete', migrated, skipped, errors },
    `Token migration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`
  );

  if (flags.json) {
    console.log(JSON.stringify({ migrated, skipped, errors }, null, 2));
  } else {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Token Migration Summary:`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Migrated: ${migrated}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Errors:   ${errors}`);
    console.log(`${'='.repeat(60)}`);
  }

  await postgres.close();
}

/**
 * brat migrate api-tokens
 */
async function cmdMigrateApiTokens(
  flags: MigrateCliFlags,
  m: Record<string, string>,
  logger: Logger
): Promise<void> {
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

  logger.info({ action: 'migrate.api_tokens.start' }, 'Starting API token migration');

  if (flags.dryRun) {
    console.log(`[DRY RUN] Would migrate API gateway tokens from gateways/api/tokens`);
  }

  try {
    // Get all API tokens from Firestore
    const snapshot = await firestore.collection('gateways/api/tokens').get();
    const total = snapshot.size;

    console.log(`\nFound ${total} API tokens in Firestore`);

    let migrated = 0;
    let errors = 0;

    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();

        if (!flags.dryRun) {
          await postgres.set('api_tokens', doc.id, {
            user_id: data.user_id,
            created_at: data.created_at?.toDate?.() || data.created_at,
            token_hash: data.token_hash,
          });
        }

        migrated++;
        if (migrated % 10 === 0 || migrated === total) {
          console.log(`  Progress: ${migrated}/${total} tokens migrated`);
        }
      } catch (error: any) {
        errors++;
        logger.error(
          { action: 'migrate.api_tokens.error', docId: doc.id, error: error.message },
          `Failed to migrate API token ${doc.id}`
        );
      }
    }

    logger.info(
      { action: 'migrate.api_tokens.complete', migrated, errors, total },
      `API token migration complete: ${migrated}/${total} migrated`
    );

    if (flags.json) {
      console.log(JSON.stringify({ migrated, errors, total }, null, 2));
    } else {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`API Token Migration Summary:`);
      console.log(`${'='.repeat(60)}`);
      console.log(`  Total:    ${total}`);
      console.log(`  Migrated: ${migrated}`);
      console.log(`  Errors:   ${errors}`);
      console.log(`${'='.repeat(60)}`);
    }
  } catch (error: any) {
    logger.error(
      { action: 'migrate.api_tokens.error', error: error.message },
      'Failed to migrate API tokens'
    );
    console.error(`Failed to migrate API tokens: ${error.message}`);
    process.exit(1);
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
  brat migrate tokens [provider] [--dry-run] [--json]
  brat migrate api-tokens [--dry-run] [--json]

Collections:
  ${COLLECTIONS.join(', ')}

Options:
  --dry-run   Simulate migration without writing to PostgreSQL
  --json      Output results as JSON

Examples:
  brat migrate collection events --dry-run
  brat migrate all
  brat migrate tokens                # Migrate all OAuth tokens (Twitch, Discord)
  brat migrate tokens twitch         # Migrate only Twitch tokens
  brat migrate api-tokens --dry-run  # Preview API token migration
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
  } else if (subcommand === 'tokens') {
    const provider = cmd[2]; // Optional: 'twitch' or 'discord'
    await cmdMigrateTokens(provider, flags, m, logger);
  } else if (subcommand === 'api-tokens') {
    await cmdMigrateApiTokens(flags, m, logger);
  } else {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Valid subcommands: collection, all, tokens, api-tokens');
    process.exit(2);
  }
}

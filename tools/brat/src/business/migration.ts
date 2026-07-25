/**
 * Firestore → PostgreSQL Migration Business Logic
 * Sprint 361: BIZ-003
 *
 * Extracted from cli/migrate.ts (546 lines) → business module pattern
 *
 * Supports:
 * - Individual collection migration
 * - Bulk migration (all collections)
 * - OAuth token migration (Twitch, Discord)
 * - API token migration
 * - Collection name mapping (Firestore → PostgreSQL)
 * - Nested collection paths
 * - Dry-run mode
 * - Progress tracking
 */

import type { Logger } from '../orchestration/logger';
import type { PostgresDocumentStore } from '../../../../src/common/persistence/postgres-store';

// ============================================================================
// Constants
// ============================================================================

/**
 * Firestore collection → PostgreSQL table mapping
 *
 * Some Firestore collections have different names in PostgreSQL to avoid
 * naming conflicts or improve clarity.
 */
export const COLLECTION_MAPPING: Record<string, string> = {
  'configs': 'routing_rules',     // Firestore configs → PostgreSQL routing_rules
  'users': 'auth_users',          // Firestore users → PostgreSQL auth_users
  'oauth': 'auth_scopes',         // Firestore oauth → PostgreSQL auth_scopes
  'state': 'user_state',          // Firestore state → PostgreSQL user_state
  'services': 'service_registry', // Firestore services → PostgreSQL service_registry
};

/**
 * Firestore nested collection paths
 *
 * Some Firestore collections are nested (e.g., configs/routingRules/rules).
 * This map specifies the actual path for these collections.
 */
export const NESTED_COLLECTION_PATHS: Record<string, string> = {
  'configs': 'configs/routingRules/rules',  // Actual path for routing rules
};

/**
 * Default collections to migrate
 */
export const DEFAULT_COLLECTIONS = [
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
  'reflexes',             // Event-driven automation rules
];

/**
 * OAuth token migration paths
 *
 * Maps Firestore OAuth token paths to PostgreSQL token IDs.
 */
export const OAUTH_TOKEN_PATHS = [
  { provider: 'twitch', fs: 'oauth/twitch/bot/token', pg: 'twitch:bot', name: 'Twitch Bot' },
  { provider: 'twitch', fs: 'oauth/twitch/broadcaster/token', pg: 'twitch:broadcaster', name: 'Twitch Broadcaster' },
  { provider: 'discord', fs: 'oauth/discord/broadcaster/token', pg: 'discord:broadcaster', name: 'Discord Broadcaster' },
];

// ============================================================================
// Types
// ============================================================================

export interface MigrationOptions {
  dryRun?: boolean;
  onProgress?: (current: number, total: number) => void;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: number;
}

export interface CollectionMigrationResult extends MigrationResult {
  collection: string;
  postgresTable: string;
  duration: number;
}

export interface BulkMigrationResult {
  collections: Record<string, MigrationResult>;
  totalMigrated: number;
  totalErrors: number;
}

export interface TokenMigrationResult {
  migrated: number;
  skipped: number;
  errors: number;
  provider?: string;
}

// ============================================================================
// Core Migration Functions
// ============================================================================

/**
 * Migrate a single collection from Firestore to PostgreSQL
 *
 * Handles collection name mapping and nested collection paths.
 *
 * @param collectionName - Firestore collection name
 * @param firestore - Firestore instance
 * @param postgres - PostgreSQL document store
 * @param options - Migration options
 * @param logger - Logger instance
 * @returns Migration result with statistics
 */
export async function migrateCollection(
  collectionName: string,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger
): Promise<CollectionMigrationResult> {
  const startTime = Date.now();
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Map Firestore collection name to PostgreSQL table name
    const postgresTable = COLLECTION_MAPPING[collectionName] || collectionName;

    // Determine the actual Firestore path (handle nested collections)
    const firestorePath = NESTED_COLLECTION_PATHS[collectionName] || collectionName;

    // Get all documents from Firestore collection
    const snapshot = await firestore.collection(firestorePath).get();
    const total = snapshot.size;

    logger.info(
      { action: 'migrate.collection.start', collection: collectionName, postgresTable, total },
      `Migrating ${collectionName} → ${postgresTable}: ${total} documents`
    );

    // Migrate each document
    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();

        if (!options.dryRun) {
          await postgres.set(postgresTable, doc.id, data);
        }

        migrated++;

        // Report progress
        if (options.onProgress) {
          options.onProgress(migrated, total);
        }
      } catch (error: any) {
        errors++;
        logger.error(
          { action: 'migrate.document.error', collection: collectionName, postgresTable, docId: doc.id, error: error.message },
          `Failed to migrate document ${doc.id}`
        );
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      { action: 'migrate.collection.complete', collection: collectionName, postgresTable, migrated, errors, duration },
      `Migrated ${collectionName} → ${postgresTable}: ${migrated}/${total} documents in ${duration}ms`
    );

    return { collection: collectionName, postgresTable, migrated, skipped, errors, duration };
  } catch (error: any) {
    logger.error(
      { action: 'migrate.collection.error', collection: collectionName, error: error.message },
      `Failed to migrate collection ${collectionName}`
    );
    throw error;
  }
}

/**
 * Migrate all collections from Firestore to PostgreSQL
 *
 * Iterates through all collections and aggregates results.
 *
 * @param collections - Collections to migrate (defaults to DEFAULT_COLLECTIONS)
 * @param firestore - Firestore instance
 * @param postgres - PostgreSQL document store
 * @param options - Migration options
 * @param logger - Logger instance
 * @returns Aggregated migration results
 */
export async function migrateAll(
  collections: string[],
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger
): Promise<BulkMigrationResult> {
  logger.info({ action: 'migrate.all.start', collections: collections.length }, 'Starting full migration');

  const results: Record<string, MigrationResult> = {};
  let totalMigrated = 0;
  let totalErrors = 0;

  for (const collectionName of collections) {
    const result = await migrateCollection(collectionName, firestore, postgres, options, logger);

    results[collectionName] = {
      migrated: result.migrated,
      skipped: result.skipped,
      errors: result.errors,
    };
    totalMigrated += result.migrated;
    totalErrors += result.errors;
  }

  logger.info(
    { action: 'migrate.all.complete', totalMigrated, totalErrors },
    `Migration complete: ${totalMigrated} documents migrated, ${totalErrors} errors`
  );

  return { collections: results, totalMigrated, totalErrors };
}

// ============================================================================
// OAuth Token Migration
// ============================================================================

/**
 * Migrate OAuth tokens from Firestore to PostgreSQL
 *
 * Migrates platform-specific OAuth tokens (Twitch, Discord) from Firestore
 * document paths to PostgreSQL twitch_tokens table.
 *
 * @param provider - Provider to migrate (undefined = all providers)
 * @param firestore - Firestore instance
 * @param postgres - PostgreSQL document store
 * @param options - Migration options
 * @param logger - Logger instance
 * @returns Token migration result
 */
export async function migrateOAuthTokens(
  provider: string | undefined,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger
): Promise<TokenMigrationResult> {
  // Filter by provider if specified
  const pathsToMigrate = provider
    ? OAUTH_TOKEN_PATHS.filter(p => p.provider === provider)
    : OAUTH_TOKEN_PATHS;

  if (pathsToMigrate.length === 0) {
    throw new Error(`Unknown provider: ${provider}. Valid providers: twitch, discord`);
  }

  logger.info(
    { action: 'migrate.tokens.start', provider, count: pathsToMigrate.length },
    `Migrating ${pathsToMigrate.length} OAuth tokens`
  );

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const { fs, pg, name } of pathsToMigrate) {
    try {
      const docSnap = await firestore.doc(fs).get();
      if (!docSnap.exists) {
        logger.info({ action: 'migrate.tokens.skip', path: fs, reason: 'not_found' }, `Token ${name} not found, skipping`);
        skipped++;
        continue;
      }

      const tokenData = docSnap.data();
      if (!tokenData || !tokenData.accessToken) {
        logger.info({ action: 'migrate.tokens.skip', path: fs, reason: 'missing_access_token' }, `Token ${name} missing accessToken, skipping`);
        skipped++;
        continue;
      }

      if (!options.dryRun) {
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

      logger.info({ action: 'migrate.tokens.success', path: fs, token: pg }, `Migrated ${name} successfully`);
      migrated++;
    } catch (error: any) {
      errors++;
      logger.error(
        { action: 'migrate.tokens.error', path: fs, error: error.message },
        `Failed to migrate token ${name}`
      );
    }
  }

  logger.info(
    { action: 'migrate.tokens.complete', migrated, skipped, errors },
    `Token migration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`
  );

  return { migrated, skipped, errors, provider };
}

// ============================================================================
// API Token Migration
// ============================================================================

/**
 * Migrate API tokens from Firestore to PostgreSQL
 *
 * Migrates API gateway tokens from Firestore gateways/api/tokens collection
 * to PostgreSQL api_tokens table.
 *
 * @param firestore - Firestore instance
 * @param postgres - PostgreSQL document store
 * @param options - Migration options
 * @param logger - Logger instance
 * @returns API token migration result
 */
export async function migrateApiTokens(
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger
): Promise<TokenMigrationResult> {
  logger.info({ action: 'migrate.api_tokens.start' }, 'Starting API token migration');

  try {
    // Get all API tokens from Firestore
    const snapshot = await firestore.collection('gateways/api/tokens').get();
    const total = snapshot.size;

    logger.info({ action: 'migrate.api_tokens.found', total }, `Found ${total} API tokens in Firestore`);

    let migrated = 0;
    let errors = 0;

    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();

        if (!options.dryRun) {
          await postgres.set('api_tokens', doc.id, {
            user_id: data.user_id,
            created_at: data.created_at?.toDate?.() || data.created_at,
            token_hash: data.token_hash,
          });
        }

        migrated++;

        // Report progress
        if (options.onProgress) {
          options.onProgress(migrated, total);
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

    return { migrated, skipped: 0, errors };
  } catch (error: any) {
    logger.error(
      { action: 'migrate.api_tokens.error', error: error.message },
      'Failed to migrate API tokens'
    );
    throw error;
  }
}

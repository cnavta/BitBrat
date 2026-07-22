/**
 * Sprint 352: Unified Seed Command
 *
 * Story S6.4: CLI command to seed database with initial data.
 * Auto-detects persistence driver and routes to appropriate writer.
 */

import { seedPostgres } from '../seeding/postgres-seed-writer';
import { seedFirestore } from '../seeding/firestore-seed-writer';
import { SeedingOptions } from '../seeding/seed-data-types';
import { Firestore } from '@google-cloud/firestore';
import { ContextResolver } from '../context/context-resolver';
import type { ResolvedContext } from '../context/types';
import * as path from 'path';

/**
 * Execute seed command
 *
 * @param options - Command options
 * @param flags - Additional flags
 */
export async function cmdSeed(options: any, flags: any): Promise<void> {
  const { context: contextFlag, dryRun, wipe, botName, apiToken } = flags;

  // Resolve execution context
  // When running from dist/tools/brat/src/cli/index.js, we need to go up to repo root
  // __dirname will be dist/tools/brat/src/cli, so we go up 5 levels to reach repo root
  const repoRoot = path.resolve(__dirname, '../../../../../');
  const resolver = new ContextResolver(repoRoot);

  let resolvedContext;
  try {
    resolvedContext = await resolver.resolve(contextFlag);
  } catch (error: any) {
    console.error();
    console.error('❌ Context resolution failed:');
    console.error(`   ${error.message}`);
    console.error();
    process.exit(1);
  }

  const persistenceDriver = resolvedContext.runtime.persistence.driver;

  console.log();
  console.log('='.repeat(60));
  console.log('BitBrat Seed Data Command');
  console.log('='.repeat(60));
  console.log();
  console.log(`Context: ${resolvedContext.name}`);
  console.log(`Persistence Driver: ${persistenceDriver}`);
  console.log(`Bot Name: ${botName || 'BitBrat'}`);
  console.log(`Dry Run: ${dryRun ? 'YES' : 'NO'}`);
  console.log(`Wipe Existing: ${wipe ? 'YES' : 'NO'}`);
  console.log();

  const seedingOptions: SeedingOptions = {
    contextName: resolvedContext.name,
    botName: botName || 'BitBrat',
    dryRun: !!dryRun,
    wipe: !!wipe,
    apiToken,
  };

  try {
    let result;

    if (persistenceDriver === 'postgres') {
      // PostgreSQL seeding
      const connectionString = buildPostgresConnectionStringFromContext(resolvedContext);
      console.log('Seeding PostgreSQL database...');
      console.log();

      result = await seedPostgres(connectionString, seedingOptions);
    } else if (persistenceDriver === 'firestore') {
      // Firestore seeding
      console.log('Seeding Firestore database...');
      console.log();

      const firestore = new Firestore({
        projectId: process.env.GCP_PROJECT_ID || process.env.PROJECT_ID,
      });

      result = await seedFirestore(firestore, seedingOptions);
    } else {
      console.error(`Error: Unknown persistence driver '${persistenceDriver}'`);
      console.error('Set PERSISTENCE_DRIVER to "postgres" or "firestore"');
      process.exit(1);
    }

    // Display results
    console.log();
    console.log('='.repeat(60));
    console.log('Seed Results');
    console.log('='.repeat(60));
    console.log();
    console.log(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`Message: ${result.message}`);
    console.log();
    console.log('Seeded:');
    console.log(`  - Routing Rules: ${result.counts.routingRules}`);
    console.log(`  - Reflexes: ${result.counts.reflexes}`);
    console.log(`  - Personalities: ${result.counts.personalities}`);
    console.log(`  - Context Packs: ${result.counts.contextPacks}`);
    console.log(`  - API Tokens: ${result.counts.apiTokens}`);
    console.log();

    if (result.errors && result.errors.length > 0) {
      console.error('Errors:');
      result.errors.forEach(err => console.error(`  - ${err}`));
      console.error();
    }

    if (!result.success) {
      process.exit(1);
    }

    if (!dryRun && result.success) {
      console.log('✅ Database seeded successfully');
      console.log();

      // Display next steps
      console.log('Next steps:');
      console.log('  - Verify: Query your database to confirm seed data');
      console.log('  - Test: Send "!ping" to test the reflex');
      if (persistenceDriver === 'postgres') {
        console.log('  - Check: SELECT COUNT(*) FROM routing_rules; -- Should return 4');
        console.log('  - Check: SELECT COUNT(*) FROM reflexes; -- Should return 1');
      }
      console.log();
    }

  } catch (error: any) {
    console.error();
    console.error('❌ Seeding failed:');
    console.error(`   ${error.message || String(error)}`);
    console.error();
    process.exit(1);
  }
}

/**
 * Build PostgreSQL connection string from resolved context
 */
function buildPostgresConnectionStringFromContext(context: ResolvedContext): string {
  // Try DATABASE_URL from environment variables first (allows override)
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Use resolved context persistence connection
  const persistence = context.runtime.persistence;

  if (persistence.driver !== 'postgres') {
    throw new Error(`Expected postgres driver, got ${persistence.driver}`);
  }

  if (!persistence.connection) {
    throw new Error('PostgreSQL connection details not found in context');
  }

  const { host, port, database, username, password } = persistence.connection;

  return `postgresql://${username}:${password}@${host}:${port}/${database}`;
}

/**
 * Print seed command help
 */
export function printSeedHelp(): void {
  console.log(`brat seed — Seed database with initial data

Usage:
  brat seed [options]

Options:
  --context <name>     Context name (for substitutions)
  --bot-name <name>    Bot name (default: BitBrat)
  --dry-run            Show what would be seeded without writing
  --wipe               Delete existing seed data before seeding
  --api-token <token>  Override generated API token
  --json               Output results as JSON

Environment Variables:
  PERSISTENCE_DRIVER   Database type (postgres, firestore) [required]
  DATABASE_URL         PostgreSQL connection string (postgres)
  POSTGRES_HOST        PostgreSQL host (postgres)
  POSTGRES_PORT        PostgreSQL port (postgres)
  POSTGRES_DB          PostgreSQL database (postgres)
  POSTGRES_USER        PostgreSQL username (postgres)
  POSTGRES_PASSWORD    PostgreSQL password (postgres)
  GCP_PROJECT_ID       GCP project ID (firestore)

Examples:
  brat seed                                    # Seed current database
  brat seed --dry-run                          # Preview what would be seeded
  brat seed --bot-name MyBot                   # Custom bot name
  brat seed --wipe                             # Wipe and re-seed
  PERSISTENCE_DRIVER=postgres brat seed        # Explicitly use PostgreSQL

Seeded Data:
  - 4 routing rules (initial-contextualization, bot-mention, adventure, cnj)
  - 1 reflex (!ping → pong!)
  - 1 personality (default bot)
  - 3 context packs (schema, router guide, scheduler guide)
  - 1 API token (admin)
`);
}

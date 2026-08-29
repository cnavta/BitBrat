/**
 * Sprint 27: Migration Script - Replace Resolved MCP Tokens with Variable References
 *
 * Security fix: This script updates service_registry entries to replace resolved
 * MCP_AUTH_TOKEN values with variable references (${MCP_AUTH_TOKEN}).
 *
 * IMPORTANT: Run this AFTER deploying the base-server.ts fix to prevent tokens
 * from being re-resolved on next registration.
 *
 * Usage:
 *   npx ts-node planning/sprint-27-6tp11t/migrate-mcp-tokens.ts --context=staging [--live]
 */

import { createDocumentStore } from '../../src/common/resources/document-store-manager';
import { getConfig } from '../../src/common/config';

interface ServiceRegistryEntry {
  name: string;
  env?: {
    Authorization?: string;
  };
  [key: string]: any;
}

async function migrateTokens(context: string, dryRun: boolean = true) {
  console.log(`\n=== MCP Token Migration (${context}) ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will modify DB)'}\n`);

  // Initialize document store
  const config = await getConfig();
  const store = createDocumentStore(config);
  await store.connect();

  try {
    // Get all service registry entries
    const collection = 'service_registry';
    const entries = await store.listAll<ServiceRegistryEntry>(collection);

    console.log(`Found ${entries.length} service registry entries\n`);

    let migrated = 0;
    let skipped = 0;

    for (const entry of entries) {
      const { name, env } = entry;

      // Check if entry has Authorization header with Bearer token
      if (!env?.Authorization || !env.Authorization.startsWith('Bearer ')) {
        skipped++;
        continue;
      }

      const authHeader = env.Authorization;

      // Check if already a variable reference
      if (authHeader === 'Bearer ${MCP_AUTH_TOKEN}') {
        console.log(`  ✓ ${name}: Already using variable reference`);
        skipped++;
        continue;
      }

      // Found a resolved token - needs migration
      const tokenValue = authHeader.substring(7); // Remove "Bearer "
      console.log(`  🔒 ${name}: Found resolved token (${tokenValue.substring(0, 8)}...)`);

      if (!dryRun) {
        // Update to variable reference
        const updated = {
          ...entry,
          env: {
            ...env,
            Authorization: 'Bearer ${MCP_AUTH_TOKEN}'
          }
        };

        await store.set(collection, name, updated);
        console.log(`     ✅ Updated to variable reference`);
      } else {
        console.log(`     [DRY RUN] Would update to: Bearer \${MCP_AUTH_TOKEN}`);
      }

      migrated++;
    }

    console.log(`\n=== Migration Summary ===`);
    console.log(`Total entries: ${entries.length}`);
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped: ${skipped}`);

    if (dryRun && migrated > 0) {
      console.log(`\n⚠️  This was a DRY RUN. Run again with --live to apply changes.`);
    } else if (migrated > 0) {
      console.log(`\n✅ Migration complete! ${migrated} entries updated.`);
    } else {
      console.log(`\n✓ No migration needed - all entries already use variable references.`);
    }

  } finally {
    await store.disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const contextArg = args.find(arg => arg.startsWith('--context='));
const dryRun = !args.includes('--live');

if (!contextArg) {
  console.error('Error: --context=<context> required');
  console.error('Usage: npx ts-node planning/sprint-27-6tp11t/migrate-mcp-tokens.ts --context=staging [--live]');
  process.exit(1);
}

const context = contextArg.split('=')[1];

// Set context env var for config loading
process.env.BITBRAT_CONTEXT = context;

// Run migration
migrateTokens(context, dryRun)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

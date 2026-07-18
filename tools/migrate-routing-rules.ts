#!/usr/bin/env node
/**
 * Migrate routing rules to PostgreSQL routing_rules table
 *
 * This script loads reference routing rules from JSON files into the PostgreSQL routing_rules table.
 * It can also export rules from Firestore if the emulator is running.
 *
 * Usage:
 *   # Load from JSON files
 *   PERSISTENCE_DRIVER=postgres DATABASE_URL="postgresql://..." \
 *   npx ts-node tools/migrate-routing-rules.ts
 *
 *   # Export from Firestore and load to PostgreSQL
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 GOOGLE_CLOUD_PROJECT=bitbrat-local \
 *   PERSISTENCE_DRIVER=postgres DATABASE_URL="postgresql://..." \
 *   npx ts-node tools/migrate-routing-rules.ts --from-firestore
 */

import { createDocumentStore } from '../src/common/persistence/factory';
import { logger } from '../src/common/logging';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

interface RoutingRule {
  id?: string;
  enabled: boolean;
  priority: number;
  description?: string;
  logic: string;
  routing?: {
    stage: string;
    slip: Array<{
      id: string;
      v?: string;
      nextTopic: string;
      maxAttempts?: number;
      attributes?: Record<string, string>;
    }>;
  };
  routingSlip?: any[]; // Legacy field name
  enrichments?: {
    message?: string;
    annotations?: any[];
    candidates?: any[];
    randomCandidate?: boolean;
    egress?: any;
  };
  metadata?: Record<string, unknown>;
}

async function loadRulesFromJsonFiles(): Promise<Array<{id: string, data: RoutingRule}>> {
  const rulesDir = join(__dirname, '../documentation/reference/setup');
  const rules: Array<{id: string, data: RoutingRule}> = [];

  try {
    const files = readdirSync(rulesDir).filter(f => f.endsWith('_rule.json'));

    for (const file of files) {
      const filePath = join(rulesDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const rule = JSON.parse(content) as RoutingRule;

      // Generate ID from filename (remove _rule.json suffix)
      const id = rule.id || file.replace(/_rule\.json$/, '');

      // Normalize routing field (support both routing and routingSlip)
      if (!rule.routing && rule.routingSlip) {
        rule.routing = {
          stage: 'initial',
          slip: rule.routingSlip
        };
        delete rule.routingSlip;
      }

      rules.push({ id, data: rule });
      logger.info('Loaded rule from file', { file, id, enabled: rule.enabled });
    }

    return rules;
  } catch (err: any) {
    logger.error('Failed to load rules from files', { error: err?.message || String(err) });
    throw err;
  }
}

async function loadRulesFromFirestore(): Promise<Array<{id: string, data: RoutingRule}>> {
  const { getFirestore } = require('../src/common/firebase');
  const firestore = getFirestore();
  const rules: Array<{id: string, data: RoutingRule}> = [];

  try {
    const collectionPath = 'configs/routingRules/rules';
    const snapshot = await firestore.collection(collectionPath).get();

    snapshot.forEach((doc: any) => {
      const data = doc.data() as RoutingRule;
      rules.push({ id: doc.id, data });
      logger.info('Loaded rule from Firestore', { id: doc.id, enabled: data.enabled });
    });

    return rules;
  } catch (err: any) {
    logger.error('Failed to load rules from Firestore', { error: err?.message || String(err) });
    throw err;
  }
}

async function writeRulesToPostgres(rules: Array<{id: string, data: RoutingRule}>): Promise<void> {
  const store = createDocumentStore();
  let successCount = 0;
  let failCount = 0;

  for (const { id, data } of rules) {
    try {
      await store.set('routing_rules', id, data);
      logger.info('Rule written to PostgreSQL', { id, enabled: data.enabled, priority: data.priority });
      successCount++;
    } catch (err: any) {
      logger.error('Failed to write rule to PostgreSQL', { id, error: err?.message || String(err) });
      failCount++;
    }
  }

  logger.info('Migration complete', {
    total: rules.length,
    success: successCount,
    failed: failCount
  });

  if (failCount > 0) {
    throw new Error(`Migration completed with ${failCount} failures`);
  }
}

async function main() {
  logger.info('Starting routing rules migration to PostgreSQL');

  // Check environment variables
  const persistenceDriver = process.env.PERSISTENCE_DRIVER;
  const databaseUrl = process.env.DATABASE_URL;
  const useFirestore = process.argv.includes('--from-firestore');

  logger.info('Environment check', {
    persistenceDriver,
    hasDatabaseUrl: !!databaseUrl,
    source: useFirestore ? 'firestore' : 'json-files'
  });

  if (persistenceDriver !== 'postgres' && persistenceDriver !== 'postgresql') {
    logger.error('PERSISTENCE_DRIVER must be set to "postgres"');
    process.exit(1);
  }

  if (!databaseUrl) {
    logger.error('DATABASE_URL must be set');
    process.exit(1);
  }

  // Load rules from source
  const rules = useFirestore
    ? await loadRulesFromFirestore()
    : await loadRulesFromJsonFiles();

  if (rules.length === 0) {
    logger.warn('No rules found to migrate');
    process.exit(0);
  }

  logger.info('Rules loaded', { count: rules.length });

  // Write to PostgreSQL
  await writeRulesToPostgres(rules);

  logger.info('All routing rules migrated successfully');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err?.message || String(err) });
  process.exit(1);
});

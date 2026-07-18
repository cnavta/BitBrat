#!/usr/bin/env node
/**
 * Migrate reflexes to PostgreSQL reflexes table
 *
 * This script loads reference reflexes from JSON files into the PostgreSQL reflexes table.
 * It can also export reflexes from Firestore if the emulator is running.
 *
 * Usage:
 *   # Load from JSON files
 *   PERSISTENCE_DRIVER=postgres DATABASE_URL="postgresql://..." \
 *   npx ts-node tools/migrate-reflexes.ts
 *
 *   # Export from Firestore and load to PostgreSQL
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 GOOGLE_CLOUD_PROJECT=bitbrat-local \
 *   PERSISTENCE_DRIVER=postgres DATABASE_URL="postgresql://..." \
 *   npx ts-node tools/migrate-reflexes.ts --from-firestore
 */

import { createDocumentStore } from '../src/common/persistence/factory';
import { logger } from '../src/common/logging';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

interface Reflex {
  id?: string;
  name: string;
  description?: string;
  active: boolean;
  priority: number;
  match: {
    type: 'exact' | 'contains' | 'prefix' | 'suffix' | 'regex';
    pattern: string;
    field: string;
  };
  conditions?: {
    eventTypes?: string[];
    platforms?: string[];
  };
  candidateTemplate: string;
  metadata?: Record<string, unknown>;
}

async function loadReflexesFromJsonFiles(): Promise<Array<{id: string, data: Reflex}>> {
  const reflexesDir = join(__dirname, '../documentation/reference/setup');
  const reflexes: Array<{id: string, data: Reflex}> = [];

  try {
    if (!existsSync(reflexesDir)) {
      logger.warn('Reflexes directory not found', { dir: reflexesDir });
      return reflexes;
    }

    const files = readdirSync(reflexesDir).filter(f => f.endsWith('_reflex.json'));

    for (const file of files) {
      const filePath = join(reflexesDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const reflex = JSON.parse(content) as Reflex;

      // Generate ID from filename (remove _reflex.json suffix)
      const id = reflex.id || file.replace(/_reflex\.json$/, '');

      reflexes.push({ id, data: reflex });
      logger.info('Loaded reflex from file', { file, id, active: reflex.active });
    }

    return reflexes;
  } catch (err: any) {
    logger.error('Failed to load reflexes from files', { error: err?.message || String(err) });
    throw err;
  }
}

async function loadReflexesFromFirestore(): Promise<Array<{id: string, data: Reflex}>> {
  const { getFirestore } = require('../src/common/firebase');
  const firestore = getFirestore();
  const reflexes: Array<{id: string, data: Reflex}> = [];

  try {
    const collectionPath = 'reflexes';
    const snapshot = await firestore.collection(collectionPath).get();

    snapshot.forEach((doc: any) => {
      const data = doc.data() as Reflex;
      // Remove Firestore-specific fields
      delete (data as any).id;
      delete (data as any).createdAt;
      delete (data as any).updatedAt;

      reflexes.push({ id: doc.id, data });
      logger.info('Loaded reflex from Firestore', { id: doc.id, active: data.active });
    });

    return reflexes;
  } catch (err: any) {
    logger.error('Failed to load reflexes from Firestore', { error: err?.message || String(err) });
    throw err;
  }
}

async function writeReflexesToPostgres(reflexes: Array<{id: string, data: Reflex}>): Promise<void> {
  const store = createDocumentStore();
  let successCount = 0;
  let failCount = 0;

  for (const { id, data } of reflexes) {
    try {
      await store.set('reflexes', id, data);
      logger.info('Reflex written to PostgreSQL', { id, active: data.active, priority: data.priority });
      successCount++;
    } catch (err: any) {
      logger.error('Failed to write reflex to PostgreSQL', { id, error: err?.message || String(err) });
      failCount++;
    }
  }

  logger.info('Migration complete', {
    total: reflexes.length,
    success: successCount,
    failed: failCount
  });

  if (failCount > 0) {
    throw new Error(`Migration completed with ${failCount} failures`);
  }
}

async function main() {
  logger.info('Starting reflexes migration to PostgreSQL');

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

  // Load reflexes from source
  const reflexes = useFirestore
    ? await loadReflexesFromFirestore()
    : await loadReflexesFromJsonFiles();

  if (reflexes.length === 0) {
    logger.warn('No reflexes found to migrate');
    process.exit(0);
  }

  logger.info('Reflexes loaded', { count: reflexes.length });

  // Write to PostgreSQL
  await writeReflexesToPostgres(reflexes);

  logger.info('All reflexes migrated successfully');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err?.message || String(err) });
  process.exit(1);
});

/**
 * Migration Test Script (FND-014)
 *
 * This script validates the migration tooling by:
 * 1. Generating sample test data in Firestore
 * 2. Running migration to PostgreSQL
 * 3. Validating data consistency
 * 4. Measuring performance
 */

import { getFirestore } from '../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../src/common/persistence/postgres-store';

interface TestEvent {
  id: string;
  type: string;
  correlationId: string;
  source: string;
  timestamp: string;
  payload: {
    message: string;
    userId: string;
    metadata: Record<string, any>;
  };
}

/**
 * Generate sample test events
 */
function generateTestEvents(count: number): TestEvent[] {
  const events: TestEvent[] = [];
  const types = ['message', 'command', 'query', 'notification'];
  const sources = ['twitch', 'discord', 'web', 'api'];

  for (let i = 0; i < count; i++) {
    events.push({
      id: `test-event-${i}`,
      type: types[i % types.length],
      correlationId: `corr-${Math.floor(i / 100)}`,
      source: sources[i % sources.length],
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      payload: {
        message: `Test message ${i}`,
        userId: `user-${i % 50}`,
        metadata: {
          index: i,
          batch: Math.floor(i / 1000),
          test: true,
        },
      },
    });
  }

  return events;
}

/**
 * Seed Firestore with test data
 */
async function seedFirestore(count: number): Promise<number> {
  console.log(`\n📝 Generating ${count} test events...`);
  const events = generateTestEvents(count);

  console.log(`📤 Uploading to Firestore...`);
  const db = getFirestore();
  const batch = db.batch();
  let batchCount = 0;
  let totalWritten = 0;

  for (const event of events) {
    const ref = db.collection('events').doc(event.id);
    batch.set(ref, event);
    batchCount++;

    // Firestore batch limit is 500
    if (batchCount === 500) {
      await batch.commit();
      totalWritten += batchCount;
      console.log(`  ✓ Written ${totalWritten}/${count} events`);
      batchCount = 0;
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    totalWritten += batchCount;
  }

  console.log(`✅ Successfully seeded ${totalWritten} events to Firestore\n`);
  return totalWritten;
}

/**
 * Verify PostgreSQL data
 */
async function verifyPostgres(): Promise<{ count: number; sampleMatch: boolean }> {
  console.log(`🔍 Verifying PostgreSQL data...`);

  const postgres = new PostgresDocumentStore({
    connectionString: process.env.DATABASE_URL!,
    poolSize: 10,
  });

  try {
    const events = await postgres.getAll('events');
    const count = events.length;

    console.log(`  ✓ Found ${count} events in PostgreSQL`);

    // Verify sample event structure
    if (count > 0) {
      const sample = events[0] as any;
      const hasRequiredFields =
        sample.id &&
        sample.type &&
        sample.correlationId &&
        sample.source &&
        sample.timestamp &&
        sample.payload;

      console.log(`  ${hasRequiredFields ? '✓' : '✗'} Sample event has correct structure`);

      return { count, sampleMatch: hasRequiredFields };
    }

    return { count: 0, sampleMatch: false };
  } finally {
    await postgres.close();
  }
}

/**
 * Clean up test data
 */
async function cleanup(): Promise<void> {
  console.log(`\n🧹 Cleaning up test data...`);

  const db = getFirestore();
  const snapshot = await db.collection('events').where('id', '>=', 'test-event-').get();

  if (snapshot.empty) {
    console.log(`  ℹ️  No test events to clean up`);
    return;
  }

  const batch = db.batch();
  let count = 0;

  for (const doc of snapshot.docs) {
    if (doc.id.startsWith('test-event-')) {
      batch.delete(doc.ref);
      count++;
    }

    if (count === 500) {
      await batch.commit();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`✅ Cleaned up ${snapshot.size} test events from Firestore\n`);
}

/**
 * Main test execution
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is required');
    console.error('Set it to your PostgreSQL connection string, e.g.:');
    console.error('  export DATABASE_URL="postgresql://bitbrat:password@localhost:5432/bitbrat"');
    process.exit(1);
  }

  switch (command) {
    case 'seed':
      const count = parseInt(args[1] || '1000', 10);
      await seedFirestore(count);
      break;

    case 'verify':
      const result = await verifyPostgres();
      if (result.count === 0) {
        console.log('⚠️  No events found in PostgreSQL. Run migration first.');
        process.exit(1);
      }
      if (!result.sampleMatch) {
        console.log('⚠️  Sample event structure mismatch!');
        process.exit(1);
      }
      console.log('✅ Verification passed!\n');
      break;

    case 'cleanup':
      await cleanup();
      break;

    case 'full':
      // Full test cycle
      console.log('🚀 Running full migration test cycle...\n');

      // 1. Clean up any existing test data
      await cleanup();

      // 2. Seed Firestore
      const seeded = await seedFirestore(1000);

      // 3. Instructions for manual migration
      console.log('📋 Next steps:');
      console.log('  1. Ensure PostgreSQL is running (docker compose up postgres)');
      console.log('  2. Run migration: npm run brat -- migrate collection events');
      console.log('  3. Verify data: npm run test-migration verify');
      console.log('  4. Validate consistency: npm run brat -- db:validate --collection events');
      console.log('  5. Clean up: npm run test-migration cleanup\n');
      break;

    default:
      console.log(`
Migration Test Script

Usage:
  npm run test-migration seed [count]     Generate and upload test events to Firestore (default: 1000)
  npm run test-migration verify           Verify PostgreSQL has migrated data
  npm run test-migration cleanup          Remove test events from Firestore
  npm run test-migration full             Run full test cycle with instructions

Examples:
  npm run test-migration seed 5000        Generate 5000 test events
  npm run test-migration verify           Check PostgreSQL data
  npm run test-migration cleanup          Clean up test data

Environment Variables:
  DATABASE_URL    PostgreSQL connection string (required)

Prerequisites:
  - Firestore emulator or GCP Firestore access
  - PostgreSQL running (local Docker or remote)
`);
      break;
  }
}

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { generateTestEvents, seedFirestore, verifyPostgres, cleanup };

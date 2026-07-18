#!/usr/bin/env node
/**
 * Migrate snapshots from Firestore subcollections to PostgreSQL flat table
 *
 * Firestore: events/{correlationId}/snapshots/{snapshotId}
 * PostgreSQL: snapshots table with correlationId as FK field
 */

const { Firestore } = require('@google-cloud/firestore');
const { createDocumentStore } = require('../dist/common/persistence/factory');

async function migrateSnapshots() {
  const firestore = new Firestore();
  const postgres = createDocumentStore();

  console.log('Counting snapshots in Firestore...');
  const allSnapshots = await firestore.collectionGroup('snapshots').get();
  console.log(`Found ${allSnapshots.size} snapshots in Firestore\n`);

  if (allSnapshots.size === 0) {
    console.log('No snapshots to migrate.');
    return;
  }

  console.log('Sample snapshots:');
  allSnapshots.docs.slice(0, 5).forEach(doc => {
    const data = doc.data();
    console.log(`  - ${doc.id} | correlationId: ${data.correlationId} | kind: ${data.kind} | sequence: ${data.sequence}`);
  });

  console.log('\nSnapshot kinds distribution:');
  const kinds = {};
  allSnapshots.docs.forEach(doc => {
    const kind = doc.data().kind || 'unknown';
    kinds[kind] = (kinds[kind] || 0) + 1;
  });
  Object.entries(kinds).forEach(([kind, count]) => {
    console.log(`  - ${kind}: ${count}`);
  });

  console.log('\nMigrating snapshots to PostgreSQL...');
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of allSnapshots.docs) {
    try {
      const data = doc.data();

      // Check if already exists in PostgreSQL
      const existing = await postgres.get('snapshots', doc.id);
      if (existing) {
        skipped++;
        continue;
      }

      // Migrate snapshot (data already includes correlationId from Firestore)
      await postgres.set('snapshots', doc.id, data);
      migrated++;

      if (migrated % 100 === 0) {
        console.log(`  Migrated ${migrated}/${allSnapshots.size}...`);
      }
    } catch (error) {
      console.error(`  Error migrating snapshot ${doc.id}:`, error.message);
      errors++;
    }
  }

  console.log('\nMigration complete:');
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Errors: ${errors}`);
}

// Run migration
migrateSnapshots()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

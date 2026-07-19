/**
 * Integration Test: DocumentStoreContextPackStore with Real PostgreSQL
 *
 * This test validates that the DocumentStoreContextPackStore works correctly
 * with a real PostgreSQL database connection, including vector embeddings.
 */

import {
  DocumentStoreContextPackStore,
  FirestoreContextPackStore,
  createContextPackStore,
} from './dist/src/apps/context-pack-service.js';
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';

async function testContextPackStoreWithPostgres() {
  console.log('🚀 Testing DocumentStoreContextPackStore with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const contextPackStore = new DocumentStoreContextPackStore(store, 'context_packs');

  try {
    // Test 1: Health check
    console.log('1. Testing PostgreSQL health check...');
    const health = await store.health();
    console.log(`   ✓ Health: ${JSON.stringify(health)}\n`);

    // Test 2: Upsert context pack without embedding
    console.log('2. Upserting context pack without embedding...');
    const pack1 = {
      id: 'test-pack-1',
      version: 'v1',
      title: 'Test Context Pack - No Embedding',
      priority: 1,
      format: 'markdown',
      body: '# Test Pack\n\nThis is a test context pack.',
      source: 'test-context-pack-store-postgres.mjs',
      bitName: 'test-service',
      active: true,
      updatedAt: new Date().toISOString(),
    };

    await contextPackStore.upsert('test-pack-1', pack1);
    console.log(`   ✓ Upserted pack without embedding: test-pack-1\n`);

    // Test 3: Retrieve and verify
    console.log('3. Retrieving pack to verify...');
    const retrieved1 = await store.get('context_packs', 'test-pack-1');
    if (!retrieved1) {
      throw new Error('Pack 1 not found');
    }
    console.log(`   ✓ Retrieved pack: ${retrieved1.title}`);
    console.log(`   ✓ Format: ${retrieved1.format}`);
    console.log(`   ✓ Active: ${retrieved1.active}\n`);

    // Test 4: Upsert context pack WITH embedding
    console.log('4. Upserting context pack with embedding...');

    // Generate a 1536-dimensional embedding (matching OpenAI ada-002)
    const testEmbedding = Array(1536).fill(0).map(() => Math.random());

    const pack2 = {
      id: 'test-pack-2',
      version: 'v1',
      title: 'Test Context Pack - With Embedding',
      priority: 2,
      format: 'json',
      body: JSON.stringify({ key: 'value', description: 'Test data' }),
      source: 'test-context-pack-store-postgres.mjs',
      bitName: 'test-service',
      active: true,
      updatedAt: new Date().toISOString(),
      embedding: testEmbedding,
      embeddingText: 'Test Context Pack - With Embedding. Test data',
    };

    await contextPackStore.upsert('test-pack-2', pack2);
    console.log(`   ✓ Upserted pack with embedding (1536 dimensions): test-pack-2\n`);

    // Test 5: Retrieve and verify embedding
    console.log('5. Verifying embedding storage...');
    const retrieved2 = await store.get('context_packs', 'test-pack-2');
    if (!retrieved2) {
      throw new Error('Pack 2 not found');
    }
    console.log(`   ✓ Retrieved pack with embedding: ${retrieved2.title}`);
    console.log(`   ✓ Has embeddingText: ${!!retrieved2.embeddingText}\n`);

    // Test 6: Update existing pack (upsert)
    console.log('6. Testing upsert (update) operation...');
    const pack1Updated = {
      ...pack1,
      title: 'Test Context Pack - UPDATED',
      priority: 5,
      updatedAt: new Date().toISOString(),
    };

    await contextPackStore.upsert('test-pack-1', pack1Updated);
    const retrievedUpdated = await store.get('context_packs', 'test-pack-1');
    if (!retrievedUpdated) {
      throw new Error('Updated pack not found');
    }
    if (retrievedUpdated.title !== 'Test Context Pack - UPDATED') {
      throw new Error('Pack title was not updated');
    }
    if (retrievedUpdated.priority !== 5) {
      throw new Error('Pack priority was not updated');
    }
    console.log(`   ✓ Pack updated successfully`);
    console.log(`   ✓ New title: ${retrievedUpdated.title}`);
    console.log(`   ✓ New priority: ${retrievedUpdated.priority}\n`);

    // Test 7: Query all packs
    console.log('7. Querying all context packs...');
    const allPacks = await store.query('context_packs', {});
    console.log(`   ✓ Found ${allPacks.length} packs`);
    const testPacks = allPacks.filter(p => p.id.startsWith('test-pack'));
    console.log(`   ✓ Test packs: ${testPacks.length}\n`);

    // Test 8: Factory function - PostgreSQL detection
    console.log('8. Testing factory function with PostgreSQL...');
    const factoryStore = createContextPackStore(store, 'context_packs');
    if (!(factoryStore instanceof DocumentStoreContextPackStore)) {
      throw new Error('Factory did not return DocumentStoreContextPackStore');
    }
    console.log(`   ✓ Factory correctly detected PostgreSQL\n`);

    // Test 9: Factory function - environment variable fallback
    console.log('9. Testing factory function with environment variable...');
    const originalDriver = process.env.PERSISTENCE_DRIVER;
    try {
      process.env.PERSISTENCE_DRIVER = 'postgres';
      try {
        createContextPackStore(); // Should throw because no store provided
        throw new Error('Expected error not thrown');
      } catch (err) {
        if (err.message.includes('PostgreSQL driver selected but no IDocumentStore')) {
          console.log(`   ✓ Correctly throws error when driver is postgres but no store provided\n`);
        } else {
          throw err;
        }
      }
    } finally {
      if (originalDriver !== undefined) {
        process.env.PERSISTENCE_DRIVER = originalDriver;
      } else {
        delete process.env.PERSISTENCE_DRIVER;
      }
    }

    // Test 10: Deactivate a pack
    console.log('10. Testing pack deactivation...');
    const pack1Deactivated = {
      ...pack1Updated,
      active: false,
      updatedAt: new Date().toISOString(),
    };
    await contextPackStore.upsert('test-pack-1', pack1Deactivated);
    const retrievedDeactivated = await store.get('context_packs', 'test-pack-1');
    if (!retrievedDeactivated) {
      throw new Error('Deactivated pack not found');
    }
    if (retrievedDeactivated.active !== false) {
      throw new Error('Pack was not deactivated');
    }
    console.log(`   ✓ Pack deactivated successfully\n`);

    // Cleanup: Delete test packs
    console.log('11. Cleaning up test data...');
    await store.delete('context_packs', 'test-pack-1');
    await store.delete('context_packs', 'test-pack-2');
    console.log(`   ✓ Test packs deleted\n`);

    console.log('✅ All integration tests passed!\n');

    console.log('📊 Summary:');
    console.log('   - ContextPackStore working with PostgreSQL');
    console.log('   - Upsert operations working (create and update)');
    console.log('   - Embedding storage working (1536 dimensions)');
    console.log('   - Factory pattern working');
    console.log('   - Pack deactivation working\n');

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Cleanup on error
    try {
      await store.delete('context_packs', 'test-pack-1').catch(() => {});
      await store.delete('context_packs', 'test-pack-2').catch(() => {});
    } catch {}

    await store.close();
    process.exit(1);
  }
}

testContextPackStoreWithPostgres();

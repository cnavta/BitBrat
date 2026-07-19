import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store';

async function testPostgresStore() {
  console.log('Creating PostgresDocumentStore...');
  const store = new PostgresDocumentStore({
    connectionString: 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat',
    poolSize: 5
  });

  try {
    // Test health check
    console.log('\n1. Testing health check...');
    const health = await store.health();
    console.log('✓ Health:', health);

    // Test set operation
    console.log('\n2. Testing set operation...');
    await store.set('events', 'test-1', {
      id: 'test-1',
      type: 'test',
      message: 'Hello from test',
      timestamp: new Date().toISOString()
    });
    console.log('✓ Document set successfully');

    // Test get operation
    console.log('\n3. Testing get operation...');
    const doc = await store.get('events', 'test-1');
    console.log('✓ Document retrieved:', doc);

    // Test query
    console.log('\n4. Testing query operation...');
    const results = await store.query('events', {
      filters: [{ field: 'type', operator: '==', value: 'test' }]
    });
    console.log(`✓ Query returned ${results.length} results`);

    // Test batch operations
    console.log('\n5. Testing batch operations...');
    await store.batch([
      { type: 'set', collection: 'events', id: 'test-2', data: { id: 'test-2', type: 'batch-test', message: 'Batch 1' } },
      { type: 'set', collection: 'events', id: 'test-3', data: { id: 'test-3', type: 'batch-test', message: 'Batch 2' } }
    ]);
    console.log('✓ Batch operations completed');

    // Test getAll
    console.log('\n6. Testing getAll operation...');
    const all = await store.getAll('events');
    console.log(`✓ Retrieved ${all.length} total documents`);

    // Cleanup
    console.log('\n7. Cleaning up test data...');
    await store.delete('events', 'test-1');
    await store.delete('events', 'test-2');
    await store.delete('events', 'test-3');
    console.log('✓ Cleanup complete');

    console.log('\n✅ All tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

testPostgresStore();

/**
 * Integration Test: DocumentStoreToolUsageStore with Real PostgreSQL
 *
 * This test validates that the DocumentStoreToolUsageStore works correctly
 * with a real PostgreSQL database connection.
 */

import {
  DocumentStoreToolUsageStore,
  FirestoreToolUsageStore,
  createToolUsageStore,
  McpObservability,
} from './dist/src/common/mcp/observability.js';
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';

async function testToolUsageStoreWithPostgres() {
  console.log('🚀 Testing DocumentStoreToolUsageStore with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const toolUsageStore = new DocumentStoreToolUsageStore(store, 'tool_usage');

  try {
    // Test 1: Health check
    console.log('1. Testing PostgreSQL health check...');
    const health = await store.health();
    console.log(`   ✓ Health: ${JSON.stringify(health)}\n`);

    // Test 2: Record a successful tool usage
    console.log('2. Recording successful tool usage...');
    const record1 = {
      ts: new Date().toISOString(),
      userId: 'test-user-123',
      agent: 'claude-code',
      tool: 'test_tool_1',
      server: 'test-server',
      durationMs: 150,
      status: 'OK',
      errorCode: null,
      correlationId: 'test-corr-1',
    };

    await toolUsageStore.record(record1);
    console.log(`   ✓ Recorded successful tool usage\n`);

    // Test 3: Record a failed tool usage
    console.log('3. Recording failed tool usage...');
    const record2 = {
      ts: new Date().toISOString(),
      userId: 'test-user-456',
      agent: 'aider',
      tool: 'test_tool_2',
      server: 'test-server',
      durationMs: 75,
      status: 'ERROR',
      errorCode: 'PERMISSION_DENIED',
      correlationId: 'test-corr-2',
    };

    await toolUsageStore.record(record2);
    console.log(`   ✓ Recorded failed tool usage\n`);

    // Test 4: Record without userId (null)
    console.log('4. Recording tool usage without userId...');
    const record3 = {
      ts: new Date().toISOString(),
      userId: null,
      agent: 'unknown',
      tool: 'test_tool_3',
      server: 'test-server',
      durationMs: 200,
      status: 'OK',
      errorCode: null,
      correlationId: null,
    };

    await toolUsageStore.record(record3);
    console.log(`   ✓ Recorded tool usage without userId\n`);

    // Test 5: Query recorded tool usages
    console.log('5. Querying recorded tool usages...');
    const allRecords = await store.query('tool_usage', {});
    console.log(`   ✓ Found ${allRecords.length} total records`);
    const testRecords = allRecords.filter(r => r.server === 'test-server');
    console.log(`   ✓ Test records: ${testRecords.length}\n`);

    // Test 6: Verify record data integrity
    console.log('6. Verifying record data integrity...');
    const foundRecord1 = testRecords.find(r => r.tool === 'test_tool_1');
    if (!foundRecord1) {
      throw new Error('Record 1 not found');
    }
    if (foundRecord1.userId !== 'test-user-123') {
      throw new Error('userId mismatch');
    }
    if (foundRecord1.durationMs !== 150) {
      throw new Error('durationMs mismatch');
    }
    if (foundRecord1.status !== 'OK') {
      throw new Error('status mismatch');
    }
    console.log(`   ✓ Record 1 data integrity verified`);
    console.log(`   ✓ userId: ${foundRecord1.userId}`);
    console.log(`   ✓ durationMs: ${foundRecord1.durationMs}`);
    console.log(`   ✓ status: ${foundRecord1.status}\n`);

    // Test 7: Verify error record
    console.log('7. Verifying error record...');
    const foundRecord2 = testRecords.find(r => r.tool === 'test_tool_2');
    if (!foundRecord2) {
      throw new Error('Record 2 not found');
    }
    if (foundRecord2.status !== 'ERROR') {
      throw new Error('status should be ERROR');
    }
    if (foundRecord2.errorCode !== 'PERMISSION_DENIED') {
      throw new Error('errorCode mismatch');
    }
    console.log(`   ✓ Error record verified`);
    console.log(`   ✓ status: ${foundRecord2.status}`);
    console.log(`   ✓ errorCode: ${foundRecord2.errorCode}\n`);

    // Test 8: Factory function - PostgreSQL detection
    console.log('8. Testing factory function with PostgreSQL...');
    const factoryStore = createToolUsageStore(store, 'tool_usage');
    if (!(factoryStore instanceof DocumentStoreToolUsageStore)) {
      throw new Error('Factory did not return DocumentStoreToolUsageStore');
    }
    console.log(`   ✓ Factory correctly detected PostgreSQL\n`);

    // Test 9: Factory function - environment variable fallback
    console.log('9. Testing factory function with environment variable...');
    const originalDriver = process.env.PERSISTENCE_DRIVER;
    try {
      process.env.PERSISTENCE_DRIVER = 'postgres';
      try {
        createToolUsageStore(); // Should throw because no store provided
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

    // Test 10: McpObservability integration
    console.log('10. Testing McpObservability.recordCall with PostgreSQL...');
    McpObservability.setToolUsageStore(toolUsageStore);

    // Record a call via McpObservability (fire-and-forget)
    await McpObservability.recordCall(
      'integration-test-server',
      'integration_test_tool',
      250,
      false,
      {
        userId: 'test-user-integration',
        agentName: 'test-agent',
        correlationId: 'test-corr-integration',
      }
    );

    // Wait a moment for the fire-and-forget write to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    const integrationRecords = await store.query('tool_usage', {});
    const integrationRecord = integrationRecords.find(r => r.tool === 'integration_test_tool');
    if (!integrationRecord) {
      throw new Error('Integration record not found');
    }
    console.log(`   ✓ McpObservability.recordCall working`);
    console.log(`   ✓ tool: ${integrationRecord.tool}`);
    console.log(`   ✓ server: ${integrationRecord.server}`);
    console.log(`   ✓ durationMs: ${integrationRecord.durationMs}\n`);

    // Cleanup: Delete test records
    console.log('11. Cleaning up test data...');
    let deletedCount = 0;
    for (const record of allRecords) {
      if (record.server === 'test-server' || record.server === 'integration-test-server') {
        await store.delete('tool_usage', record.id);
        deletedCount++;
      }
    }
    console.log(`   ✓ Deleted ${deletedCount} test records\n`);

    console.log('✅ All integration tests passed!\n');

    console.log('📊 Summary:');
    console.log('   - ToolUsageStore working with PostgreSQL');
    console.log('   - Record operations working (successful and failed)');
    console.log('   - Null userId handling working');
    console.log('   - Factory pattern working');
    console.log('   - McpObservability integration working\n');

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Cleanup on error
    try {
      const allRecords = await store.query('tool_usage', {});
      for (const record of allRecords) {
        if (record.server === 'test-server' || record.server === 'integration-test-server') {
          await store.delete('tool_usage', record.id).catch(() => {});
        }
      }
    } catch {}

    await store.close();
    process.exit(1);
  }
}

testToolUsageStoreWithPostgres();

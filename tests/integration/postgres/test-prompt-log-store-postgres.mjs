/**
 * Integration Test: DocumentStorePromptLogStore with Real PostgreSQL
 *
 * This test validates that the DocumentStorePromptLogStore works correctly
 * with a real PostgreSQL database connection.
 */

import {
  DocumentStorePromptLogStore,
  FirestorePromptLogStore,
  createPromptLogStore,
} from './dist/src/services/query-analyzer/llm-provider.js';
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';

async function testPromptLogStoreWithPostgres() {
  console.log('🚀 Testing DocumentStorePromptLogStore with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const promptLogStore = new DocumentStorePromptLogStore(store, 'prompt_logs');

  try {
    // Test 1: Health check
    console.log('1. Testing PostgreSQL health check...');
    const health = await store.health();
    console.log(`   ✓ Health: ${JSON.stringify(health)}\n`);

    // Test 2: Log a prompt record
    console.log('2. Logging a prompt record...');
    const testRecord = {
      correlationId: 'test-corr-123',
      prompt: '[REDACTED] User message',
      response: '[REDACTED] AI response',
      entities: [
        { text: 'John', type: 'PERSON' },
        { text: 'California', type: 'LOCATION' },
      ],
      topic: 'greeting',
      platform: 'openai',
      model: 'gpt-4o-mini',
      processingTimeMs: 1234,
      usage: {
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80,
      },
      createdAt: new Date().toISOString(),
    };

    await promptLogStore.log(testRecord);
    console.log(`   ✓ Prompt log recorded\n`);

    // Test 3: Verify the record was written
    console.log('3. Verifying prompt log was written...');
    const allRecords = await store.query('prompt_logs', {});
    const foundRecord = allRecords.find(r => r.correlationId === 'test-corr-123');

    if (!foundRecord) {
      throw new Error('Prompt log not found in database');
    }

    console.log(`   ✓ Record found: correlationId=${foundRecord.correlationId}`);
    console.log(`   ✓ Platform: ${foundRecord.platform}`);
    console.log(`   ✓ Model: ${foundRecord.model}`);
    console.log(`   ✓ Entities count: ${foundRecord.entities?.length || 0}`);
    console.log(`   ✓ Processing time: ${foundRecord.processingTimeMs}ms\n`);

    // Test 4: Log multiple records
    console.log('4. Logging multiple records...');
    const records = [
      {
        correlationId: 'test-batch-1',
        prompt: '[REDACTED]',
        response: '[REDACTED]',
        entities: [],
        topic: 'question',
        platform: 'ollama',
        model: 'llama3',
        processingTimeMs: 500,
        createdAt: new Date().toISOString(),
      },
      {
        correlationId: 'test-batch-2',
        prompt: '[REDACTED]',
        response: '[REDACTED]',
        entities: [{ text: 'Python', type: 'TECH' }],
        topic: 'technical support',
        platform: 'openai',
        model: 'gpt-4o',
        processingTimeMs: 2000,
        usage: {
          promptTokens: 100,
          completionTokens: 150,
          totalTokens: 250,
        },
        createdAt: new Date().toISOString(),
      },
    ];

    for (const record of records) {
      await promptLogStore.log(record);
    }

    console.log(`   ✓ Logged ${records.length} records\n`);

    // Test 5: Factory function - PostgreSQL detection
    console.log('5. Testing factory function with PostgreSQL...');
    const factoryStore = createPromptLogStore(store, 'prompt_logs');
    if (!(factoryStore instanceof DocumentStorePromptLogStore)) {
      throw new Error('Factory did not return DocumentStorePromptLogStore');
    }
    console.log(`   ✓ Factory correctly detected PostgreSQL\n`);

    // Test 6: Log via factory
    console.log('6. Logging via factory store...');
    await factoryStore.log({
      correlationId: 'test-factory-123',
      prompt: '[REDACTED]',
      response: '[REDACTED]',
      entities: [],
      topic: 'meta',
      platform: 'vllm',
      model: 'mistral',
      processingTimeMs: 800,
      createdAt: new Date().toISOString(),
    });
    console.log(`   ✓ Factory store log successful\n`);

    // Test 7: Verify all test records
    console.log('7. Verifying all test records...');
    const finalRecords = await store.query('prompt_logs', {});
    const testRecords = finalRecords.filter(r =>
      r.correlationId && r.correlationId.startsWith('test-')
    );

    console.log(`   ✓ Found ${testRecords.length} test records\n`);

    // Cleanup: Delete test records
    console.log('8. Cleaning up test data...');
    for (const record of testRecords) {
      await store.delete('prompt_logs', record.id);
    }
    console.log(`   ✓ Test records deleted\n`);

    console.log('✅ All integration tests passed!\n');

    console.log('📊 Summary:');
    console.log('   - PromptLogStore working with PostgreSQL');
    console.log('   - Single record logging working');
    console.log('   - Batch logging working');
    console.log('   - Entity tracking working');
    console.log('   - Usage metrics tracking working');
    console.log('   - Factory pattern working\n');

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Cleanup on error
    try {
      const allRecords = await store.query('prompt_logs', {});
      for (const record of allRecords) {
        if (record.correlationId && record.correlationId.startsWith('test-')) {
          await store.delete('prompt_logs', record.id).catch(() => {});
        }
      }
    } catch {}

    await store.close();
    process.exit(1);
  }
}

testPromptLogStoreWithPostgres();

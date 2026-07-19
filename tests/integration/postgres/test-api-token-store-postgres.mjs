/**
 * Integration Test: DocumentStoreApiTokenStore with Real PostgreSQL
 *
 * This test validates that the DocumentStoreApiTokenStore and AuthService
 * work correctly with a real PostgreSQL database connection.
 */

import {
  DocumentStoreApiTokenStore,
  FirestoreApiTokenStore,
  createApiTokenStore,
  AuthService,
} from './dist/src/services/api-gateway/auth.js';
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';
import crypto from 'crypto';

// Mock logger for testing
const mockLogger = {
  info: () => {},
  debug: () => {},
  warn: (msg, meta) => console.log(`WARN: ${msg}`, meta),
  error: (msg, meta) => console.log(`ERROR: ${msg}`, meta),
};

async function testApiTokenStoreWithPostgres() {
  console.log('🚀 Testing DocumentStoreApiTokenStore with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const tokenStore = new DocumentStoreApiTokenStore(store, mockLogger, 'api_tokens');

  try {
    // Test 1: Health check
    console.log('1. Testing PostgreSQL health check...');
    const health = await store.health();
    console.log(`   ✓ Health: ${JSON.stringify(health)}\n`);

    // Test 2: Create and retrieve a valid token
    console.log('2. Creating and retrieving a valid token...');
    const testToken = 'test-api-token-12345';
    const tokenHash = crypto.createHash('sha256').update(testToken).digest('hex');

    // Insert token directly into store
    await store.set('api_tokens', tokenHash, {
      uid: 'test-user-123',
      token_hash: tokenHash,
      created_at: new Date().toISOString(),
      last_used_at: null,
      expires_at: null, // No expiration
    });

    const tokenInfo = await tokenStore.getToken(tokenHash);
    if (!tokenInfo) {
      throw new Error('Token not found');
    }
    console.log(`   ✓ Token retrieved: uid=${tokenInfo.uid}`);
    console.log(`   ✓ Token hash: ${tokenInfo.token_hash.substring(0, 16)}...`);
    console.log(`   ✓ Expires at: ${tokenInfo.expires_at || 'never'}\n`);

    // Test 3: Update last_used_at
    console.log('3. Testing updateLastUsed...');
    await tokenStore.updateLastUsed(tokenHash);

    // Wait a moment for the update to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const updatedToken = await tokenStore.getToken(tokenHash);
    if (!updatedToken) {
      throw new Error('Updated token not found');
    }
    if (!updatedToken.last_used_at) {
      throw new Error('last_used_at was not updated');
    }
    console.log(`   ✓ last_used_at updated: ${updatedToken.last_used_at.toISOString()}\n`);

    // Test 4: Create token with expiration (future)
    console.log('4. Creating token with future expiration...');
    const futureToken = 'test-api-token-future';
    const futureHash = crypto.createHash('sha256').update(futureToken).digest('hex');
    const futureExpiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    await store.set('api_tokens', futureHash, {
      uid: 'test-user-456',
      token_hash: futureHash,
      created_at: new Date().toISOString(),
      last_used_at: null,
      expires_at: futureExpiry,
    });

    const futureTokenInfo = await tokenStore.getToken(futureHash);
    if (!futureTokenInfo) {
      throw new Error('Future token not found');
    }
    if (!futureTokenInfo.expires_at) {
      throw new Error('expires_at not set');
    }
    console.log(`   ✓ Token with expiration created`);
    console.log(`   ✓ Expires at: ${futureTokenInfo.expires_at.toISOString()}\n`);

    // Test 5: Create token with expiration (past)
    console.log('5. Creating token with past expiration...');
    const expiredToken = 'test-api-token-expired';
    const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
    const pastExpiry = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago

    await store.set('api_tokens', expiredHash, {
      uid: 'test-user-789',
      token_hash: expiredHash,
      created_at: new Date().toISOString(),
      last_used_at: null,
      expires_at: pastExpiry,
    });

    const expiredTokenInfo = await tokenStore.getToken(expiredHash);
    if (!expiredTokenInfo) {
      throw new Error('Expired token not found');
    }
    console.log(`   ✓ Expired token retrieved (expiry check happens in AuthService)\n`);

    // Test 6: Factory function - PostgreSQL detection
    console.log('6. Testing factory function with PostgreSQL...');
    const factoryStore = createApiTokenStore(store, mockLogger, 'api_tokens');
    if (!(factoryStore instanceof DocumentStoreApiTokenStore)) {
      throw new Error('Factory did not return DocumentStoreApiTokenStore');
    }
    console.log(`   ✓ Factory correctly detected PostgreSQL\n`);

    // Test 7: AuthService integration - valid token
    console.log('7. Testing AuthService with valid token...');
    const authService = new AuthService(store, mockLogger);
    const validUid = await authService.validateToken(testToken);
    if (validUid !== 'test-user-123') {
      throw new Error(`Expected uid 'test-user-123', got '${validUid}'`);
    }
    console.log(`   ✓ AuthService validated token: uid=${validUid}\n`);

    // Test 8: AuthService integration - cache hit
    console.log('8. Testing AuthService cache...');
    const cachedUid = await authService.validateToken(testToken);
    if (cachedUid !== 'test-user-123') {
      throw new Error('Cache did not return correct uid');
    }
    console.log(`   ✓ Cache hit: uid=${cachedUid}\n`);

    // Test 9: AuthService integration - expired token
    console.log('9. Testing AuthService with expired token...');
    const expiredUid = await authService.validateToken(expiredToken);
    if (expiredUid !== null) {
      throw new Error('Expired token should return null');
    }
    console.log(`   ✓ Expired token correctly rejected\n`);

    // Test 10: AuthService integration - non-existent token
    console.log('10. Testing AuthService with non-existent token...');
    const invalidUid = await authService.validateToken('invalid-token-12345');
    if (invalidUid !== null) {
      throw new Error('Invalid token should return null');
    }
    console.log(`   ✓ Invalid token correctly rejected\n`);

    // Test 11: AuthService integration - future expiration token
    console.log('11. Testing AuthService with future expiration token...');
    const futureUid = await authService.validateToken(futureToken);
    if (futureUid !== 'test-user-456') {
      throw new Error(`Expected uid 'test-user-456', got '${futureUid}'`);
    }
    console.log(`   ✓ Future expiration token validated: uid=${futureUid}\n`);

    // Cleanup: Delete test tokens
    console.log('12. Cleaning up test data...');
    await store.delete('api_tokens', tokenHash);
    await store.delete('api_tokens', futureHash);
    await store.delete('api_tokens', expiredHash);
    console.log(`   ✓ Test tokens deleted\n`);

    console.log('✅ All integration tests passed!\n');

    console.log('📊 Summary:');
    console.log('   - ApiTokenStore working with PostgreSQL');
    console.log('   - Token retrieval working');
    console.log('   - last_used_at updates working');
    console.log('   - Expiration handling working');
    console.log('   - Factory pattern working');
    console.log('   - AuthService integration working');
    console.log('   - Cache mechanism working\n');

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Cleanup on error
    try {
      const allRecords = await store.query('api_tokens', {});
      for (const record of allRecords) {
        if (record.uid && record.uid.startsWith('test-user-')) {
          await store.delete('api_tokens', record.id).catch(() => {});
        }
      }
    } catch {}

    await store.close();
    process.exit(1);
  }
}

testApiTokenStoreWithPostgres();

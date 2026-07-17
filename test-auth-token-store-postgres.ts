/**
 * Integration Test: DocumentStoreAuthTokenStore with Real PostgreSQL
 *
 * This test validates that the DocumentStoreAuthTokenStore works correctly
 * with a real PostgreSQL database connection.
 */

import { DocumentStoreAuthTokenStore, AuthTokenDoc } from './src/services/oauth/auth-token-store';
import { PostgresDocumentStore } from './src/common/persistence/postgres-store';

async function testAuthTokenStoreWithPostgres() {
  console.log('🚀 Testing DocumentStoreAuthTokenStore with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const tokenStore = new DocumentStoreAuthTokenStore(store, 'auth_scopes');

  try {
    // Test 1: Health check
    console.log('1. Testing PostgreSQL health check...');
    const health = await store.health();
    console.log(`   ✓ Health: ${JSON.stringify(health)}\n`);

    // Test 2: Put a new token
    console.log('2. Putting test OAuth token...');
    const testToken = {
      tokenType: 'oauth' as const,
      accessToken: 'test-access-token-12345',
      refreshToken: 'test-refresh-token-67890',
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      scope: ['chat:read', 'chat:write'],
      providerUserId: 'twitch-user-123',
      metadata: {
        testRun: true,
        timestamp: new Date().toISOString()
      }
    };

    await tokenStore.putAuthToken('twitch', 'bot', testToken);
    console.log('   ✓ Token stored successfully\n');

    // Test 3: Get the token back
    console.log('3. Retrieving stored token...');
    const retrieved = await tokenStore.getAuthToken('twitch', 'bot');

    if (!retrieved) {
      throw new Error('Failed to retrieve token');
    }

    console.log(`   ✓ Retrieved token for ${retrieved.provider}:${retrieved.identity}`);
    console.log(`   ✓ Token type: ${retrieved.tokenType}`);
    console.log(`   ✓ Access token: ${retrieved.accessToken?.substring(0, 20)}...`);
    console.log(`   ✓ Refresh token: ${retrieved.refreshToken?.substring(0, 20)}...`);
    console.log(`   ✓ Scopes: ${retrieved.scope?.join(', ')}`);
    console.log(`   ✓ Provider user ID: ${retrieved.providerUserId}\n`);

    // Test 4: Verify token content
    console.log('4. Verifying token content...');
    if (retrieved.accessToken !== testToken.accessToken) {
      throw new Error('Access token mismatch');
    }
    if (retrieved.refreshToken !== testToken.refreshToken) {
      throw new Error('Refresh token mismatch');
    }
    if (retrieved.scope?.join(',') !== testToken.scope.join(',')) {
      throw new Error('Scope mismatch');
    }
    if (retrieved.providerUserId !== testToken.providerUserId) {
      throw new Error('Provider user ID mismatch');
    }
    console.log('   ✓ All token fields match\n');

    // Test 5: Update the token
    console.log('5. Updating token with new access token...');
    const updatedToken = {
      ...testToken,
      accessToken: 'updated-access-token-99999',
      metadata: {
        ...testToken.metadata,
        updated: true
      }
    };

    await tokenStore.putAuthToken('twitch', 'bot', updatedToken);
    const retrievedUpdated = await tokenStore.getAuthToken('twitch', 'bot');

    if (retrievedUpdated?.accessToken !== updatedToken.accessToken) {
      throw new Error('Token update failed');
    }
    console.log(`   ✓ Token updated successfully: ${retrievedUpdated.accessToken?.substring(0, 20)}...\n`);

    // Test 6: Test with different provider/identity
    console.log('6. Testing multiple providers...');
    const discordToken = {
      tokenType: 'oauth' as const,
      accessToken: 'discord-access-token-abcdef',
      refreshToken: 'discord-refresh-token-xyz',
      expiresAt: new Date(Date.now() + 7200000).toISOString(), // 2 hours from now
      scope: ['identify', 'guilds'],
      providerUserId: 'discord-user-456',
      metadata: { bot: false }
    };

    await tokenStore.putAuthToken('discord', 'user', discordToken);
    const retrievedDiscord = await tokenStore.getAuthToken('discord', 'user');

    if (!retrievedDiscord || retrievedDiscord.accessToken !== discordToken.accessToken) {
      throw new Error('Discord token storage failed');
    }
    console.log(`   ✓ Discord token stored: ${retrievedDiscord.provider}:${retrievedDiscord.identity}\n`);

    // Test 7: Test non-existent token
    console.log('7. Testing retrieval of non-existent token...');
    const nonExistent = await tokenStore.getAuthToken('youtube', 'broadcaster');
    if (nonExistent !== null) {
      throw new Error('Expected null for non-existent token');
    }
    console.log('   ✓ Correctly returned null for non-existent token\n');

    // Test 8: Test backward compatibility with old schema
    console.log('8. Testing backward compatibility with legacy schema...');
    // Simulate old Twitch token format (expiresIn instead of expiresAt)
    const legacyToken = {
      provider: 'twitch',
      identity: 'legacy-bot',
      tokenType: 'oauth',
      accessToken: 'legacy-access-token',
      refreshToken: 'legacy-refresh-token',
      expiresIn: 3600, // Old format: seconds instead of ISO timestamp
      obtainmentTimestamp: Date.now(),
      userId: 'legacy-user-123', // Old field name
      scope: ['chat:read']
    };

    // Manually write with old schema
    await store.set('auth_scopes', 'twitch:legacy-bot', legacyToken);

    // Read back through the store (should normalize)
    const retrievedLegacy = await tokenStore.getAuthToken('twitch', 'legacy-bot');

    if (!retrievedLegacy) {
      throw new Error('Failed to retrieve legacy token');
    }
    if (!retrievedLegacy.expiresAt) {
      throw new Error('Legacy token expiresAt not normalized');
    }
    if (retrievedLegacy.providerUserId !== 'legacy-user-123') {
      throw new Error('Legacy userId not normalized to providerUserId');
    }
    console.log(`   ✓ Legacy token normalized: expiresAt=${retrievedLegacy.expiresAt}\n`);

    // Cleanup
    console.log('9. Cleaning up test data...');
    await store.delete('auth_scopes', 'twitch:bot');
    await store.delete('auth_scopes', 'discord:user');
    await store.delete('auth_scopes', 'twitch:legacy-bot');
    console.log('   ✓ Test tokens deleted\n');

    console.log('✅ All integration tests passed!\n');

    console.log('📊 Summary:');
    console.log('   - AuthTokenStore working with PostgreSQL');
    console.log('   - Put/get operations working');
    console.log('   - Token updates working');
    console.log('   - Multiple providers working');
    console.log('   - Non-existent token handling working');
    console.log('   - Backward compatibility with legacy schema working\n');

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Cleanup on error
    try {
      await store.delete('auth_scopes', 'twitch:bot').catch(() => {});
      await store.delete('auth_scopes', 'discord:user').catch(() => {});
      await store.delete('auth_scopes', 'twitch:legacy-bot').catch(() => {});
    } catch {}

    await store.close();
    process.exit(1);
  }
}

testAuthTokenStoreWithPostgres();

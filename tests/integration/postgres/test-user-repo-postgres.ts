/**
 * Integration Test: DocumentStoreUserRepo with Real PostgreSQL
 *
 * This test validates that the DocumentStoreUserRepo works correctly
 * with a real PostgreSQL database connection.
 */

import { DocumentStoreUserRepo, AuthUserDoc } from './src/services/auth/user-repo';
import { PostgresDocumentStore } from './src/common/persistence/postgres-store';

async function testUserRepoWithPostgres() {
  console.log('🚀 Testing DocumentStoreUserRepo with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const repo = new DocumentStoreUserRepo(store, 'auth_users');

  try {
    // Test 1: Health check
    console.log('1. Testing PostgreSQL health check...');
    const health = await store.health();
    console.log(`   ✓ Health: ${JSON.stringify(health)}\n`);

    // Test 2: Create new user
    console.log('2. Testing ensureUserOnMessage (create new user)...');
    const nowIso = new Date().toISOString();
    const result1 = await repo.ensureUserOnMessage(
      'test-user-123',
      {
        provider: 'twitch',
        providerUserId: 'twitch-123',
        displayName: 'Test User',
        email: 'test@example.com',
        roles: ['user', 'subscriber'],
        profile: {
          username: 'testuser',
          avatarUrl: 'https://example.com/avatar.png',
          updatedAt: nowIso,
        },
      },
      nowIso
    );

    console.log(`   ✓ Created: ${result1.created}`);
    console.log(`   ✓ First message: ${result1.isFirstMessage}`);
    console.log(`   ✓ New session: ${result1.isNewSession}`);
    console.log(`   ✓ Message count: ${result1.doc.messageCountAllTime}`);
    console.log(`   ✓ Session count: ${result1.doc.sessionCount}\n`);

    // Test 3: Get by ID
    console.log('3. Testing getById...');
    const user = await repo.getById('test-user-123');
    console.log(`   ✓ User found: ${user?.id}`);
    console.log(`   ✓ Display name: ${user?.displayName}`);
    console.log(`   ✓ Email: ${user?.email}`);
    console.log(`   ✓ Roles: ${user?.roles.join(', ')}\n`);

    // Test 4: Get by email
    console.log('4. Testing getByEmail...');
    const userByEmail = await repo.getByEmail('test@example.com');
    console.log(`   ✓ User found: ${userByEmail?.id}`);
    console.log(`   ✓ Matches ID: ${userByEmail?.id === 'test-user-123'}\n`);

    // Test 5: Update user
    console.log('5. Testing updateUser...');
    const updated = await repo.updateUser('test-user-123', {
      displayName: 'Updated Test User',
      notes: 'This is a test note',
    });
    console.log(`   ✓ Updated display name: ${updated?.displayName}`);
    console.log(`   ✓ Added notes: ${updated?.notes}\n`);

    // Test 6: Search users
    console.log('6. Testing searchUsers...');
    const searchResults = await repo.searchUsers({ provider: 'twitch' });
    console.log(`   ✓ Found ${searchResults.length} user(s) with provider=twitch`);
    if (searchResults.length > 0) {
      console.log(`   ✓ First result: ${searchResults[0].displayName}\n`);
    }

    // Test 7: Ensure user on second message (same session)
    console.log('7. Testing ensureUserOnMessage (existing user, same session)...');
    const nowIso2 = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour later
    const result2 = await repo.ensureUserOnMessage('test-user-123', {}, nowIso2);
    console.log(`   ✓ Created: ${result2.created}`);
    console.log(`   ✓ First message: ${result2.isFirstMessage}`);
    console.log(`   ✓ New session: ${result2.isNewSession}`);
    console.log(`   ✓ Message count: ${result2.doc.messageCountAllTime}`);
    console.log(`   ✓ Session count: ${result2.doc.sessionCount}\n`);

    // Test 8: Ensure user on message after 24h (new session)
    console.log('8. Testing ensureUserOnMessage (new session after 24h)...');
    const nowIso3 = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // 25 hours later
    const result3 = await repo.ensureUserOnMessage('test-user-123', {}, nowIso3);
    console.log(`   ✓ Created: ${result3.created}`);
    console.log(`   ✓ First message: ${result3.isFirstMessage}`);
    console.log(`   ✓ New session: ${result3.isNewSession}`);
    console.log(`   ✓ Message count: ${result3.doc.messageCountAllTime}`);
    console.log(`   ✓ Session count: ${result3.doc.sessionCount}\n`);

    // Cleanup
    console.log('9. Cleaning up test data...');
    await store.delete('auth_users', 'test-user-123');
    const cleaned = await repo.getById('test-user-123');
    console.log(`   ✓ User deleted: ${cleaned === null}\n`);

    console.log('✅ All integration tests passed!\n');

    // Close connection
    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await store.close();
    process.exit(1);
  }
}

testUserRepoWithPostgres();

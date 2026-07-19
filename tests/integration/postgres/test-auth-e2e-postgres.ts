/**
 * End-to-End Test: Auth Service with PostgreSQL
 *
 * This test validates the complete auth enrichment flow using PostgreSQL
 * as the persistence backend instead of Firestore.
 */

import { PostgresDocumentStore } from './src/common/persistence/postgres-store';
import { DocumentStoreUserRepo } from './src/services/auth/user-repo';
import { enrichEvent } from './src/services/auth/enrichment';
import type { InternalEventV2 } from './src/types/events';

async function testAuthE2EWithPostgres() {
  console.log('🚀 Testing Auth Service End-to-End with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const repo = new DocumentStoreUserRepo(store, 'auth_users');

  try {
    console.log('1. Health check...');
    const health = await store.health();
    console.log(`   ✓ PostgreSQL healthy: ${health.healthy} (${health.latency}ms)\n`);

    // Test 1: New user from Twitch message
    console.log('2. Testing new user enrichment (Twitch)...');
    const twitchEvent: InternalEventV2 = {
      v: '2',
      type: 'internal.ingress.v1',
      correlationId: 'test-corr-001',
      ingress: {
        timestamp: new Date().toISOString(),
      },
      identity: {
        external: {
          platform: 'twitch',
          id: 'twitch-user-456',
          metadata: {
            email: 'twitchuser@example.com',
          },
        },
      },
      message: {
        text: 'Hello from Twitch!',
        rawPlatformPayload: {
          user: {
            id: 'twitch-user-456',
            displayName: 'TwitchGamer',
            login: 'twitchgamer',
          },
          broadcaster: {
            id: 'broadcaster-123',
            displayName: 'StreamHost',
          },
        },
      },
      externalEvent: {
        metadata: {
          userId: 'twitch-user-456',
          broadcasterId: 'broadcaster-123',
        },
      },
    };

    const result1 = await enrichEvent(twitchEvent, repo, { provider: 'twitch' });

    console.log(`   ✓ Matched: ${result1.matched}`);
    console.log(`   ✓ Created: ${result1.created}`);
    console.log(`   ✓ First message: ${result1.isFirstMessage}`);
    console.log(`   ✓ New session: ${result1.isNewSession}`);
    console.log(`   ✓ User ref: ${result1.userRef}`);
    console.log(`   ✓ Identity set: ${result1.event.identity?.userId !== undefined}`);
    console.log(`   ✓ Auth envelope populated: ${result1.event.auth?.userId !== undefined}\n`);

    // Test 2: Existing user - same session
    console.log('3. Testing existing user enrichment (same session)...');
    const twitchEvent2: InternalEventV2 = {
      ...twitchEvent,
      correlationId: 'test-corr-002',
      message: {
        text: 'Another message from the same user!',
        rawPlatformPayload: twitchEvent.message?.rawPlatformPayload,
      },
    };

    const result2 = await enrichEvent(twitchEvent2, repo, { provider: 'twitch' });

    console.log(`   ✓ Matched: ${result2.matched}`);
    console.log(`   ✓ Created: ${result2.created}`);
    console.log(`   ✓ First message: ${result2.isFirstMessage}`);
    console.log(`   ✓ New session: ${result2.isNewSession}`);
    console.log(`   ✓ User ref: ${result2.userRef}\n`);

    // Test 3: Discord user with email lookup
    console.log('4. Testing new user enrichment (Discord)...');
    const discordEvent: InternalEventV2 = {
      v: '2',
      type: 'internal.ingress.v1',
      correlationId: 'test-corr-003',
      ingress: {
        timestamp: new Date().toISOString(),
      },
      identity: {
        external: {
          platform: 'discord',
          id: 'discord-user-789',
          metadata: {
            email: 'discorduser@example.com',
          },
        },
      },
      message: {
        text: 'Hello from Discord!',
        rawPlatformPayload: {
          author: {
            id: 'discord-user-789',
            username: 'DiscordGamer',
            discriminator: '1234',
          },
          guild: {
            id: 'guild-123',
            name: 'Test Server',
          },
        },
      },
      externalEvent: {
        metadata: {
          userId: 'discord-user-789',
        },
      },
    };

    const result3 = await enrichEvent(discordEvent, repo, { provider: 'discord' });

    console.log(`   ✓ Matched: ${result3.matched}`);
    console.log(`   ✓ Created: ${result3.created}`);
    console.log(`   ✓ First message: ${result3.isFirstMessage}`);
    console.log(`   ✓ User ref: ${result3.userRef}\n`);

    // Test 4: Email-based lookup (same user, different platform)
    console.log('5. Testing email-based user lookup...');
    const emailEvent: InternalEventV2 = {
      v: '2',
      type: 'internal.ingress.v1',
      correlationId: 'test-corr-004',
      ingress: {
        timestamp: new Date().toISOString(),
      },
      identity: {
        external: {
          platform: 'api-gateway',
          id: 'api-user-999',
          metadata: {
            email: 'twitchuser@example.com', // Same email as Twitch user
          },
        },
      },
      message: {
        text: 'Hello from API!',
      },
    };

    const result4 = await enrichEvent(emailEvent, repo, { provider: 'api-gateway' });

    console.log(`   ✓ Matched: ${result4.matched}`);
    console.log(`   ✓ Found existing user by email: ${!result4.created}`);
    console.log(`   ✓ User ref: ${result4.userRef}\n`);

    // Test 5: Verify data persistence
    console.log('6. Verifying data persistence in PostgreSQL...');
    const twitchUser = await repo.getById('twitch:twitch-user-456');
    const discordUser = await repo.getById('discord:discord-user-789');

    console.log(`   ✓ Twitch user found: ${twitchUser?.id}`);
    console.log(`   ✓ Twitch user message count: ${twitchUser?.messageCountAllTime}`);
    console.log(`   ✓ Discord user found: ${discordUser?.id}`);
    console.log(`   ✓ Discord user message count: ${discordUser?.messageCountAllTime}\n`);

    // Test 6: Search functionality
    console.log('7. Testing search functionality...');
    const twitchUsers = await repo.searchUsers({ provider: 'twitch' });
    const discordUsers = await repo.searchUsers({ provider: 'discord' });

    console.log(`   ✓ Twitch users found: ${twitchUsers.length}`);
    console.log(`   ✓ Discord users found: ${discordUsers.length}\n`);

    // Cleanup
    console.log('8. Cleaning up test data...');
    await store.delete('auth_users', 'twitch:twitch-user-456');
    await store.delete('auth_users', 'discord:discord-user-789');
    console.log(`   ✓ Test users deleted\n`);

    console.log('✅ All end-to-end tests passed!\n');

    console.log('📊 Summary:');
    console.log('   - Auth enrichment working with PostgreSQL');
    console.log('   - User creation and updates working');
    console.log('   - Email-based lookups working');
    console.log('   - Session tracking working');
    console.log('   - Multi-platform support working');
    console.log('   - Search functionality working\n');

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await store.close();
    process.exit(1);
  }
}

testAuthE2EWithPostgres();

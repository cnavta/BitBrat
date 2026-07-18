#!/usr/bin/env ts-node
/**
 * Migrate OAuth tokens from Firestore to PostgreSQL
 *
 * This script copies OAuth tokens from Firestore's nested document structure
 * to PostgreSQL's flat twitch_tokens table.
 *
 * Usage:
 *   PERSISTENCE_DRIVER=postgres DATABASE_URL="..." npx ts-node tools/migrate-tokens-to-postgres.ts
 */

import { getFirestore } from '../src/common/firebase';
import { createDocumentStore } from '../src/common/persistence/factory';

interface TokenData {
  accessToken: string;
  refreshToken?: string | null;
  scope?: string[];
  expiresIn?: number | null;
  obtainmentTimestamp?: number | null;
  userId?: string | null;
  updatedAt?: number;
}

async function migrateTokens() {
  console.log('Starting token migration from Firestore to PostgreSQL...');

  // Initialize Firestore
  const firestore = getFirestore();

  // Initialize PostgreSQL store
  const pgStore = createDocumentStore();

  try {
    // Migrate Twitch bot token (oauth/twitch/bot/token)
    await migrateToken(firestore, pgStore, 'oauth/twitch/bot/token', 'twitch:bot');

    // Migrate Twitch broadcaster token (oauth/twitch/broadcaster/token)
    await migrateToken(firestore, pgStore, 'oauth/twitch/broadcaster/token', 'twitch:broadcaster');

    // Migrate Discord broadcaster token (oauth/discord/broadcaster/token)
    await migrateToken(firestore, pgStore, 'oauth/discord/broadcaster/token', 'discord:broadcaster');

    console.log('✅ Token migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

async function migrateToken(
  firestore: any,
  pgStore: any,
  firestorePath: string,
  pgId: string
): Promise<void> {
  console.log(`Migrating ${firestorePath} -> ${pgId}...`);

  try {
    const docSnap = await firestore.doc(firestorePath).get();

    if (!docSnap.exists) {
      console.log(`  ⚠️  No token found at ${firestorePath}, skipping`);
      return;
    }

    const tokenData = docSnap.data() as TokenData;

    if (!tokenData.accessToken) {
      console.log(`  ⚠️  Token at ${firestorePath} missing accessToken, skipping`);
      return;
    }

    // Write to PostgreSQL twitch_tokens table
    await pgStore.set('twitch_tokens', pgId, {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken ?? null,
      scope: tokenData.scope ?? [],
      expiresIn: tokenData.expiresIn ?? null,
      obtainmentTimestamp: tokenData.obtainmentTimestamp ?? null,
      userId: tokenData.userId ?? null,
      updatedAt: tokenData.updatedAt ?? Date.now(),
    });

    console.log(`  ✅ Migrated ${pgId}`);
  } catch (error: any) {
    console.error(`  ❌ Failed to migrate ${firestorePath}:`, error.message);
    throw error;
  }
}

// Run migration
migrateTokens().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

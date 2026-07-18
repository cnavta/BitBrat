#!/usr/bin/env node
/**
 * Migrate OAuth tokens from Firestore to PostgreSQL
 *
 * This script copies OAuth tokens from Firestore to the PostgreSQL twitch_tokens table.
 * It can be run multiple times safely (idempotent).
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 GOOGLE_CLOUD_PROJECT=bitbrat-local \
 *   PERSISTENCE_DRIVER=postgres DATABASE_URL="postgresql://..." \
 *   npx ts-node tools/migrate-oauth-tokens.ts
 */

import { getFirestore } from '../src/common/firebase';
import { createDocumentStore } from '../src/common/persistence/factory';
import { logger } from '../src/common/logging';

interface FirestoreTokenData {
  accessToken: string;
  refreshToken: string | null;
  scope: string[];
  expiresIn: number | null;
  obtainmentTimestamp: number | null;
  userId: string | null;
  updatedAt: number;
}

interface TokenInfo {
  docPath: string;
  docId: string;
  data: FirestoreTokenData;
}

async function fetchTokenFromFirestore(docPath: string): Promise<TokenInfo | null> {
  const firestore = getFirestore();
  const docRef = firestore.doc(`${docPath}/token`);

  try {
    const snap = await docRef.get();
    if (!snap.exists) {
      logger.info('Token document not found in Firestore', { docPath });
      return null;
    }

    const data = snap.data() as FirestoreTokenData;
    if (!data || !data.accessToken) {
      logger.warn('Token document exists but has no accessToken', { docPath });
      return null;
    }

    // Convert Firestore path to PostgreSQL docId
    // Example: "oauth/twitch/bot" -> "twitch:bot"
    const parts = docPath.split('/').filter(Boolean);
    const docId = parts.length >= 2
      ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}`
      : docPath.replace(/\//g, ':');

    logger.info('Found token in Firestore', {
      docPath,
      docId,
      userId: data.userId,
      scopes: data.scope?.length || 0
    });

    return { docPath, docId, data };
  } catch (err: any) {
    logger.error('Failed to fetch token from Firestore', {
      docPath,
      error: err?.message || String(err)
    });
    return null;
  }
}

async function writeTokenToPostgres(tokenInfo: TokenInfo): Promise<boolean> {
  const store = createDocumentStore();

  try {
    await store.set('twitch_tokens', tokenInfo.docId, {
      accessToken: tokenInfo.data.accessToken,
      refreshToken: tokenInfo.data.refreshToken,
      scope: tokenInfo.data.scope || [],
      expiresIn: tokenInfo.data.expiresIn,
      obtainmentTimestamp: tokenInfo.data.obtainmentTimestamp,
      userId: tokenInfo.data.userId,
      updatedAt: tokenInfo.data.updatedAt || Date.now(),
    });

    logger.info('Token written to PostgreSQL', {
      docId: tokenInfo.docId,
      userId: tokenInfo.data.userId
    });

    return true;
  } catch (err: any) {
    logger.error('Failed to write token to PostgreSQL', {
      docId: tokenInfo.docId,
      error: err?.message || String(err)
    });
    return false;
  }
}

async function verifyTokenInPostgres(docId: string): Promise<boolean> {
  const store = createDocumentStore();

  try {
    const doc = await store.get('twitch_tokens', docId);
    if (!doc) {
      logger.warn('Token not found in PostgreSQL after migration', { docId });
      return false;
    }

    const data = doc as any;
    if (!data.accessToken) {
      logger.warn('Token in PostgreSQL is missing accessToken', { docId });
      return false;
    }

    logger.info('Token verified in PostgreSQL', {
      docId,
      userId: data.userId,
      hasAccessToken: !!data.accessToken,
      hasRefreshToken: !!data.refreshToken
    });

    return true;
  } catch (err: any) {
    logger.error('Failed to verify token in PostgreSQL', {
      docId,
      error: err?.message || String(err)
    });
    return false;
  }
}

async function main() {
  logger.info('Starting OAuth token migration from Firestore to PostgreSQL');

  // Check environment variables
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const persistenceDriver = process.env.PERSISTENCE_DRIVER;
  const databaseUrl = process.env.DATABASE_URL;

  logger.info('Environment check', {
    firestoreHost,
    projectId,
    persistenceDriver,
    hasDatabaseUrl: !!databaseUrl
  });

  if (persistenceDriver !== 'postgres' && persistenceDriver !== 'postgresql') {
    logger.error('PERSISTENCE_DRIVER must be set to "postgres"');
    process.exit(1);
  }

  if (!databaseUrl) {
    logger.error('DATABASE_URL must be set');
    process.exit(1);
  }

  // Token paths to migrate
  const tokenPaths = [
    'oauth/twitch/bot',
    'oauth/twitch/broadcaster',
    'oauth/discord/bot',
    'oauth/discord/broadcaster',
  ];

  let successCount = 0;
  let failCount = 0;
  let notFoundCount = 0;

  for (const docPath of tokenPaths) {
    logger.info('Processing token', { docPath });

    // Fetch from Firestore
    const tokenInfo = await fetchTokenFromFirestore(docPath);
    if (!tokenInfo) {
      notFoundCount++;
      continue;
    }

    // Write to PostgreSQL
    const written = await writeTokenToPostgres(tokenInfo);
    if (!written) {
      failCount++;
      continue;
    }

    // Verify
    const verified = await verifyTokenInPostgres(tokenInfo.docId);
    if (verified) {
      successCount++;
    } else {
      failCount++;
    }
  }

  logger.info('Migration complete', {
    total: tokenPaths.length,
    success: successCount,
    notFound: notFoundCount,
    failed: failCount
  });

  if (failCount > 0) {
    logger.error('Migration completed with errors');
    process.exit(1);
  }

  logger.info('All tokens migrated successfully');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err?.message || String(err) });
  process.exit(1);
});

import admin from 'firebase-admin';
import { getFirestore as gfs, Firestore } from 'firebase-admin/firestore';
import { logger } from './logging';
import { loadConfig } from './config';

// Initialize Firebase Admin SDK as a singleton. Configuration (e.g., databaseId)
// must be provided via the central config loader or explicitly via configureFirestore().
let initialized = false;
let cachedDb: Firestore | undefined;
let configuredDbId: string | undefined;

/**
 * Configure Firestore database binding prior to first use.
 * Call this from app bootstrap with a value from loadConfig(), e.g.:
 *   configureFirestore(cfg.firestore?.databaseId)
 */
export function configureFirestore(databaseId?: string) {
  if (databaseId && databaseId.trim()) {
    configuredDbId = databaseId.trim();
    // If already initialized, re-bind cached instance to the new database id
    if (initialized) {
      cachedDb = gfs(configuredDbId);
      logger.debug('firestore.rebound', { databaseId: configuredDbId });
    }
  }
}

function resolveDatabaseId(): string {
  // Prefer explicitly configured value; otherwise consult central config; finally default.
  if (configuredDbId && configuredDbId.trim()) return configuredDbId.trim();
  try {
    const cfg: any = loadConfig() as any;
    const fromCfg = cfg?.firestore?.databaseId as string | undefined;
    if (fromCfg && String(fromCfg).trim()) return String(fromCfg).trim();
  } catch {/* config load failures should not prevent Firestore usage */}
  return 'twitch';
}

export function getFirestore() {
  if (!initialized) {
    const databaseId = resolveDatabaseId();
    // Only initialize once per process
    logger.info('Initializing Firestore', { databaseId });
    admin.initializeApp({
      // Admin SDK uses ADC by default when available (service account key or Workload Identity)
    });
    // Bind Firestore to the named database (multi-database support)
    cachedDb = gfs(databaseId);
    initialized = true;
    logger.debug('firestore.initialized');
  }
  // Return the initialized Firestore instance (with databaseId if provided)
  return cachedDb as Firestore;
}

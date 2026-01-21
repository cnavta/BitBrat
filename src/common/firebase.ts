import admin from 'firebase-admin';
import { getFirestore as gfs, Firestore } from 'firebase-admin/firestore';
import { logger } from './logging';
//import { loadConfig } from './config';

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
      const db = gfs(configuredDbId);
      db.settings({ ignoreUndefinedProperties: true });
      cachedDb = db;
      logger.debug('firestore.rebound', { databaseId: configuredDbId });
    }
  }
}

function resolveDatabaseId(): string {
  // Prefer explicitly configured value; otherwise consult central config; finally default.
  if (configuredDbId && configuredDbId.trim()) return configuredDbId.trim();
  try {
    // Try to get from process.env directly to avoid circular dependency or config load failures
    const fromEnv = process.env.FIRESTORE_DATABASE_ID;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();

    const cfg: any = {} as any;
    const fromCfg = cfg?.firestore?.databaseId as string | undefined;
    if (fromCfg && String(fromCfg).trim()) return String(fromCfg).trim();
  } catch {/* config load failures should not prevent Firestore usage */}
  return '(default)';
}

export function getFirestore() {
  if (!initialized) {
    const databaseId = resolveDatabaseId();
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    const projectId = process.env.GCLOUD_PROJECT;
    // Only initialize once per process
    logger.info('Initializing Firestore', {
      projectId,
      databaseId,
      emulatorHost: emulatorHost || 'none'
    });
    admin.initializeApp({
      projectId,
      // Admin SDK uses ADC by default when available (service account key or Workload Identity)
    });
    // Bind Firestore to the named database (multi-database support)
    const db = gfs(databaseId);
    db.settings({ ignoreUndefinedProperties: true });
    cachedDb = db;
    initialized = true;
    logger.debug('firestore.initialized');
  }
  // Return the initialized Firestore instance (with databaseId if provided)
  return cachedDb as Firestore;
}

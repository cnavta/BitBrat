import admin from 'firebase-admin';
import { getFirestore as gfs, Firestore } from 'firebase-admin/firestore';
import { ConfigurationError } from '../../orchestration/errors';
import type { Logger } from '../../orchestration/logger';

/**
 * brat Firestore provider (Technical Architecture §7.1).
 *
 * Mirrors the canonical connection pattern in `src/common/firebase.ts`:
 *   - firebase-admin via Application Default Credentials (ADC),
 *   - project id resolved from explicit flag / PROJECT_ID / GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT,
 *   - named/multi-database support (same `(default)` fallback semantics),
 *   - `FIRESTORE_EMULATOR_HOST` awareness for local/CI/emulator targets.
 *
 * Unlike the app singleton in `firebase.ts`, the provider creates an isolated, named
 * firebase-admin app per connection so that `brat backup` can be invoked repeatedly (and in
 * tests) without colliding with a default app, and so a single process can address more than one
 * (project, database) pair.
 */

export interface FirestoreTarget {
  projectId: string;
  databaseId: string;
  /** Set when talking to a Firestore emulator (host:port). */
  emulatorHost?: string;
  /** Human-readable description for echoing/logging before any access. */
  description: string;
}

export interface FirestoreConnectOptions {
  /** Explicit project id (from --project-id). */
  projectId?: string;
  /** Explicit database id (from --database / FIRESTORE_DATABASE_ID). */
  databaseId?: string;
  /** Explicit emulator host (host:port); overrides FIRESTORE_EMULATOR_HOST. */
  emulatorHost?: string;
}

/** Default project id used when connecting to an emulator without an explicit project. */
export const DEFAULT_EMULATOR_PROJECT = 'bitbrat-local';

export function resolveProjectId(explicit?: string, opts: { emulator?: boolean } = {}): string {
  const pid = (explicit
    || process.env.PROJECT_ID
    || process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || '').trim();
  if (pid) return pid;
  if (opts.emulator) return DEFAULT_EMULATOR_PROJECT;
  throw new ConfigurationError(
    'Could not resolve a GCP project id. Pass --project-id <id> or set PROJECT_ID/GCLOUD_PROJECT.',
  );
}

export function resolveDatabaseId(explicit?: string): string {
  const id = (explicit || process.env.FIRESTORE_DATABASE_ID || '').trim();
  return id || '(default)';
}

/** Resolve the connection target (without connecting), for logging/echo and safety checks. */
export function resolveFirestoreTarget(opts: FirestoreConnectOptions = {}): FirestoreTarget {
  const emulatorHost = (opts.emulatorHost || process.env.FIRESTORE_EMULATOR_HOST || '').trim() || undefined;
  const projectId = resolveProjectId(opts.projectId, { emulator: !!emulatorHost });
  const databaseId = resolveDatabaseId(opts.databaseId);
  const description = emulatorHost
    ? `Firestore emulator ${emulatorHost} (project '${projectId}', database '${databaseId}')`
    : `GCP Firestore (project '${projectId}', database '${databaseId}')`;
  return { projectId, databaseId, emulatorHost, description };
}

let appCounter = 0;

/**
 * Connect to Firestore for the resolved target. ALWAYS logs the resolved target before returning
 * (AGENTS.md §8). Returns both the Firestore handle and the resolved target so callers can echo
 * it and perform safety checks.
 */
export function getBackupFirestore(
  opts: FirestoreConnectOptions = {},
  logger?: Logger,
): { db: Firestore; target: FirestoreTarget } {
  const target = resolveFirestoreTarget(opts);

  // The Admin SDK reads FIRESTORE_EMULATOR_HOST from the environment; set it when explicitly given.
  if (opts.emulatorHost && opts.emulatorHost.trim()) {
    process.env.FIRESTORE_EMULATOR_HOST = opts.emulatorHost.trim();
  }

  logger?.info(
    {
      action: 'backup.firestore.connect',
      projectId: target.projectId,
      databaseId: target.databaseId,
      emulatorHost: target.emulatorHost || 'none',
    },
    `Connecting to ${target.description}`,
  );

  const appName = `brat-backup-${++appCounter}`;
  const app = admin.initializeApp({ projectId: target.projectId }, appName);
  const db = gfs(app, target.databaseId);
  db.settings({ ignoreUndefinedProperties: true });
  return { db, target };
}

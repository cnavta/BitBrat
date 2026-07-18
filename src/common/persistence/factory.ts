/**
 * Persistence Factory - Simple Driver Selection
 *
 * Provides a simple factory for selecting between Firestore and PostgreSQL
 * based on the PERSISTENCE_DRIVER environment variable.
 *
 * NO DUAL-WRITE: This is a simple switch, not a dual-write implementation.
 * Services use one backend at a time.
 */

import { IDocumentStore } from './interfaces';
import { PostgresDocumentStore } from './postgres-store';
import { getFirestore } from '../firebase';

/**
 * Create document store based on PERSISTENCE_DRIVER environment variable
 *
 * Values:
 * - 'postgres' (default): Use PostgreSQL backend
 * - 'firestore' (deprecated): Use Firestore backend
 *
 * Environment variables:
 * - PERSISTENCE_DRIVER: Driver selection ('postgres' | 'firestore')
 * - DATABASE_URL: PostgreSQL connection string (required if driver=postgres)
 * - POSTGRES_POOL_SIZE: Connection pool size (optional, default: 10)
 *
 * Sprint 344: PostgreSQL is now the default persistence driver for the BitBrat platform.
 * Firestore remains supported for backwards compatibility but will be deprecated in future sprints.
 */
export function createDocumentStore(): IDocumentStore {
  const driver = process.env.PERSISTENCE_DRIVER || 'postgres';

  if (driver === 'postgres') {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL environment variable required when PERSISTENCE_DRIVER=postgres'
      );
    }

    return new PostgresDocumentStore({
      connectionString,
      poolSize: process.env.POSTGRES_POOL_SIZE
        ? parseInt(process.env.POSTGRES_POOL_SIZE, 10)
        : 10,
      ssl: process.env.POSTGRES_SSL === 'true',
    });
  }

  // Firestore backend (deprecated - will be removed in future sprint)
  if (driver === 'firestore') {
    console.warn(
      '[DEPRECATION WARNING] PERSISTENCE_DRIVER=firestore is deprecated. ' +
      'PostgreSQL is now the default persistence backend. ' +
      'Firestore support will be removed in a future sprint. ' +
      'Please migrate to PostgreSQL (see documentation/guides/postgres-migration.md).'
    );
  }
  return getFirestore() as any; // Firestore already implements similar interface
}

/**
 * Get current persistence driver name
 */
export function getPersistenceDriver(): 'postgres' | 'firestore' {
  return (process.env.PERSISTENCE_DRIVER as any) || 'firestore';
}

/**
 * Check if using PostgreSQL backend
 */
export function isPostgres(): boolean {
  return getPersistenceDriver() === 'postgres';
}

/**
 * Check if using Firestore backend
 */
export function isFirestore(): boolean {
  return getPersistenceDriver() === 'firestore';
}

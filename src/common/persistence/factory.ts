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
 * - 'postgres': Use PostgreSQL backend
 * - 'firestore' (default): Use Firestore backend
 *
 * Environment variables:
 * - PERSISTENCE_DRIVER: Driver selection ('postgres' | 'firestore')
 * - DATABASE_URL: PostgreSQL connection string (required if driver=postgres)
 * - POSTGRES_POOL_SIZE: Connection pool size (optional, default: 10)
 */
export function createDocumentStore(): IDocumentStore {
  const driver = process.env.PERSISTENCE_DRIVER || 'firestore';

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

  // Default to Firestore
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

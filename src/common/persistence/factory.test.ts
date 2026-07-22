/**
 * Integration Tests: PostgreSQL Default Behavior
 *
 * Validates that the persistence factory defaults to PostgreSQL when
 * PERSISTENCE_DRIVER is not set (Sprint 353).
 */

import { createDocumentStore } from './factory';
import { PostgresDocumentStore } from './postgres-store';

describe('createDocumentStore() - Default Behavior (Sprint 353)', () => {
  const originalEnv = process.env.PERSISTENCE_DRIVER;

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.PERSISTENCE_DRIVER = originalEnv;
    } else {
      delete process.env.PERSISTENCE_DRIVER;
    }
  });

  it('should default to PostgreSQL when PERSISTENCE_DRIVER is not set', async () => {
    // Arrange
    delete process.env.PERSISTENCE_DRIVER;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    // Act
    const store = await createDocumentStore();

    // Assert
    expect(store).toBeInstanceOf(PostgresDocumentStore);

    // Cleanup
    if (store instanceof PostgresDocumentStore) {
      await store.close();
    }
  });

  it('should use PostgreSQL when PERSISTENCE_DRIVER=postgres', async () => {
    // Arrange
    process.env.PERSISTENCE_DRIVER = 'postgres';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    // Act
    const store = await createDocumentStore();

    // Assert
    expect(store).toBeInstanceOf(PostgresDocumentStore);

    // Cleanup
    if (store instanceof PostgresDocumentStore) {
      await store.close();
    }
  });

  it('should use Firestore when PERSISTENCE_DRIVER=firestore', async () => {
    // Arrange
    process.env.PERSISTENCE_DRIVER = 'firestore';
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.GCLOUD_PROJECT = 'test-project';

    // Act
    const store = await createDocumentStore();

    // Assert
    expect(store).toBeDefined();
    expect(store).not.toBeInstanceOf(PostgresDocumentStore);

    // Note: Firestore is returned directly from getFirestore(), no cleanup needed
  });

  it('should fallback to Firestore for unrecognized PERSISTENCE_DRIVER value', () => {
    // Arrange
    process.env.PERSISTENCE_DRIVER = 'invalid' as any;
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.GCLOUD_PROJECT = 'test-project';

    // Act
    const store = createDocumentStore();

    // Assert
    expect(store).toBeDefined();
    expect(store).not.toBeInstanceOf(PostgresDocumentStore);
    // Note: Falls back to Firestore (getFirestore()) for any non-'postgres' value
  });

  it('should throw error when DATABASE_URL is missing for PostgreSQL', () => {
    // Arrange
    delete process.env.PERSISTENCE_DRIVER; // Defaults to postgres
    delete process.env.DATABASE_URL;

    // Act & Assert
    expect(() => createDocumentStore()).toThrow(/DATABASE_URL/i);
  });

  it('should return Firestore when PERSISTENCE_DRIVER=firestore (even without GCLOUD_PROJECT)', () => {
    // Arrange
    process.env.PERSISTENCE_DRIVER = 'firestore';
    delete process.env.GCLOUD_PROJECT;
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'; // Emulator doesn't require project

    // Act
    const store = createDocumentStore();

    // Assert
    expect(store).toBeDefined();
    expect(store).not.toBeInstanceOf(PostgresDocumentStore);
    // Note: Firestore validation happens at runtime when methods are called, not during factory creation
  });
});

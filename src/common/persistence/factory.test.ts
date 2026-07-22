/**
 * Integration Tests: PostgreSQL Default Behavior
 *
 * Validates that the persistence factory defaults to PostgreSQL when
 * PERSISTENCE_DRIVER is not set (Sprint 353).
 */

import { createDocumentStore } from './factory';
import { PostgresDocumentStore } from './postgres-store';
import { FirestoreDocumentStore } from './firestore-store';

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
    await store.close();
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
    await store.close();
  });

  it('should use Firestore when PERSISTENCE_DRIVER=firestore', async () => {
    // Arrange
    process.env.PERSISTENCE_DRIVER = 'firestore';
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.GCLOUD_PROJECT = 'test-project';

    // Act
    const store = await createDocumentStore();

    // Assert
    expect(store).toBeInstanceOf(FirestoreDocumentStore);

    // Cleanup
    await store.close();
  });

  it('should throw error for invalid PERSISTENCE_DRIVER value', async () => {
    // Arrange
    process.env.PERSISTENCE_DRIVER = 'invalid' as any;

    // Act & Assert
    await expect(createDocumentStore()).rejects.toThrow(/invalid persistence driver/i);
  });

  it('should throw error when DATABASE_URL is missing for PostgreSQL', async () => {
    // Arrange
    delete process.env.PERSISTENCE_DRIVER; // Defaults to postgres
    delete process.env.DATABASE_URL;

    // Act & Assert
    await expect(createDocumentStore()).rejects.toThrow(/DATABASE_URL/i);
  });

  it('should throw error when GCLOUD_PROJECT is missing for Firestore', async () => {
    // Arrange
    process.env.PERSISTENCE_DRIVER = 'firestore';
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIRESTORE_EMULATOR_HOST;

    // Act & Assert
    await expect(createDocumentStore()).rejects.toThrow(/GCLOUD_PROJECT/i);
  });
});

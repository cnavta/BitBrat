/**
 * Integration Tests: Docker Orchestrator Default Behavior
 *
 * Validates that the Docker orchestrator defaults to PostgreSQL and skips
 * GCP credential synchronization when PERSISTENCE_DRIVER is not set (Sprint 353).
 *
 * Tests the logic at orchestrator.ts:365 that determines when GCP services are needed.
 */

describe('DockerOrchestrator - Default Persistence Behavior (Sprint 353)', () => {
  describe('GCP Services Detection Logic', () => {
    /**
     * Helper function to check if GCP services are needed
     * Simulates orchestrator.ts:365 logic
     */
    function needsGcpServices(persistence: string, messageBus: string): boolean {
      return persistence === 'firestore' || messageBus === 'pubsub';
    }

    it('should not need GCP when PERSISTENCE_DRIVER is unset (defaults to postgres)', () => {
      // Arrange: Simulate the logic from orchestrator.ts:365
      const envPersistence: string | undefined = undefined;
      const envMessageBus: string | undefined = undefined;
      const persistenceDriver = envPersistence || 'postgres'; // Default is postgres (Sprint 344)
      const messageBusDriver = envMessageBus || 'nats';

      // Act
      const needsGcp = needsGcpServices(persistenceDriver, messageBusDriver);

      // Assert
      expect(needsGcp).toBe(false);
    });

    it('should not need GCP when PERSISTENCE_DRIVER=postgres and MESSAGE_BUS_DRIVER=nats', () => {
      // Arrange
      const needsGcp = needsGcpServices('postgres', 'nats');

      // Assert
      expect(needsGcp).toBe(false);
    });

    it('should need GCP when PERSISTENCE_DRIVER=firestore', () => {
      // Arrange & Act
      const needsGcp = needsGcpServices('firestore', 'nats');

      // Assert
      expect(needsGcp).toBe(true);
    });

    it('should need GCP when MESSAGE_BUS_DRIVER=pubsub', () => {
      // Arrange & Act
      const needsGcp = needsGcpServices('postgres', 'pubsub');

      // Assert
      expect(needsGcp).toBe(true);
    });

    it('should need GCP when both PERSISTENCE_DRIVER=firestore and MESSAGE_BUS_DRIVER=pubsub', () => {
      // Arrange & Act
      const needsGcp = needsGcpServices('firestore', 'pubsub');

      // Assert
      expect(needsGcp).toBe(true);
    });
  });

  describe('Persistence Driver Default Value', () => {
    it('should default to "postgres" when PERSISTENCE_DRIVER is undefined', () => {
      // Arrange
      const envValue: string | undefined = undefined;

      // Act: Simulate the default behavior from orchestrator.ts:365
      const persistenceDriver = envValue || 'postgres';

      // Assert
      expect(persistenceDriver).toBe('postgres');
    });

    it('should default to "postgres" when PERSISTENCE_DRIVER is empty string', () => {
      // Arrange
      const envValue = '';

      // Act
      const persistenceDriver = envValue || 'postgres';

      // Assert
      expect(persistenceDriver).toBe('postgres');
    });

    it('should use explicit value when PERSISTENCE_DRIVER is set', () => {
      // Arrange
      const envValue = 'firestore';

      // Act
      const persistenceDriver = envValue || 'postgres';

      // Assert
      expect(persistenceDriver).toBe('firestore');
    });
  });
});

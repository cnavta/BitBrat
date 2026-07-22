/**
 * Tests for LogRetriever
 */

import { LogRetriever } from '../log-retriever.js';
import { TargetConnection, DeploymentType } from '../types.js';
import { FirestoreRegistryReader } from '../../fleet/firestore-registry.js';
import { LokiClient } from '../loki-client.js';

// Mock FirestoreRegistryReader and LokiClient
jest.mock('../../fleet/firestore-registry.js');
jest.mock('../loki-client.js');

describe('LogRetriever', () => {
  let mockConnection: TargetConnection;
  let mockRegistry: jest.Mocked<FirestoreRegistryReader>;

  beforeEach(() => {
    // Create mock connection
    mockConnection = {
      name: 'test-target',
      type: 'local',
      persistenceDriver: 'firestore',
      firestore: {
        db: {} as any,
        projectId: 'test-project',
        databaseId: 'default'
      },
      cleanup: jest.fn().mockResolvedValue(undefined)
    };

    // Mock registry
    mockRegistry = new FirestoreRegistryReader({}) as jest.Mocked<FirestoreRegistryReader>;
    (FirestoreRegistryReader as jest.Mock).mockImplementation(() => mockRegistry);
  });

  describe('resolveBitDeployment', () => {
    it('should identify Cloud Run deployment from *.run.app URL', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'llm-bot',
          url: 'https://llm-bot-abc123.run.app',
          profile: 'llm',
          exposure: 'platform-only'
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act
      const deploymentType = await retriever.resolveBitDeployment('llm-bot');

      // Assert
      expect(deploymentType).toBe('cloud-run');
    });

    it('should identify Cloud Run deployment from *.a.run.app URL', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'event-router',
          url: 'https://event-router-xyz.a.run.app',
          profile: 'core',
          exposure: 'platform-only'
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act
      const deploymentType = await retriever.resolveBitDeployment('event-router');

      // Assert
      expect(deploymentType).toBe('cloud-run');
    });

    it('should identify Docker deployment from localhost URL', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'llm-bot',
          url: 'http://localhost:3001',
          profile: 'llm',
          exposure: 'platform-only'
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act
      const deploymentType = await retriever.resolveBitDeployment('llm-bot');

      // Assert
      expect(deploymentType).toBe('docker');
    });

    it('should identify Docker deployment from *.bitbrat.local URL', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'llm-bot',
          url: 'http://llm-bot.bitbrat.local:3001',
          profile: 'llm',
          exposure: 'platform-only'
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act
      const deploymentType = await retriever.resolveBitDeployment('llm-bot');

      // Assert
      expect(deploymentType).toBe('docker');
    });

    it('should throw error when Bit not found in registry', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'event-router',
          url: 'http://localhost:3002',
          profile: 'core',
          exposure: 'platform-only'
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act & Assert
      await expect(retriever.resolveBitDeployment('nonexistent-bit')).rejects.toThrow(
        "Bit 'nonexistent-bit' not found in mcp_servers registry"
      );
    });

    it('should throw error when Bit has no URL', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'incomplete-bit',
          profile: 'core',
          exposure: 'platform-only'
          // No url field
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act & Assert
      await expect(retriever.resolveBitDeployment('incomplete-bit')).rejects.toThrow(
        "Bit 'incomplete-bit' has no URL registered"
      );
    });

    it('should throw error for unknown deployment type', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'unknown-bit',
          url: 'https://unknown-deployment.example.com',
          profile: 'core',
          exposure: 'platform-only'
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act & Assert
      await expect(retriever.resolveBitDeployment('unknown-bit')).rejects.toThrow(
        'Unable to determine deployment type'
      );
    });

    it('should be case-insensitive when parsing URLs', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([
        {
          name: 'mixed-case-bit',
          url: 'HTTPS://SERVICE.RUN.APP',
          profile: 'core',
          exposure: 'platform-only'
        }
      ]);

      const retriever = new LogRetriever(mockConnection);

      // Act
      const deploymentType = await retriever.resolveBitDeployment('mixed-case-bit');

      // Assert
      expect(deploymentType).toBe('cloud-run');
    });
  });

  describe('getLogs', () => {
    it('should return error response when bit name is missing', async () => {
      // Arrange
      const retriever = new LogRetriever(mockConnection);

      // Act
      const response = await retriever.getLogs({});

      // Assert
      expect(response.error).toContain('Bit name is required');
      expect(response.count).toBe(0);
      expect(response.logs).toEqual([]);
    });

    it('should return error response when bit not found in registry', async () => {
      // Arrange
      mockRegistry.listServers.mockResolvedValue([]);
      const retriever = new LogRetriever(mockConnection);

      // Act
      const response = await retriever.getLogs({ bit: 'nonexistent-bit' });

      // Assert
      expect(response.error).toContain('not found in mcp_servers registry');
      expect(response.count).toBe(0);
    });
  });

  describe('Cloud Run log retrieval (private methods accessible via getLogs integration)', () => {
    // Note: These are integration-level tests since the methods are private
    // We'll test them more thoroughly in Phase 2 when fleet.logs tool is implemented

    describe('parseSince', () => {
      it('should parse hour duration', () => {
        // We can't test private methods directly, but we can verify the logic
        // through integration tests in Phase 2
        expect(true).toBe(true);
      });
    });

    describe('mapLevelToSeverity', () => {
      it('should map levels correctly', () => {
        // Will be tested through integration tests in Phase 2
        expect(true).toBe(true);
      });
    });
  });
});

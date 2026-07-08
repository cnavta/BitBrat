/**
 * Mock factories for dev-mcp testing
 *
 * Provides mock implementations of external dependencies:
 * - Firestore (database connections)
 * - SSH connections (remote Docker targets)
 * - FleetClient (for fleet tool operations)
 */

import { Firestore } from '@google-cloud/firestore';
import { TargetConnection } from '../types.js';

/**
 * Create a mock Firestore instance
 */
export function createMockFirestore(): jest.Mocked<Firestore> {
  const mockFirestore = {
    collection: jest.fn(),
    doc: jest.fn(),
    listCollections: jest.fn().mockResolvedValue([]),
    runTransaction: jest.fn(),
    batch: jest.fn(),
    getAll: jest.fn(),
    terminate: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Firestore>;

  return mockFirestore;
}

/**
 * Create a mock TargetConnection
 */
export function createMockConnection(overrides?: Partial<TargetConnection>): TargetConnection {
  const mockDb = createMockFirestore();

  const defaultConnection: TargetConnection = {
    name: 'test-target',
    type: 'local',
    firestore: {
      db: mockDb,
      projectId: 'test-project',
      databaseId: '(default)',
    },
    cleanup: jest.fn().mockResolvedValue(undefined),
  };

  return {
    ...defaultConnection,
    ...overrides,
  };
}

/**
 * Create a mock SSH connection (remote Docker)
 */
export function createMockSshConnection(overrides?: Partial<TargetConnection>): TargetConnection {
  return createMockConnection({
    name: 'ssh-target',
    type: 'remote-ssh',
    ...overrides,
  });
}

/**
 * Create a mock GCP connection
 */
export function createMockGcpConnection(overrides?: Partial<TargetConnection>): TargetConnection {
  return createMockConnection({
    name: 'gcp-target',
    type: 'gcp',
    firestore: {
      db: createMockFirestore(),
      projectId: 'prod-project',
      databaseId: 'prod-database',
    },
    ...overrides,
  });
}

/**
 * Create a mock connection with gateway URL (for fleet operations)
 */
export function createMockConnectionWithGateway(overrides?: Partial<TargetConnection>): TargetConnection {
  return createMockConnection({
    gateway: {
      url: 'http://localhost:3001',
      authToken: 'test-token-123',
    },
    ...overrides,
  });
}

/**
 * Mock FleetClient for fleet tool testing
 */
export class MockFleetClient {
  public listBits = jest.fn().mockResolvedValue([
    { name: 'bit-1', status: 'active' },
    { name: 'bit-2', status: 'active' },
  ]);

  public getBitInfo = jest.fn().mockResolvedValue({
    name: 'bit-1',
    version: '1.0.0',
    uptime: 12345,
  });

  public getBitHealth = jest.fn().mockResolvedValue({
    status: 'healthy',
    checks: { firestore: 'ok', memory: 'ok' },
  });

  public callTool = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Success' }],
  });
}

/**
 * Mock resolveBackupConnection for target-manager testing
 */
export function createMockResolveBackupConnection() {
  return jest.fn().mockResolvedValue({
    targetKind: 'local',
    isEmulator: true,
    connectOptions: {
      projectId: 'test-project',
      databaseId: '(default)',
    },
    cleanup: jest.fn().mockResolvedValue(undefined),
  });
}

/**
 * Mock getBackupFirestore for target-manager testing
 */
export function createMockGetBackupFirestore() {
  return jest.fn().mockReturnValue({
    db: createMockFirestore(),
    target: {
      projectId: 'test-project',
      databaseId: '(default)',
    },
  });
}

/**
 * Tests for TargetConnectionManager
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { TargetConnectionManager } from '../target-manager.js';
import { createLogger } from '../../orchestration/logger';
import { createTestTargetManager } from '../test-utils/helpers.js';
import {
  createMockConnection,
  createMockResolveBackupConnection,
  createMockGetBackupFirestore,
} from '../test-utils/mocks.js';

describe('TargetConnectionManager', () => {
  let manager: TargetConnectionManager;
  const logger = createLogger({ base: { component: 'test' }, level: 'error' });

  beforeEach(() => {
    manager = new TargetConnectionManager(process.cwd(), undefined, logger);
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  it('should initialize without errors', () => {
    expect(manager).toBeDefined();
  });

  it('should create manager with default target', () => {
    const managerWithDefault = new TargetConnectionManager('local', undefined, logger);
    expect(managerWithDefault).toBeDefined();
  });

  // TODO: DM-007 - Add comprehensive tests with mocks
  // These tests will require mocking resolveBackupConnection and getBackupFirestore
  // which are currently called directly. We'll need to refactor or use jest.mock()
  //
  // Tests to add:
  // - Connection resolution (local, SSH, GCP)
  // - Connection pooling (reuse cached connections)
  // - Health checks
  // - Cleanup (SSH tunnel teardown)
  //
  // Example test structure:
  // it('should resolve local connection', async () => {
  //   const mockResolve = createMockResolveBackupConnection();
  //   const mockFirestore = createMockGetBackupFirestore();
  //   // Mock the imports
  //   // const connection = await manager.getActiveConnection('local');
  //   // expect(connection.type).toBe('local');
  //   // expect(mockResolve).toHaveBeenCalled();
  // });
});

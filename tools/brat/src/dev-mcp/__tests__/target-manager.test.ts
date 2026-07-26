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
    const managerWithDefault = new TargetConnectionManager(process.cwd(), 'local', logger);
    expect(managerWithDefault).toBeDefined();
  });

  describe('validateContext()', () => {
    it('should return true for valid context (local)', async () => {
      // Local context should always exist (default)
      const result = await manager.validateContext('local');
      expect(result).toBe(true);
    });

    it('should return false for invalid context', async () => {
      // Invalid context names should return false
      const result = await manager.validateContext('invalid-context-that-does-not-exist');
      expect(result).toBe(false);
    });

    it('should use defaultContext when contextName not provided', async () => {
      // Create manager with explicit default
      const managerWithDefault = new TargetConnectionManager(process.cwd(), 'local', logger);
      const result = await managerWithDefault.validateContext();
      expect(result).toBe(true);
    });

    it('should handle undefined contextName with undefined defaultContext', async () => {
      // Manager with no default should fallback to 'local'
      const result = await manager.validateContext();
      expect(result).toBe(true); // Fallback to 'local' which should exist
    });

    it('should validate staging context if it exists in architecture.yaml', async () => {
      // This test assumes staging might not exist in all environments
      // So we just verify it doesn't throw an error
      const result = await manager.validateContext('staging');
      expect(typeof result).toBe('boolean');
    });
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

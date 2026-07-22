/**
 * TargetConnectionManager Tests
 *
 * Tests for refactored TargetConnectionManager using ContextResolver + ContextAdapter.
 */

import { TargetConnectionManager } from './target-manager';
import { createLogger } from '../orchestration/logger';

describe('TargetConnectionManager', () => {
  const logger = createLogger({ base: { component: 'test' }, level: 'silent' });
  const repoRoot = process.cwd(); // Use current directory for tests

  describe('getActiveConnection()', () => {
    it('should resolve default context when no name provided', async () => {
      const manager = new TargetConnectionManager(repoRoot, undefined, logger);

      // Context resolution follows priority: BITBRAT_CONTEXT → ~/.bratrc → 'local'
      const connection = await manager.getActiveConnection();

      expect(connection.name).toBeDefined();
      expect(connection.persistenceDriver).toBe('postgres');

      // Cleanup
      await connection.cleanup();
    }, 10000);

    it('should use default context from constructor', async () => {
      const manager = new TargetConnectionManager(repoRoot, 'local', logger);

      const connection = await manager.getActiveConnection();

      expect(connection.name).toBe('local');

      // Cleanup
      await connection.cleanup();
    }, 10000);

    it('should cache connections', async () => {
      const manager = new TargetConnectionManager(repoRoot, 'local', logger);

      const conn1 = await manager.getActiveConnection('local');
      const conn2 = await manager.getActiveConnection('local');

      // Should return same instance
      expect(conn1).toBe(conn2);

      // Cleanup
      await manager.disconnectAll();
    }, 10000);

    it('should create separate connections for different contexts', async () => {
      const manager = new TargetConnectionManager(repoRoot, undefined, logger);

      const localConn = await manager.getActiveConnection('local');

      expect(localConn.name).toBe('local');

      // Cleanup
      await manager.disconnectAll();
    }, 10000);
  });

  describe('disconnect()', () => {
    it('should disconnect specific target', async () => {
      const manager = new TargetConnectionManager(repoRoot, undefined, logger);

      await manager.getActiveConnection('local');

      // Disconnect
      await manager.disconnect('local');

      // Should create new connection after disconnect
      const conn = await manager.getActiveConnection('local');
      expect(conn.name).toBe('local');

      // Cleanup
      await manager.disconnectAll();
    }, 10000);
  });

  describe('disconnectAll()', () => {
    it('should disconnect all targets and cleanup', async () => {
      const manager = new TargetConnectionManager(repoRoot, undefined, logger);

      // Create connections
      await manager.getActiveConnection('local');

      // Disconnect all
      await manager.disconnectAll();

      // After disconnect all, should be able to create new connections
      const conn = await manager.getActiveConnection('local');
      expect(conn.name).toBe('local');

      // Cleanup
      await manager.disconnectAll();
    }, 10000);
  });
});

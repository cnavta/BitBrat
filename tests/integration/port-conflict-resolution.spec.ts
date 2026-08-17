/**
 * Integration tests for port conflict resolution in bulk deployments
 *
 * Tests the full flow: DockerComposeStrategy → DockerOrchestrator → PortManager
 * with realistic docker ps outputs simulating port conflicts.
 *
 * @module tests/integration/port-conflict-resolution
 * @since Sprint 379
 */

import { PortManager } from '../../tools/brat/src/orchestration/docker/port-manager';
import { execCmd } from '../../tools/brat/src/orchestration/exec';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
jest.mock('../../tools/brat/src/orchestration/exec');
jest.mock('fs');

describe('Port Conflict Resolution - Integration (Sprint 379)', () => {
  let portManager: PortManager;
  let mockExecCmd: jest.MockedFunction<typeof execCmd>;
  let mockFs: jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    portManager = new PortManager();
    mockExecCmd = execCmd as jest.MockedFunction<typeof execCmd>;
    mockFs = fs as jest.Mocked<typeof fs>;

    // Default: docker ps returns no running containers
    mockExecCmd.mockResolvedValue({
      code: 0,
      stdout: '',
      stderr: '',
    });

    // Default: all service files exist
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
  });

  describe('Auto-assign ports avoiding conflicts (Task 379-010 Test 1)', () => {
    it('should auto-assign ports avoiding conflicts in bulk deployment', async () => {
      // Given: Container already running on port 3001
      mockExecCmd.mockResolvedValue({
        code: 0,
        stdout: '0.0.0.0:3001->3000/tcp\n',
        stderr: '',
      });

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/llm-bot.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/tool-gateway.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/auth.compose.yaml',
      ];

      // When: Deploy all services without explicit ports
      const assignments = await portManager.resolvePorts(serviceFiles, {}, {});

      // Then: Port 3001 is skipped, services get 3002, 3003, 3004
      expect(assignments).toHaveLength(3);
      expect(assignments[0]).toEqual({ service: 'llm-bot', port: 3002, explicit: false });
      expect(assignments[1]).toEqual({ service: 'tool-gateway', port: 3003, explicit: false });
      expect(assignments[2]).toEqual({ service: 'auth', port: 3004, explicit: false });

      // Verify docker ps was called
      expect(mockExecCmd).toHaveBeenCalledWith('docker', ['ps', '--format', '{{.Ports}}']);
    });

    it('should handle multiple running containers on sequential ports', async () => {
      // Given: Containers running on ports 3001, 3002, 3003
      mockExecCmd.mockResolvedValue({
        code: 0,
        stdout:
          '0.0.0.0:3001->3000/tcp\n' +
          '0.0.0.0:3002->3000/tcp\n' +
          '0.0.0.0:3003->3000/tcp\n',
        stderr: '',
      });

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/service-a.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/service-b.compose.yaml',
      ];

      // When: Deploy two services
      const assignments = await portManager.resolvePorts(serviceFiles, {}, {});

      // Then: Services get ports 3004, 3005 (skipping 3001-3003)
      expect(assignments).toHaveLength(2);
      expect(assignments[0]).toEqual({ service: 'service-a', port: 3004, explicit: false });
      expect(assignments[1]).toEqual({ service: 'service-b', port: 3005, explicit: false });
    });
  });

  describe('Explicit ports honored (Task 379-010 Test 2)', () => {
    it('should honor explicit ports even when they conflict with running containers', async () => {
      // Given: Container running on port 3001
      mockExecCmd.mockResolvedValue({
        code: 0,
        stdout: '0.0.0.0:3001->3000/tcp\n',
        stderr: '',
      });

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/llm-bot.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/tool-gateway.compose.yaml',
      ];

      const env = {
        LLM_BOT_HOST_PORT: '3001', // Explicit port (conflicts with running container)
        // tool-gateway gets auto-assigned
      };

      // When: Deploy with explicit port
      const assignments = await portManager.resolvePorts(serviceFiles, env, {});

      // Then: llm-bot gets explicit port 3001, tool-gateway gets auto-assigned 3002
      expect(assignments).toHaveLength(2);
      expect(assignments[0]).toEqual({ service: 'llm-bot', port: 3001, explicit: true });
      expect(assignments[1]).toEqual({ service: 'tool-gateway', port: 3002, explicit: false });
    });

    it('should not generate env overrides for explicit ports', async () => {
      // Given: Service with explicit port
      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/llm-bot.compose.yaml',
      ];

      const env = {
        LLM_BOT_HOST_PORT: '5000',
      };

      // When: Resolve ports and get overrides
      const assignments = await portManager.resolvePorts(serviceFiles, env, {});
      const overrides = portManager.getEnvOverrides(assignments);

      // Then: No override for explicit port
      expect(overrides).toEqual({});
      expect(assignments[0]).toEqual({ service: 'llm-bot', port: 5000, explicit: true });
    });
  });

  describe('Multiple services auto-assigned sequential ports (Task 379-010 Test 3)', () => {
    it('should assign sequential ports to multiple services', async () => {
      // Given: No running containers
      mockExecCmd.mockResolvedValue({
        code: 0,
        stdout: '',
        stderr: '',
      });

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/service-1.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/service-2.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/service-3.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/service-4.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/service-5.compose.yaml',
      ];

      // When: Deploy all services
      const assignments = await portManager.resolvePorts(serviceFiles, {}, {});

      // Then: Sequential port assignment starting from 3001
      expect(assignments).toHaveLength(5);
      expect(assignments[0]).toEqual({ service: 'service-1', port: 3001, explicit: false });
      expect(assignments[1]).toEqual({ service: 'service-2', port: 3002, explicit: false });
      expect(assignments[2]).toEqual({ service: 'service-3', port: 3003, explicit: false });
      expect(assignments[3]).toEqual({ service: 'service-4', port: 3004, explicit: false });
      expect(assignments[4]).toEqual({ service: 'service-5', port: 3005, explicit: false });
    });

    it('should generate correct env overrides for implicit assignments', async () => {
      // Given: No running containers
      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/llm-bot.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/tool-gateway.compose.yaml',
      ];

      // When: Deploy with auto-assignment
      const assignments = await portManager.resolvePorts(serviceFiles, {}, {});
      const overrides = portManager.getEnvOverrides(assignments);

      // Then: Env overrides generated
      expect(overrides).toEqual({
        LLM_BOT_HOST_PORT: '3001',
        TOOL_GATEWAY_HOST_PORT: '3002',
      });
    });
  });

  describe('Remote (SSH) docker ps (Task 379-010 Test 4)', () => {
    it('should discover used ports via SSH for remote deployments', async () => {
      // Given: Remote deployment with SSH host
      const targetConfig = {
        host: 'ssh://root@bitbrat.lan',
        remoteDir: '/opt/BitBratPlatform',
      };

      // Mock SSH docker ps output showing ports 3001-3005 in use
      mockExecCmd.mockResolvedValue({
        code: 0,
        stdout:
          '0.0.0.0:3001->3000/tcp\n' +
          '0.0.0.0:3002->3000/tcp\n' +
          '0.0.0.0:3003->3000/tcp\n' +
          '0.0.0.0:3004->3000/tcp\n' +
          '0.0.0.0:3005->3000/tcp\n',
        stderr: '',
      });

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/new-service-a.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/new-service-b.compose.yaml',
      ];

      // When: Deploy to remote host
      const assignments = await portManager.resolvePorts(serviceFiles, {}, targetConfig);

      // Then: Services get ports 3006, 3007 (avoiding 3001-3005)
      expect(assignments).toHaveLength(2);
      expect(assignments[0]).toEqual({ service: 'new-service-a', port: 3006, explicit: false });
      expect(assignments[1]).toEqual({ service: 'new-service-b', port: 3007, explicit: false });

      // Verify SSH command was used
      expect(mockExecCmd).toHaveBeenCalledWith('ssh', [
        'root@bitbrat.lan',
        'docker ps --format "{{.Ports}}"',
      ]);
    });

    it('should gracefully handle SSH failures', async () => {
      // Given: SSH command fails
      const targetConfig = {
        host: 'ssh://root@unreachable-host',
        remoteDir: '/opt/BitBratPlatform',
      };

      mockExecCmd.mockRejectedValue(new Error('SSH connection refused'));

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/service-a.compose.yaml',
      ];

      // Spy on console.warn to verify graceful degradation
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // When: Deploy with SSH failure
      const assignments = await portManager.resolvePorts(serviceFiles, {}, targetConfig);

      // Then: Falls back to default behavior (no live port discovery)
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toEqual({ service: 'service-a', port: 3001, explicit: false });

      // Verify warning logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to discover used ports')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Complex scenarios', () => {
    it('should handle mix of explicit and implicit ports with conflicts', async () => {
      // Given: Containers running on ports 3001, 3002
      mockExecCmd.mockResolvedValue({
        code: 0,
        stdout: '0.0.0.0:3001->3000/tcp, 0.0.0.0:3002->3001/tcp\n',
        stderr: '',
      });

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/service-a.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/service-b.compose.yaml',
        '/test/repo/infrastructure/docker-compose/services/service-c.compose.yaml',
      ];

      const env = {
        SERVICE_A_HOST_PORT: '5000', // Explicit
        // service-b and service-c get auto-assigned
      };

      // When: Deploy with mixed ports
      const assignments = await portManager.resolvePorts(serviceFiles, env, {});

      // Then: service-a gets explicit 5000, service-b/c avoid 3001, 3002, 5000
      expect(assignments).toHaveLength(3);
      expect(assignments[0]).toEqual({ service: 'service-a', port: 5000, explicit: true });
      expect(assignments[1]).toEqual({ service: 'service-b', port: 3003, explicit: false });
      expect(assignments[2]).toEqual({ service: 'service-c', port: 3004, explicit: false });
    });

    it('should parse complex docker ps output with multiple port mappings', async () => {
      // Given: Docker ps output with multiple ports per container
      mockExecCmd.mockResolvedValue({
        code: 0,
        stdout:
          '0.0.0.0:3001->3000/tcp, 0.0.0.0:3002->3001/tcp\n' +
          '0.0.0.0:8080->80/tcp, 0.0.0.0:8443->443/tcp\n' +
          '0.0.0.0:5432->5432/tcp\n',
        stderr: '',
      });

      const serviceFiles = [
        '/test/repo/infrastructure/docker-compose/services/new-service.compose.yaml',
      ];

      // When: Deploy new service
      const assignments = await portManager.resolvePorts(serviceFiles, {}, {});

      // Then: Service avoids 3001, 3002, 8080, 8443, 5432
      expect(assignments).toHaveLength(1);
      expect(assignments[0].port).toBe(3003); // First available after 3001, 3002
    });
  });
});

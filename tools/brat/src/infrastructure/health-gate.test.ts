/**
 * Unit tests for HealthGate - Unified infrastructure health check system
 *
 * Tests cover:
 * - checkHealth() method (CMD, CMD-SHELL, docker exec formats)
 * - waitForInfrastructure() method (parallel, sequential, timeouts)
 * - pollUntilHealthy() internal method
 * - checkServiceHealth() convenience method
 * - Error message formatting and troubleshooting
 *
 * @module infrastructure/health-gate.test
 */

import { HealthGate, type Logger } from './health-gate';
import type { InfrastructureSpec } from './types';
import { exec } from 'child_process';
import { promisify } from 'util';

// Mock child_process exec
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as jest.MockedFunction<typeof exec>;

describe('HealthGate', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
  });

  describe('checkHealth', () => {
    it('should return true when no health check is defined', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        // No healthCheck defined
      };

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(true);
    });

    it('should return true when health check test is empty', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: [],
          interval: '10s',
          timeout: '5s',
        },
      };

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(true);
    });

    it('should execute CMD format health check', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['CMD', 'pg_isready', '-U', 'bitbrat'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock successful exec
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'ready', stderr: '' });
        return {} as any;
      });

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        'pg_isready -U bitbrat',
        { timeout: 5000 },
        expect.any(Function)
      );
    });

    it('should execute CMD-SHELL format health check', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['CMD-SHELL', 'pg_isready -U bitbrat || exit 1'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock successful exec
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'ready', stderr: '' });
        return {} as any;
      });

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        'pg_isready -U bitbrat || exit 1',
        { timeout: 5000 },
        expect.any(Function)
      );
    });

    it('should execute docker exec format health check', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['docker', 'exec', 'bitbrat-postgres-1', 'pg_isready', '-U', 'bitbrat'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock successful exec
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'ready', stderr: '' });
        return {} as any;
      });

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        'docker exec bitbrat-postgres-1 pg_isready -U bitbrat',
        { timeout: 5000 },
        expect.any(Function)
      );
    });

    it('should return false when health check command fails', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['CMD', 'pg_isready', '-U', 'bitbrat'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock failed exec
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(new Error('Command failed'), null);
        return {} as any;
      });

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(false);
    });

    it('should return true and log warning for unknown command type', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['UNKNOWN', 'some-command'],
          interval: '10s',
          timeout: '5s',
        },
      };

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown health check command type: UNKNOWN')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle exec timeout', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['CMD', 'pg_isready', '-U', 'bitbrat'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock timeout error
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        const error = new Error('Command timed out') as any;
        error.killed = true;
        error.signal = 'SIGTERM';
        callback(error, null);
        return {} as any;
      });

      const result = await HealthGate.checkHealth(spec);
      expect(result).toBe(false);
    });
  });

  describe('checkServiceHealth', () => {
    it('should create InfrastructureSpec and call checkHealth', async () => {
      const healthCheck = {
        test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
        interval: '10s',
        timeout: '5s',
      };

      // Mock successful exec
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'ready', stderr: '' });
        return {} as any;
      });

      const result = await HealthGate.checkServiceHealth('postgres', healthCheck);
      expect(result).toBe(true);
    });
  });

  describe('waitForInfrastructure', () => {
    it('should return immediately when specs array is empty', async () => {
      await HealthGate.waitForInfrastructure([], { logger: mockLogger });

      expect(mockLogger.info).toHaveBeenCalledWith('No infrastructure services to wait for');
    });

    it('should wait for all infrastructure in parallel (success)', async () => {
      const specs: InfrastructureSpec[] = [
        {
          capability: 'messaging',
          provider: 'docker',
          serviceName: 'nats',
          config: {},
          healthCheck: {
            test: ['CMD', 'wget', '--spider', 'http://localhost:8222/healthz'],
            interval: '5s',
            timeout: '3s',
          },
        },
        {
          capability: 'caching',
          provider: 'docker',
          serviceName: 'redis',
          config: {},
          healthCheck: {
            test: ['CMD', 'redis-cli', 'ping'],
            interval: '5s',
            timeout: '3s',
          },
        },
      ];

      // Mock successful health checks
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'OK', stderr: '' });
        return {} as any;
      });

      await HealthGate.waitForInfrastructure(specs, {
        timeout: 10000,
        parallel: true,
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Waiting for 2 infrastructure service(s) to be ready...');
      expect(mockLogger.info).toHaveBeenCalledWith('✓ All infrastructure services are healthy');
    });

    it('should wait for all infrastructure sequentially (success)', async () => {
      const specs: InfrastructureSpec[] = [
        {
          capability: 'messaging',
          provider: 'docker',
          serviceName: 'nats',
          config: {},
          healthCheck: {
            test: ['CMD', 'wget', '--spider', 'http://localhost:8222/healthz'],
            interval: '5s',
            timeout: '3s',
          },
        },
        {
          capability: 'caching',
          provider: 'docker',
          serviceName: 'redis',
          config: {},
          healthCheck: {
            test: ['CMD', 'redis-cli', 'ping'],
            interval: '5s',
            timeout: '3s',
          },
        },
      ];

      // Mock successful health checks
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'OK', stderr: '' });
        return {} as any;
      });

      await HealthGate.waitForInfrastructure(specs, {
        timeout: 10000,
        parallel: false,
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Waiting for nats...');
      expect(mockLogger.info).toHaveBeenCalledWith('Waiting for redis...');
      expect(mockLogger.info).toHaveBeenCalledWith('✓ All infrastructure services are healthy');
    });

    it('should throw detailed error when health checks fail (parallel)', async () => {
      const specs: InfrastructureSpec[] = [
        {
          capability: 'messaging',
          provider: 'docker',
          serviceName: 'nats',
          config: {},
          healthCheck: {
            test: ['CMD', 'wget', '--spider', 'http://localhost:8222/healthz'],
            interval: '5s',
            timeout: '3s',
          },
        },
        {
          capability: 'caching',
          provider: 'docker',
          serviceName: 'redis',
          config: {},
          healthCheck: {
            test: ['CMD', 'redis-cli', 'ping'],
            interval: '5s',
            timeout: '3s',
          },
        },
      ];

      // Mock failed health checks (timeout)
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(new Error('Command failed'), null);
        return {} as any;
      });

      await expect(
        HealthGate.waitForInfrastructure(specs, {
          timeout: 3000, // Short timeout for test
          parallel: true,
          logger: mockLogger,
        })
      ).rejects.toThrow(/Infrastructure health check failed/);
    });

    it('should throw timeout error with troubleshooting for single service', async () => {
      const specs: InfrastructureSpec[] = [
        {
          capability: 'persistence',
          provider: 'docker',
          serviceName: 'postgres',
          config: {},
          healthCheck: {
            test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
            interval: '10s',
            timeout: '5s',
          },
        },
      ];

      // Mock failed health checks
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(new Error('Connection refused'), null);
        return {} as any;
      });

      await expect(
        HealthGate.waitForInfrastructure(specs, {
          timeout: 3000, // Short timeout for test
          parallel: true,
          logger: mockLogger,
        })
      ).rejects.toThrow(/Timeout after .* waiting for postgres/);
    });

    it('should handle mixed success/failure scenarios', async () => {
      const specs: InfrastructureSpec[] = [
        {
          capability: 'messaging',
          provider: 'docker',
          serviceName: 'nats',
          config: {},
          healthCheck: {
            test: ['CMD', 'wget', '--spider', 'http://localhost:8222/healthz'],
            interval: '5s',
            timeout: '3s',
          },
        },
        {
          capability: 'caching',
          provider: 'docker',
          serviceName: 'redis',
          config: {},
          healthCheck: {
            test: ['CMD', 'redis-cli', 'ping'],
            interval: '5s',
            timeout: '3s',
          },
        },
      ];

      let callCount = 0;
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callCount++;
        // NATS succeeds, Redis fails
        if (cmd.includes('nats') || cmd.includes('wget')) {
          callback(null, { stdout: 'OK', stderr: '' });
        } else {
          callback(new Error('Connection refused'), null);
        }
        return {} as any;
      });

      await expect(
        HealthGate.waitForInfrastructure(specs, {
          timeout: 3000,
          parallel: true,
          logger: mockLogger,
        })
      ).rejects.toThrow(/Infrastructure health check failed/);
    });

    it('should use default timeout when not specified', async () => {
      const specs: InfrastructureSpec[] = [
        {
          capability: 'messaging',
          provider: 'docker',
          serviceName: 'nats',
          config: {},
          healthCheck: {
            test: ['CMD', 'wget', '--spider', 'http://localhost:8222/healthz'],
            interval: '5s',
            timeout: '3s',
          },
        },
      ];

      // Mock successful health check
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'OK', stderr: '' });
        return {} as any;
      });

      await HealthGate.waitForInfrastructure(specs);

      // Should complete without error (using default 60s timeout)
    });
  });

  describe('pollUntilHealthy (internal)', () => {
    it('should succeed when service becomes healthy immediately', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock successful health check
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(null, { stdout: 'ready', stderr: '' });
        return {} as any;
      });

      // Call via waitForInfrastructure to test pollUntilHealthy
      await HealthGate.waitForInfrastructure([spec], {
        timeout: 5000,
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith('✓ postgres is healthy');
    });

    it('should retry until timeout and throw detailed error', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock always-failing health check
      // Note: checkHealth() catches errors and returns false, doesn't throw
      // So debug logging won't be triggered (only happens if checkHealth throws)
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(new Error('Connection refused'), null);
        return {} as any;
      });

      await expect(
        HealthGate.waitForInfrastructure([spec], {
          timeout: 3000, // Short timeout for test
          logger: mockLogger,
        })
      ).rejects.toThrow(/Timeout after .* waiting for postgres/);

      // Verify timeout error was thrown (debug logs not called when checkHealth returns false)
    });

    it('should include troubleshooting information in timeout error', async () => {
      const spec: InfrastructureSpec = {
        capability: 'persistence',
        provider: 'docker',
        serviceName: 'postgres',
        config: {},
        healthCheck: {
          test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
          interval: '10s',
          timeout: '5s',
        },
      };

      // Mock always-failing health check
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(new Error('Connection refused'), null);
        return {} as any;
      });

      try {
        await HealthGate.waitForInfrastructure([spec], {
          timeout: 3000,
          logger: mockLogger,
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('Troubleshooting:');
        expect(error.message).toContain('Check service is running: docker ps --filter name=postgres');
        expect(error.message).toContain('Check service logs: docker logs bitbrat-postgres-1');
        expect(error.message).toContain('Verify health check:');
        expect(error.message).toContain('Check configuration in architecture.yaml:');
      }
    });

    it('should handle services without health checks', async () => {
      const spec: InfrastructureSpec = {
        capability: 'messaging',
        provider: 'docker',
        serviceName: 'nats',
        config: {},
        // No health check
      };

      await HealthGate.waitForInfrastructure([spec], {
        timeout: 5000,
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith('✓ nats is healthy');
    });
  });

  describe('Error message formatting', () => {
    it('should format parallel failure error with multiple services', async () => {
      const specs: InfrastructureSpec[] = [
        {
          capability: 'messaging',
          provider: 'docker',
          serviceName: 'nats',
          config: {},
          healthCheck: { test: ['CMD', 'echo', 'ok'], interval: '5s', timeout: '3s' },
        },
        {
          capability: 'caching',
          provider: 'docker',
          serviceName: 'redis',
          config: {},
          healthCheck: { test: ['CMD', 'echo', 'ok'], interval: '5s', timeout: '3s' },
        },
        {
          capability: 'persistence',
          provider: 'docker',
          serviceName: 'postgres',
          config: {},
          healthCheck: { test: ['CMD', 'echo', 'ok'], interval: '5s', timeout: '3s' },
        },
      ];

      // All fail
      mockExec.mockImplementation((cmd: any, opts: any, callback: any) => {
        callback(new Error('Connection refused'), null);
        return {} as any;
      });

      try {
        await HealthGate.waitForInfrastructure(specs, {
          timeout: 3000,
          parallel: true,
          logger: mockLogger,
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('Infrastructure health check failed:');
        expect(error.message).toContain('nats:');
        expect(error.message).toContain('redis:');
        expect(error.message).toContain('postgres:');
        expect(error.message).toContain('documentation/troubleshooting/infrastructure.md');
      }
    });
  });
});

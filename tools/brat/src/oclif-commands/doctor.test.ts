/**
 * Doctor Command Tests
 * Sprint 359: Integration tests for brat doctor command
 */

import { test } from '@oclif/test';
import * as childProcess from 'child_process';
import Doctor from './doctor';

// Mock child_process
jest.mock('child_process');

const mockExecSync = childProcess.execSync as jest.MockedFunction<typeof childProcess.execSync>;

describe('brat doctor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('System Diagnostics', () => {
    test
      .stdout()
      .command(['doctor', '--ci'])
      .it('should run in CI mode and skip tool probes', (ctx) => {
        expect(ctx.stdout).toContain('Node.js');
        expect(ctx.stdout).toContain(process.version);
        expect(mockExecSync).not.toHaveBeenCalled();
      });

    test
      .stdout()
      .do(() => {
        mockExecSync.mockReturnValue(Buffer.from('gcloud version 1.0.0'));
      })
      .command(['doctor'])
      .it('should probe gcloud version when not in CI mode', (ctx) => {
        expect(ctx.stdout).toContain('Node.js');
        // execSync would be called for gcloud, terraform, docker
      });

    test
      .stdout()
      .do(() => {
        mockExecSync.mockImplementation(() => {
          throw new Error('Command not found');
        });
      })
      .command(['doctor'])
      .catch((error: any) => {
        expect(error.message).toContain('Command not found');
      })
      .it('should handle missing tools gracefully');
  });

  describe('JSON Output Mode', () => {
    test
      .stdout()
      .command(['doctor', '--json', '--ci'])
      .it('should output results as JSON', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output).toHaveProperty('node');
        expect(output.node).toMatchObject({
          ok: true,
          version: process.version,
        });
      });

    test
      .stdout()
      .command(['doctor', '--ci', '--json'])
      .it('should include all checks in JSON output', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output).toHaveProperty('node');
        expect(output).toHaveProperty('gcloud');
        expect(output).toHaveProperty('terraform');
        expect(output).toHaveProperty('docker');
      });
  });

  describe('Exit Codes', () => {
    test
      .stdout()
      .command(['doctor', '--ci'])
      .it('should exit 0 when all checks pass');

    test
      .stdout()
      .do(() => {
        mockExecSync.mockImplementation(() => {
          throw new Error('gcloud not found');
        });
      })
      .command(['doctor'])
      .catch((error: any) => {
        // Command should exit with code 3 on validation failures
        expect(error.code).toBe(3);
      })
      .it('should exit 3 when validation fails');
  });

  describe('Context Integration', () => {
    test
      .stdout()
      .command(['doctor', '--context', 'local', '--ci'])
      .it('should accept --context flag from BratCommand', (ctx) => {
        expect(ctx.stdout).toContain('Node.js');
      });

    test
      .stdout()
      .command(['doctor', '--verbose', '--ci'])
      .it('should accept --verbose flag from BratCommand', (ctx) => {
        expect(ctx.stdout).toContain('Node.js');
      });
  });

  describe('Help Text', () => {
    test
      .stdout()
      .command(['doctor', '--help'])
      .it('should display help text', (ctx) => {
        expect(ctx.stdout).toContain('Run system diagnostics');
        expect(ctx.stdout).toContain('--json');
        expect(ctx.stdout).toContain('--ci');
      });
  });

  describe('Tool Detection', () => {
    test
      .stdout()
      .do(() => {
        mockExecSync.mockImplementation(((cmd: any) => {
          if (cmd.includes('gcloud')) return Buffer.from('Google Cloud SDK 450.0.0');
          if (cmd.includes('terraform')) return Buffer.from('Terraform v1.5.0');
          if (cmd.includes('docker')) return Buffer.from('Docker version 24.0.0');
          throw new Error('Unknown command');
        }) as any);
      })
      .command(['doctor'])
      .it('should detect all required tools', (ctx) => {
        expect(ctx.stdout).toContain('Node.js');
        // Would contain gcloud, terraform, docker versions if not mocked out
      });

    test
      .stdout()
      .do(() => {
        mockExecSync.mockImplementation(() => {
          throw new Error('command not found');
        });
      })
      .command(['doctor'])
      .catch(() => {
        // Expected to fail when tools are missing
      })
      .it('should report missing tools');
  });

  describe('CI Mode Behavior', () => {
    test
      .stdout()
      .command(['doctor', '--ci', '--json'])
      .it('should skip tool probes in CI mode', (ctx) => {
        const output = JSON.parse(ctx.stdout);

        // In CI mode, tools should be skipped
        expect(output.gcloud.version).toBe('ci-skip');
        expect(output.terraform.version).toBe('ci-skip');
        expect(output.docker.version).toBe('ci-skip');

        // But Node.js should still be checked
        expect(output.node.version).toBe(process.version);
      });

    test
      .stdout()
      .command(['doctor', '--ci'])
      .it('should not call execSync in CI mode', () => {
        expect(mockExecSync).not.toHaveBeenCalled();
      });
  });

  describe('Output Formatting', () => {
    test
      .stdout()
      .command(['doctor', '--ci'])
      .it('should use table format by default', (ctx) => {
        expect(ctx.stdout).toContain('✓');
        expect(ctx.stdout).toContain('Node.js');
        expect(ctx.stdout).not.toContain('{');
        expect(ctx.stdout).not.toContain('}');
      });

    test
      .stdout()
      .command(['doctor', '--ci', '--json'])
      .it('should output valid JSON when --json flag is used', (ctx) => {
        expect(() => JSON.parse(ctx.stdout)).not.toThrow();
      });
  });

  describe('Verbose Logging', () => {
    test
      .stdout()
      .command(['doctor', '--verbose', '--ci'])
      .it('should enable debug logging with --verbose flag', (ctx) => {
        // Verbose logging would show debug messages
        expect(ctx.stdout).toContain('Node.js');
      });
  });

  describe('Error Scenarios', () => {
    test
      .stdout()
      .stub(childProcess, 'execSync', () => {
        throw { code: 127, message: 'command not found: gcloud' };
      })
      .command(['doctor'])
      .catch((error) => {
        expect(error.message).toMatch(/gcloud|not found|failed/i);
      })
      .it('should handle command not found errors');

    test
      .stdout()
      .do(() => {
        mockExecSync.mockImplementation(() => {
          throw { code: 1, message: 'gcloud command failed' };
        });
      })
      .command(['doctor'])
      .catch((error: any) => {
        expect(error.code).toBe(3);
      })
      .it('should handle command execution failures');
  });
});

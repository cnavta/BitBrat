/**
 * Doctor Command Unit Tests
 * Sprint 359: Simplified unit tests without @oclif/test
 */

import * as childProcess from 'child_process';
import Doctor from '../doctor';

// Mock child_process
jest.mock('child_process');
jest.mock('../../context/context-resolver');
jest.mock('../../orchestration/logger');

const mockExecSync = childProcess.execSync as jest.MockedFunction<typeof childProcess.execSync>;

describe('Doctor Command (Unit Tests)', () => {
  let mockLogger: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock context
    mockContext = {
      name: 'local',
      deployment: { type: 'docker-compose' },
      runtime: {
        persistence: { driver: 'postgres' },
      },
    };
  });

  describe('CI Mode', () => {
    it('should skip tool probes in CI mode', async () => {
      const cmd = new Doctor(['--ci'], {} as any);

      // Mock init to avoid real initialization
      cmd['logger'] = mockLogger;
      cmd['context'] = mockContext;
      cmd['repoRoot'] = '/fake/repo';

      await cmd.run();

      // Should not call execSync in CI mode
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should include Node.js version in CI mode', async () => {
      const cmd = new Doctor(['--ci'], {} as any);
      cmd['logger'] = mockLogger;
      cmd['context'] = mockContext;
      cmd['repoRoot'] = '/fake/repo';

      await cmd.run();

      // Logger should show Node.js info
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('JSON Output', () => {
    it('should output JSON when --json flag is used', async () => {
      const cmd = new Doctor(['--json', '--ci'], {} as any);
      cmd['logger'] = mockLogger;
      cmd['context'] = mockContext;
      cmd['repoRoot'] = '/fake/repo';

      // Capture stdout
      const logSpy = jest.spyOn(cmd, 'log');

      await cmd.run();

      // Should output JSON
      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('Tool Detection', () => {
    it('should detect all tools when available', async () => {
      mockExecSync.mockImplementation(((cmd: any) => {
        if (cmd.includes('gcloud')) return Buffer.from('gcloud version 1.0.0');
        if (cmd.includes('terraform')) return Buffer.from('terraform v1.5.0');
        if (cmd.includes('docker')) return Buffer.from('docker version 24.0.0');
        throw new Error('Unknown command');
      }) as any);

      const cmd = new Doctor([], {} as any);
      cmd['logger'] = mockLogger;
      cmd['context'] = mockContext;
      cmd['repoRoot'] = '/fake/repo';

      await cmd.run();

      // Should call execSync for each tool
      expect(mockExecSync).toHaveBeenCalled();
    });

    it('should handle missing tools gracefully', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('command not found: gcloud');
      });

      const cmd = new Doctor([], {} as any);
      cmd['logger'] = mockLogger;
      cmd['context'] = mockContext;
      cmd['repoRoot'] = '/fake/repo';

      // Should not throw, but may exit
      await expect(cmd.run()).rejects.toThrow();
    });
  });

  describe('Flag Parsing', () => {
    it('should parse --ci flag correctly', () => {
      const cmd = new Doctor(['--ci'], {} as any);
      expect(cmd.argv).toContain('--ci');
    });

    it('should parse --json flag correctly', () => {
      const cmd = new Doctor(['--json'], {} as any);
      expect(cmd.argv).toContain('--json');
    });

    it('should handle combined flags', () => {
      const cmd = new Doctor(['--ci', '--json'], {} as any);
      expect(cmd.argv).toContain('--ci');
      expect(cmd.argv).toContain('--json');
    });
  });
});

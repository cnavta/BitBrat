/**
 * Hook Executor Unit Tests
 * Sprint 15: Deployment Lifecycle Hooks
 */

import { HookExecutor, HookContext, HookType } from './hook-executor';
import { execCmd } from '../exec';
import * as fs from 'fs';
import * as path from 'path';

// Mock execCmd
jest.mock('../exec');
const mockExecCmd = execCmd as jest.MockedFunction<typeof execCmd>;

// Mock fs module
jest.mock('fs');
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

describe('HookExecutor', () => {
  let executor: HookExecutor;
  let mockContext: HookContext;
  const testRepoRoot = '/test/repo';

  beforeEach(() => {
    executor = new HookExecutor();
    mockContext = {
      contextName: 'test-context',
      deploymentType: 'docker-compose',
      services: ['test-service'],
      repoRoot: testRepoRoot,
      verbose: false,
    };

    // Reset mocks
    jest.clearAllMocks();

    // Mock fs.existsSync to return true by default
    mockExistsSync.mockReturnValue(true);

    // Mock fs.statSync to return executable file
    mockStatSync.mockReturnValue({
      mode: 0o755, // Executable
    } as fs.Stats);

    // Mock successful execution by default
    mockExecCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  });

  describe('execute() - local hook execution', () => {
    describe('hook skipping', () => {
      it('should skip when hook path is undefined', async () => {
        const result = await executor.execute('pre-deploy', undefined, mockContext);

        expect(result).toEqual({
          success: true,
          skipped: true,
        });
        expect(mockExecCmd).not.toHaveBeenCalled();
      });

      it('should log skip message when verbose is enabled', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        mockContext.verbose = true;

        await executor.execute('pre-deploy', undefined, mockContext);

        expect(consoleSpy).toHaveBeenCalledWith('[hooks] No pre-deploy hook defined, skipping');
        consoleSpy.mockRestore();
      });
    });

    describe('hook validation', () => {
      it('should throw error if hook file does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        await expect(
          executor.execute('pre-deploy', '.brat/hooks/pre-deploy.sh', mockContext)
        ).rejects.toThrow(
          'pre-deploy hook not found: .brat/hooks/pre-deploy.sh'
        );
      });

      it('should throw error if hook file is not executable (Unix)', async () => {
        // Mock non-executable file
        mockStatSync.mockReturnValue({
          mode: 0o644, // Not executable
        } as fs.Stats);

        // Skip test on Windows
        if (process.platform === 'win32') {
          return;
        }

        await expect(
          executor.execute('pre-deploy', '.brat/hooks/pre-deploy.sh', mockContext)
        ).rejects.toThrow(
          'pre-deploy hook is not executable: .brat/hooks/pre-deploy.sh'
        );
      });

      it('should reject TypeScript hooks (not yet supported)', async () => {
        await expect(
          executor.execute('pre-deploy', '.brat/hooks/pre-deploy.ts', mockContext)
        ).rejects.toThrow(
          'TypeScript/JavaScript hooks not yet supported'
        );
      });

      it('should reject JavaScript hooks (not yet supported)', async () => {
        await expect(
          executor.execute('pre-deploy', '.brat/hooks/pre-deploy.js', mockContext)
        ).rejects.toThrow(
          'TypeScript/JavaScript hooks not yet supported'
        );
      });
    });

    describe('hook execution', () => {
      it('should execute shell hook successfully', async () => {
        const hookPath = '.brat/hooks/pre-deploy.sh';
        mockExecCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

        const result = await executor.execute('pre-deploy', hookPath, mockContext);

        expect(result.success).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.exitCode).toBe(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);

        expect(mockExecCmd).toHaveBeenCalledWith(
          path.join(testRepoRoot, hookPath),
          [],
          expect.objectContaining({
            cwd: testRepoRoot,
            stdio: 'inherit',
          })
        );
      });

      it('should pass environment variables to hook', async () => {
        const hookPath = '.brat/hooks/pre-deploy.sh';
        mockContext.targetHost = 'ssh://root@bitbrat.lan';
        mockContext.remoteDir = '/opt/bitbrat-staging';

        await executor.execute('pre-deploy', hookPath, mockContext);

        const execCall = mockExecCmd.mock.calls[0];
        const options = execCall[2];

        expect(options?.env).toMatchObject({
          BRAT_CONTEXT_NAME: 'test-context',
          BRAT_DEPLOYMENT_TYPE: 'docker-compose',
          BRAT_SERVICES: 'test-service',
          BRAT_REPO_ROOT: testRepoRoot,
          BRAT_TARGET_HOST: 'ssh://root@bitbrat.lan',
          BRAT_REMOTE_DIR: '/opt/bitbrat-staging',
        });
      });

      it('should not set BRAT_TARGET_HOST if not provided', async () => {
        const hookPath = '.brat/hooks/pre-deploy.sh';

        await executor.execute('pre-deploy', hookPath, mockContext);

        const execCall = mockExecCmd.mock.calls[0];
        const options = execCall[2];

        expect(options?.env).not.toHaveProperty('BRAT_TARGET_HOST');
        expect(options?.env).not.toHaveProperty('BRAT_REMOTE_DIR');
      });

      it('should throw error if hook exits with non-zero code', async () => {
        const hookPath = '.brat/hooks/pre-deploy.sh';
        mockExecCmd.mockResolvedValue({ code: 1, stdout: '', stderr: 'Hook failed' });

        await expect(
          executor.execute('pre-deploy', hookPath, mockContext)
        ).rejects.toThrow(
          'pre-deploy hook failed with exit code 1'
        );
      });

      it('should log success message on completion', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        const hookPath = '.brat/hooks/pre-deploy.sh';

        await executor.execute('pre-deploy', hookPath, mockContext);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/✓ pre-deploy hook succeeded \(\d+ms\)/)
        );
        consoleSpy.mockRestore();
      });
    });

    describe('hook types', () => {
      const hookTypes: HookType[] = ['pre-deploy', 'pre-build', 'post-build', 'post-deploy'];

      hookTypes.forEach((hookType) => {
        it(`should execute ${hookType} hook`, async () => {
          const hookPath = `.brat/hooks/${hookType}.sh`;

          const result = await executor.execute(hookType, hookPath, mockContext);

          expect(result.success).toBe(true);
          expect(result.skipped).toBe(false);
        });
      });
    });
  });

  describe('executeRemote() - remote hook execution', () => {
    beforeEach(() => {
      mockContext.targetHost = 'ssh://root@bitbrat.lan';
      mockContext.remoteDir = '/opt/bitbrat-staging';
    });

    describe('hook skipping', () => {
      it('should skip when hook path is undefined', async () => {
        const result = await executor.executeRemote('pre-build', undefined, mockContext);

        expect(result).toEqual({
          success: true,
          skipped: true,
        });
        expect(mockExecCmd).not.toHaveBeenCalled();
      });

      it('should log skip message when verbose is enabled', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        mockContext.verbose = true;

        await executor.executeRemote('pre-build', undefined, mockContext);

        expect(consoleSpy).toHaveBeenCalledWith(
          '[hooks] No pre-build hook defined, skipping remote execution'
        );
        consoleSpy.mockRestore();
      });
    });

    describe('remote context validation', () => {
      it('should throw error if targetHost is missing', async () => {
        delete mockContext.targetHost;

        await expect(
          executor.executeRemote('pre-build', '.brat/hooks/pre-build.sh', mockContext)
        ).rejects.toThrow(
          'Remote hook execution requires targetHost and remoteDir in context'
        );
      });

      it('should throw error if remoteDir is missing', async () => {
        delete mockContext.remoteDir;

        await expect(
          executor.executeRemote('pre-build', '.brat/hooks/pre-build.sh', mockContext)
        ).rejects.toThrow(
          'Remote hook execution requires targetHost and remoteDir in context'
        );
      });
    });

    describe('remote hook execution', () => {
      it('should execute hook via SSH', async () => {
        const hookPath = '.brat/hooks/pre-build.sh';
        mockExecCmd.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

        const result = await executor.executeRemote('pre-build', hookPath, mockContext);

        expect(result.success).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.exitCode).toBe(0);

        expect(mockExecCmd).toHaveBeenCalledWith(
          'ssh',
          [
            'root@bitbrat.lan',
            expect.stringContaining('cd "/opt/bitbrat-staging"'),
          ],
          expect.objectContaining({
            cwd: testRepoRoot,
            stdio: 'inherit',
          })
        );
      });

      it('should pass environment variables in SSH command', async () => {
        const hookPath = '.brat/hooks/pre-build.sh';

        await executor.executeRemote('pre-build', hookPath, mockContext);

        const execCall = mockExecCmd.mock.calls[0];
        const sshCommand = execCall[1][1];

        expect(sshCommand).toContain('BRAT_CONTEXT_NAME=test-context');
        expect(sshCommand).toContain('BRAT_DEPLOYMENT_TYPE=docker-compose');
        expect(sshCommand).toContain('BRAT_SERVICES="test-service"');
        expect(sshCommand).toContain('BRAT_REPO_ROOT=/opt/bitbrat-staging');
        expect(sshCommand).toContain('BRAT_TARGET_HOST=ssh://root@bitbrat.lan');
        expect(sshCommand).toContain('BRAT_REMOTE_DIR=/opt/bitbrat-staging');
      });

      it('should handle SSH host with port', async () => {
        mockContext.targetHost = 'ssh://root@bitbrat.lan:2222';
        const hookPath = '.brat/hooks/pre-build.sh';

        await executor.executeRemote('pre-build', hookPath, mockContext);

        const execCall = mockExecCmd.mock.calls[0];
        const sshHost = execCall[1][0];

        expect(sshHost).toBe('root@bitbrat.lan:2222');
      });

      it('should throw error if remote hook fails', async () => {
        const hookPath = '.brat/hooks/pre-build.sh';
        mockExecCmd.mockResolvedValue({ code: 1, stdout: '', stderr: 'Remote hook failed' });

        await expect(
          executor.executeRemote('pre-build', hookPath, mockContext)
        ).rejects.toThrow(
          'pre-build hook failed on remote with exit code 1'
        );
      });

      it('should log success message on completion', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        const hookPath = '.brat/hooks/pre-build.sh';

        await executor.executeRemote('pre-build', hookPath, mockContext);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/✓ pre-build hook succeeded on remote \(\d+ms\)/)
        );
        consoleSpy.mockRestore();
      });
    });
  });

  describe('multiple services', () => {
    it('should pass multiple services as space-separated string', async () => {
      mockContext.services = ['service-a', 'service-b', 'service-c'];
      const hookPath = '.brat/hooks/pre-deploy.sh';

      await executor.execute('pre-deploy', hookPath, mockContext);

      const execCall = mockExecCmd.mock.calls[0];
      const options = execCall[2];

      expect(options?.env?.BRAT_SERVICES).toBe('service-a service-b service-c');
    });
  });

  describe('error messages', () => {
    it('should include hook path in file not found error', async () => {
      mockExistsSync.mockReturnValue(false);

      try {
        await executor.execute('post-deploy', '.brat/hooks/missing.sh', mockContext);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('Check deployment.hooks.post-deploy');
        expect(error.message).toContain('.brat/hooks/missing.sh');
      }
    });

    it('should include context name in error messages', async () => {
      mockExistsSync.mockReturnValue(false);
      mockContext.contextName = 'staging';

      try {
        await executor.execute('post-deploy', '.brat/hooks/missing.sh', mockContext);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('executionContexts.staging');
      }
    });
  });
});
